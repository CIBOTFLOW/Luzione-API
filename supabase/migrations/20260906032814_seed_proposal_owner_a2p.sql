-- Generated with Supabase CLI 2.116.0 (`supabase migration new seed_proposal_owner_a2p`).
-- Additive, local-only A2P convergence over the existing API-PC-009 proposal/quote owner.

begin;

do $$
begin
  if to_regclass('public.p110_command_receipts') is null
     or to_regclass('public.commercial_case_proposal_context_versions') is null
     or to_regclass('public.commercial_case_proposal_document_versions') is null
     or to_regclass('public.quotes') is null
     or to_regclass('public.quote_lines') is null
     or to_regclass('public.quote_economics_versions') is null
     or to_regclass('public.seed_projects') is null
     or to_regclass('public.seed_specifications') is null
     or to_regclass('public.seed_specification_lines') is null
     or to_regclass('public.seed_product_candidates') is null then
    raise exception 'SEED-PROPOSAL-OWNER-A2P requires P110, API-PC-009, A2, and corrected A3C owner tables';
  end if;
  if exists (select 1 from public.seed_purchase_order_drafts limit 1)
     or exists (select 1 from public.seed_purchase_order_acknowledgements limit 1) then
    raise exception 'SEED-PROPOSAL-OWNER-A2P refuses to reinterpret pre-A2P Purchase Order rows';
  end if;
end $$;

create table public.commercial_case_proposal_template_versions (
  tenant_id text not null,
  template_id text not null,
  revision integer not null check (revision > 0),
  object_version text not null,
  status text not null check (status in ('ACTIVE','INVALID')),
  name text not null,
  format text not null check (format in ('DOCX','HTML','PDF_ACROFORM','PDF_OVERLAY')),
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  storage_object_ref text not null,
  malware_scan_state text not null check (malware_scan_state = 'CLEAN'),
  malware_scan_evidence_ref jsonb not null check (jsonb_typeof(malware_scan_evidence_ref) = 'object'),
  token_schema_version text not null check (token_schema_version = 'ProposalMergeTokens/v1'),
  merge_tokens jsonb not null check (jsonb_typeof(merge_tokens) = 'array'),
  pdf_configuration jsonb,
  validation_issues jsonb not null check (jsonb_typeof(validation_issues) = 'array'),
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) > 0),
  command_payload jsonb not null check (jsonb_typeof(command_payload) = 'object'),
  command_payload_hash text not null check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  expected_object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  created_at timestamptz not null,
  primary key (tenant_id, template_id, revision),
  unique (tenant_id, object_version),
  foreign key (tenant_id, created_command_id)
    references public.p110_command_receipts(tenant_id, command_id)
    deferrable initially deferred,
  check ((status = 'ACTIVE') = (jsonb_array_length(validation_issues) = 0))
);

alter table public.commercial_case_proposal_document_versions
  add column proposal_contract_version text,
  add column seed_project_id text,
  add column seed_project_version text,
  add column seed_proposal_id text,
  add column seed_proposal_revision integer,
  add column seed_proposal_version text,
  add column seed_template_id text,
  add column seed_template_version text,
  add column seed_quote_id uuid,
  add column seed_quote_economics_version_id uuid,
  add column seed_status text,
  add column seed_currency text,
  add column seed_total_minor bigint,
  add column seed_decision_state text,
  add column seed_specification_refs jsonb,
  add column seed_product_refs jsonb,
  add column seed_line_ids jsonb,
  add column seed_evidence_refs jsonb,
  add column seed_command_payload jsonb,
  add column seed_command_payload_hash text,
  add column seed_created_command_id text;

