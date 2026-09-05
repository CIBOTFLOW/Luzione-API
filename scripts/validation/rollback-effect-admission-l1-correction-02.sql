begin;

do $$
begin
  if exists (
    select 1 from public.p110_reconciliation_checkpoints
     where originating_delivery_attempt_id is not null
  ) then
    raise exception 'Rollback blocked: immutable originating-attempt reconciliation evidence exists.';
  end if;
end $$;

alter table public.p110_reconciliation_checkpoints
  drop constraint if exists p110_reconciliation_originating_attempt_fk,
  drop column if exists originating_delivery_attempt_id,
  drop column if exists originating_delivery_attempt_number;
alter table public.p110_delivery_attempts
  drop constraint if exists p110_delivery_attempts_origin_identity_key;

commit;
