-- EFFECT-ADMISSION-L1-CORRECTION-01.
-- Versioned execution envelopes and exact Sultan Stage-5 admission lineage.
-- This migration creates no enabled policy, credential, provider call, or live effect.

begin;

alter table public.p110_delivery_attempts
  add column if not exists effect_execution_envelope jsonb,
  add column if not exists effect_execution_envelope_ref text,
  add column if not exists effect_execution_identity text,
  add column if not exists originating_envelope_ref text,
  add column if not exists prepared_dispatch_digest text;

alter table public.p110_delivery_attempts
  drop constraint if exists p110_delivery_attempt_effect_admission_check;
alter table public.p110_delivery_attempts
  add constraint p110_delivery_attempt_effect_admission_check check (
    result <> 'STARTED' or (
      (
        effect_admission_contract_version = 'luzione-effect-admission/v1'
        and effect_admission_ref ~ '^effect-admission:[a-f0-9]{64}$'
        and effect_admission_digest ~ '^[a-f0-9]{64}$'
        and effect_admission_kill_version ~ '^kill:[a-f0-9]{64}$'
        and length(credential_binding_id) between 2 and 512
        and credential_binding_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]+$'
        and effect_execution_envelope is null
        and effect_execution_envelope_ref is null
        and effect_execution_identity is null
        and originating_envelope_ref is null
        and prepared_dispatch_digest is null
      ) or (
        effect_admission_contract_version = 'luzione-effect-admission/v2'
        and adapter_contract_version = 'luzione-provider-adapter/v0.3'
        and provider_mode = 'SANDBOX'
        and effect_admission_ref ~ '^effect-admission:[a-f0-9]{64}$'
        and effect_admission_digest ~ '^[a-f0-9]{64}$'
        and effect_admission_kill_version ~ '^kill:[a-f0-9]{64}$'
        and credential_binding_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]+$'
        and jsonb_typeof(effect_execution_envelope) = 'object'
        and effect_execution_envelope ->> 'contractVersion' = 'luzione-effect-execution-envelope/v1'
        and effect_execution_envelope ->> 'effectAuthority' = 'SANDBOX_ONLY'
        and effect_execution_envelope ->> 'admissionCheckpoint' = 'PROVIDER_PRE_EXECUTE'
        and effect_execution_envelope ->> 'effectAdmissionRef' = effect_admission_ref
        and effect_execution_envelope ->> 'executionEnvelopeRef' = effect_execution_envelope_ref
        and effect_execution_envelope ->> 'executionIdentity' = effect_execution_identity
        and effect_execution_envelope ->> 'originatingEnvelopeRef' = originating_envelope_ref
        and effect_execution_envelope ->> 'preparedDispatchDigest' = prepared_dispatch_digest
        and effect_execution_envelope ->> 'credentialBindingId' = credential_binding_id
        and effect_execution_envelope ->> 'killVersion' = effect_admission_kill_version
        and effect_execution_envelope_ref ~ '^effect-envelope:[a-f0-9]{64}$'
        and effect_execution_identity ~ '^effect-execution:[a-f0-9]{64}$'
        and originating_envelope_ref ~ '^p110-origin:[a-f0-9]{64}$'
        and prepared_dispatch_digest ~ '^[a-f0-9]{64}$'
      )
    )
  ) not valid;

comment on column public.p110_delivery_attempts.effect_execution_envelope is
  'Strict API-owned v1 execution envelope atomically persisted with STARTED; excludes credentials and secret values.';
comment on column public.p110_delivery_attempts.originating_envelope_ref is
  'Deterministic reference to the canonical outbox/receipt payload lineage; never grants authority.';

alter table public.sultan_agent_command_reservations
  add column if not exists admission_receipt_hash text,
  add column if not exists originating_envelope_ref text,
  add column if not exists prepare_effect_admission_ref text,
  add column if not exists prepare_execution_identity text;

alter table public.sultan_agent_command_reservations
  add constraint sultan_agent_command_exact_stage5_admission_fk
    foreign key (tenant_id, admission_receipt_id, admission_receipt_hash)
    references public.sultan_api_admission_receipts(tenant_id, admission_receipt_id, receipt_hash)
    on delete restrict
    not valid;

alter table public.sultan_agent_command_reservations
  add constraint sultan_agent_command_prepare_effect_lineage_check check (
    admission_receipt_id is null or (
      admission_receipt_hash ~ '^[a-f0-9]{64}$'
      and originating_envelope_ref ~ '^sultan-stage5:[a-f0-9]{64}$'
      and prepare_effect_admission_ref ~ '^effect-admission:[a-f0-9]{64}$'
      and prepare_execution_identity ~ '^effect-execution:[a-f0-9]{64}$'
    )
  ) not valid;

alter table public.sultan_agent_internal_actions
  add column if not exists effect_execution_envelope jsonb,
  add column if not exists effect_execution_envelope_ref text,
  add column if not exists effect_execution_identity text,
  add column if not exists originating_envelope_ref text;

alter table public.sultan_agent_internal_actions
  add constraint sultan_agent_internal_action_effect_envelope_check check (
    jsonb_typeof(effect_execution_envelope) = 'object'
    and effect_execution_envelope ->> 'contractVersion' = 'luzione-effect-execution-envelope/v1'
    and effect_execution_envelope ->> 'effectAuthority' = 'SANDBOX_ONLY'
    and effect_execution_envelope ->> 'admissionCheckpoint' = 'SULTAN_EXECUTE'
    and effect_execution_envelope ->> 'executionEnvelopeRef' = effect_execution_envelope_ref
    and effect_execution_envelope ->> 'executionIdentity' = effect_execution_identity
    and effect_execution_envelope ->> 'originatingEnvelopeRef' = originating_envelope_ref
    and effect_execution_envelope_ref ~ '^effect-envelope:[a-f0-9]{64}$'
    and effect_execution_identity ~ '^effect-execution:[a-f0-9]{64}$'
    and originating_envelope_ref ~ '^sultan-stage5:[a-f0-9]{64}$'
    and external_effect_authorized = false
    and provider_dispatch_authorized = false
  ) not valid;

comment on column public.sultan_agent_command_reservations.admission_receipt_hash is
  'Exact Stage-5 admission receipt content hash bound at prepare time.';
comment on column public.sultan_agent_internal_actions.effect_execution_envelope is
  'Sandbox-only internal execution lineage. This evidence does not grant live/provider authority.';

create or replace function public.sultan_agent_internal_action_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Sultan internal action evidence is append-only.';
  end if;
  if old.tool_id = 'luzione.note.append' then
    raise exception 'Sultan notes are append-only.';
  end if;
  if new.archived_at is null or new.state <> 'ARCHIVED'
     or new.payload <> old.payload or new.receipt_id <> old.receipt_id
     or new.approved_by <> old.approved_by or new.external_effect_authorized
     or new.provider_dispatch_authorized
     or new.effect_execution_envelope <> old.effect_execution_envelope
     or new.effect_execution_envelope_ref <> old.effect_execution_envelope_ref
     or new.effect_execution_identity <> old.effect_execution_identity
     or new.originating_envelope_ref <> old.originating_envelope_ref then
    raise exception 'Only archival of reversible Sultan internal actions is allowed.';
  end if;
  return new;
end;
$$;

commit;