alter table public.commercial_case_proposal_document_versions
  add constraint commercial_case_proposal_document_seed_v1_check check (
    proposal_contract_version is null or (
      proposal_contract_version = 'ProposalVersion/v1'
      and seed_project_id is not null and seed_project_version is not null
      and seed_proposal_id is not null and seed_proposal_revision > 0 and seed_proposal_version is not null
      and seed_template_id is not null and seed_template_version is not null
      and seed_quote_id is not null and seed_quote_economics_version_id is not null
      and seed_status = 'DRAFT' and seed_currency ~ '^[A-Z]{3}$' and seed_total_minor >= 0
      and seed_decision_state = 'PENDING'
      and jsonb_typeof(seed_specification_refs) = 'array' and jsonb_array_length(seed_specification_refs) > 0
      and jsonb_typeof(seed_product_refs) = 'array'
      and jsonb_typeof(seed_line_ids) = 'array' and jsonb_array_length(seed_line_ids) > 0
      and jsonb_typeof(seed_evidence_refs) = 'array' and jsonb_array_length(seed_evidence_refs) > 0
      and jsonb_typeof(seed_command_payload) = 'object'
      and seed_command_payload_hash ~ '^[a-f0-9]{64}$'
      and seed_created_command_id is not null
      and customer_send_authorized = false and proposal_approval_authorized = false
    )
  ),
  add constraint commercial_case_proposal_document_seed_project_fk
    foreign key (tenant_id, seed_project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  add constraint commercial_case_proposal_document_seed_quote_fk
    foreign key (seed_quote_economics_version_id)
    references public.quote_economics_versions(quote_economics_version_id) on delete restrict,
  add constraint commercial_case_proposal_document_seed_receipt_fk
    foreign key (tenant_id, seed_created_command_id)
    references public.p110_command_receipts(tenant_id, command_id)
    deferrable initially deferred;

-- Reuse the admitted API-PC-009 exact-version review ledger for every client
-- ApprovalDecision/v1. Scope and Portal grant facts remain explicit projections.
alter table public.commercial_case_proposal_review_versions
  add column proposal_contract_version text,
  add column seed_proposal_id text,
  add column seed_proposal_revision integer,
  add column seed_proposal_version text,
  add column seed_scope text,
  add column seed_target_id text,
  add column seed_decision_id text,
  add column seed_portal_grant_ref jsonb,
  add column seed_human_authentication_ref text,
  add column seed_created_command_id text,
  add constraint commercial_case_proposal_review_seed_v1_check check (
    proposal_contract_version is null or (
      proposal_contract_version = 'ApprovalDecision/v1'
      and seed_proposal_id is not null and seed_proposal_revision > 0 and seed_proposal_version is not null
      and seed_scope in ('ITEM','OPTION_GROUP','PROPOSAL','SECTION') and seed_target_id is not null
      and seed_decision_id is not null and jsonb_typeof(seed_portal_grant_ref) = 'object'
      and seed_human_authentication_ref is not null and seed_created_command_id is not null
      and exact_version_current = true and ai_approval_authorized = false
      and customer_send_authorized = false and binding_acceptance_authorized = false
    )
  ),
  add constraint commercial_case_proposal_review_seed_decision_unique unique (tenant_id, seed_decision_id),
  add constraint commercial_case_proposal_review_seed_receipt_fk
    foreign key (tenant_id, seed_created_command_id)
    references public.p110_command_receipts(tenant_id, command_id)
    deferrable initially deferred;

create table public.commercial_case_proposal_v1_identity_map (
  tenant_id text not null,
  proposal_id text not null,
  revision integer not null check (revision > 0),
  proposal_version text not null,
  project_id text not null,
  project_version text not null,
  case_id text not null,
  proposal_context_version_id text not null,
  proposal_document_version_id text not null,
  template_id text not null,
  template_version text not null,
  quote_id uuid not null,
  quote_economics_version_id uuid not null,
  created_command_id text not null,
  created_at timestamptz not null,
  primary key (tenant_id, proposal_id, revision),
  unique (tenant_id, proposal_id, proposal_version),
  unique (tenant_id, proposal_document_version_id),
  unique (tenant_id, quote_economics_version_id),
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, case_id, proposal_context_version_id)
    references public.commercial_case_proposal_context_versions(tenant_id, case_id, proposal_context_version_id) on delete restrict,
  foreign key (tenant_id, case_id, proposal_document_version_id)
    references public.commercial_case_proposal_document_versions(tenant_id, case_id, proposal_document_version_id) on delete restrict,
  foreign key (quote_economics_version_id) references public.quote_economics_versions(quote_economics_version_id) on delete restrict,
  foreign key (tenant_id, created_command_id)
    references public.p110_command_receipts(tenant_id, command_id)
    deferrable initially deferred
);

create table public.commercial_case_proposal_line_versions (
  tenant_id text not null,
  proposal_id text not null,
  proposal_revision integer not null,
  proposal_version text not null,
  line_id text not null,
  object_version text not null,
  project_id text not null,
  line_type text not null check (line_type in ('DELIVERY_INSTALLATION','DESIGN_FEE','DISCOUNT','FREIGHT','PROCUREMENT_FEE','PRODUCT','SERVICE_FEE','TAX')),
  description text not null,
  quantity integer not null check (quantity > 0),
  section_id text not null,
  option_group_id text,
  supplier_cost_minor bigint not null check (supplier_cost_minor >= 0),
  freight_minor bigint not null check (freight_minor >= 0),
  duty_minor bigint not null check (duty_minor >= 0),
  reserve_minor bigint not null check (reserve_minor >= 0),
  landed_cost_minor bigint not null check (landed_cost_minor >= 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  confidence_score numeric(8,7) not null check (confidence_score between 0 and 1),
  source_fresh_at timestamptz,
  source_ref jsonb not null check (jsonb_typeof(source_ref) = 'object'),
  specification_line_ref jsonb,
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  command_payload_hash text not null check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  created_command_id text not null,
  created_at timestamptz not null,
  primary key (tenant_id, proposal_id, proposal_revision, line_id),
  foreign key (tenant_id, proposal_id, proposal_revision)
    references public.commercial_case_proposal_v1_identity_map(tenant_id, proposal_id, revision)
    deferrable initially deferred,
  foreign key (tenant_id, project_id) references public.seed_projects(tenant_id, project_id) on delete restrict,
  foreign key (tenant_id, created_command_id)
    references public.p110_command_receipts(tenant_id, command_id)
    deferrable initially deferred,
  check (landed_cost_minor = supplier_cost_minor * quantity + freight_minor + duty_minor + reserve_minor),
  check (total_minor = unit_price_minor * quantity),
  check (line_type = 'PRODUCT' or specification_line_ref is null),
  check (line_type not in ('DISCOUNT','TAX') or landed_cost_minor = 0)
);

create table public.commercial_case_proposal_client_decision_versions (
  tenant_id text not null,
  decision_id text not null,
  proposal_id text not null,
  proposal_revision integer not null,
  proposal_version text not null,
  scope text not null check (scope in ('ITEM','OPTION_GROUP','PROPOSAL','SECTION')),
  target_id text not null,
  decision text not null check (decision in ('APPROVE','CHANGE_REQUESTED','REJECT')),
  comment text,
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) > 0),
  portal_grant_ref jsonb not null check (jsonb_typeof(portal_grant_ref) = 'object'),
  decided_by text not null,
  human_authentication_ref text not null,
  status text not null check (status = 'ACTIVE'),
  object_version text not null,
  expected_object_version text not null,
  command_payload jsonb not null check (jsonb_typeof(command_payload) = 'object'),
  command_payload_hash text not null check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  created_command_id text not null,
  decided_at timestamptz not null,
  primary key (tenant_id, decision_id),
  unique (tenant_id, proposal_id, proposal_revision, scope, target_id),
  foreign key (tenant_id, proposal_id, proposal_revision)
    references public.commercial_case_proposal_v1_identity_map(tenant_id, proposal_id, revision) on delete restrict,
  foreign key (tenant_id, created_command_id)
    references public.p110_command_receipts(tenant_id, command_id)
    deferrable initially deferred
);

