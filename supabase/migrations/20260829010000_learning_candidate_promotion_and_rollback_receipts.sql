begin;

-- Hosted Supabase projects may grant service_role ALL on future public tables.
-- Remove that default before creating the learning ledger, then grant only the
-- runtime operations declared below.
alter default privileges for role postgres in schema public
  revoke all on tables from service_role;

create table if not exists public.learning_candidate_versions (
  candidate_version_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  candidate_id text not null check (candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'),
  version integer not null check (version > 0),
  kind text not null check (kind in ('ACTION_POLICY','MEMORY','MODEL_ROUTING','PROMPT','SKILL')),
  stage text not null check (stage in ('CANDIDATE','SHADOW','CANARY','DEPLOYED','QUARANTINED','ROLLED_BACK','SUPERSEDED')),
  changes_action_eligibility boolean not null default false,
  proposed_by_actor_id text not null,
  proposed_by_actor_type text not null check (proposed_by_actor_type in ('agent','service','user')),
  candidate_payload jsonb not null check (jsonb_typeof(candidate_payload) = 'object'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  feedback_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(feedback_refs) = 'array'),
  payload_checksum text not null check (payload_checksum ~ '^[a-f0-9]{64}$'),
  last_known_good_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, candidate_id, version)
);

create table if not exists public.learning_evaluation_receipts (
  receipt_id text primary key check (receipt_id ~ '^learning_evaluation_[a-f0-9]{24}$'),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  candidate_version_id uuid not null references public.learning_candidate_versions(candidate_version_id),
  decision text not null check (decision in (
    'CANARY_ELIGIBLE','GUARDIAN_REVIEW_REQUIRED','MONITOR','PROMOTION_ELIGIBLE',
    'QUARANTINE','ROLLBACK_REQUIRED','SHADOW_ONLY'
  )),
  reason_codes jsonb not null check (jsonb_typeof(reason_codes) = 'array'),
  metrics_snapshot jsonb not null check (jsonb_typeof(metrics_snapshot) = 'object'),
  evaluation_contract_version text not null,
  evaluator_actor_id text not null,
  rollback_target_version text,
  next_safe_action text not null,
  external_effects_authorized boolean not null default false check (not external_effects_authorized),
  promotion_executed boolean not null default false check (not promotion_executed),
  rollback_executed boolean not null default false check (not rollback_executed),
  receipt_hash text not null unique check (receipt_hash ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, candidate_version_id, receipt_hash)
);

create table if not exists public.learning_promotion_receipts (
  promotion_receipt_id text primary key,
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  candidate_version_id uuid not null references public.learning_candidate_versions(candidate_version_id),
  evaluation_receipt_id text not null references public.learning_evaluation_receipts(receipt_id),
  canonical_approval_id text not null,
  guardian_approval_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(guardian_approval_refs) = 'array'),
  promoted_by_actor_id text not null,
  command_id text not null,
  idempotency_key text not null,
  source_readback jsonb not null check (jsonb_typeof(source_readback) = 'object'),
  external_effects_authorized boolean not null default false check (not external_effects_authorized),
  promoted_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, candidate_version_id),
  unique (tenant_id, idempotency_key)
);

create table if not exists public.learning_rollback_receipts (
  rollback_receipt_id text primary key,
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  candidate_version_id uuid not null references public.learning_candidate_versions(candidate_version_id),
  evaluation_receipt_id text not null references public.learning_evaluation_receipts(receipt_id),
  from_version text not null,
  to_version text not null,
  trigger_reason_codes jsonb not null check (jsonb_typeof(trigger_reason_codes) = 'array'),
  command_id text not null,
  idempotency_key text not null,
  executed_by_actor_id text not null,
  source_readback jsonb not null check (jsonb_typeof(source_readback) = 'object'),
  external_effects_authorized boolean not null default false check (not external_effects_authorized),
  rolled_back_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, candidate_version_id, evaluation_receipt_id),
  unique (tenant_id, idempotency_key)
);

create index if not exists learning_candidate_versions_tenant_stage_idx
  on public.learning_candidate_versions (tenant_id, stage, updated_at desc);
create index if not exists learning_evaluation_receipts_candidate_idx
  on public.learning_evaluation_receipts (tenant_id, candidate_version_id, evaluated_at desc);
create index if not exists learning_promotion_receipts_tenant_created_idx
  on public.learning_promotion_receipts (tenant_id, promoted_at desc);
create index if not exists learning_rollback_receipts_tenant_created_idx
  on public.learning_rollback_receipts (tenant_id, rolled_back_at desc);

create or replace function public.prevent_learning_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is an immutable learning receipt ledger', tg_table_name);
end
$$;

create or replace function public.protect_learning_candidate_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.candidate_id is distinct from old.candidate_id
     or new.version is distinct from old.version
     or new.kind is distinct from old.kind
     or new.changes_action_eligibility is distinct from old.changes_action_eligibility
     or new.proposed_by_actor_id is distinct from old.proposed_by_actor_id
     or new.proposed_by_actor_type is distinct from old.proposed_by_actor_type
     or new.candidate_payload is distinct from old.candidate_payload
     or new.evidence_refs is distinct from old.evidence_refs
     or new.feedback_refs is distinct from old.feedback_refs
     or new.payload_checksum is distinct from old.payload_checksum
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'Learning candidate evidence is immutable; create a new candidate version.';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.validate_learning_promotion_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  candidate record;
  evaluation record;
