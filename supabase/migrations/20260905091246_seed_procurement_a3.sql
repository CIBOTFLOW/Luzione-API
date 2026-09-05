begin;

do $$
begin
  if to_regclass('public.p110_command_receipts') is null
     or to_regclass('public.p110_event_envelopes') is null
     or to_regclass('public.p110_outbox_messages') is null
     or to_regclass('public.seed_projects') is null
     or to_regclass('public.seed_specifications') is null
     or to_regclass('public.seed_specification_lines') is null then
    raise exception 'SEED-PROCUREMENT-A3 requires the P110 ledger and admitted A2 Project/Specification baseline';
  end if;
end $$;

create table public.seed_procurement_evidence_artifacts (
  tenant_id text not null,
  artifact_id text not null,
  project_id text,
  artifact_kind text not null check (artifact_kind in ('CALENDAR','DOCUMENT','EMAIL','MEETING_TRANSCRIPT','PORTAL_FORM','UPLOAD')),
  status text not null check (status in ('ACTIVE','QUARANTINED','REVIEW_REQUIRED')),
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  provider text not null,
  source_record_ref text not null,
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  captured_at timestamptz not null,
  created_at timestamptz not null,
  primary key (tenant_id, artifact_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, provider, source_record_ref, content_digest)
);

create table public.seed_product_sources (
  tenant_id text not null,
  product_source_id text not null,
  project_id text,
  artifact_id text not null,
  source_kind text not null check (source_kind in ('MANUAL','PDF','ROOM_PLANNER','SHOPIFY','URL','XLSX')),
  ingestion_format text not null check (ingestion_format in ('CSV','MANUAL','PDF','ROOM_PLANNER','SHOPIFY','URL','XLSX')),
  status text not null check (status in ('ACTIVE','CONFLICT','REVIEW_REQUIRED')),
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  duplicate_of_source_id text,
  extraction_provenance jsonb not null check (jsonb_typeof(extraction_provenance) = 'array'),
  conflict_refs jsonb not null check (jsonb_typeof(conflict_refs) = 'array'),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  observed_at timestamptz not null,
  valid_until timestamptz,
  created_at timestamptz not null,
  primary key (tenant_id, product_source_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, artifact_id) references public.seed_procurement_evidence_artifacts(tenant_id, artifact_id) on delete restrict,
  foreign key (tenant_id, duplicate_of_source_id) references public.seed_product_sources(tenant_id, product_source_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  check (
    (status = 'ACTIVE' and jsonb_array_length(conflict_refs) = 0)
    or status = 'REVIEW_REQUIRED'
    or (status = 'CONFLICT' and jsonb_array_length(conflict_refs) > 0)
  )
);

create table public.seed_product_candidates (
  tenant_id text not null,
  product_candidate_id text not null,
  project_id text,
  product_source_id text not null,
  product_identity_ref text not null,
  lane text not null check (lane in ('APPROVED_VENDOR','LUZIONE_MADE_TO_ORDER','LUZIONE_QUICK_SHIP','OUTSIDE_PRODUCT')),
  status text not null check (status in ('ELIGIBLE','REJECTED','REVIEW_REQUIRED')),
  duplicate_of_candidate_id text,
  conflict_refs jsonb not null check (jsonb_typeof(conflict_refs) = 'array'),
  extraction_provenance jsonb not null check (jsonb_typeof(extraction_provenance) = 'array'),
  fit_inputs jsonb not null check (jsonb_typeof(fit_inputs) = 'object'),
  fit_weights jsonb not null check (jsonb_typeof(fit_weights) = 'object'),
  objective_fit_score numeric(8,7) not null check (objective_fit_score between 0 and 1),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, product_candidate_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, product_source_id) references public.seed_product_sources(tenant_id, product_source_id) on delete restrict,
  foreign key (tenant_id, duplicate_of_candidate_id) references public.seed_product_candidates(tenant_id, product_candidate_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  check ((status = 'REVIEW_REQUIRED') or jsonb_array_length(conflict_refs) = 0),
  check (lane <> 'APPROVED_VENDOR' or nullif(canonical_payload ->> 'vendorId', '') is not null)
);

create table public.seed_rfq_drafts (
  tenant_id text not null,
  rfq_id text not null,
  project_id text not null,
  project_version text not null,
  specification_id text not null,
  specification_version text not null,
  supplier_id text not null,
  status text not null check (status = 'DRAFT'),
  specification_line_versions jsonb not null check (jsonb_typeof(specification_line_versions) = 'object'),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  due_at timestamptz not null,
  created_at timestamptz not null,
  primary key (tenant_id, rfq_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, specification_id) references public.seed_specifications(tenant_id, specification_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred
);

create table public.seed_supplier_quotes (
  tenant_id text not null,
  supplier_quote_id text not null,
  project_id text not null,
  rfq_id text not null,
  evidence_artifact_id text not null,
  supplier_id text not null,
  response_source text not null check (response_source in ('EMAIL','MANUAL','PORTAL')),
  status text not null check (status in ('NORMALIZED','REVIEW_REQUIRED')),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  economics_payload jsonb not null check (jsonb_typeof(economics_payload) = 'object'),
  objective_fit_inputs jsonb not null check (jsonb_typeof(objective_fit_inputs) = 'object'),
  objective_fit_weights jsonb not null check (jsonb_typeof(objective_fit_weights) = 'object'),
  objective_fit_score numeric(8,7) not null check (objective_fit_score between 0 and 1),
  basis_currency text not null check (basis_currency ~ '^[A-Z]{3}$'),
  supplier_cost_total_minor bigint not null check (supplier_cost_total_minor >= 0),
  landed_total_minor bigint not null check (landed_total_minor >= supplier_cost_total_minor),
  client_price_total_minor bigint not null check (client_price_total_minor >= 0),
  margin_minor bigint not null,
  valid_until timestamptz,
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, supplier_quote_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, rfq_id) references public.seed_rfq_drafts(tenant_id, rfq_id) on delete restrict,
  foreign key (tenant_id, evidence_artifact_id) references public.seed_procurement_evidence_artifacts(tenant_id, artifact_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, rfq_id, evidence_artifact_id),
  check (margin_minor = client_price_total_minor - landed_total_minor)
);

create table public.seed_bid_comparisons (
  tenant_id text not null,
  bid_comparison_id text not null,
  version integer not null check (version in (1,2)),
  project_id text not null,
  project_version text not null,
  specification_id text not null,
  specification_version text not null,
  status text not null check ((version = 1 and status in ('DRAFT','REVIEW_REQUIRED')) or (version = 2 and status = 'APPROVED')),
  basis_currency text not null check (basis_currency ~ '^[A-Z]{3}$'),
  rfq_ids jsonb not null check (jsonb_typeof(rfq_ids) = 'array'),
  supplier_quote_ids jsonb not null check (jsonb_typeof(supplier_quote_ids) = 'array'),
  selected_by_human_approval_ref text,
  recommendation_payload jsonb not null check (jsonb_typeof(recommendation_payload) = 'object'),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, bid_comparison_id, version),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, specification_id) references public.seed_specifications(tenant_id, specification_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  check ((version = 2) = (selected_by_human_approval_ref is not null))
);