create table public.commercial_case_proposal_render_preparations (
  tenant_id text not null,
  preparation_id text not null,
  proposal_id text not null,
  proposal_revision integer not null,
  proposal_version text not null,
  template_id text not null,
  template_version text not null,
  requested_artifact text not null check (requested_artifact in ('PDF','WEB')),
  render_input_hash text not null check (render_input_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status = 'PREPARED'),
  provider_acknowledgement_ref text,
  source_readback_ref text,
  artifact_ref text,
  external_effect_authorized boolean not null default false check (external_effect_authorized = false),
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) > 0),
  object_version text not null,
  expected_object_version text not null,
  command_payload jsonb not null check (jsonb_typeof(command_payload) = 'object'),
  command_payload_hash text not null check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  created_command_id text not null,
  created_at timestamptz not null,
  primary key (tenant_id, preparation_id),
  unique (tenant_id, proposal_id, proposal_revision, requested_artifact, render_input_hash),
  foreign key (tenant_id, proposal_id, proposal_revision)
    references public.commercial_case_proposal_v1_identity_map(tenant_id, proposal_id, revision) on delete restrict,
  foreign key (tenant_id, created_command_id)
    references public.p110_command_receipts(tenant_id, command_id)
    deferrable initially deferred,
  check (provider_acknowledgement_ref is null and source_readback_ref is null and artifact_ref is null)
);

alter table public.seed_purchase_order_drafts
  add column project_version text not null,
  add column selection_decision_version text not null,
  add column supplier_quote_version text not null,
  add column proposal_decision_id text not null,
  add column line_refs jsonb not null check (jsonb_typeof(line_refs)='array' and jsonb_array_length(line_refs)>0),
  add column source_refs jsonb not null check (jsonb_typeof(source_refs)='array' and jsonb_array_length(source_refs)>0),
  add column command_payload jsonb not null check (jsonb_typeof(command_payload)='object'),
  add column command_payload_hash text not null check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  add column release_approval_ref text,
  add column external_effect_authorized boolean not null default false check (external_effect_authorized=false),
  add constraint seed_purchase_order_a2p_release_hold check (release_approval_ref is null),
  add constraint seed_purchase_order_a2p_proposal_fk foreign key (tenant_id,proposal_version_id,proposal_version)
    references public.commercial_case_proposal_v1_identity_map(tenant_id,proposal_id,proposal_version) on delete restrict,
  add constraint seed_purchase_order_a2p_decision_fk foreign key (tenant_id,proposal_decision_id)
    references public.commercial_case_proposal_client_decision_versions(tenant_id,decision_id) on delete restrict;
alter table public.seed_purchase_order_drafts alter column external_effect_authorized drop default;

create index commercial_case_proposal_templates_lookup_idx on public.commercial_case_proposal_template_versions (tenant_id, template_id, revision desc);
create index commercial_case_proposal_v1_project_idx on public.commercial_case_proposal_v1_identity_map (tenant_id, project_id, created_at, proposal_id, revision);
create index commercial_case_proposal_lines_lookup_idx on public.commercial_case_proposal_line_versions (tenant_id, proposal_id, proposal_revision, line_id);
create index commercial_case_proposal_decisions_lookup_idx on public.commercial_case_proposal_client_decision_versions (tenant_id, proposal_id, proposal_revision, decided_at, decision_id);
create index commercial_case_proposal_render_lookup_idx on public.commercial_case_proposal_render_preparations (tenant_id, proposal_id, proposal_revision, created_at, preparation_id);

