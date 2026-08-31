begin;

alter table public.p110_outbox_messages
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists request_deadline_at timestamptz;

update public.p110_outbox_messages
   set state = 'RETRY_SCHEDULED',
       locked_at = null,
       lock_owner = null,
       not_before = now(),
       last_error_code = coalesce(last_error_code, 'LEASE_BASELINE_RELEASED'),
       last_error_summary = coalesce(last_error_summary, 'A claimed row without durable lease evidence was released during the workflow-delivery baseline.'),
       updated_at = now()
 where state = 'CLAIMED'
   and lease_expires_at is null;

alter table public.p110_outbox_messages
  drop constraint if exists p110_outbox_lease_evidence_check;
alter table public.p110_outbox_messages
  add constraint p110_outbox_lease_evidence_check check (
    state <> 'CLAIMED' or (
      locked_at is not null and heartbeat_at is not null and lease_expires_at is not null
      and request_deadline_at is not null and lock_owner is not null
      and lease_expires_at > locked_at and request_deadline_at <= lease_expires_at
    )
  );

create table if not exists public.p110_kill_switches (
  tenant_id text not null,
  switch_id text not null,
  scope_type text not null check (scope_type in ('GLOBAL','DESTINATION','WORKFLOW_DEFINITION','WORKFLOW_INSTANCE','COMMAND_TYPE')),
  scope_ref text not null,
  active boolean not null default true,
  reason text not null,
  activated_by text not null,
  activated_at timestamptz not null default now(),
  deactivated_by text,
  deactivated_at timestamptz,
  primary key (tenant_id, switch_id),
  unique (tenant_id, scope_type, scope_ref),
  check (deactivated_at is null or deactivated_by is not null)
);

create table if not exists public.p110_inbox_messages (
  tenant_id text not null,
  inbox_message_id text not null,
  producer text not null,
  producer_message_id text not null,
  event_type text not null,
  correlation_id text not null,
  payload_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'RECEIVED' check (state in ('RECEIVED','PROCESSING','PROCESSED','DUPLICATE','DEAD_LETTERED','REJECTED')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  receipt_id text,
  last_error_code text,
  lease_owner text,
  lease_started_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  primary key (tenant_id, inbox_message_id),
  unique (tenant_id, producer, producer_message_id)
);

alter table public.p110_inbox_messages
  add column if not exists lease_owner text,
  add column if not exists lease_started_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists lease_expires_at timestamptz;
alter table public.p110_inbox_messages
  drop constraint if exists p110_inbox_lease_evidence_check;
alter table public.p110_inbox_messages
  add constraint p110_inbox_lease_evidence_check check (
    state <> 'PROCESSING' or (
      lease_owner is not null and lease_started_at is not null and heartbeat_at is not null
      and lease_expires_at is not null and lease_expires_at > lease_started_at
    )
  );

create table if not exists public.p110_delivery_attempts (
  tenant_id text not null,
  attempt_id text not null,
  outbox_message_id text not null,
  attempt_number integer not null check (attempt_number > 0),
  failure_class text check (failure_class is null or failure_class in ('AMBIGUOUS_AFTER_ACK','CONTRACT_VIOLATION','PERMANENT','POLICY_BLOCKED','RATE_LIMITED','TRANSIENT_BEFORE_ACK')),
  result text not null check (result in ('STARTED','SUCCEEDED','FAILED','RETRY_SCHEDULED','RECONCILIATION_REQUIRED','BLOCKED')),
  started_at timestamptz not null,
  finished_at timestamptz,
  retry_at timestamptz,
  provider_acknowledgement_ref text,
  error_code text,
  error_summary text,
  telemetry jsonb not null default '{}'::jsonb,
  primary key (tenant_id, attempt_id),
  unique (tenant_id, outbox_message_id, attempt_number),
  foreign key (tenant_id, outbox_message_id)
    references public.p110_outbox_messages(tenant_id, outbox_message_id)
);

create table if not exists public.p110_dead_letters (
  tenant_id text not null,
  dead_letter_id text not null,
  message_kind text not null check (message_kind in ('COMMAND','INBOX','OUTBOX','WORKFLOW_SIGNAL')),
  message_ref text not null,
  correlation_id text not null,
  failure_class text not null,
  error_code text,
  error_summary text not null,
  payload_hash text not null,
  replay_policy text not null check (replay_policy in ('NEVER','AFTER_REPAIR','AFTER_RECONCILIATION','OPERATOR_ONLY')),
  state text not null default 'OPEN' check (state in ('OPEN','UNDER_REVIEW','REPLAY_APPROVED','REPLAYED','RESOLVED','QUARANTINED')),
  owner_ref text,
  review_by timestamptz,
  replayed_at timestamptz,
  replay_receipt_id text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, dead_letter_id),
  unique (tenant_id, message_kind, message_ref)
);

