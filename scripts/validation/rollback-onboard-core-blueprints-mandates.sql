begin;

drop table if exists public.onboarding_setup_mandates;
drop table if exists public.onboarding_tenant_blueprint_approvals;
drop table if exists public.onboarding_tenant_blueprint_drafts;
drop function if exists public.onboard_core_reject_mutation();

commit;