create function public.seed_proposal_a2p_reject_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'SEED-PROPOSAL-OWNER-A2P facts are immutable; append a new template, proposal, decision, or preparation version';
end
$$;
revoke all on function public.seed_proposal_a2p_reject_mutation() from public;

create function public.seed_proposal_a2p_protect_predecessor()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_table_name in ('quotes','quote_lines') and old.source_system = 'luzione_api_seed_proposal_a2p')
     or (tg_table_name = 'commercial_case_proposal_context_versions' and old.generator_type = 'seed_proposal_owner_v1')
     or (tg_table_name = 'commercial_case_proposal_document_versions' and old.proposal_contract_version = 'ProposalVersion/v1')
     or (tg_table_name = 'commercial_case_proposal_review_versions' and old.proposal_contract_version = 'ApprovalDecision/v1')
     or (tg_table_name = 'quote_economics_versions' and exists (
       select 1 from public.quotes q where q.id=old.quote_id and q.source_system='luzione_api_seed_proposal_a2p'
     )) then
    raise exception 'SEED-PROPOSAL-OWNER-A2P predecessor rows are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function public.seed_proposal_a2p_protect_predecessor() from public;

create function public.seed_proposal_a2p_validate_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare
  identity_row record;
  template_row record;
  receipt_row record;
  current_revision integer;
  target_exists boolean;
