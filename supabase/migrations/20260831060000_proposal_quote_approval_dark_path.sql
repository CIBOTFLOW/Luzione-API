begin;

create extension if not exists pgcrypto;

create table if not exists public.commercial_policy_configurations (
  tenant_id text not null,
  policy_key text not null,
  version integer not null default 1,
  status text not null default 'active',
  configuration jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, policy_key)
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  external_quote_id text unique,
  customer_id text,
  customer_name text,
  status text not null default 'draft',
  currency text not null default 'USD',
  subtotal_cents bigint not null default 0,
  margin_cents bigint,
  margin_percent numeric(8,4),
  source_system text not null default 'luzione_api',
  source_record_id text,
  created_by_type text not null default 'service',
  created_by_id text,
  approved_by_id text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quotes
  add column if not exists tenant_id text not null default 'luzione',
  add column if not exists commercial_case_id text,
  add column if not exists opportunity_id uuid,
  add column if not exists fully_landed_cost_cents bigint,
  add column if not exists economics_version integer not null default 1;

alter table public.quotes drop constraint if exists quotes_api_currency_check;
alter table public.quotes add constraint quotes_api_currency_check check (currency ~ '^[A-Z]{3}$');
alter table public.quotes drop constraint if exists quotes_api_money_check;
alter table public.quotes add constraint quotes_api_money_check check (
  subtotal_cents >= 0 and (fully_landed_cost_cents is null or fully_landed_cost_cents >= 0)
);
alter table public.quotes drop constraint if exists quotes_api_economics_version_check;
alter table public.quotes add constraint quotes_api_economics_version_check check (economics_version > 0);

create index if not exists quotes_tenant_updated_idx on public.quotes (tenant_id, updated_at desc);

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  sku text,
  description text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  margin_cents bigint,
  supplier_id text,
  source_system text not null default 'luzione_api',
  source_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_id, line_number)
);

create table if not exists public.quote_economics_versions (
  quote_economics_version_id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  quote_id uuid not null references public.quotes(id) on delete restrict,
  version integer not null check (version > 0),
  input_checksum text not null check (input_checksum ~ '^[a-f0-9]{64}$'),
  immutable_snapshot jsonb not null,
  gross_margin_percent numeric not null,
  fully_landed_cost_cents bigint not null check (fully_landed_cost_cents >= 0),
  approval_required boolean not null,
  required_approver_role text,
  actor_id text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, quote_id, version)
);

