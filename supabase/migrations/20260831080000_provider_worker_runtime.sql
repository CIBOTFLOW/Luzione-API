begin;

alter table public.p110_outbox_messages
  add column if not exists dispatch_started_at timestamptz;

alter table public.p110_delivery_attempts
  add column if not exists adapter_contract_version text,
  add column if not exists provider_mode text,
  add column if not exists provider_request_ref text,
  add column if not exists source_readback_ref text;

alter table public.p110_delivery_attempts
  drop constraint if exists p110_delivery_attempts_provider_mode_check;
alter table public.p110_delivery_attempts
  add constraint p110_delivery_attempts_provider_mode_check
  check (provider_mode is null or provider_mode in ('SANDBOX','LIVE'));

alter table public.p110_reconciliation_checkpoints
  add column if not exists lease_owner text,
  add column if not exists lease_started_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_check_at timestamptz not null default now(),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 5;

alter table public.p110_reconciliation_checkpoints
  drop constraint if exists p110_reconciliation_lease_evidence_check;
alter table public.p110_reconciliation_checkpoints
  add constraint p110_reconciliation_lease_evidence_check check (
    (lease_owner is null and lease_started_at is null and heartbeat_at is null and lease_expires_at is null)
    or
    (result = 'PENDING' and lease_owner is not null and lease_started_at is not null
      and heartbeat_at is not null and lease_expires_at is not null
      and lease_expires_at > lease_started_at)
  );

alter table public.p110_reconciliation_checkpoints
  drop constraint if exists p110_reconciliation_attempt_budget_check;
alter table public.p110_reconciliation_checkpoints
  add constraint p110_reconciliation_attempt_budget_check
  check (attempt_count >= 0 and max_attempts between 1 and 20 and attempt_count <= max_attempts);

create index if not exists p110_reconciliation_due_claim_idx
  on public.p110_reconciliation_checkpoints (tenant_id, next_check_at, checked_at)
  where result = 'PENDING';
create index if not exists p110_delivery_attempt_started_idx
  on public.p110_delivery_attempts (tenant_id, outbox_message_id, attempt_number)
  where result = 'STARTED';

comment on column public.p110_outbox_messages.dispatch_started_at is
  'Durable boundary written before an adapter call. An abandoned started attempt must reconcile before retry.';
comment on column public.p110_reconciliation_checkpoints.lease_owner is
  'Restart-safe reconciliation claim owner; PENDING checkpoints are claimed with SKIP LOCKED.';

commit;