begin
  select tenant_id, changes_action_eligibility
    into candidate
    from public.learning_candidate_versions
   where candidate_version_id = new.candidate_version_id;
  select tenant_id, candidate_version_id, decision
    into evaluation
    from public.learning_evaluation_receipts
   where receipt_id = new.evaluation_receipt_id;
  if candidate.tenant_id is distinct from new.tenant_id
     or evaluation.tenant_id is distinct from new.tenant_id
     or evaluation.candidate_version_id is distinct from new.candidate_version_id
     or evaluation.decision is distinct from 'PROMOTION_ELIGIBLE' then
    raise exception using errcode = '23514', message = 'Promotion requires a matching PROMOTION_ELIGIBLE evaluation receipt.';
  end if;
  if candidate.changes_action_eligibility
     and jsonb_array_length(new.guardian_approval_refs) < 2 then
    raise exception using errcode = '23514', message = 'Action-eligibility promotion requires two guardian approval references.';
  end if;
  return new;
end
$$;

create or replace function public.validate_learning_rollback_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  evaluation record;
begin
  select tenant_id, candidate_version_id, decision, rollback_target_version
    into evaluation
    from public.learning_evaluation_receipts
   where receipt_id = new.evaluation_receipt_id;
  if evaluation.tenant_id is distinct from new.tenant_id
     or evaluation.candidate_version_id is distinct from new.candidate_version_id
     or evaluation.decision is distinct from 'ROLLBACK_REQUIRED'
     or evaluation.rollback_target_version is distinct from new.to_version then
    raise exception using errcode = '23514', message = 'Rollback requires a matching ROLLBACK_REQUIRED evaluation and exact target version.';
  end if;
  return new;
end
$$;

drop trigger if exists learning_candidate_version_immutable_evidence on public.learning_candidate_versions;
create trigger learning_candidate_version_immutable_evidence
before update on public.learning_candidate_versions
for each row execute function public.protect_learning_candidate_version();

drop trigger if exists learning_evaluation_receipts_immutable on public.learning_evaluation_receipts;
create trigger learning_evaluation_receipts_immutable
before update or delete on public.learning_evaluation_receipts
for each row execute function public.prevent_learning_receipt_mutation();

drop trigger if exists learning_promotion_receipts_immutable on public.learning_promotion_receipts;
create trigger learning_promotion_receipts_immutable
before update or delete on public.learning_promotion_receipts
for each row execute function public.prevent_learning_receipt_mutation();

drop trigger if exists learning_promotion_receipts_validate on public.learning_promotion_receipts;
create trigger learning_promotion_receipts_validate
before insert on public.learning_promotion_receipts
for each row execute function public.validate_learning_promotion_receipt();

drop trigger if exists learning_rollback_receipts_immutable on public.learning_rollback_receipts;
create trigger learning_rollback_receipts_immutable
before update or delete on public.learning_rollback_receipts
for each row execute function public.prevent_learning_receipt_mutation();

drop trigger if exists learning_rollback_receipts_validate on public.learning_rollback_receipts;
create trigger learning_rollback_receipts_validate
before insert on public.learning_rollback_receipts
for each row execute function public.validate_learning_rollback_receipt();

alter table public.learning_candidate_versions enable row level security;
alter table public.learning_evaluation_receipts enable row level security;
alter table public.learning_promotion_receipts enable row level security;
alter table public.learning_rollback_receipts enable row level security;

revoke all on table public.learning_candidate_versions from public, anon, authenticated, service_role;
revoke all on table public.learning_evaluation_receipts from public, anon, authenticated, service_role;
revoke all on table public.learning_promotion_receipts from public, anon, authenticated, service_role;
revoke all on table public.learning_rollback_receipts from public, anon, authenticated, service_role;
revoke all on function public.prevent_learning_receipt_mutation() from public, anon, authenticated, service_role;
revoke all on function public.protect_learning_candidate_version() from public, anon, authenticated, service_role;
revoke all on function public.validate_learning_promotion_receipt() from public, anon, authenticated, service_role;
revoke all on function public.validate_learning_rollback_receipt() from public, anon, authenticated, service_role;

grant select, insert, update on table public.learning_candidate_versions to service_role;
grant select, insert on table public.learning_evaluation_receipts to service_role;
grant select, insert on table public.learning_promotion_receipts to service_role;
grant select, insert on table public.learning_rollback_receipts to service_role;

comment on table public.learning_candidate_versions is
  'Versioned learning candidates. Candidate evidence is immutable; only lifecycle stage and rollback pointer may change.';
comment on table public.learning_evaluation_receipts is
  'Immutable, effect-free evaluation receipts for poisoning, drift, promotion, and rollback gates.';
comment on table public.learning_promotion_receipts is
  'Immutable receipts for separately approved, exact-version learning promotions.';
comment on table public.learning_rollback_receipts is
  'Immutable receipts proving an idempotent rollback and authoritative source readback.';

commit;
