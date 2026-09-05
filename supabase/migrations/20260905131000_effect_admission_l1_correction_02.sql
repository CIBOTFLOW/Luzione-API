-- EFFECT-ADMISSION-L1-CORRECTION-02.
-- Binds reconciliation to the immutable originating delivery attempt.
-- Runtime post-STARTED admission and registry/parser hardening are code-only and SANDBOX_ONLY.

begin;

alter table public.p110_delivery_attempts
  add constraint p110_delivery_attempts_origin_identity_key
  unique (tenant_id, attempt_id, outbox_message_id, attempt_number);

alter table public.p110_reconciliation_checkpoints
  add column originating_delivery_attempt_id text,
  add column originating_delivery_attempt_number integer;

update public.p110_reconciliation_checkpoints checkpoint
   set originating_delivery_attempt_id = attempt.attempt_id,
       originating_delivery_attempt_number = attempt.attempt_number
  from public.p110_delivery_attempts attempt
 where attempt.tenant_id = checkpoint.tenant_id
   and attempt.outbox_message_id = checkpoint.outbox_message_id
   and checkpoint.reconciliation_id = 'reconcile_' || checkpoint.outbox_message_id || '_' || attempt.attempt_number::text;

do $$
begin
  if exists (
    select 1 from public.p110_reconciliation_checkpoints
     where originating_delivery_attempt_id is null or originating_delivery_attempt_number is null
  ) then
    raise exception 'Correction-02 cannot infer an exact immutable originating delivery attempt for every historical reconciliation checkpoint.';
  end if;
end $$;

alter table public.p110_reconciliation_checkpoints
  alter column originating_delivery_attempt_id set not null,
  alter column originating_delivery_attempt_number set not null,
  add constraint p110_reconciliation_originating_attempt_fk
    foreign key (tenant_id, originating_delivery_attempt_id, outbox_message_id, originating_delivery_attempt_number)
    references public.p110_delivery_attempts(tenant_id, attempt_id, outbox_message_id, attempt_number)
    on delete restrict;

comment on column public.p110_reconciliation_checkpoints.originating_delivery_attempt_id is
  'Immutable delivery-attempt identity selected at checkpoint creation; reconciliation never follows mutable outbox attempt_count.';
comment on column public.p110_reconciliation_checkpoints.originating_delivery_attempt_number is
  'Exact originating attempt number constrained with tenant, attempt ID and outbox identity.';

commit;
