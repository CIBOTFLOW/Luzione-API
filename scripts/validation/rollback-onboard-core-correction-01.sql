begin;

do $$
declare
  v2_provenance text;
begin
  if to_regclass('public.onboarding_setup_mandate_revocations') is null
    or to_regclass('public.onboarding_tenant_blueprint_drafts') is null
    or to_regclass('public.onboarding_tenant_blueprint_approvals') is null
    or to_regclass('public.onboarding_setup_mandates') is null
    or to_regclass('public.onboarding_import_batches') is null
    or to_regclass('public.onboarding_import_rows') is null
    or to_regclass('public.onboarding_import_receipts') is null then
    raise exception 'ONBOARD_CORE_CORRECTION_REVERSE_BASELINE_MISMATCH';
  end if;

  if exists (select 1 from public.onboarding_setup_mandate_revocations) then
    v2_provenance := 'append-only mandate revocation';
  elsif exists (
    select 1 from public.onboarding_tenant_blueprint_drafts
    where mapping_version = 'TenantBlueprintMap/v2'
      or source_binding is not null
      or source_binding_digest is not null
  ) then
    v2_provenance := 'tenant blueprint source binding';
  elsif exists (
    select 1 from public.onboarding_tenant_blueprint_approvals
    where proposal_actor_id is not null or human_authentication_ref is not null
  ) then
    v2_provenance := 'distinct human approval provenance';
  elsif exists (
    select 1 from public.onboarding_setup_mandates where source_binding_digest is not null
  ) then
    v2_provenance := 'setup mandate source binding';
  elsif exists (
    select 1 from public.onboarding_import_batches
    where mapping_version = 'CRMImportDryRunMap/v2' or source_binding_digest is not null
  ) then
    v2_provenance := 'import source binding';
  elsif exists (
    select 1 from public.onboarding_import_rows where match_key_digest is not null
  ) then
    v2_provenance := 'server-derived import match key';
  elsif exists (
    select 1 from public.onboarding_import_receipts
    where source_binding_digest is not null or measured_runtime_ms is not null or deadline_at is not null
  ) then
    v2_provenance := 'import runtime provenance';
  end if;

  if v2_provenance is not null then
    raise exception 'ONBOARD_CORE_CORRECTION_REVERSE_BLOCKED_V2_PROVENANCE: %', v2_provenance
      using hint = 'Preserve the v2 schema and append-only evidence; this reverse is authorized only for empty pre-activation rehearsal.';
  end if;
end $$;

drop table if exists public.onboarding_setup_mandate_revocations;

alter table public.onboarding_import_receipts
  drop constraint if exists onboarding_import_receipt_runtime_v2,
  drop column if exists deadline_at,
  drop column if exists measured_runtime_ms,
  drop column if exists source_binding_digest;

alter table public.onboarding_import_rows
  drop constraint if exists onboarding_import_match_key_digest_v2,
  drop column if exists match_key_digest;

alter table public.onboarding_import_batches
  drop constraint if exists onboarding_import_binding_digest_v2,
  drop constraint if exists onboarding_import_mapping_version_v2,
  drop column if exists source_binding_digest,
  add constraint onboarding_import_batches_mapping_version_check check (mapping_version = 'CRMImportDryRunMap/v1');

alter table public.onboarding_setup_mandates
  drop constraint if exists onboarding_mandate_binding_digest_v2,
  drop column if exists source_binding_digest;

alter table public.onboarding_tenant_blueprint_approvals
  drop constraint if exists onboarding_blueprint_distinct_human_v2,
  drop column if exists human_authentication_ref,
  drop column if exists proposal_actor_id;

alter table public.onboarding_tenant_blueprint_drafts
  drop constraint if exists onboarding_blueprint_v2_binding_required,
  drop constraint if exists onboarding_blueprint_mapping_version_v2,
  drop column if exists source_binding_digest,
  drop column if exists source_binding,
  add constraint onboarding_tenant_blueprint_drafts_mapping_version_check check (mapping_version = 'TenantBlueprintMap/v1');

commit;
