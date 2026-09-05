begin;
do $$
begin
  if exists (select 1 from public.connector_revocation_receipts limit 1) then
    raise exception 'Rollback blocked: append-only connector revocation evidence exists.';
  end if;
end $$;
drop table if exists public.connector_revocation_receipts;
drop function if exists public.connector_revocation_receipts_append_only();
commit;
