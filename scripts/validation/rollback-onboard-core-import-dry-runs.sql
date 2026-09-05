begin;

drop table if exists public.onboarding_import_receipts;
drop table if exists public.onboarding_import_rows;
drop table if exists public.onboarding_import_batches;
drop function if exists public.onboard_core_validate_import_pair();

commit;
