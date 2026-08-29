begin;

alter table public.p110_outbox_messages
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists request_deadline_at timestamptz,
  add column if not exists adapter_version text,
  add column if not exists actual_cost jsonb;

update public.p110_outbox_messages
set state = 'RETRY_SCHEDULED',
    locked_at = null,
    lock_owner = null,
    not_before = now(),
    last_error_code = coalesce(last_error_code, 'LEASE_UPGRADE_RELEASED'),
    last_error_summary = coalesce(last_error_summary, 'A pre-runtime claimed lease was released during the durable execution upgrade.'),
    updated_at = now()
where state = 'CLAIMED'
  and lease_expires_at is null;

alter table public.p110_outbox_messages
  drop constraint if exists p110_outbox_lease_evidence_check;
alter table public.p110_outbox_messages
  add constraint p110_outbox_lease_evidence_check check (
    state <> 'CLAIMED'
    or (
      locked_at is not null
      and heartbeat_at is not null
      and lease_expires_at is not null
      and lock_owner is not null
      and lease_expires_at > locked_at
    )
  );

alter table public.p110_outbox_messages
  alter column max_attempts set default 6;

alter table public.p111_workflow_instances
  alter column retry_policy set default
    '{"delaysMs":[2000,10000,30000,120000,600000],"maxAttempts":6,"jitterRatio":0.2}'::jsonb;

create table public.platform_execution_steps (
  execution_step_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  legacy_tenant_id text not null,
  command_id text not null,
  receipt_id text not null,
  connection_id uuid,
  provider text not null,
  capability text not null,
  step_kind text not null check (step_kind in (
    'PROVIDER_REQUEST','PROVIDER_READBACK','COMPENSATION','RECONCILIATION'
  )),
  step_sequence integer not null check (step_sequence >= 0),
  state text not null default 'PENDING' check (state in (
    'PENDING','LEASED','RETRY_SCHEDULED','COMPLETED','FAILED','DEAD_LETTERED','CANCELLED'
  )),
  idempotency_key text not null,
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  output_digest text check (output_digest is null or output_digest ~ '^[a-f0-9]{64}$'),
  provider_request_ref text,
  source_readback_ref text,
  attempt_count integer not null default 0 check (attempt_count between 0 and 6),
  max_attempts integer not null default 6 check (max_attempts = 6),
  not_before timestamptz not null default now(),
  lease_owner text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  request_deadline_at timestamptz,
  last_error_code text,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, command_id, step_kind, step_sequence),
  unique (tenant_id, capability, idempotency_key),
  foreign key (legacy_tenant_id, receipt_id)
    references public.p110_command_receipts(tenant_id, receipt_id) on delete restrict,
  foreign key (tenant_id, connection_id)
    references public.integration_connections(tenant_id, connection_id) on delete restrict,
  constraint platform_execution_step_provider_check check (provider ~ '^[a-z][a-z0-9._-]+$'),
  constraint platform_execution_step_capability_check check (capability ~ '^[a-z][a-z0-9._-]+$'),
  constraint platform_execution_step_lease_check check (
    state <> 'LEASED'
    or (
      lease_owner is not null
      and leased_at is not null
      and heartbeat_at is not null
      and lease_expires_at is not null
      and lease_expires_at > leased_at
      and request_deadline_at is not null
    )
  ),
  constraint platform_execution_step_readback_check check (
    step_kind <> 'PROVIDER_READBACK'
    or state <> 'COMPLETED'
    or source_readback_ref is not null
  ),
  constraint platform_execution_step_completion_check check (
    state <> 'COMPLETED'
    or (completed_at is not null and output_digest is not null)
  )
);

create table public.integration_circuit_breakers (
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  circuit_key text not null,
  provider text not null,
  connection_id uuid,
  capability text not null,
  state text not null default 'CLOSED' check (state in ('CLOSED','OPEN','HALF_OPEN')),
  transient_failure_count integer not null default 0 check (transient_failure_count between 0 and 5),
  failure_window_started_at timestamptz,
  last_failure_at timestamptz,
  opened_at timestamptz,
  half_open_at timestamptz,
  probe_lease_owner text,
  probe_lease_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, circuit_key),
  foreign key (tenant_id, connection_id)
    references public.integration_connections(tenant_id, connection_id) on delete restrict,
  constraint integration_circuit_key_check check (circuit_key ~ '^[a-z][a-z0-9._:/-]+$'),
  constraint integration_circuit_open_check check (
    state <> 'OPEN'
    or (
      transient_failure_count = 5
      and opened_at is not null
      and half_open_at is not null
      and half_open_at >= opened_at + interval '5 minutes'
    )
  )
);

create table public.platform_audit_events (
  audit_event_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  identity_id text not null references public.platform_identities(identity_id),
  event_type text not null,
  command_id text,
  execution_step_id uuid references public.platform_execution_steps(execution_step_id),
  correlation_id text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object'
    and not luzione_api_private.jsonb_contains_secret_key(evidence)
  ),
  occurred_at timestamptz not null default now(),
  constraint platform_audit_event_type_check check (event_type ~ '^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$')
);