create table public.seed_procurement_selection_decisions (
  tenant_id text not null,
  selection_decision_id text not null,
  project_id text not null,
  bid_comparison_id text not null,
  bid_comparison_version integer not null check (bid_comparison_version = 1),
  expected_bid_comparison_version text not null,
  selected_supplier_quote_id text not null,
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) > 0),
  rationale text not null,
  decision text not null check (decision = 'SELECT'),
  status text not null check (status = 'ACTIVE'),
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type = 'user'),
  decided_at timestamptz not null,
  primary key (tenant_id, selection_decision_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, bid_comparison_id, bid_comparison_version) references public.seed_bid_comparisons(tenant_id, bid_comparison_id, version) on delete restrict,
  foreign key (tenant_id, selected_supplier_quote_id) references public.seed_supplier_quotes(tenant_id, supplier_quote_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, bid_comparison_id)
);

create table public.seed_purchase_order_drafts (
  tenant_id text not null,
  purchase_order_id text not null,
  project_id text not null,
  bid_comparison_id text not null,
  bid_comparison_version integer not null check (bid_comparison_version = 2),
  selection_decision_id text not null,
  supplier_quote_id text not null,
  supplier_id text not null,
  proposal_version_id text not null,
  proposal_version text not null,
  status text not null check (status = 'DRAFT'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_minor bigint not null check (total_minor >= 0),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, purchase_order_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, bid_comparison_id, bid_comparison_version) references public.seed_bid_comparisons(tenant_id, bid_comparison_id, version) on delete restrict,
  foreign key (tenant_id, selection_decision_id) references public.seed_procurement_selection_decisions(tenant_id, selection_decision_id) on delete restrict,
  foreign key (tenant_id, supplier_quote_id) references public.seed_supplier_quotes(tenant_id, supplier_quote_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, bid_comparison_id)
);