begin
  if tg_table_name = 'commercial_case_proposal_template_versions' then
    select max(revision) into current_revision from public.commercial_case_proposal_template_versions
     where tenant_id = new.tenant_id and template_id = new.template_id and revision < new.revision;
    if (new.revision = 1 and new.expected_object_version <> 'ABSENT')
       or (new.revision > 1 and (current_revision is distinct from new.revision - 1
          or new.expected_object_version <> 'proposal-template:' || new.template_id || ':v' || (new.revision - 1)::text)) then
      raise exception 'SEED-PROPOSAL-OWNER-A2P template expected version is stale';
    end if;
    if new.storage_object_ref not like 'private-object:' || new.tenant_id || ':%' then
      raise exception 'SEED-PROPOSAL-OWNER-A2P template object is not tenant-private';
    end if;
    if new.malware_scan_evidence_ref->>'objectType'<>'EVIDENCE_ARTIFACT'
       or new.malware_scan_evidence_ref->>'ownerProject'<>'LUZIONE_PROCUREMENT'
       or not exists (
         select 1 from public.seed_procurement_evidence_artifacts a
         where a.tenant_id=new.tenant_id and a.artifact_id=new.malware_scan_evidence_ref->>'objectId'
           and a.object_version=new.malware_scan_evidence_ref->>'version'
           and a.status='ACTIVE' and a.project_id is null
       ) then raise exception 'SEED-PROPOSAL-OWNER-A2P exact active tenant-global malware scan evidence is missing'; end if;
  elsif tg_table_name = 'commercial_case_proposal_v1_identity_map' then
    select * into template_row from public.commercial_case_proposal_template_versions
     where tenant_id=new.tenant_id and template_id=new.template_id and object_version=new.template_version;
    if not found or template_row.status <> 'ACTIVE' then raise exception 'SEED-PROPOSAL-OWNER-A2P exact active template is missing'; end if;
    if not exists (select 1 from public.commercial_case_proposal_document_versions d where d.tenant_id=new.tenant_id and d.case_id=new.case_id and d.proposal_document_version_id=new.proposal_document_version_id and d.seed_proposal_id=new.proposal_id and d.seed_proposal_revision=new.revision and d.seed_proposal_version=new.proposal_version and d.seed_project_id=new.project_id and d.seed_project_version=new.project_version and d.seed_template_id=new.template_id and d.seed_template_version=new.template_version and d.seed_quote_id=new.quote_id and d.seed_quote_economics_version_id=new.quote_economics_version_id and d.seed_created_command_id=new.created_command_id) then
      raise exception 'SEED-PROPOSAL-OWNER-A2P identity map does not match its document version';
    end if;
    select max(revision) into current_revision from public.commercial_case_proposal_v1_identity_map where tenant_id=new.tenant_id and proposal_id=new.proposal_id and revision<new.revision;
    if (new.revision=1 and (current_revision is not null or (select expected_object_version from public.p110_command_receipts where tenant_id=new.tenant_id and command_id=new.created_command_id)<>'ABSENT'))
       or (new.revision>1 and current_revision is distinct from new.revision-1) then
      raise exception 'SEED-PROPOSAL-OWNER-A2P proposal revision lineage is invalid';
    end if;
  elsif tg_table_name in ('commercial_case_proposal_line_versions','commercial_case_proposal_client_decision_versions','commercial_case_proposal_render_preparations') then
    select * into identity_row from public.commercial_case_proposal_v1_identity_map
     where tenant_id=new.tenant_id and proposal_id=new.proposal_id and revision=new.proposal_revision and proposal_version=new.proposal_version;
    if not found then raise exception 'SEED-PROPOSAL-OWNER-A2P exact Proposal Version is missing'; end if;
    if tg_table_name='commercial_case_proposal_client_decision_versions' then
      select max(revision) into current_revision from public.commercial_case_proposal_v1_identity_map where tenant_id=new.tenant_id and proposal_id=new.proposal_id;
      if current_revision<>new.proposal_revision or new.expected_object_version<>new.proposal_version then raise exception 'SEED-PROPOSAL-OWNER-A2P stale Proposal Version decision denied'; end if;
      target_exists := case new.scope
        when 'PROPOSAL' then new.target_id=new.proposal_id
        when 'ITEM' then exists (select 1 from public.commercial_case_proposal_line_versions l where l.tenant_id=new.tenant_id and l.proposal_id=new.proposal_id and l.proposal_revision=new.proposal_revision and l.line_id=new.target_id)
        when 'OPTION_GROUP' then exists (select 1 from public.commercial_case_proposal_line_versions l where l.tenant_id=new.tenant_id and l.proposal_id=new.proposal_id and l.proposal_revision=new.proposal_revision and l.option_group_id=new.target_id)
        when 'SECTION' then exists (select 1 from public.commercial_case_proposal_line_versions l where l.tenant_id=new.tenant_id and l.proposal_id=new.proposal_id and l.proposal_revision=new.proposal_revision and l.section_id=new.target_id)
        else false end;
      if not target_exists then raise exception 'SEED-PROPOSAL-OWNER-A2P decision target is outside the exact Proposal Version'; end if;
      if new.portal_grant_ref->>'status'<>'ACTIVE'
        or new.portal_grant_ref->>'tenantId'<>new.tenant_id
        or new.portal_grant_ref->>'actorId'<>new.decided_by
        or new.portal_grant_ref->>'proposalId'<>new.proposal_id
        or new.portal_grant_ref->>'proposalVersion'<>new.proposal_version
        or new.portal_grant_ref->>'accessLevel' not in ('contribute','manage')
        or coalesce((new.portal_grant_ref->>'validUntil')::timestamptz, 'infinity'::timestamptz) <= new.decided_at
        or not exists (
          select 1 from public.commercial_case_proposal_review_versions v
          where v.tenant_id=new.tenant_id and v.seed_decision_id=new.decision_id
            and v.seed_proposal_id=new.proposal_id and v.seed_proposal_revision=new.proposal_revision
            and v.seed_proposal_version=new.proposal_version and v.seed_scope=new.scope
            and v.seed_target_id=new.target_id and v.seed_created_command_id=new.created_command_id
            and v.reviewer_id=new.decided_by and v.seed_human_authentication_ref=new.human_authentication_ref
        ) then
        raise exception 'SEED-PROPOSAL-OWNER-A2P exact active Portal object grant or predecessor review is missing';
      end if;
    elsif tg_table_name='commercial_case_proposal_render_preparations' then
      if new.expected_object_version<>new.proposal_version then raise exception 'SEED-PROPOSAL-OWNER-A2P stale render preparation denied'; end if;
    end if;
  end if;

  if new.created_command_id is not null then
    select * into receipt_row from public.p110_command_receipts where tenant_id=new.tenant_id and command_id=new.created_command_id;
    if not found then raise exception 'SEED-PROPOSAL-OWNER-A2P durable receipt is missing'; end if;
    if tg_table_name = 'commercial_case_proposal_template_versions' then
      if receipt_row.committed_object_version<>new.object_version or receipt_row.payload_hash<>new.command_payload_hash then raise exception 'SEED-PROPOSAL-OWNER-A2P template receipt mismatch'; end if;
    elsif tg_table_name = 'commercial_case_proposal_v1_identity_map' then
      if receipt_row.committed_object_version<>new.proposal_version then raise exception 'SEED-PROPOSAL-OWNER-A2P proposal receipt mismatch'; end if;
    elsif tg_table_name = 'commercial_case_proposal_line_versions' then
      if receipt_row.committed_object_version<>new.proposal_version or receipt_row.payload_hash<>new.command_payload_hash then raise exception 'SEED-PROPOSAL-OWNER-A2P line receipt mismatch'; end if;
    else
      if receipt_row.committed_object_version<>new.object_version or receipt_row.payload_hash<>new.command_payload_hash then raise exception 'SEED-PROPOSAL-OWNER-A2P child receipt mismatch'; end if;
    end if;
  end if;
  return null;
end
$$;
revoke all on function public.seed_proposal_a2p_validate_integrity() from public;

create function public.seed_proposal_a2p_validate_review_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare
  receipt_row record;
