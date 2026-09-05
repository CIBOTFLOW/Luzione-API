begin;

alter table public.p110_delivery_attempts
  add column if not exists effect_admission_contract_version text,
  add column if not exists effect_admission_ref text,
  add column if not exists effect_admission_digest text,
  add column if not exists effect_admission_kill_version text,
  add column if not exists credential_binding_id text;

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

comment on column public.p110_delivery_attempts.effect_admission_ref is
  'Exact API-owned effect-admission decision re-read immediately before dispatch; never contains credential material.';
comment on column public.p110_delivery_attempts.credential_binding_id is
  'Opaque tenant/provider/destination binding identity. This is not a credential and grants no authority by itself.';

commit;
