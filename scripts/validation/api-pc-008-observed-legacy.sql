\set ON_ERROR_STOP on

create table public.crm_leads (
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

create table public.commercial_case_identities (
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

create table public.commercial_cases (
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
  account_id uuid,
  primary_contact_id text,
  opportunity_id uuid,
  source_lead_id text,
  relationship_integrity_state text not null default 'legacy_unverified',
  primary key (tenant_id, case_id),
  foreign key (case_id) references public.commercial_case_identities(case_id) on delete restrict,
  check (length(trim(title)) > 0),
  check (stage in ('intake','identity_review','qualification','discovery','solution_building','feasibility','proposal_preparation','proposal_review','decision_pending','revision','won','lost','paused','disqualified')),
  check (status in ('active','paused','retired')),
  constraint commercial_cases_relationship_integrity_check check (
    relationship_integrity_state = 'legacy_unverified'
    or (
      relationship_integrity_state = 'verified'
      and account_id is not null
      and primary_contact_id is not null
      and opportunity_id is not null
    )
  )
);

insert into public.crm_leads (
  id, tenant_id, lead_source, stage, status, created_at, updated_at
) values (
  'legacy-lead-001', 'legacy-tenant', 'legacy-ui', 'qualified', 'active',
  '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z'
);

insert into public.commercial_case_identities (
  case_id, tenant_id, origin_type, origin_id, created_by
) values (
  'legacy-case-001', 'legacy-tenant', 'lead', 'legacy-lead-001', 'legacy-ui'
);

insert into public.commercial_cases (
  tenant_id, case_id, title, owner, next_action, status, created_by, updated_by,
  version, source_metadata, created_at, updated_at
) values (
  'legacy-tenant', 'legacy-case-001', 'Legacy case', 'Legacy Owner',
  'Preserve this read', 'active', 'legacy-ui', 'legacy-ui', 3,
  '{"legacy":true}'::jsonb, '2026-08-01T00:00:00Z', '2026-08-03T00:00:00Z'
);