begin
  if new.proposal_contract_version is distinct from 'ApprovalDecision/v1' then return null; end if;
  select * into receipt_row from public.p110_command_receipts
   where tenant_id=new.tenant_id and command_id=new.seed_created_command_id;
  if not found or receipt_row.committed_object_version<>new.resulting_version
     or receipt_row.payload_hash<>new.payload_hash or receipt_row.actor_id<>new.reviewer_id then
    raise exception 'SEED-PROPOSAL-OWNER-A2P predecessor review receipt mismatch';
  end if;
  if not exists (
    select 1 from public.commercial_case_proposal_v1_identity_map m
    where m.tenant_id=new.tenant_id and m.case_id=new.case_id
      and m.proposal_id=new.seed_proposal_id and m.revision=new.seed_proposal_revision
      and m.proposal_version=new.seed_proposal_version
      and m.proposal_document_version_id=new.source_proposal_document_version_id
      and m.proposal_context_version_id=new.source_proposal_context_version_id
  ) then raise exception 'SEED-PROPOSAL-OWNER-A2P predecessor review Proposal Version mismatch'; end if;
  if new.seed_portal_grant_ref->>'tenantId'<>new.tenant_id
     or new.seed_portal_grant_ref->>'actorId'<>new.reviewer_id
     or new.seed_portal_grant_ref->>'proposalId'<>new.seed_proposal_id
     or new.seed_portal_grant_ref->>'proposalVersion'<>new.seed_proposal_version
     or new.seed_portal_grant_ref->>'status'<>'ACTIVE'
     or new.seed_portal_grant_ref->>'accessLevel' not in ('contribute','manage') then
    raise exception 'SEED-PROPOSAL-OWNER-A2P predecessor review Portal grant mismatch';
  end if;
  if not exists (
    select 1 from public.commercial_case_proposal_client_decision_versions d
    where d.tenant_id=new.tenant_id and d.decision_id=new.seed_decision_id
      and d.proposal_id=new.seed_proposal_id and d.proposal_revision=new.seed_proposal_revision
      and d.proposal_version=new.seed_proposal_version and d.scope=new.seed_scope
      and d.target_id=new.seed_target_id and d.created_command_id=new.seed_created_command_id
      and d.decided_by=new.reviewer_id and d.human_authentication_ref=new.seed_human_authentication_ref
  ) then raise exception 'SEED-PROPOSAL-OWNER-A2P predecessor review decision projection mismatch'; end if;
  return null;
end
$$;
revoke all on function public.seed_proposal_a2p_validate_review_integrity() from public;

create function public.seed_proposal_a2p_validate_purchase_order()
returns trigger language plpgsql set search_path = '' as $$
declare
  accepted_revision integer;
  bid_row record;
  decision_row record;
  proposal_row record;
  quote_row record;
  receipt_row record;
  ref jsonb;
