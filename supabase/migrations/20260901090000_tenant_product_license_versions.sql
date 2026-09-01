begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    raise exception 'API-PC-017 requires the API-PC-013 luzione_api_runtime role';
  end if;
end $$;

create table if not exists public.tenant_product_license_versions (
  license_version_id text primary key,
  tenant_id text not null,
  license_id text not null,
  record_version integer not null check (record_version > 0),
  edition_id text not null check (edition_id in ('AI_OCRMS','IMPORT_OPERATIONS','DESIGN_COMMERCE','ENTERPRISE')),
  status text not null check (status in ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','EXPIRED','CANCELLED')),
  effective_at timestamptz not null,
  expires_at timestamptz,
  exact_version_current boolean not null default true,
  superseded_by_license_version_id text,
  source_system text not null,
  source_ref text,
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  policy_version text not null,
  created_by_actor_id text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, license_id, record_version),
  unique (tenant_id, license_version_id),
  foreign key (tenant_id, superseded_by_license_version_id)
    references public.tenant_product_license_versions (tenant_id, license_version_id)
    deferrable initially deferred,
  check (expires_at is null or expires_at > effective_at),
  check (
    (exact_version_current and superseded_by_license_version_id is null)
    or (not exact_version_current and superseded_by_license_version_id is not null)
  )
);

create unique index if not exists tenant_product_license_current_uniq
  on public.tenant_product_license_versions (tenant_id)
  where exact_version_current;
create index if not exists tenant_product_license_status_idx
  on public.tenant_product_license_versions (tenant_id, status, effective_at desc)
  where exact_version_current;

create table if not exists public.tenant_product_module_entitlements (
  entitlement_id text primary key,
  tenant_id text not null,
  license_version_id text not null,
  module_id text not null check (module_id in (
    'supplier.onboarding','crm.lead-management','crm.accounts-opportunities','growth.engine',
    'finance.money-dashboards','operations.orders-delivery','work.task-management',
    'service.customer-experience','logistics.international-shipping',
    'fulfillment.end-to-end-quoting','trade.import-export-compliance',
    'partners.service-provider-network','ai.operating-system',
    'delivery.white-glove-scheduling','commercial.proposals','commercial.quotes','design.room-planner'
  )),
  enabled boolean not null,
  access_mode text not null check (access_mode in ('READ','INTERNAL_WRITE','EXTERNAL_EFFECT')),
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, license_version_id, module_id),
  foreign key (tenant_id, license_version_id)
    references public.tenant_product_license_versions (tenant_id, license_version_id)
    on delete restrict
);

create index if not exists tenant_product_module_entitlement_lookup_idx
  on public.tenant_product_module_entitlements (tenant_id, module_id, enabled);

alter table public.tenant_product_license_versions enable row level security;
alter table public.tenant_product_license_versions force row level security;
alter table public.tenant_product_module_entitlements enable row level security;
alter table public.tenant_product_module_entitlements force row level security;

drop policy if exists api_pc017_runtime_tenant on public.tenant_product_license_versions;
create policy api_pc017_runtime_tenant on public.tenant_product_license_versions
  to luzione_api_runtime
  using (tenant_id = (select current_setting('app.tenant_id', true)));

drop policy if exists api_pc017_runtime_tenant on public.tenant_product_module_entitlements;
create policy api_pc017_runtime_tenant on public.tenant_product_module_entitlements
  to luzione_api_runtime
  using (tenant_id = (select current_setting('app.tenant_id', true)));

revoke all on table public.tenant_product_license_versions from public;
revoke all on table public.tenant_product_module_entitlements from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.tenant_product_license_versions from anon;
    revoke all on table public.tenant_product_module_entitlements from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.tenant_product_license_versions from authenticated;
    revoke all on table public.tenant_product_module_entitlements from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.tenant_product_license_versions from service_role;
    revoke all on table public.tenant_product_module_entitlements from service_role;
  end if;
end $$;

grant select on table
  public.tenant_product_license_versions,
  public.tenant_product_module_entitlements
to luzione_api_runtime;

comment on table public.tenant_product_license_versions is
  'API-PC-017 append-versioned tenant licenses with controlled current-version supersession. Provisioning is owner-only until a separate billing adapter is authorized.';
comment on table public.tenant_product_module_entitlements is
  'API-PC-017 exact-version module and access-mode entitlements. Licensing never grants business action authority.';

commit;
