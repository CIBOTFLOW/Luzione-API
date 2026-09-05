begin;

do $$
begin
  if to_regclass('public.onboarding_tenant_blueprint_drafts') is null
    or to_regclass('public.onboarding_import_receipts') is null then
    raise exception 'ONBOARD-CORE-CORRECTION-01 requires the exact ONBOARD-CORE-01 baseline';
  end if;
end $$;

alter table public.onboarding_tenant_blueprint_drafts
  drop constraint onboarding_tenant_blueprint_drafts_mapping_version_check,
  add column source_binding jsonb,
  add column source_binding_digest text,
  add constraint onboarding_blueprint_mapping_version_v2
    check (mapping_version in ('TenantBlueprintMap/v1','TenantBlueprintMap/v2')),
  add constraint onboarding_blueprint_v2_binding_required
    check (mapping_version <> 'TenantBlueprintMap/v2' or (
      source_schema_digest = 'c94dd71d93d72b048ceaa77b1ba08cb84e1f610393f139060f49ead684d28eb4'
      and source_binding is not null
      and source_binding_digest ~ '^[a-f0-9]{64}$'
      and source_binding->>'contractVersion' = 'TenantPackSourceBinding/v1'
      and source_binding->>'sourceSchemaDigest' = source_schema_digest
    ));

alter table public.onboarding_tenant_blueprint_approvals
  add column proposal_actor_id text,
  add column human_authentication_ref text,
  add constraint onboarding_blueprint_distinct_human_v2
    check (proposal_actor_id is null or (
      actor_type = 'user' and actor_id <> proposal_actor_id and human_authentication_ref like 'supabase-session:%'
    ));

alter table public.onboarding_setup_mandates
  add column source_binding_digest text,
  add constraint onboarding_mandate_binding_digest_v2
    check (source_binding_digest is null or source_binding_digest ~ '^[a-f0-9]{64}$');

create table public.onboarding_setup_mandate_revocations (
  tenant_id text not null,
  revocation_event_id uuid not null,
  mandate_id uuid not null,
  revocation_ref text not null,
  reason_code text not null check (reason_code in ('APPROVAL_WITHDRAWN','LIMIT_CHANGED','SECURITY_HOLD','SOURCE_WITHDRAWN')),
  actor_id text not null,
  human_authentication_ref text not null check (human_authentication_ref like 'supabase-session:%'),
  revoked_at timestamptz not null,
  primary key (tenant_id, revocation_event_id),
  unique (tenant_id, mandate_id),
  unique (tenant_id, revocation_ref),
  foreign key (tenant_id, mandate_id)
    references public.onboarding_setup_mandates(tenant_id, mandate_id) on delete restrict
);

create trigger onboarding_setup_mandate_revocations_append_only
before update or delete on public.onboarding_setup_mandate_revocations
for each row execute function public.onboard_core_reject_mutation();

alter table public.onboarding_setup_mandate_revocations enable row level security;
alter table public.onboarding_setup_mandate_revocations force row level security;
revoke all on table public.onboarding_setup_mandate_revocations from public;

alter table public.onboarding_import_batches
  drop constraint onboarding_import_batches_mapping_version_check,
  add column source_binding_digest text,
  add constraint onboarding_import_mapping_version_v2
    check (mapping_version in ('CRMImportDryRunMap/v1','CRMImportDryRunMap/v2')),
  add constraint onboarding_import_binding_digest_v2
    check (mapping_version <> 'CRMImportDryRunMap/v2' or source_binding_digest ~ '^[a-f0-9]{64}$');

alter table public.onboarding_import_rows
  add column match_key_digest text,
  add constraint onboarding_import_match_key_digest_v2
    check (match_key_digest is null or match_key_digest ~ '^[a-f0-9]{64}$');

alter table public.onboarding_import_receipts
  add column source_binding_digest text,
  add column measured_runtime_ms integer,
  add column deadline_at timestamptz,
  add constraint onboarding_import_receipt_runtime_v2
    check (source_binding_digest is null or (
      source_binding_digest ~ '^[a-f0-9]{64}$' and measured_runtime_ms >= 0 and deadline_at > created_at
    ));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.onboarding_setup_mandate_revocations from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.onboarding_setup_mandate_revocations from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.onboarding_setup_mandate_revocations from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    execute 'create policy onboard_mandate_revocations_runtime_tenant on public.onboarding_setup_mandate_revocations to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    grant select, insert on table public.onboarding_setup_mandate_revocations to luzione_api_runtime;
  end if;
end $$;

comment on table public.onboarding_setup_mandate_revocations is
  'ONBOARD-CORE-CORRECTION-01 append-only, separately authenticated human revocation events; active Mandate readback is derived from this ledger.';

commit;