create table public.seed_purchase_order_acknowledgements (
  tenant_id text not null,
  acknowledgement_id text not null,
  project_id text not null,
  purchase_order_id text not null,
  acknowledged_purchase_order_version text not null,
  evidence_artifact_id text not null,
  supplier_id text not null,
  status text not null check (status in ('CONFLICT','PROVIDER_ACKNOWLEDGED')),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, acknowledgement_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, purchase_order_id) references public.seed_purchase_order_drafts(tenant_id, purchase_order_id) on delete restrict,
  foreign key (tenant_id, evidence_artifact_id) references public.seed_procurement_evidence_artifacts(tenant_id, artifact_id) on delete restrict,
  foreign key (tenant_id, created_command_id) references public.p110_command_receipts(tenant_id, command_id) deferrable initially deferred,
  unique (tenant_id, purchase_order_id, evidence_artifact_id)
);

create index seed_procurement_evidence_project_idx on public.seed_procurement_evidence_artifacts (tenant_id, project_id, captured_at desc, artifact_id);
create index seed_product_sources_project_idx on public.seed_product_sources (tenant_id, project_id, observed_at desc, product_source_id);
create index seed_product_candidates_project_idx on public.seed_product_candidates (tenant_id, project_id, objective_fit_score desc, product_candidate_id);
create index seed_rfq_project_idx on public.seed_rfq_drafts (tenant_id, project_id, specification_id, created_at, rfq_id);
create index seed_supplier_quotes_project_idx on public.seed_supplier_quotes (tenant_id, project_id, rfq_id, created_at, supplier_quote_id);
create index seed_bid_comparisons_project_idx on public.seed_bid_comparisons (tenant_id, project_id, specification_id, version desc, bid_comparison_id);
create index seed_selection_project_idx on public.seed_procurement_selection_decisions (tenant_id, project_id, decided_at, selection_decision_id);
create index seed_purchase_orders_project_idx on public.seed_purchase_order_drafts (tenant_id, project_id, created_at, purchase_order_id);
create index seed_purchase_order_ack_project_idx on public.seed_purchase_order_acknowledgements (tenant_id, project_id, created_at, acknowledgement_id);

create function public.seed_procurement_a3_reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SEED-PROCUREMENT-A3 rows are immutable; append the next version or decision fact';
end
$$;

revoke all on function public.seed_procurement_a3_reject_mutation() from public;

create function public.seed_procurement_a3_hold_unresolved_dependencies()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SEED-PROCUREMENT-A3 downstream write held: canonical Supplier eligibility and ProposalVersion readback are not yet available';
end
$$;

revoke all on function public.seed_procurement_a3_hold_unresolved_dependencies() from public;

create function public.seed_procurement_a3_validate_product_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_project_id text;
  parent_status text;
  parent_digest text;
  duplicate_project_id text;