create table if not exists public.quote_margin_approval_records (
  approval_id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  quote_id uuid not null references public.quotes(id) on delete restrict,
  quote_economics_version_id uuid not null references public.quote_economics_versions(quote_economics_version_id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  required_role text not null,
  approver_role text not null,
  approver_user_id text not null,
  rationale text,
  idempotency_key text,
  request_digest text,
  approval_policy_version integer,
  economics_input_checksum text,
  created_at timestamptz not null default now(),
  unique (tenant_id, quote_economics_version_id)
);

alter table public.quote_margin_approval_records
  add column if not exists idempotency_key text,
  add column if not exists request_digest text,
  add column if not exists approval_policy_version integer,
  add column if not exists economics_input_checksum text;
create unique index if not exists quote_margin_approval_records_command_uidx
  on public.quote_margin_approval_records (tenant_id, quote_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.commercial_case_proposal_context_versions (
  proposal_context_version_id text primary key,
  tenant_id text not null,
  case_id text not null,
  idempotency_key text not null,
  payload_hash text not null,
  author_id text not null,
  author_type text not null,
  expected_version text not null,
  resulting_version text not null,
  source_recommendation_version_id text not null,
  source_supplier_inquiry_version_id text not null,
  context_hash text not null,
  proposal_id text not null,
  economics_authority text not null,
  economics jsonb not null,
  lineage_refs jsonb not null default '[]'::jsonb,
  binding_quote_authorized boolean not null default false,
  operational_authorization boolean not null default false,
  human_commercial_review_required boolean not null default true,
  generator_type text not null,
  prohibited_effects jsonb not null default '[]'::jsonb,
  event_id text,
  created_at timestamptz not null default now(),
  unique (tenant_id, case_id, proposal_context_version_id)
);

create table if not exists public.commercial_case_proposal_document_versions (
  proposal_document_version_id text primary key,
  tenant_id text not null,
  case_id text not null,
  idempotency_key text not null,
  payload_hash text not null,
  author_id text not null,
  author_type text not null,
  expected_version text not null,
  resulting_version text not null,
  source_proposal_context_version_id text not null,
  artifact_hash text not null,
  artifact jsonb not null,
  completeness_gate jsonb not null,
  template jsonb not null,
  rendering_boundary text not null,
  google_doc_authoritative boolean not null default false,
  customer_send_authorized boolean not null default false,
  proposal_approval_authorized boolean not null default false,
  generator_type text not null,
  prohibited_effects jsonb not null default '[]'::jsonb,
  event_id text,
  created_at timestamptz not null default now(),
  unique (tenant_id, case_id, proposal_document_version_id),
  foreign key (tenant_id, case_id, source_proposal_context_version_id)
    references public.commercial_case_proposal_context_versions(tenant_id, case_id, proposal_context_version_id) on delete restrict
);

alter table public.commercial_case_proposal_document_versions
  add column if not exists google_generation_state text not null default 'not_requested',
  add column if not exists google_generation_error text,
  add column if not exists google_primary_document_id text,
  add column if not exists google_primary_url text,
  add column if not exists google_artifacts jsonb not null default '[]'::jsonb,
  add column if not exists immutable_input_snapshot jsonb,
  add column if not exists snapshot_checksum text,
  add column if not exists google_generated_at timestamptz,
  add column if not exists google_readback_at timestamptz;

create table if not exists public.commercial_case_proposal_review_versions (
  proposal_review_version_id text primary key,
  tenant_id text not null,
  case_id text not null,
  idempotency_key text not null,
  payload_hash text not null,
  reviewer_id text not null,
  reviewer_type text not null check (reviewer_type = 'user'),
  expected_version text not null,
  resulting_version text not null,
  source_proposal_document_version_id text not null,
  source_proposal_context_version_id text not null,
  reviewed_artifact_hash text not null,
  decision text not null check (decision in ('approved','changes_requested','rejected')),
  reviewer_notes text not null,
  findings jsonb not null default '[]'::jsonb,
  review_hash text not null,
  exact_version_current boolean not null,
  superseded_by_document_version_id text,
  ai_approval_authorized boolean not null default false check (ai_approval_authorized = false),
  customer_send_authorized boolean not null default false check (customer_send_authorized = false),
  binding_acceptance_authorized boolean not null default false check (binding_acceptance_authorized = false),
  generator_type text not null check (generator_type = 'human_exact_version_review'),
  prohibited_effects jsonb not null default '[]'::jsonb,
  reviewer_role_snapshot text,
  approval_policy_version integer,
  approval_authority_state text not null default 'legacy_unverified',
  typed_confirmation_digest text,
  event_id text,
  created_at timestamptz not null default now(),
  unique (tenant_id, case_id, idempotency_key),
  unique (tenant_id, case_id, proposal_review_version_id),
  unique (tenant_id, case_id, review_hash),
  foreign key (tenant_id, case_id, source_proposal_document_version_id)
    references public.commercial_case_proposal_document_versions(tenant_id, case_id, proposal_document_version_id) on delete restrict,
  check (approval_authority_state in ('not_required','verified','legacy_unverified'))
);

alter table public.commercial_case_proposal_review_versions
  add column if not exists reviewer_role_snapshot text,
  add column if not exists approval_policy_version integer,
  add column if not exists approval_authority_state text not null default 'legacy_unverified',
  add column if not exists typed_confirmation_digest text;

create index if not exists commercial_case_proposal_reviews_case_idx on public.commercial_case_proposal_review_versions (tenant_id, case_id, created_at desc);

comment on table public.quotes is 'Existing canonical Quote rows. API-PC-009 is a default-off transfer-pending writer; active UI writer retirement requires independent cutover evidence.';
comment on table public.commercial_case_proposal_review_versions is 'Existing P16 exact-version human Proposal reviews. API-PC-009 reuses these rows without granting customer-send or binding-acceptance authority.';

commit;