begin
  select * into receipt_row from public.p110_command_receipts where tenant_id=new.tenant_id and command_id=new.created_command_id;
  if not found or receipt_row.state<>'DOMAIN_COMMITTED' or receipt_row.command_type<>'purchase_order.create_draft'
     or receipt_row.idempotency_key is distinct from new.command_payload->>'idempotencyKey'
     or receipt_row.payload_hash<>new.command_payload_hash or receipt_row.committed_object_version<>new.object_version
     or receipt_row.expected_object_version<>new.command_payload->>'expectedVersion'
     or receipt_row.target_owner_project<>'LUZIONE_PROCUREMENT' or receipt_row.target_object_type<>'purchase_order'
     or receipt_row.target_object_id<>new.purchase_order_id or receipt_row.actor_id<>new.created_by
     or receipt_row.actor_type<>new.created_by_type or receipt_row.requested_at is distinct from new.created_at
     or receipt_row.committed_at is null then
    raise exception 'SEED-PROPOSAL-OWNER-A2P PO durable receipt mismatch';
  end if;
  if new.command_payload->>'commandType'<>'purchase_order.create_draft'
     or new.command_payload->>'commandId'<>new.created_command_id
     or new.command_payload->>'projectId'<>new.project_id
     or new.command_payload->>'projectVersion'<>new.project_version
     or new.command_payload->>'bidComparisonId'<>new.bid_comparison_id
     or new.command_payload->>'selectionDecisionId'<>new.selection_decision_id
     or new.command_payload->>'selectionDecisionVersion'<>new.selection_decision_version
     or new.command_payload->>'proposalVersionId'<>new.proposal_version_id
     or new.command_payload->>'proposalVersion'<>new.proposal_version then
    raise exception 'SEED-PROPOSAL-OWNER-A2P PO command projection mismatch';
  end if;
  select * into bid_row from public.seed_bid_comparisons
   where tenant_id=new.tenant_id and bid_comparison_id=new.bid_comparison_id and version=2;
  select * into decision_row from public.seed_procurement_selection_decisions
   where tenant_id=new.tenant_id and selection_decision_id=new.selection_decision_id;
  select * into quote_row from public.seed_supplier_quotes
   where tenant_id=new.tenant_id and supplier_quote_id=new.supplier_quote_id;
  select * into proposal_row from public.commercial_case_proposal_v1_identity_map
   where tenant_id=new.tenant_id and proposal_id=new.proposal_version_id and proposal_version=new.proposal_version;
  select max(revision) into accepted_revision from public.commercial_case_proposal_v1_identity_map
   where tenant_id=new.tenant_id and proposal_id=new.proposal_version_id;
  if bid_row is null or bid_row.status<>'APPROVED' or bid_row.object_version<>new.command_payload->>'expectedVersion'
     or bid_row.selected_by_human_approval_ref<>new.selection_decision_id
     or decision_row is null or decision_row.object_version<>new.selection_decision_version
     or decision_row.bid_comparison_id<>new.bid_comparison_id or decision_row.selected_supplier_quote_id<>new.supplier_quote_id
     or quote_row is null or quote_row.object_version<>new.supplier_quote_version or quote_row.supplier_id<>new.supplier_id
     or proposal_row is null or proposal_row.project_id<>new.project_id or proposal_row.project_version<>new.project_version
     or proposal_row.revision<>accepted_revision
     or not exists (
       select 1 from public.commercial_case_proposal_client_decision_versions d
       where d.tenant_id=new.tenant_id and d.decision_id=new.proposal_decision_id
         and d.proposal_id=new.proposal_version_id and d.proposal_version=new.proposal_version
         and d.proposal_revision=proposal_row.revision and d.scope='PROPOSAL'
         and d.target_id=new.proposal_version_id and d.decision='APPROVE' and d.status='ACTIVE'
     ) then raise exception 'SEED-PROPOSAL-OWNER-A2P PO exact approved dependency mismatch'; end if;
  if new.currency<>quote_row.basis_currency or new.total_minor<>quote_row.supplier_cost_total_minor
     or new.canonical_payload->>'currency'<>new.currency
     or (new.canonical_payload->>'totalMinor')::bigint<>new.total_minor
     or new.canonical_payload->>'proposalVersionId'<>new.proposal_version_id
     or new.canonical_payload->>'supplierQuoteId'<>new.supplier_quote_id
     or new.canonical_payload->>'supplierId'<>new.supplier_id
     or new.canonical_payload->>'releaseApprovalRef' is not null
     or new.release_approval_ref is not null or new.external_effect_authorized then
    raise exception 'SEED-PROPOSAL-OWNER-A2P PO economics or no-effect projection mismatch';
  end if;
  for ref in select value from jsonb_array_elements(new.line_refs) loop
    if (select count(*) from jsonb_object_keys(ref))<>5
       or ref->>'tenantId'<>new.tenant_id or ref->>'objectType'<>'SPECIFICATION_LINE'
       or ref->>'ownerProject'<>'LUZIONE_PROJECT'
       or not exists (
         select 1 from public.seed_specification_lines l where l.tenant_id=new.tenant_id
           and l.project_id=new.project_id and l.specification_line_id=ref->>'objectId'
           and 'specification-line:'||l.specification_line_id||':v'||l.version::text=ref->>'version'
       )
       or not exists (select 1 from jsonb_array_elements(quote_row.canonical_payload->'lines') q where q->>'rfqLineId'=ref->>'objectId')
       or not exists (
         select 1 from public.commercial_case_proposal_line_versions l
         where l.tenant_id=new.tenant_id and l.proposal_id=new.proposal_version_id
           and l.proposal_revision=proposal_row.revision
           and l.specification_line_ref->>'objectId'=ref->>'objectId'
           and l.specification_line_ref->>'version'=ref->>'version'
       ) then raise exception 'SEED-PROPOSAL-OWNER-A2P PO exact line lineage mismatch'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(new.line_refs))<>(select count(distinct (value->>'objectId')||'@'||(value->>'version')) from jsonb_array_elements(new.line_refs)) then
    raise exception 'SEED-PROPOSAL-OWNER-A2P PO line refs must be unique';
  end if;
  return null;
end
$$;
revoke all on function public.seed_proposal_a2p_validate_purchase_order() from public;

create trigger commercial_case_proposal_templates_append_only before update or delete on public.commercial_case_proposal_template_versions for each row execute function public.seed_proposal_a2p_reject_mutation();
create trigger commercial_case_proposal_identity_append_only before update or delete on public.commercial_case_proposal_v1_identity_map for each row execute function public.seed_proposal_a2p_reject_mutation();
create trigger commercial_case_proposal_lines_append_only before update or delete on public.commercial_case_proposal_line_versions for each row execute function public.seed_proposal_a2p_reject_mutation();
create trigger commercial_case_proposal_decisions_append_only before update or delete on public.commercial_case_proposal_client_decision_versions for each row execute function public.seed_proposal_a2p_reject_mutation();
create trigger commercial_case_proposal_renders_append_only before update or delete on public.commercial_case_proposal_render_preparations for each row execute function public.seed_proposal_a2p_reject_mutation();
create trigger commercial_case_proposal_context_a2p_immutable before update or delete on public.commercial_case_proposal_context_versions for each row execute function public.seed_proposal_a2p_protect_predecessor();
create trigger commercial_case_proposal_document_a2p_immutable before update or delete on public.commercial_case_proposal_document_versions for each row execute function public.seed_proposal_a2p_protect_predecessor();
create trigger commercial_case_proposal_review_a2p_immutable before update or delete on public.commercial_case_proposal_review_versions for each row execute function public.seed_proposal_a2p_protect_predecessor();
create trigger quotes_a2p_immutable before update or delete on public.quotes for each row execute function public.seed_proposal_a2p_protect_predecessor();
create trigger quote_lines_a2p_immutable before update or delete on public.quote_lines for each row execute function public.seed_proposal_a2p_protect_predecessor();
create trigger quote_economics_a2p_immutable before update or delete on public.quote_economics_versions for each row execute function public.seed_proposal_a2p_protect_predecessor();