create table if not exists public.p110_reconciliation_checkpoints (
  tenant_id text not null,
  reconciliation_id text not null,
  receipt_id text not null,
  outbox_message_id text,
  source_system text not null,
  source_object_ref text not null,
  expected_object_version text,
  observed_object_version text,
  source_readback_ref text,
  result text not null check (result in ('PENDING','MATCHED','NOT_FOUND','VERSION_MISMATCH','AMBIGUOUS','SOURCE_UNAVAILABLE')),
  checked_at timestamptz not null,
  checked_by text not null,
  notes text,
  primary key (tenant_id, reconciliation_id),
  foreign key (tenant_id, receipt_id)
    references public.p110_command_receipts(tenant_id, receipt_id),
  check (result <> 'MATCHED' or source_readback_ref is not null)
);

create table if not exists public.p111_workflow_instances (
  tenant_id text not null,
  flow_id text not null,
  definition_id text not null,
  definition_version integer not null check (definition_version > 0),
  state text not null check (state in ('PLANNED','RUNNING','WAITING_FOR_FACT','WAITING_FOR_HUMAN','WAITING_FOR_PROVIDER','RESUMING','COMPENSATING','COMPLETED','FAILED','CANCELLED','SUPERSEDED','QUARANTINED')),
  state_version integer not null default 1 check (state_version > 0),
  current_step_id text,
  object_owner_project text not null,
  object_type text not null,
  object_id text not null,
  object_version text not null,
  object_source_refs jsonb not null default '[]'::jsonb,
  correlation_id text not null,
  idempotency_key text not null,
  last_event_id text,
  last_command_receipt_id text,
  last_outbox_message_id text,
  retry_policy jsonb not null default '{"backoffCoefficient":2,"baseDelayMs":1000,"maxAttempts":5,"maxDelayMs":900000}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  continuation_policy text not null default 'SIGNED_EXACT_VERSION' check (continuation_policy = 'SIGNED_EXACT_VERSION'),
  started_at timestamptz,
  completed_at timestamptz,
  last_transition_at timestamptz not null default now(),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, flow_id),
  unique (tenant_id, definition_id, idempotency_key),
  check (state not in ('COMPLETED','CANCELLED','SUPERSEDED') or completed_at is not null)
);

comment on table public.p111_workflow_instances is
  'Durable orchestration state. Every external effect must be represented by a P110 command receipt.';

create table if not exists public.p111_workflow_checkpoints (
  tenant_id text not null,
  checkpoint_id text not null,
  flow_id text not null,
  step_id text not null,
  checkpoint_name text not null,
  checkpoint_sequence integer not null check (checkpoint_sequence >= 0),
  owner_project text not null,
  state text not null check (state in ('PENDING','ACTIVE','COMPLETED','FAILED','SKIPPED','SUPERSEDED')),
  input_version text not null,
  output_version text,
  next_step_id text,
  evidence_refs jsonb not null default '[]'::jsonb,
  blocker_refs jsonb not null default '[]'::jsonb,
  command_receipt_id text,
  event_id text,
  state_version integer not null check (state_version > 0),
  activated_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, checkpoint_id),
  unique (tenant_id, flow_id, checkpoint_sequence),
  foreign key (tenant_id, flow_id) references public.p111_workflow_instances(tenant_id, flow_id),
  check (state <> 'COMPLETED' or (completed_at is not null and output_version is not null))
);

create table if not exists public.p111_step_attempts (
  tenant_id text not null,
  step_attempt_id text not null,
  flow_id text not null,
  checkpoint_id text not null,
  attempt_number integer not null check (attempt_number > 0),
  expected_state_version integer not null check (expected_state_version > 0),
  command_receipt_id text,
  failure_class text,
  result text not null check (result in ('STARTED','COMPLETED','FAILED','RETRY_SCHEDULED','RECONCILIATION_REQUIRED','BLOCKED')),
  retry_at timestamptz,
  started_at timestamptz not null,
  finished_at timestamptz,
  error_code text,
  error_summary text,
  primary key (tenant_id, step_attempt_id),
  unique (tenant_id, flow_id, checkpoint_id, attempt_number),
  foreign key (tenant_id, flow_id) references public.p111_workflow_instances(tenant_id, flow_id),
  foreign key (tenant_id, checkpoint_id) references public.p111_workflow_checkpoints(tenant_id, checkpoint_id)
);

create table if not exists public.p111_workflow_timers (
  tenant_id text not null,
  timer_id text not null,
  flow_id text not null,
  checkpoint_id text,
  timer_type text not null,
  fire_at timestamptz not null,
  state text not null default 'SCHEDULED' check (state in ('SCHEDULED','CLAIMED','FIRED','CANCELLED','SUPERSEDED')),
  fired_at timestamptz,
  cancellation_reason text,
  lease_owner text,
  lease_started_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, timer_id),
  foreign key (tenant_id, flow_id) references public.p111_workflow_instances(tenant_id, flow_id),
  check (state <> 'FIRED' or fired_at is not null)
);

alter table public.p111_workflow_timers
  add column if not exists lease_owner text,
  add column if not exists lease_started_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists lease_expires_at timestamptz;
