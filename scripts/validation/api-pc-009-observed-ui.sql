create extension if not exists pgcrypto;

create table public.commercial_policy_configurations (
  tenant_id text not null,
  policy_key text not null,
  version integer not null default 1,
  status text not null default 'active',
  configuration jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, policy_key)
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(), external_quote_id text unique,
  customer_id text, customer_name text, status text not null default 'draft',
  currency text not null default 'USD', subtotal_cents bigint not null default 0,
  margin_cents bigint, margin_percent numeric(8,4), source_system text not null default 'sultan_os',
  source_record_id text, created_by_type text not null default 'operator', created_by_id text,
  approved_by_id text, approved_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), tenant_id text not null default 'luzione',
  commercial_case_id text, opportunity_id uuid, fully_landed_cost_cents bigint,
  economics_version integer not null default 1
);
create table public.quote_lines (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.quotes(id) on delete cascade,
  line_number integer not null, sku text, description text not null, quantity numeric(12,3) not null,
  unit_price_cents bigint not null, unit_cost_cents bigint, margin_cents bigint, supplier_id text,
  source_system text not null default 'sultan_os', source_record_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (quote_id, line_number)
);
create table public.quote_economics_versions (
  quote_economics_version_id uuid primary key default gen_random_uuid(), tenant_id text not null,
  quote_id uuid not null references public.quotes(id), version integer not null, input_checksum text not null,
  immutable_snapshot jsonb not null, gross_margin_percent numeric not null, fully_landed_cost_cents bigint not null,
  approval_required boolean not null, required_approver_role text, actor_id text not null,
  created_at timestamptz not null default now(), unique (tenant_id, quote_id, version)
);
create table public.quote_margin_approval_records (
  approval_id uuid primary key default gen_random_uuid(), tenant_id text not null,
  quote_id uuid not null references public.quotes(id), quote_economics_version_id uuid not null references public.quote_economics_versions(quote_economics_version_id),
  decision text not null, required_role text not null, approver_role text not null,
  approver_user_id text not null, rationale text, created_at timestamptz not null default now(),
  unique (tenant_id, quote_economics_version_id)
);

create table public.commercial_case_proposal_context_versions (
  proposal_context_version_id text primary key, tenant_id text not null, case_id text not null,
  idempotency_key text not null, payload_hash text not null, author_id text not null, author_type text not null,
  expected_version text not null, resulting_version text not null, source_recommendation_version_id text not null,
  source_supplier_inquiry_version_id text not null, context_hash text not null, proposal_id text not null,
  economics_authority text not null, economics jsonb not null, lineage_refs jsonb not null default '[]',
  binding_quote_authorized boolean not null default false, operational_authorization boolean not null default false,
  human_commercial_review_required boolean not null default true, generator_type text not null,
  prohibited_effects jsonb not null default '[]', event_id text, created_at timestamptz not null default now(),
  unique (tenant_id, case_id, proposal_context_version_id)
);
create table public.commercial_case_proposal_document_versions (
  proposal_document_version_id text primary key, tenant_id text not null, case_id text not null,
  idempotency_key text not null, payload_hash text not null, author_id text not null, author_type text not null,
  expected_version text not null, resulting_version text not null, source_proposal_context_version_id text not null,
  artifact_hash text not null, artifact jsonb not null, completeness_gate jsonb not null, template jsonb not null,
  rendering_boundary text not null, google_doc_authoritative boolean not null default false,
  customer_send_authorized boolean not null default false, proposal_approval_authorized boolean not null default false,
  generator_type text not null, prohibited_effects jsonb not null default '[]', event_id text,
  created_at timestamptz not null default now(), unique (tenant_id, case_id, proposal_document_version_id)
);
create table public.commercial_case_proposal_review_versions (
  proposal_review_version_id text primary key, tenant_id text not null, case_id text not null,
  idempotency_key text not null, payload_hash text not null, reviewer_id text not null, reviewer_type text not null,
  expected_version text not null, resulting_version text not null, source_proposal_document_version_id text not null,
  source_proposal_context_version_id text not null, reviewed_artifact_hash text not null, decision text not null,
  reviewer_notes text not null, findings jsonb not null default '[]', review_hash text not null,
  exact_version_current boolean not null, superseded_by_document_version_id text,
  ai_approval_authorized boolean not null default false, customer_send_authorized boolean not null default false,
  binding_acceptance_authorized boolean not null default false, generator_type text not null,
  prohibited_effects jsonb not null default '[]', event_id text, created_at timestamptz not null default now(),
  unique (tenant_id, case_id, idempotency_key), unique (tenant_id, case_id, proposal_review_version_id),
  unique (tenant_id, case_id, review_hash)
);
