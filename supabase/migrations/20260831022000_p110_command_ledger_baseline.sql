begin;

create table if not exists public.p110_command_receipts (
  tenant_id text not null,
  receipt_id text not null,
  command_id text not null,
  command_type text not null,
  idempotency_key text not null,
  payload_hash text not null,
  correlation_id text not null,
  causation_id text,
  workflow_id text,
  step_id text,
  target_owner_project text not null,
  target_object_type text not null,
  target_object_id text not null,
  expected_object_version text not null,
  committed_object_version text,
  policy_version text not null,
  actor_id text not null,
  actor_type text not null check (actor_type in ('user','agent','service','system')),
  actor_roles jsonb not null default '[]'::jsonb,
  state text not null check (state in ('RECEIVED','VALIDATED','DOMAIN_COMMITTED','DISPATCH_PENDING','DISPATCHED','PROVIDER_ACKNOWLEDGED','SOURCE_CONFIRMED','RETRY_SCHEDULED','RECONCILIATION_REQUIRED','DEAD_LETTERED','BLOCKED','CANCELLED','FAILED')),
  event_id text,
  outbox_message_id text,
  requested_at timestamptz not null,
  committed_at timestamptz,
  source_confirmed_at timestamptz,
  source_readback_ref text,
  failure_class text,
  last_error_code text,
  last_error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, receipt_id),
  unique (tenant_id, command_id),
  unique (tenant_id, idempotency_key),
  check (state in ('RECEIVED','VALIDATED','BLOCKED','CANCELLED','FAILED') or committed_object_version is not null),
  check (source_confirmed_at is null or source_readback_ref is not null),
  check (coalesce(metadata->>'tenantOverrideAccepted','false') <> 'true'),
  check (coalesce(metadata->>'actorOverrideAccepted','false') <> 'true'),
  check (coalesce(metadata->>'sourceConfirmedByProviderAck','false') <> 'true')
);

create table if not exists public.p110_event_envelopes (
  tenant_id text not null,
  event_id text not null,
  contract_version text not null default '1.0' check (contract_version = '1.0'),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$'),
  event_version integer not null check (event_version > 0),
  authority_class text not null check (authority_class in ('BUSINESS_FACT','COMMAND_EVIDENCE','INTEGRATION_EVIDENCE','OBSERVATION','PROJECTION','RECOMMENDATION')),
  producer_project text not null,
  subject_owner_project text not null,
  subject_object_type text not null,
  subject_object_id text not null,
  subject_object_version text not null,
  subject_source_refs jsonb not null default '[]'::jsonb,
  actor_id text not null,
  actor_type text not null check (actor_type in ('user','agent','service','system')),
  actor_roles jsonb not null default '[]'::jsonb,
  correlation_id text not null,
  causation_id text,
  command_id text,
  workflow_id text,
  step_id text,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  privacy_class text not null default 'INTERNAL' check (privacy_class in ('INTERNAL','RESTRICTED','TENANT_VISIBLE')),
  retention_class text not null default 'OPERATIONAL' check (retention_class in ('AUDIT','OPERATIONAL','TRANSIENT')),
  correction_of text,
  supersedes text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, event_id),
  unique (tenant_id, producer_project, event_type, idempotency_key)
);

comment on table public.p110_event_envelopes is
  'Universal integration envelope evidence. Canonical business facts remain owned by the subject owner project.';

create table if not exists public.p110_idempotency_conflicts (
  tenant_id text not null,
  conflict_id text not null,
  command_id text not null,
  idempotency_key text not null,
  existing_payload_hash text not null,
  received_payload_hash text not null,
  correlation_id text not null,
  observed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_ref text,
  primary key (tenant_id, conflict_id),
  check (existing_payload_hash <> received_payload_hash),
  check (resolved_at is null or resolution_ref is not null)
);

alter table public.p110_idempotency_conflicts
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_ref text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.p110_idempotency_conflicts'::regclass
       and conname = 'p110_idempotency_conflicts_resolution_check'
  ) then
    alter table public.p110_idempotency_conflicts
      add constraint p110_idempotency_conflicts_resolution_check
      check (resolved_at is null or resolution_ref is not null);
  end if;
end $$;

