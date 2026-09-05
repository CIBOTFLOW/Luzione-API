begin;

do $$
begin
  if to_regclass('public.p110_command_receipts') is null then
    raise exception 'ONBOARD-CORE-01 requires the P110 command ledger baseline';
  end if;
end $$;

create table public.onboarding_tenant_blueprint_drafts (
  tenant_id text not null,
  blueprint_id uuid not null,
  source_pack_id text not null,
  source_pack_version text not null,
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  source_schema_digest text not null check (source_schema_digest ~ '^[a-f0-9]{64}$'),
  mapping_version text not null check (mapping_version = 'TenantBlueprintMap/v1'),
  draft_payload_hash text not null check (draft_payload_hash ~ '^[a-f0-9]{64}$'),
  canonical_blueprint jsonb not null,
  object_version text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, blueprint_id),
  unique (tenant_id, source_pack_id, source_pack_version),
  check (canonical_blueprint->>'contractVersion' = 'TenantBlueprint/v1'),
  check (canonical_blueprint->>'tenantId' = tenant_id),
  check (canonical_blueprint->>'blueprintId' = blueprint_id::text),
  check (canonical_blueprint#>>'{approval,state}' = 'DRAFT'),
  check (canonical_blueprint#>>'{approval,approvalRef}' is null),
  check (canonical_blueprint#>>'{approval,approvedAt}' is null)
);

create table public.onboarding_tenant_blueprint_approvals (
  tenant_id text not null,
  approval_event_id uuid not null,
  blueprint_id uuid not null,
  action text not null check (action in ('APPROVED','SUPERSEDED')),
  approval_ref text not null,
  supersedes_approval_ref text,
  canonical_blueprint jsonb not null,
  object_version text not null,
  actor_id text not null,
  actor_type text not null check (actor_type = 'user'),
  approved_at timestamptz not null,
  created_at timestamptz not null,
  primary key (tenant_id, approval_event_id),
  foreign key (tenant_id, blueprint_id)
    references public.onboarding_tenant_blueprint_drafts(tenant_id, blueprint_id)
    on delete restrict,
  unique (tenant_id, blueprint_id, action),
  check (canonical_blueprint->>'contractVersion' = 'TenantBlueprint/v1'),
  check (canonical_blueprint->>'tenantId' = tenant_id),
  check (canonical_blueprint->>'blueprintId' = blueprint_id::text),
  check (canonical_blueprint#>>'{approval,approvalRef}' = approval_ref),
  check (canonical_blueprint#>>'{approval,state}' = action)
);

create index onboarding_blueprint_approval_ref_idx
  on public.onboarding_tenant_blueprint_approvals (tenant_id, approval_ref, created_at desc);

create table public.onboarding_setup_mandates (
  tenant_id text not null,
  mandate_id uuid not null,
  blueprint_id uuid not null,
  blueprint_version text not null,
  approval_ref text not null,
  canonical_mandate jsonb not null,
  object_version text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_ref text,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, mandate_id),
  foreign key (tenant_id, blueprint_id)
    references public.onboarding_tenant_blueprint_drafts(tenant_id, blueprint_id)
    on delete restrict,
  check (canonical_mandate->>'contractVersion' = 'SetupMandate/v1'),
  check (canonical_mandate->>'tenantId' = tenant_id),
  check (canonical_mandate->>'mandateId' = mandate_id::text),
  check ((revoked_at is null) = (revocation_ref is null)),
  check (expires_at > created_at)
);

create index onboarding_setup_mandates_blueprint_idx
  on public.onboarding_setup_mandates (tenant_id, blueprint_id, created_at desc);

create function public.onboard_core_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ONBOARD-CORE-01 records are append-only';
end
$$;

create trigger onboarding_blueprint_drafts_append_only
before update or delete on public.onboarding_tenant_blueprint_drafts
for each row execute function public.onboard_core_reject_mutation();

create trigger onboarding_blueprint_approvals_append_only
before update or delete on public.onboarding_tenant_blueprint_approvals
for each row execute function public.onboard_core_reject_mutation();

create trigger onboarding_setup_mandates_append_only
before update or delete on public.onboarding_setup_mandates
for each row execute function public.onboard_core_reject_mutation();

alter table public.onboarding_tenant_blueprint_drafts enable row level security;
alter table public.onboarding_tenant_blueprint_drafts force row level security;
alter table public.onboarding_tenant_blueprint_approvals enable row level security;
alter table public.onboarding_tenant_blueprint_approvals force row level security;
alter table public.onboarding_setup_mandates enable row level security;
alter table public.onboarding_setup_mandates force row level security;

revoke all on table public.onboarding_tenant_blueprint_drafts from public;
revoke all on table public.onboarding_tenant_blueprint_approvals from public;
revoke all on table public.onboarding_setup_mandates from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.onboarding_tenant_blueprint_drafts from anon;
    revoke all on table public.onboarding_tenant_blueprint_approvals from anon;
    revoke all on table public.onboarding_setup_mandates from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.onboarding_tenant_blueprint_drafts from authenticated;
    revoke all on table public.onboarding_tenant_blueprint_approvals from authenticated;
    revoke all on table public.onboarding_setup_mandates from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.onboarding_tenant_blueprint_drafts from service_role;
    revoke all on table public.onboarding_tenant_blueprint_approvals from service_role;
    revoke all on table public.onboarding_setup_mandates from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    execute 'create policy onboard_core_drafts_runtime_tenant on public.onboarding_tenant_blueprint_drafts to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy onboard_core_approvals_runtime_tenant on public.onboarding_tenant_blueprint_approvals to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy onboard_core_mandates_runtime_tenant on public.onboarding_setup_mandates to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    grant select, insert on table public.onboarding_tenant_blueprint_drafts to luzione_api_runtime;
    grant select, insert on table public.onboarding_tenant_blueprint_approvals to luzione_api_runtime;
    grant select, insert on table public.onboarding_setup_mandates to luzione_api_runtime;
  end if;
end $$;

comment on table public.onboarding_tenant_blueprint_drafts is
  'ONBOARD-CORE-01 append-only, tenant-bound canonical mapping of L2 DRAFT Tenant Packs; default-off API writer only.';
comment on table public.onboarding_tenant_blueprint_approvals is
  'ONBOARD-CORE-01 immutable human approval and supersession events; L1 remains canonical authority.';
comment on table public.onboarding_setup_mandates is
  'ONBOARD-CORE-01 immutable, expiring, NO_EFFECT Setup Mandates issued from active approved Blueprints.';

commit;
