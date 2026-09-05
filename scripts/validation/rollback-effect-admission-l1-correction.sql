begin;

do $$
begin
  if exists (
    select 1 from public.p110_delivery_attempts
     where effect_admission_contract_version = 'luzione-effect-admission/v2'
  ) then
    raise exception 'Rollback blocked: v2 provider execution-envelope evidence exists.';
  end if;
  if exists (
    select 1 from public.sultan_agent_command_reservations
     where admission_receipt_hash is not null
        or originating_envelope_ref is not null
        or prepare_effect_admission_ref is not null
        or prepare_execution_identity is not null
  ) or exists (
    select 1 from public.sultan_agent_internal_actions
     where effect_execution_envelope is not null
  ) then
    raise exception 'Rollback blocked: Sultan effect-admission lineage exists.';
  end if;
end
$$;

alter table public.p110_delivery_attempts
  drop constraint if exists p110_delivery_attempt_effect_admission_check;
alter table public.p110_delivery_attempts
  add constraint p110_delivery_attempt_effect_admission_check check (
    result <> 'STARTED' or (
      effect_admission_contract_version = 'luzione-effect-admission/v1'
      and effect_admission_ref ~ '^effect-admission:[a-f0-9]{64}$'
      and effect_admission_digest ~ '^[a-f0-9]{64}$'
      and effect_admission_kill_version ~ '^kill:[a-f0-9]{64}$'
      and length(credential_binding_id) between 2 and 512
      and credential_binding_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]+$'
    )
  ) not valid;

alter table public.sultan_agent_internal_actions
  drop constraint if exists sultan_agent_internal_action_effect_envelope_check,
  drop column if exists originating_envelope_ref,
  drop column if exists effect_execution_identity,
  drop column if exists effect_execution_envelope_ref,
  drop column if exists effect_execution_envelope;

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
     or new.provider_dispatch_authorized then
    raise exception 'Only archival of reversible Sultan internal actions is allowed.';
  end if;
  return new;
end;
$$;

alter table public.sultan_agent_command_reservations
  drop constraint if exists sultan_agent_command_prepare_effect_lineage_check,
  drop constraint if exists sultan_agent_command_exact_stage5_admission_fk,
  drop column if exists prepare_execution_identity,
  drop column if exists prepare_effect_admission_ref,
  drop column if exists originating_envelope_ref,
  drop column if exists admission_receipt_hash;

alter table public.p110_delivery_attempts
  drop column if exists prepared_dispatch_digest,
  drop column if exists originating_envelope_ref,
  drop column if exists effect_execution_identity,
  drop column if exists effect_execution_envelope_ref,
  drop column if exists effect_execution_envelope;

commit;