create table if not exists public.p110_outbox_messages (
  tenant_id text not null,
  outbox_message_id text not null,
  receipt_id text not null,
  event_id text not null,
  destination text not null,
  effect_class text not null check (effect_class in ('NO_EFFECT','REVERSIBLE_INTERNAL','EXTERNAL_EFFECT')),
  authorization_ref text,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  state text not null default 'PENDING' check (state in ('PENDING','CLAIMED','DISPATCHED','PROVIDER_ACKNOWLEDGED','SOURCE_CONFIRMED','RETRY_SCHEDULED','RECONCILIATION_REQUIRED','DEAD_LETTERED','BLOCKED','CANCELLED')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  lock_owner text,
  provider_acknowledged_at timestamptz,
  provider_acknowledgement_ref text,
  source_confirmed_at timestamptz,
  source_readback_ref text,
  failure_class text,
  last_error_code text,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, outbox_message_id),
  unique (tenant_id, receipt_id),
  unique (tenant_id, destination, idempotency_key),
  foreign key (tenant_id, receipt_id) references public.p110_command_receipts(tenant_id, receipt_id),
  foreign key (tenant_id, event_id) references public.p110_event_envelopes(tenant_id, event_id),
  check (attempt_count >= 0 and max_attempts between 1 and 20 and attempt_count <= max_attempts),
  check (effect_class <> 'EXTERNAL_EFFECT' or authorization_ref is not null),
  check (provider_acknowledged_at is null or provider_acknowledgement_ref is not null),
  check (source_confirmed_at is null or source_readback_ref is not null),
  check (failure_class is null or failure_class in ('AMBIGUOUS_AFTER_ACK','CONTRACT_VIOLATION','PERMANENT','POLICY_BLOCKED','RATE_LIMITED','TRANSIENT_BEFORE_ACK'))
);

comment on table public.p110_outbox_messages is
  'Transactional outbox. Claimers must use FOR UPDATE SKIP LOCKED and preserve the idempotency key across attempts.';

create index if not exists p110_receipts_correlation_idx
  on public.p110_command_receipts (tenant_id, correlation_id, requested_at desc);
create index if not exists p110_events_correlation_idx
  on public.p110_event_envelopes (tenant_id, correlation_id, recorded_at desc);
create index if not exists p110_events_subject_idx
  on public.p110_event_envelopes (tenant_id, subject_object_type, subject_object_id, recorded_at desc);
create index if not exists p110_outbox_claim_idx
  on public.p110_outbox_messages (tenant_id, not_before, created_at)
  where state in ('PENDING','RETRY_SCHEDULED');
create index if not exists p110_outbox_reconcile_idx
  on public.p110_outbox_messages (tenant_id, updated_at)
  where state = 'RECONCILIATION_REQUIRED';

alter table public.p110_command_receipts enable row level security;
alter table public.p110_command_receipts force row level security;
alter table public.p110_event_envelopes enable row level security;
alter table public.p110_event_envelopes force row level security;
alter table public.p110_idempotency_conflicts enable row level security;
alter table public.p110_idempotency_conflicts force row level security;
alter table public.p110_outbox_messages enable row level security;
alter table public.p110_outbox_messages force row level security;

drop policy if exists p110_command_receipts_tenant_policy on public.p110_command_receipts;
create policy p110_command_receipts_tenant_policy on public.p110_command_receipts
  using (tenant_id = (select current_setting('app.tenant_id', true)))
  with check (tenant_id = (select current_setting('app.tenant_id', true)));
drop policy if exists p110_event_envelopes_tenant_policy on public.p110_event_envelopes;
create policy p110_event_envelopes_tenant_policy on public.p110_event_envelopes
  using (tenant_id = (select current_setting('app.tenant_id', true)))
  with check (tenant_id = (select current_setting('app.tenant_id', true)));
drop policy if exists p110_idempotency_conflicts_tenant_policy on public.p110_idempotency_conflicts;
create policy p110_idempotency_conflicts_tenant_policy on public.p110_idempotency_conflicts
  using (tenant_id = (select current_setting('app.tenant_id', true)))
  with check (tenant_id = (select current_setting('app.tenant_id', true)));
drop policy if exists p110_outbox_messages_tenant_policy on public.p110_outbox_messages;
create policy p110_outbox_messages_tenant_policy on public.p110_outbox_messages
  using (tenant_id = (select current_setting('app.tenant_id', true)))
  with check (tenant_id = (select current_setting('app.tenant_id', true)));

revoke all on table public.p110_command_receipts from public;
revoke all on table public.p110_event_envelopes from public;
revoke all on table public.p110_idempotency_conflicts from public;
revoke all on table public.p110_outbox_messages from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.p110_command_receipts, public.p110_event_envelopes,
      public.p110_idempotency_conflicts, public.p110_outbox_messages from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.p110_command_receipts, public.p110_event_envelopes,
      public.p110_idempotency_conflicts, public.p110_outbox_messages from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.p110_command_receipts, public.p110_event_envelopes,
      public.p110_idempotency_conflicts, public.p110_outbox_messages from service_role;
    grant select, insert, update on table public.p110_command_receipts,
      public.p110_event_envelopes, public.p110_idempotency_conflicts,
      public.p110_outbox_messages to service_role;
  end if;
end $$;

commit;