alter table public.p111_workflow_timers drop constraint if exists p111_timer_state_check;
alter table public.p111_workflow_timers
  add constraint p111_timer_state_check check (state in ('SCHEDULED','CLAIMED','FIRED','CANCELLED','SUPERSEDED'));
alter table public.p111_workflow_timers
  drop constraint if exists p111_timer_lease_evidence_check;
alter table public.p111_workflow_timers
  add constraint p111_timer_lease_evidence_check check (
    state <> 'CLAIMED' or (
      lease_owner is not null and lease_started_at is not null and heartbeat_at is not null
      and lease_expires_at is not null and lease_expires_at > lease_started_at
    )
  );

create table if not exists public.p111_human_task_refs (
  tenant_id text not null, human_task_ref_id text not null, flow_id text not null,
  checkpoint_id text, task_owner_ref text not null, decision_type text not null,
  exact_object_version text not null, status text not null default 'OPEN'
    check (status in ('OPEN','CLAIMED','DECIDED','EXPIRED','CANCELLED','SUPERSEDED')),
  due_at timestamptz, decision_ref text, decided_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, human_task_ref_id),
  foreign key (tenant_id, flow_id) references public.p111_workflow_instances(tenant_id, flow_id),
  check (status <> 'DECIDED' or (decision_ref is not null and decided_at is not null))
);

create table if not exists public.p111_compensation_intents (
  tenant_id text not null, compensation_id text not null, flow_id text not null,
  compensates_receipt_id text not null, reason text not null,
  state text not null default 'PLANNED'
    check (state in ('PLANNED','APPROVED','DISPATCH_PENDING','RUNNING','SOURCE_CONFIRMED','FAILED','CANCELLED')),
  command_receipt_id text, source_readback_ref text, created_by text not null,
  created_at timestamptz not null default now(), completed_at timestamptz,
  primary key (tenant_id, compensation_id),
  foreign key (tenant_id, flow_id) references public.p111_workflow_instances(tenant_id, flow_id),
  check (state <> 'SOURCE_CONFIRMED' or source_readback_ref is not null)
);

create table if not exists public.p111_recovery_receipts (
  tenant_id text not null, recovery_receipt_id text not null, flow_id text not null,
  playbook_id text not null, safe_command text not null, expected_state_version integer not null,
  resulting_state_version integer, actor_id text not null,
  result text not null check (result in ('STARTED','COMPLETED','FAILED','REJECTED_STALE','REJECTED_POLICY')),
  evidence_refs jsonb not null default '[]'::jsonb, notes text,
  started_at timestamptz not null default now(), finished_at timestamptz,
  primary key (tenant_id, recovery_receipt_id),
  foreign key (tenant_id, flow_id) references public.p111_workflow_instances(tenant_id, flow_id),
  check (expected_state_version > 0 and (resulting_state_version is null or resulting_state_version > expected_state_version))
);

create index if not exists p110_inbox_due_idx on public.p110_inbox_messages (tenant_id, received_at)
  where state = 'RECEIVED';
create index if not exists p110_inbox_expired_lease_idx on public.p110_inbox_messages (tenant_id, lease_expires_at)
  where state = 'PROCESSING';
create index if not exists p110_dead_letters_open_idx on public.p110_dead_letters (tenant_id, review_by, created_at)
  where state in ('OPEN','UNDER_REVIEW');
create index if not exists p110_outbox_expired_lease_idx on public.p110_outbox_messages (tenant_id, lease_expires_at)
  where state = 'CLAIMED';
create index if not exists p111_checkpoints_flow_idx on public.p111_workflow_checkpoints (tenant_id, flow_id, checkpoint_sequence);
create index if not exists p111_flows_attention_idx on public.p111_workflow_instances (tenant_id, last_transition_at)
  where state in ('WAITING_FOR_FACT','WAITING_FOR_HUMAN','WAITING_FOR_PROVIDER','FAILED','QUARANTINED');
create index if not exists p111_timers_due_idx on public.p111_workflow_timers (tenant_id, fire_at)
  where state = 'SCHEDULED';
create index if not exists p111_timers_expired_lease_idx on public.p111_workflow_timers (tenant_id, lease_expires_at)
  where state = 'CLAIMED';

do $$
declare
  relation_name text;
  policy_name text;
begin
  foreach relation_name in array array[
    'p110_kill_switches','p110_inbox_messages','p110_delivery_attempts','p110_dead_letters',
    'p110_reconciliation_checkpoints','p111_workflow_instances',
    'p111_workflow_checkpoints','p111_step_attempts','p111_workflow_timers',
    'p111_human_task_refs','p111_compensation_intents','p111_recovery_receipts'
  ] loop
    policy_name := relation_name || '_tenant_policy';
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I force row level security', relation_name);
    execute format('drop policy if exists %I on public.%I', policy_name, relation_name);
    execute format(
      'create policy %I on public.%I using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))',
      policy_name, relation_name
    );
    execute format('revoke all on table public.%I from public', relation_name);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', relation_name);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', relation_name);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on table public.%I from service_role', relation_name);
      execute format('grant select, insert, update on table public.%I to service_role', relation_name);
    end if;
  end loop;
end $$;

commit;
