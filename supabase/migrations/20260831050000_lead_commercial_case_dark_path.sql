begin;

create table if not exists public.crm_leads (
  id text primary key,
  tenant_id text not null,
  account_id text,
  contact_id text,
  project_id text,
  lead_source text not null,
  trigger_event_id text,
  vertical text,
  lead_iq numeric,
  account_iq numeric,
  stage text not null,
  recommended_offer text,
  recommended_next_action text,
  assigned_owner_id text,
  sla_due_at timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_leads
  add column if not exists version integer not null default 1,
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

alter table public.crm_leads
  drop constraint if exists crm_leads_api_version_check;
alter table public.crm_leads
  add constraint crm_leads_api_version_check check (version > 0);

create table if not exists public.commercial_case_identities (
  case_id text primary key,
  tenant_id text not null,
  origin_type text not null,
  origin_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null,
  status text not null default 'active' check (status in ('active','retired')),
  unique (tenant_id, origin_type, origin_id)
);

create table if not exists public.commercial_cases (
  tenant_id text not null,
  case_id text not null,
  title text not null,
  stage text not null default 'intake',
  owner text,
  next_action text,
  next_action_due_at timestamptz,
  account_name text,
  contact_name text,
  amount numeric,
  status text not null default 'active',
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  source_metadata jsonb not null default '{}'::jsonb,
  primary key (tenant_id, case_id),
  foreign key (case_id) references public.commercial_case_identities(case_id) on delete restrict,
  check (length(trim(title)) > 0),
  check (stage in ('intake','identity_review','qualification','discovery','solution_building','feasibility','proposal_preparation','proposal_review','decision_pending','revision','won','lost','paused','disqualified')),
  check (status in ('active','paused','retired'))
);

alter table public.commercial_cases
  add column if not exists account_id uuid,
  add column if not exists primary_contact_id text,
  add column if not exists opportunity_id uuid,
  add column if not exists source_lead_id text,
  add column if not exists relationship_integrity_state text not null default 'legacy_unverified';

alter table public.commercial_cases
  drop constraint if exists commercial_cases_relationship_integrity_check;
alter table public.commercial_cases
  add constraint commercial_cases_relationship_integrity_check check (
    relationship_integrity_state = 'legacy_unverified'
    or (
      relationship_integrity_state = 'verified'
      and account_id is not null
      and primary_contact_id is not null
      and opportunity_id is not null
    )
  );

create index if not exists crm_leads_tenant_updated_idx
  on public.crm_leads (tenant_id, updated_at desc, id);
create index if not exists commercial_cases_tenant_updated_idx
  on public.commercial_cases (tenant_id, updated_at desc, case_id);
create index if not exists commercial_cases_source_lead_idx
  on public.commercial_cases (tenant_id, source_lead_id)
  where source_lead_id is not null;

comment on table public.crm_leads is
  'Existing canonical Lead rows. API-PC-008 supplies a default-off transfer-pending command path; active UI writer retirement requires independent cutover evidence.';
comment on table public.commercial_cases is
  'Existing canonical Commercial Case rows. API-PC-008 supplies a default-off transfer-pending command path and preserves legacy reads.';

commit;