begin
  if tg_table_name = 'seed_product_sources' then
    select project_id,status,content_digest
      into parent_project_id,parent_status,parent_digest
      from public.seed_procurement_evidence_artifacts
     where tenant_id=new.tenant_id and artifact_id=new.artifact_id;
    if not found then
      raise exception 'SEED-PROCUREMENT-A3 Product Source evidence is not tenant-visible';
    end if;
    if parent_project_id is distinct from new.project_id then
      raise exception 'SEED-PROCUREMENT-A3 Product Source must inherit Evidence Artifact project scope';
    end if;
    if parent_digest <> new.content_digest then
      raise exception 'SEED-PROCUREMENT-A3 Product Source digest must match Evidence Artifact';
    end if;
    if parent_status <> 'ACTIVE' and new.status <> 'REVIEW_REQUIRED' then
      raise exception 'SEED-PROCUREMENT-A3 Product Source cannot promote non-active evidence';
    end if;
    if new.duplicate_of_source_id is not null then
      select project_id into duplicate_project_id
        from public.seed_product_sources
       where tenant_id=new.tenant_id and product_source_id=new.duplicate_of_source_id;
      if not found or duplicate_project_id is distinct from new.project_id then
        raise exception 'SEED-PROCUREMENT-A3 duplicate Product Source must share project scope';
      end if;
      if new.status <> 'REVIEW_REQUIRED' then
        raise exception 'SEED-PROCUREMENT-A3 duplicate Product Source must remain review-required';
      end if;
    end if;
  elsif tg_table_name = 'seed_product_candidates' then
    select project_id,status into parent_project_id,parent_status
      from public.seed_product_sources
     where tenant_id=new.tenant_id and product_source_id=new.product_source_id;
    if not found then
      raise exception 'SEED-PROCUREMENT-A3 Product Candidate source is not tenant-visible';
    end if;
    if parent_project_id is distinct from new.project_id then
      raise exception 'SEED-PROCUREMENT-A3 Product Candidate must inherit Product Source project scope';
    end if;
    if parent_status <> 'ACTIVE' and new.status <> 'REVIEW_REQUIRED' then
      raise exception 'SEED-PROCUREMENT-A3 Product Candidate cannot promote a non-active source';
    end if;
    if new.duplicate_of_candidate_id is not null then
      select project_id into duplicate_project_id
        from public.seed_product_candidates
       where tenant_id=new.tenant_id and product_candidate_id=new.duplicate_of_candidate_id;
      if not found or duplicate_project_id is distinct from new.project_id then
        raise exception 'SEED-PROCUREMENT-A3 duplicate Product Candidate must share project scope';
      end if;
      if new.status <> 'REVIEW_REQUIRED' then
        raise exception 'SEED-PROCUREMENT-A3 duplicate Product Candidate must remain review-required';
      end if;
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.seed_procurement_a3_validate_product_lineage() from public;

create trigger seed_procurement_evidence_append_only before update or delete on public.seed_procurement_evidence_artifacts for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_product_sources_append_only before update or delete on public.seed_product_sources for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_product_candidates_append_only before update or delete on public.seed_product_candidates for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_rfq_drafts_append_only before update or delete on public.seed_rfq_drafts for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_supplier_quotes_append_only before update or delete on public.seed_supplier_quotes for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_bid_comparisons_append_only before update or delete on public.seed_bid_comparisons for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_selection_decisions_append_only before update or delete on public.seed_procurement_selection_decisions for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_purchase_order_drafts_append_only before update or delete on public.seed_purchase_order_drafts for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_purchase_order_acks_append_only before update or delete on public.seed_purchase_order_acknowledgements for each row execute function public.seed_procurement_a3_reject_mutation();
create trigger seed_product_sources_validate_lineage before insert on public.seed_product_sources for each row execute function public.seed_procurement_a3_validate_product_lineage();
create trigger seed_product_candidates_validate_lineage before insert on public.seed_product_candidates for each row execute function public.seed_procurement_a3_validate_product_lineage();
create trigger seed_rfq_dependency_hold before insert on public.seed_rfq_drafts for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();
create trigger seed_supplier_quote_dependency_hold before insert on public.seed_supplier_quotes for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();
create trigger seed_bid_comparison_dependency_hold before insert on public.seed_bid_comparisons for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();
create trigger seed_selection_decision_dependency_hold before insert on public.seed_procurement_selection_decisions for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();
create trigger seed_purchase_order_dependency_hold before insert on public.seed_purchase_order_drafts for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();
create trigger seed_purchase_order_ack_dependency_hold before insert on public.seed_purchase_order_acknowledgements for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();

