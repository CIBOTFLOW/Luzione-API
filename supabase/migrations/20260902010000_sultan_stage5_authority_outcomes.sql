-- API-owned Sultan Stage 5 admission, canonical readback and outcome evidence.
-- This migration grants no external-effect authority and stores no raw model text.

begin;

create table public.sultan_stage5_idempotency_conflicts (
  tenant_id text not null,
  conflict_id text not null,
  scope text not null check (scope in ('ADMISSION','READBACK','OUTCOME')),
  idempotency_key text not null,
  existing_request_hash text not null check (existing_request_hash ~ '^[a-f0-9]{64}$'),
  received_request_hash text not null check (received_request_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, conflict_id),
  check (existing_request_hash <> received_request_hash)
);

create table public.sultan_canonical_readback_receipts (
  tenant_id text not null,
  readback_receipt_id text not null,
  idempotency_key text not null,
  consumer_actor_id text not null check (consumer_actor_id in ('service:luzione-ui','service:sultan-os')),
  consumer_deployment_sha text not null check (consumer_deployment_sha ~ '^[a-f0-9]{40}$'),
  subject_type text not null check (subject_type in (
    'ORDER','SHIPMENT','ACCOUNT','OPPORTUNITY','COMMITMENT','LOGISTICS',
    'ECONOMIC_CALCULATION','FEP_ALLOCATION'
  )),
  subject_id text not null,
  status text not null check (status in ('AVAILABLE','NOT_FOUND','SCHEMA_MISMATCH','SOURCE_UNAVAILABLE')),
  source_version text,
  observed_at timestamptz not null,
  fresh_until timestamptz,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  readback_hash text not null check (readback_hash ~ '^[a-f0-9]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, readback_receipt_id),
  unique (tenant_id, idempotency_key),
  check ((status = 'AVAILABLE') = (source_version is not null and fresh_until is not null)),
  check (fresh_until is null or fresh_until > observed_at),
  check (receipt::text !~* '"(raw_?prompt|raw_?response|system_?prompt|secret|token|api_?key|messages|memory)"[[:space:]]*:')
);

create table public.sultan_api_admission_receipts (
  tenant_id text not null,
  admission_receipt_id text not null,
  idempotency_key text not null,
  operation_id text not null,
  run_id text not null,
  interaction_id text not null,
  status text not null check (status in ('ADMITTED_NO_EFFECT','DENIED','SEPARATE_REVIEW_REQUIRED')),
  phase text not null check (phase in ('REASONING','SIMULATION','ACTION_PREPARATION','EXECUTION','OBSERVATION')),
  credential_actor_id text not null,
  logical_agent_id text not null,
  logical_agent_version text not null,
  case_id text not null,
  case_type text not null check (case_type in (
    'PORTFOLIO','COMMERCIAL','FULFILLMENT','PARTNER_RELATIONSHIP','CATALOG_QUALITY',
    'ACCOUNT_RELATIONSHIP','ECONOMIC_REVIEW','FEP_CASE','CONTROL_REVIEW'
  )),
  requested_capability text not null,
  requested_effect_class text not null check (requested_effect_class in ('A0','A1','A2','A3')),
  participation_contract_sha text not null check (participation_contract_sha ~ '^[a-f0-9]{40}$'),
  sultan_deployment_sha text not null check (sultan_deployment_sha ~ '^[a-f0-9]{40}$'),
  grounding_assembler_deployment_sha text not null check (grounding_assembler_deployment_sha ~ '^[a-f0-9]{40}$'),
  api_deployment_sha text not null check (api_deployment_sha ~ '^[a-f0-9]{40}$'),
  context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
  grounding_packet_hash text not null check (grounding_packet_hash ~ '^[a-f0-9]{64}$'),
  participant_set_hash text not null check (participant_set_hash ~ '^[a-f0-9]{64}$'),
  interaction_receipt_hash text not null check (interaction_receipt_hash ~ '^[a-f0-9]{64}$'),
  evidence_refs_hash text not null check (evidence_refs_hash ~ '^[a-f0-9]{64}$'),
  policy_version text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz not null,
  decided_at timestamptz not null,
  external_effects_authorized boolean not null default false check (external_effects_authorized = false),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, admission_receipt_id),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, operation_id),
  check (decided_at >= requested_at - interval '30 seconds'),
  check (status <> 'ADMITTED_NO_EFFECT' or requested_effect_class = 'A0'),
  check (status <> 'SEPARATE_REVIEW_REQUIRED' or requested_effect_class in ('A1','A2','A3')),
  check (receipt::text !~* '"(raw_?prompt|raw_?response|system_?prompt|secret|token|api_?key|messages|memory)"[[:space:]]*:')
);

