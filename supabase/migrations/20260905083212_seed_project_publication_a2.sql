begin;

do $$
begin
  if to_regclass('public.p110_command_receipts') is null
     or to_regclass('public.p110_event_envelopes') is null
     or to_regclass('public.p110_outbox_messages') is null then
    raise exception 'SEED-PROJECT-PUBLICATION-A2 requires the P110 command ledger baseline';
  end if;
end $$;

create table public.seed_projects (
  tenant_id text not null,
  project_id text not null,
  source_opportunity_id text not null,
  source_opportunity_version text not null,
  account_id text not null,
  name text not null,
  owner_id text not null,
  budget_amount_minor bigint,
  budget_currency text,
  target_start_at timestamptz,
  target_end_at timestamptz,
  source_context jsonb not null,
  status text not null check (status = 'ACTIVE'),
  version integer not null check (version = 1),
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, project_id),
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, source_opportunity_id),
  check ((budget_amount_minor is null) = (budget_currency is null)),
  check (budget_amount_minor is null or budget_amount_minor >= 0),
  check (budget_currency is null or budget_currency ~ '^[A-Z]{3}$'),
  check (target_end_at is null or target_start_at is null or target_end_at >= target_start_at),
  check (jsonb_typeof(source_context) = 'object')
);

create table public.seed_project_packages (
  tenant_id text not null,
  package_id text not null,
  project_id text not null,
  publication_kind text not null check (publication_kind in ('INITIAL','REVISION')),
  planner_project_id text not null,
  planner_project_version text not null,
  source_version_hash text not null check (source_version_hash ~ '^[a-f0-9]{64}$'),
  package_hash text not null check (package_hash ~ '^[a-f0-9]{64}$'),
  canonical_payload jsonb not null,
  supersedes_package_id text,
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  published_at timestamptz not null,
  primary key (tenant_id, package_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, supersedes_package_id) references public.seed_project_packages(tenant_id, package_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, project_id, planner_project_id, planner_project_version),
  unique (tenant_id, project_id, package_hash),
  check (canonical_payload->>'packageHash' = package_hash),
  check (canonical_payload->>'sourceVersionHash' = source_version_hash)
);

create table public.seed_spaces (
  tenant_id text not null,
  space_id text not null,
  project_id text not null,
  package_id text not null,
  planner_space_id text not null,
  planner_space_version text not null,
  name text not null,
  kind text not null check (kind in ('AREA','EXTERIOR','ROOM','WHOLE_HOME')),
  floor text,
  sequence integer not null check (sequence > 0),
  status text not null check (status = 'ACTIVE'),
  version integer not null check (version = 1),
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, space_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, package_id) references public.seed_project_packages(tenant_id, package_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, project_id, planner_space_id)
);

create table public.seed_specifications (
  tenant_id text not null,
  specification_id text not null,
  project_id text not null,
  package_id text not null,
  planner_specification_id text not null,
  planner_specification_version text not null,
  title text not null,
  space_ids jsonb not null,
  canonical_snapshot jsonb not null,
  status text not null check (status = 'ACTIVE_PROCUREMENT'),
  version integer not null check (version = 1),
  activated_at timestamptz,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, specification_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, package_id) references public.seed_project_packages(tenant_id, package_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, project_id, planner_specification_id),
  check (jsonb_typeof(space_ids) = 'array'),
  check (jsonb_typeof(canonical_snapshot) = 'object'),
  check ((status = 'ACTIVE_PROCUREMENT') = (activated_at is not null))
);

create table public.seed_specification_lines (
  tenant_id text not null,
  specification_line_id text not null,
  specification_id text not null,
  project_id text not null,
  package_id text not null,
  planner_line_id text not null,
  planner_line_version text not null,
  space_id text not null,
  canonical_snapshot jsonb not null,
  status text not null check (status = 'SOURCING'),
  version integer not null check (version = 1),
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, specification_line_id),
  foreign key (tenant_id, specification_id) references public.seed_specifications(tenant_id, specification_id) on delete restrict,
  foreign key (tenant_id, space_id) references public.seed_spaces(tenant_id, space_id) on delete restrict,
  foreign key (tenant_id, package_id) references public.seed_project_packages(tenant_id, package_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  check (jsonb_typeof(canonical_snapshot) = 'object')
);