alter table public.seed_procurement_evidence_artifacts enable row level security;
alter table public.seed_procurement_evidence_artifacts force row level security;
alter table public.seed_product_sources enable row level security;
alter table public.seed_product_sources force row level security;
alter table public.seed_product_candidates enable row level security;
alter table public.seed_product_candidates force row level security;
alter table public.seed_rfq_drafts enable row level security;
alter table public.seed_rfq_drafts force row level security;
alter table public.seed_supplier_quotes enable row level security;
alter table public.seed_supplier_quotes force row level security;
alter table public.seed_bid_comparisons enable row level security;
alter table public.seed_bid_comparisons force row level security;
alter table public.seed_procurement_selection_decisions enable row level security;
alter table public.seed_procurement_selection_decisions force row level security;
alter table public.seed_purchase_order_drafts enable row level security;
alter table public.seed_purchase_order_drafts force row level security;
alter table public.seed_purchase_order_acknowledgements enable row level security;
alter table public.seed_purchase_order_acknowledgements force row level security;

revoke all on table public.seed_procurement_evidence_artifacts, public.seed_product_sources,
  public.seed_product_candidates, public.seed_rfq_drafts, public.seed_supplier_quotes,
  public.seed_bid_comparisons, public.seed_procurement_selection_decisions,
  public.seed_purchase_order_drafts, public.seed_purchase_order_acknowledgements from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.seed_procurement_evidence_artifacts, public.seed_product_sources,
      public.seed_product_candidates, public.seed_rfq_drafts, public.seed_supplier_quotes,
      public.seed_bid_comparisons, public.seed_procurement_selection_decisions,
      public.seed_purchase_order_drafts, public.seed_purchase_order_acknowledgements from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.seed_procurement_evidence_artifacts, public.seed_product_sources,
      public.seed_product_candidates, public.seed_rfq_drafts, public.seed_supplier_quotes,
      public.seed_bid_comparisons, public.seed_procurement_selection_decisions,
      public.seed_purchase_order_drafts, public.seed_purchase_order_acknowledgements from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.seed_procurement_evidence_artifacts, public.seed_product_sources,
      public.seed_product_candidates, public.seed_rfq_drafts, public.seed_supplier_quotes,
      public.seed_bid_comparisons, public.seed_procurement_selection_decisions,
      public.seed_purchase_order_drafts, public.seed_purchase_order_acknowledgements from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    execute 'create policy seed_procurement_evidence_runtime_tenant on public.seed_procurement_evidence_artifacts to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_product_sources_runtime_tenant on public.seed_product_sources to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_product_candidates_runtime_tenant on public.seed_product_candidates to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_rfq_drafts_runtime_tenant on public.seed_rfq_drafts to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_supplier_quotes_runtime_tenant on public.seed_supplier_quotes to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_bid_comparisons_runtime_tenant on public.seed_bid_comparisons to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_selection_decisions_runtime_tenant on public.seed_procurement_selection_decisions to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_purchase_order_drafts_runtime_tenant on public.seed_purchase_order_drafts to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_purchase_order_acks_runtime_tenant on public.seed_purchase_order_acknowledgements to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    grant select, insert on table public.seed_procurement_evidence_artifacts, public.seed_product_sources,
      public.seed_product_candidates, public.seed_rfq_drafts, public.seed_supplier_quotes,
      public.seed_bid_comparisons, public.seed_procurement_selection_decisions,
      public.seed_purchase_order_drafts, public.seed_purchase_order_acknowledgements to luzione_api_runtime;
  end if;
end $$;

comment on table public.seed_product_sources is
  'Immutable artifact-backed ProductSource/v1 observations. G0 stores reviewed fixture facts only and performs no fetch, upload, scan, OCR, or provider action.';
comment on table public.seed_bid_comparisons is
  'Reserved append-only BidComparison/v1 schema. Inserts remain database-held until an API-owned SupplierProfile/v1 is admitted.';
comment on table public.seed_purchase_order_drafts is
  'Reserved PurchaseOrder/v1 draft schema. Inserts remain database-held until tenant/project/version-matched canonical ProposalVersion readback is admitted.';
comment on table public.seed_purchase_order_acknowledgements is
  'Inbound evidence-backed acknowledgements. A3 rejects SOURCE_CONFIRMED and never treats provider acknowledgement as authoritative completion.';

commit;