create table public.platform_effect_receipts (
  effect_receipt_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  command_id text not null,
  execution_step_id uuid not null references public.platform_execution_steps(execution_step_id),
  connection_id uuid,
  provider text not null,
  capability text not null,
  authority_contract_version text not null check (authority_contract_version in (
    'luzione-authority/v1','luzione-authority/v2'
  )),
  normalized_outcome jsonb not null check (
    jsonb_typeof(normalized_outcome) = 'object'
    and not luzione_api_private.jsonb_contains_secret_key(normalized_outcome)
  ),
  provider_readback jsonb not null check (
    jsonb_typeof(provider_readback) = 'object'
    and not luzione_api_private.jsonb_contains_secret_key(provider_readback)
  ),
  provider_request_ref text not null,
  source_readback_ref text not null,
  actual_cost jsonb,
  adapter_version text not null,
  audit_event_id uuid not null references public.platform_audit_events(audit_event_id),
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, command_id),
  unique (tenant_id, provider, provider_request_ref),
  foreign key (tenant_id, connection_id)
    references public.integration_connections(tenant_id, connection_id) on delete restrict
);

create or replace function luzione_api_private.guard_append_only_platform_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Platform evidence is append-only.';
end;
$$;

create trigger platform_audit_events_append_only
before update or delete on public.platform_audit_events
for each row execute function luzione_api_private.guard_append_only_platform_evidence();

create trigger platform_effect_receipts_append_only
before update or delete on public.platform_effect_receipts
for each row execute function luzione_api_private.guard_append_only_platform_evidence();

create unique index p110_command_receipts_v2_capability_idempotency_idx
  on public.p110_command_receipts (canonical_tenant_id, capability, idempotency_key)
  where authority_contract_version = 'luzione-authority/v2';
create index platform_execution_steps_due_idx
  on public.platform_execution_steps (not_before, created_at)
  where state in ('PENDING','RETRY_SCHEDULED');
create index platform_execution_steps_expired_lease_idx
  on public.platform_execution_steps (lease_expires_at)
  where state = 'LEASED';
create index integration_circuit_breakers_state_idx
  on public.integration_circuit_breakers (state, half_open_at)
  where state <> 'CLOSED';
create index platform_audit_events_tenant_time_idx
  on public.platform_audit_events (tenant_id, occurred_at desc);
create index platform_effect_receipts_tenant_time_idx
  on public.platform_effect_receipts (tenant_id, created_at desc);

insert into public.platform_object_ownership_registry
  (object_schema, object_name, owner_repository, previous_owner_repository,
   ownership_contract_version, transfer_evidence_ref)
values
  ('public','platform_execution_steps','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','durable-execution-runtime-v1'),
  ('public','integration_circuit_breakers','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','durable-execution-runtime-v1'),
  ('public','platform_audit_events','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','durable-execution-runtime-v1'),
  ('public','platform_effect_receipts','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','durable-execution-runtime-v1'),
  ('public','tenant_vault_secret_refs','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','vault-secret-store-boundary-v1')
on conflict (object_schema, object_name) do update set
  owner_repository = excluded.owner_repository,
  previous_owner_repository = excluded.previous_owner_repository,
  ownership_contract_version = excluded.ownership_contract_version,
  transfer_evidence_ref = excluded.transfer_evidence_ref,
  transferred_at = now();

alter table public.platform_execution_steps enable row level security;
alter table public.integration_circuit_breakers enable row level security;
alter table public.platform_audit_events enable row level security;
alter table public.platform_effect_receipts enable row level security;
alter table public.platform_execution_steps force row level security;
alter table public.integration_circuit_breakers force row level security;
alter table public.platform_audit_events force row level security;
alter table public.platform_effect_receipts force row level security;

revoke all on table public.platform_execution_steps from public, anon, authenticated, service_role;
revoke all on table public.integration_circuit_breakers from public, anon, authenticated, service_role;
revoke all on table public.platform_audit_events from public, anon, authenticated, service_role;
revoke all on table public.platform_effect_receipts from public, anon, authenticated, service_role;
grant select, insert, update on table public.platform_execution_steps to service_role;
grant select, insert, update on table public.integration_circuit_breakers to service_role;
grant select, insert on table public.platform_audit_events to service_role;
grant select, insert on table public.platform_effect_receipts to service_role;

revoke all on function luzione_api_private.guard_append_only_platform_evidence() from public, anon, authenticated;
grant execute on function luzione_api_private.guard_append_only_platform_evidence() to service_role;

comment on table public.platform_execution_steps is
  'API-owned durable execution state. Workers claim with SKIP LOCKED, use 60-second leases, and heartbeat every 20 seconds.';
comment on table public.integration_circuit_breakers is
  'Tenant/connection/capability circuits open after five transient failures in 60 seconds and half-open after five minutes.';

commit;
