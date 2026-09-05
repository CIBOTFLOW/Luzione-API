begin;

alter table public.p110_delivery_attempts
  drop constraint if exists p110_delivery_attempt_effect_admission_check,
  drop column if exists credential_binding_id,
  drop column if exists effect_admission_kill_version,
  drop column if exists effect_admission_digest,
  drop column if exists effect_admission_ref,
  drop column if exists effect_admission_contract_version;

commit;
