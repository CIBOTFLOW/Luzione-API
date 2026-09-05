begin;

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