create table public.sultan_outcome_observations (
  tenant_id text not null,
  observation_id text not null,
  idempotency_key text not null,
  admission_receipt_id text not null,
  readback_receipt_id text not null,
  classification text not null check (classification in ('CONFIRMED','REFUTED','UNRESOLVED','SUPERSEDED')),
  supersedes_observation_id text,
  observer_actor_id text not null check (observer_actor_id in ('service:luzione-ui','service:sultan-os')),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, observation_id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, admission_receipt_id)
    references public.sultan_api_admission_receipts(tenant_id, admission_receipt_id) on delete restrict,
  foreign key (tenant_id, readback_receipt_id)
    references public.sultan_canonical_readback_receipts(tenant_id, readback_receipt_id) on delete restrict,
  foreign key (tenant_id, supersedes_observation_id)
    references public.sultan_outcome_observations(tenant_id, observation_id) on delete restrict,
  check ((classification = 'SUPERSEDED') = (supersedes_observation_id is not null)),
  check (receipt::text !~* '"(raw_?prompt|raw_?response|system_?prompt|secret|token|api_?key|messages|memory)"[[:space:]]*:')
);

alter table public.sultan_agent_command_reservations
  add column admission_receipt_id text,
  add constraint sultan_agent_command_stage5_admission_fk
    foreign key (tenant_id, admission_receipt_id)
    references public.sultan_api_admission_receipts(tenant_id, admission_receipt_id)
    on delete restrict;

create index sultan_agent_command_stage5_admission_idx
  on public.sultan_agent_command_reservations (tenant_id, admission_receipt_id)
  where admission_receipt_id is not null;

create index sultan_stage5_admission_interaction_idx
  on public.sultan_api_admission_receipts (tenant_id, interaction_id, decided_at desc);
create index sultan_stage5_admission_agent_case_idx
  on public.sultan_api_admission_receipts (tenant_id, logical_agent_id, case_type, case_id, decided_at desc);
create index sultan_stage5_readback_subject_idx
  on public.sultan_canonical_readback_receipts (tenant_id, subject_type, subject_id, observed_at desc);
create index sultan_stage5_outcome_admission_idx
  on public.sultan_outcome_observations (tenant_id, admission_receipt_id, observed_at desc);
create index sultan_stage5_outcome_readback_idx
  on public.sultan_outcome_observations (tenant_id, readback_receipt_id);
create index sultan_stage5_outcome_supersedes_idx
  on public.sultan_outcome_observations (tenant_id, supersedes_observation_id)
  where supersedes_observation_id is not null;

alter table public.sultan_stage5_idempotency_conflicts enable row level security;
alter table public.sultan_stage5_idempotency_conflicts force row level security;
alter table public.sultan_canonical_readback_receipts enable row level security;
alter table public.sultan_canonical_readback_receipts force row level security;
alter table public.sultan_api_admission_receipts enable row level security;
alter table public.sultan_api_admission_receipts force row level security;
alter table public.sultan_outcome_observations enable row level security;
alter table public.sultan_outcome_observations force row level security;

create policy sultan_stage5_conflicts_runtime_tenant on public.sultan_stage5_idempotency_conflicts
  to luzione_api_runtime
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''))
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''));
create policy sultan_stage5_readbacks_runtime_tenant on public.sultan_canonical_readback_receipts
  to luzione_api_runtime
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''))
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''));
create policy sultan_stage5_admissions_runtime_tenant on public.sultan_api_admission_receipts
  to luzione_api_runtime
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''))
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''));
create policy sultan_stage5_outcomes_runtime_tenant on public.sultan_outcome_observations
  to luzione_api_runtime
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''))
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''));

revoke all on public.sultan_stage5_idempotency_conflicts,
  public.sultan_canonical_readback_receipts,
  public.sultan_api_admission_receipts,
  public.sultan_outcome_observations
from public, anon, authenticated, service_role, luzione_provider_worker;

grant select, insert on public.sultan_stage5_idempotency_conflicts,
  public.sultan_canonical_readback_receipts,
  public.sultan_api_admission_receipts,
  public.sultan_outcome_observations
to luzione_api_runtime;

create or replace function public.sultan_stage5_append_only_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Sultan Stage 5 receipts and conflicts are append-only';
end;
$$;

revoke all on function public.sultan_stage5_append_only_guard() from public, anon, authenticated, service_role, luzione_provider_worker;
grant execute on function public.sultan_stage5_append_only_guard() to luzione_api_runtime;

create trigger sultan_stage5_conflicts_append_only
  before update or delete on public.sultan_stage5_idempotency_conflicts
  for each row execute function public.sultan_stage5_append_only_guard();
create trigger sultan_stage5_readbacks_append_only
  before update or delete on public.sultan_canonical_readback_receipts
  for each row execute function public.sultan_stage5_append_only_guard();
create trigger sultan_stage5_admissions_append_only
  before update or delete on public.sultan_api_admission_receipts
  for each row execute function public.sultan_stage5_append_only_guard();
create trigger sultan_stage5_outcomes_append_only
  before update or delete on public.sultan_outcome_observations
  for each row execute function public.sultan_stage5_append_only_guard();

comment on table public.sultan_api_admission_receipts is
  'Immutable admission or denial evidence bound to exact Sultan interaction/context hashes and deployment SHAs. It grants no external effect.';
comment on table public.sultan_canonical_readback_receipts is
  'Immutable tenant-bound structured FACT/CALCULATION readbacks for Sultan grounding; prompts, beliefs and authority are prohibited.';
comment on table public.sultan_outcome_observations is
  'Immutable outcome observations derived from one exact admission and later canonical readback; observations do not promote learning.';

commit;