create constraint trigger commercial_case_proposal_templates_integrity after insert on public.commercial_case_proposal_template_versions deferrable initially deferred for each row execute function public.seed_proposal_a2p_validate_integrity();
create constraint trigger commercial_case_proposal_identity_integrity after insert on public.commercial_case_proposal_v1_identity_map deferrable initially deferred for each row execute function public.seed_proposal_a2p_validate_integrity();
create constraint trigger commercial_case_proposal_lines_integrity after insert on public.commercial_case_proposal_line_versions deferrable initially deferred for each row execute function public.seed_proposal_a2p_validate_integrity();
create constraint trigger commercial_case_proposal_decisions_integrity after insert on public.commercial_case_proposal_client_decision_versions deferrable initially deferred for each row execute function public.seed_proposal_a2p_validate_integrity();
create constraint trigger commercial_case_proposal_renders_integrity after insert on public.commercial_case_proposal_render_preparations deferrable initially deferred for each row execute function public.seed_proposal_a2p_validate_integrity();
create constraint trigger commercial_case_proposal_review_a2p_integrity after insert on public.commercial_case_proposal_review_versions deferrable initially deferred for each row execute function public.seed_proposal_a2p_validate_review_integrity();
drop trigger seed_purchase_order_dependency_hold on public.seed_purchase_order_drafts;
create constraint trigger seed_purchase_order_a2p_integrity after insert on public.seed_purchase_order_drafts deferrable initially deferred for each row execute function public.seed_proposal_a2p_validate_purchase_order();

do $$
declare relation_name text; policy_record record;
begin
  foreach relation_name in array array[
    'commercial_case_proposal_template_versions','commercial_case_proposal_v1_identity_map',
    'commercial_case_proposal_line_versions','commercial_case_proposal_client_decision_versions',
    'commercial_case_proposal_render_preparations'
  ] loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I force row level security', relation_name);
    for policy_record in select polname from pg_policy where polrelid=format('public.%I',relation_name)::regclass loop
      execute format('drop policy %I on public.%I', policy_record.polname, relation_name);
    end loop;
    execute format('create policy seed_proposal_a2p_runtime_tenant on public.%I to luzione_api_runtime using (tenant_id=(select current_setting(''app.tenant_id'',true))) with check (tenant_id=(select current_setting(''app.tenant_id'',true)))', relation_name);
    execute format('revoke all on table public.%I from public', relation_name);
    if exists(select 1 from pg_roles where rolname='anon') then execute format('revoke all on table public.%I from anon',relation_name); end if;
    if exists(select 1 from pg_roles where rolname='authenticated') then execute format('revoke all on table public.%I from authenticated',relation_name); end if;
    if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on table public.%I from service_role',relation_name); end if;
  end loop;
end $$;

do $$
begin
  if exists(select 1 from pg_roles where rolname='luzione_api_runtime') then
    grant select,insert on table public.commercial_case_proposal_template_versions,
      public.commercial_case_proposal_v1_identity_map, public.commercial_case_proposal_line_versions,
      public.commercial_case_proposal_client_decision_versions,
      public.commercial_case_proposal_render_preparations to luzione_api_runtime;
    grant select,insert on table public.commercial_case_proposal_context_versions,
      public.commercial_case_proposal_document_versions,
      public.commercial_case_proposal_review_versions to luzione_api_runtime;
    revoke all on table public.seed_purchase_order_drafts from luzione_api_runtime;
    grant select,insert on table public.seed_purchase_order_drafts to luzione_api_runtime;
  end if;
end $$;

comment on table public.commercial_case_proposal_v1_identity_map is 'Immutable A2P identity bridge: ProposalVersion/v1 is the API-PC-009 proposal document version bound to one exact quote-economics snapshot; it is not a second proposal truth.';
comment on table public.commercial_case_proposal_line_versions is 'Immutable typed ProposalLine/v1 facts owned by an exact API-PC-009 proposal document/economics version.';
comment on table public.commercial_case_proposal_client_decision_versions is 'Exact-version client ApprovalDecision/v1 facts. Portal client identity and object grants are server-derived dependencies; no send or binding external effect is authorized.';
comment on table public.commercial_case_proposal_render_preparations is 'NO_EFFECT render preparation only. Provider acknowledgement, artifact readback, upload, send, and delivery remain null and unauthorized.';
comment on table public.seed_purchase_order_drafts is 'Immutable NO_EFFECT PurchaseOrder/v1 draft bound to one exact latest accepted Proposal Version, approved Bid Comparison, human selection, selected Supplier Quote, and canonical Specification Line set. Release, send, acknowledgement, and provider finality remain held.';

commit;