create table public.seed_specification_revisions (
  tenant_id text not null,
  revision_id text not null,
  specification_id text not null,
  project_id text not null,
  package_id text not null,
  expected_specification_version text not null,
  proposed_specification_version text not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  deterministic_diff jsonb not null,
  status text not null check (status = 'PENDING'),
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, revision_id),
  foreign key (tenant_id, specification_id) references public.seed_specifications(tenant_id, specification_id) on delete restrict,
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, package_id) references public.seed_project_packages(tenant_id, package_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, package_id, specification_id),
  check (jsonb_typeof(before_snapshot) = 'object'),
  check (jsonb_typeof(after_snapshot) = 'object'),
  check (jsonb_typeof(deterministic_diff) = 'array')
);

create index seed_projects_updated_idx on public.seed_projects (tenant_id, updated_at desc, project_id);
create index seed_packages_project_idx on public.seed_project_packages (tenant_id, project_id, published_at desc, package_id);
create index seed_spaces_project_idx on public.seed_spaces (tenant_id, project_id, sequence, space_id);
create index seed_specifications_project_idx on public.seed_specifications (tenant_id, project_id, specification_id);
create index seed_specification_lines_spec_idx on public.seed_specification_lines (tenant_id, specification_id, specification_line_id);
create index seed_specification_revisions_pending_idx on public.seed_specification_revisions (tenant_id, project_id, created_at, revision_id) where status = 'PENDING';
create unique index seed_specification_revisions_one_pending_idx
  on public.seed_specification_revisions (tenant_id, specification_id)
  where status = 'PENDING';

create function public.seed_project_publication_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'SEED-PROJECT-PUBLICATION-A2 rows are immutable; append a revision instead';
end
$$;

revoke all on function public.seed_project_publication_reject_mutation() from public;

create trigger seed_projects_append_only before update or delete on public.seed_projects
for each row execute function public.seed_project_publication_reject_mutation();
create trigger seed_project_packages_append_only before update or delete on public.seed_project_packages
for each row execute function public.seed_project_publication_reject_mutation();
create trigger seed_spaces_append_only before update or delete on public.seed_spaces
for each row execute function public.seed_project_publication_reject_mutation();
create trigger seed_specifications_append_only before update or delete on public.seed_specifications
for each row execute function public.seed_project_publication_reject_mutation();
create trigger seed_specification_lines_append_only before update or delete on public.seed_specification_lines
for each row execute function public.seed_project_publication_reject_mutation();
create trigger seed_specification_revisions_append_only before update or delete on public.seed_specification_revisions
for each row execute function public.seed_project_publication_reject_mutation();

alter table public.seed_projects enable row level security;
alter table public.seed_projects force row level security;
alter table public.seed_project_packages enable row level security;
alter table public.seed_project_packages force row level security;
alter table public.seed_spaces enable row level security;
alter table public.seed_spaces force row level security;
alter table public.seed_specifications enable row level security;
alter table public.seed_specifications force row level security;
alter table public.seed_specification_lines enable row level security;
alter table public.seed_specification_lines force row level security;
alter table public.seed_specification_revisions enable row level security;
alter table public.seed_specification_revisions force row level security;

revoke all on table public.seed_projects, public.seed_project_packages, public.seed_spaces,
  public.seed_specifications, public.seed_specification_lines, public.seed_specification_revisions from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.seed_projects, public.seed_project_packages, public.seed_spaces,
      public.seed_specifications, public.seed_specification_lines, public.seed_specification_revisions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.seed_projects, public.seed_project_packages, public.seed_spaces,
      public.seed_specifications, public.seed_specification_lines, public.seed_specification_revisions from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.seed_projects, public.seed_project_packages, public.seed_spaces,
      public.seed_specifications, public.seed_specification_lines, public.seed_specification_revisions from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    execute 'create policy seed_projects_runtime_tenant on public.seed_projects to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_project_packages_runtime_tenant on public.seed_project_packages to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_spaces_runtime_tenant on public.seed_spaces to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_specifications_runtime_tenant on public.seed_specifications to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_specification_lines_runtime_tenant on public.seed_specification_lines to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_specification_revisions_runtime_tenant on public.seed_specification_revisions to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    grant select, insert on table public.seed_projects, public.seed_project_packages, public.seed_spaces,
      public.seed_specifications, public.seed_specification_lines, public.seed_specification_revisions to luzione_api_runtime;
  end if;
end $$;

comment on table public.seed_projects is
  'API-owned canonical Project identity created from an exact tenant-bound CRM Opportunity reference; source CRM truth remains external to this table.';
comment on table public.seed_project_packages is
  'Immutable Room Planner ProjectPackage/v1 publications. Later packages append proposed revisions and never overwrite active procurement.';
comment on table public.seed_specification_revisions is
  'Immutable, NO_EFFECT pending Specification/v1 revision facts with exact prior version and deterministic before/after diff. A later additive disposition/activation contract must append acceptance or rejection and a new canonical Specification version; it must not update this fact.';

commit;
