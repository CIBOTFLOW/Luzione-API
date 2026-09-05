begin;

do $$
declare
  profile_rows bigint;
  portal_binding_rows bigint;
  receipt_rows bigint;
begin
  select count(*) into profile_rows from public.seed_supplier_profile_versions;
  select count(*) into portal_binding_rows from public.seed_supplier_portal_account_binding_versions;
  select count(*) into receipt_rows from public.p110_command_receipts
   where command_type in ('supplier_profile.propose','supplier_profile.revise','supplier_profile.transition','portal_account_access_binding.record','portal_account_access_binding.revoke');
  if profile_rows > 0 or portal_binding_rows > 0 or receipt_rows > 0 then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S rollback refused: admitted Supplier Profile facts or receipts require a forward recovery';
  end if;
end $$;

drop table public.seed_supplier_portal_account_binding_versions;
drop table public.seed_supplier_profile_versions;
drop function public.seed_supplier_identity_a2s_validate_portal_binding_receipt();
drop function public.seed_supplier_identity_a2s_validate_portal_binding();
drop function public.seed_supplier_identity_a2s_validate_receipt();
drop function public.seed_supplier_identity_a2s_validate_version();
drop function public.seed_supplier_identity_a2s_reject_mutation();

commit;
