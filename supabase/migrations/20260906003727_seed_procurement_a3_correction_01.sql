begin;

do $$
begin
  if to_regclass('public.seed_product_sources') is null
    or to_regclass('public.seed_rfq_drafts') is null
    or to_regclass('public.seed_supplier_quotes') is null
    or to_regclass('public.seed_bid_comparisons') is null
    or to_regclass('public.seed_procurement_selection_decisions') is null
    or to_regclass('public.seed_supplier_profile_versions') is null
    or to_regclass('public.p110_command_receipts') is null then
    raise exception 'SEED-PROCUREMENT-A3-CORRECTION-01 requires exact A3 and A2S owner tables';
  end if;
  if exists (select 1 from public.seed_rfq_drafts limit 1)
    or exists (select 1 from public.seed_supplier_quotes limit 1)
    or exists (select 1 from public.seed_bid_comparisons limit 1)
    or exists (select 1 from public.seed_procurement_selection_decisions limit 1) then
    raise exception 'SEED-PROCUREMENT-A3-CORRECTION-01 refuses to reinterpret pre-correction downstream rows';
  end if;
  if exists (select 1 from public.seed_product_candidates where canonical_payload->>'vendorId' is not null limit 1) then
    raise exception 'SEED-PROCUREMENT-A3-CORRECTION-01 refuses to guess Supplier Profile versions for pre-correction vendor candidates';
  end if;
end $$;

alter table public.seed_product_sources
  add column upstream_artifact_refs jsonb not null default '[]'::jsonb
  check (jsonb_typeof(upstream_artifact_refs)='array');
alter table public.seed_product_sources alter column upstream_artifact_refs drop default;

alter table public.seed_product_candidates
  add column supplier_profile_id text,
  add column supplier_profile_version text,
  add constraint seed_product_candidates_supplier_profile_fk foreign key (tenant_id,supplier_profile_id,supplier_profile_version)
    references public.seed_supplier_profile_versions(tenant_id,supplier_profile_id,object_version) on delete restrict,
  add constraint seed_product_candidates_supplier_profile_coherence check (
    ((canonical_payload ->> 'vendorId') is null and supplier_profile_id is null and supplier_profile_version is null)
    or ((canonical_payload ->> 'vendorId') is not null and supplier_profile_id is not null and supplier_profile_version is not null)
  ),
  add constraint seed_product_candidates_supplier_profile_unpadded check (
    supplier_profile_id is null or (supplier_profile_id=btrim(supplier_profile_id) and supplier_profile_version=btrim(supplier_profile_version))
  );

alter table public.seed_rfq_drafts
  add column supplier_profile_id text,
  add column supplier_profile_version text,
  add column command_payload jsonb,
  add column command_payload_hash text,
  add constraint seed_rfq_supplier_profile_fk foreign key (tenant_id,supplier_profile_id,supplier_profile_version)
    references public.seed_supplier_profile_versions(tenant_id,supplier_profile_id,object_version) on delete restrict,
  add constraint seed_rfq_supplier_profile_unpadded check (supplier_profile_id=btrim(supplier_profile_id) and supplier_profile_version=btrim(supplier_profile_version));

alter table public.seed_supplier_quotes
  add column rfq_version text,
  add column evidence_artifact_version text,
  add column supplier_profile_id text,
  add column supplier_profile_version text,
  add column command_payload jsonb,
  add column command_payload_hash text,
  add constraint seed_quote_supplier_profile_fk foreign key (tenant_id,supplier_profile_id,supplier_profile_version)
    references public.seed_supplier_profile_versions(tenant_id,supplier_profile_id,object_version) on delete restrict,
  add constraint seed_quote_supplier_profile_unpadded check (supplier_profile_id=btrim(supplier_profile_id) and supplier_profile_version=btrim(supplier_profile_version));

alter table public.seed_bid_comparisons
  add column supplier_profile_refs jsonb,
  add column source_refs jsonb,
  add column command_payload jsonb,
  add column command_payload_hash text;

alter table public.seed_procurement_selection_decisions
  add column supplier_profile_id text,
  add column supplier_profile_version text,
  add column command_payload jsonb,
  add column command_payload_hash text,
  add column human_authentication_ref text,
  add constraint seed_selection_supplier_profile_fk foreign key (tenant_id,supplier_profile_id,supplier_profile_version)
    references public.seed_supplier_profile_versions(tenant_id,supplier_profile_id,object_version) on delete restrict,
  add constraint seed_selection_supplier_profile_unpadded check (supplier_profile_id=btrim(supplier_profile_id) and supplier_profile_version=btrim(supplier_profile_version));

alter table public.seed_rfq_drafts
  alter column supplier_profile_id set not null, alter column supplier_profile_version set not null,
  alter column command_payload set not null, alter column command_payload_hash set not null,
  add constraint seed_rfq_command_payload_object check (jsonb_typeof(command_payload)='object'),
  add constraint seed_rfq_command_payload_hash check (command_payload_hash ~ '^[a-f0-9]{64}$');
alter table public.seed_supplier_quotes
  drop constraint seed_supplier_quotes_objective_fit_inputs_check,
  drop constraint seed_supplier_quotes_objective_fit_weights_check,
  alter column rfq_version set not null, alter column evidence_artifact_version set not null,
  alter column supplier_profile_id set not null, alter column supplier_profile_version set not null,
  alter column command_payload set not null, alter column command_payload_hash set not null,
  add constraint seed_quote_command_payload_object check (jsonb_typeof(command_payload)='object'),
  add constraint seed_quote_command_payload_hash check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  add constraint seed_quote_objective_fit_inputs_array check (jsonb_typeof(objective_fit_inputs)='array' and jsonb_array_length(objective_fit_inputs)>0),
  add constraint seed_quote_objective_fit_weights_array check (jsonb_typeof(objective_fit_weights)='array' and jsonb_array_length(objective_fit_weights)=jsonb_array_length(objective_fit_inputs));
alter table public.seed_bid_comparisons
  alter column supplier_profile_refs set not null, alter column source_refs set not null,
  alter column command_payload set not null, alter column command_payload_hash set not null,
  add constraint seed_bid_supplier_profile_refs_array check (jsonb_typeof(supplier_profile_refs)='array' and jsonb_array_length(supplier_profile_refs)>0),
  add constraint seed_bid_source_refs_array check (jsonb_typeof(source_refs)='array' and jsonb_array_length(source_refs)>0),
  add constraint seed_bid_command_payload_object check (jsonb_typeof(command_payload)='object'),
  add constraint seed_bid_command_payload_hash check (command_payload_hash ~ '^[a-f0-9]{64}$');
alter table public.seed_procurement_selection_decisions
  alter column supplier_profile_id set not null, alter column supplier_profile_version set not null,
  alter column command_payload set not null, alter column command_payload_hash set not null,
  alter column human_authentication_ref set not null,
  add constraint seed_selection_command_payload_object check (jsonb_typeof(command_payload)='object'),
  add constraint seed_selection_command_payload_hash check (command_payload_hash ~ '^[a-f0-9]{64}$');

create index seed_product_candidates_supplier_profile_idx on public.seed_product_candidates (tenant_id,supplier_profile_id,supplier_profile_version) where supplier_profile_id is not null;
create index seed_rfq_supplier_profile_idx on public.seed_rfq_drafts (tenant_id,supplier_profile_id,supplier_profile_version);
create index seed_quote_supplier_profile_idx on public.seed_supplier_quotes (tenant_id,supplier_profile_id,supplier_profile_version);
create index seed_selection_supplier_profile_idx on public.seed_procurement_selection_decisions (tenant_id,supplier_profile_id,supplier_profile_version);

create or replace function public.seed_procurement_a3_validate_product_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  artifact_payload jsonb;
  parent_project_id text;
  parent_status text;
  parent_digest text;
  duplicate_project_id text;
  upstream jsonb;
  upstream_project_id text;
  upstream_status text;
  upstream_version text;
  supplier_account_id text;
begin
  if tg_table_name = 'seed_product_sources' then
    select project_id,status,content_digest,canonical_payload into parent_project_id,parent_status,parent_digest,artifact_payload
      from public.seed_procurement_evidence_artifacts where tenant_id=new.tenant_id and artifact_id=new.artifact_id;
    if not found or parent_project_id is distinct from new.project_id or parent_digest<>new.content_digest then
      raise exception 'SEED-PROCUREMENT-A3C Product Source direct Evidence Artifact lineage is invalid';
    end if;
    if parent_status<>'ACTIVE' and new.status<>'REVIEW_REQUIRED' then
      raise exception 'SEED-PROCUREMENT-A3C Product Source cannot promote unreviewed evidence';
    end if;
    if new.ingestion_format='CSV' and (new.source_kind<>'XLSX' or artifact_payload->>'mimeType'<>'text/csv') then
      raise exception 'SEED-PROCUREMENT-A3C CSV requires XLSX source lane and text/csv evidence';
    elsif new.ingestion_format<>'CSV' and new.ingestion_format<>new.source_kind then
      raise exception 'SEED-PROCUREMENT-A3C ingestion format and Product Source kind disagree';
    elsif new.ingestion_format='PDF' and artifact_payload->>'mimeType'<>'application/pdf' then
      raise exception 'SEED-PROCUREMENT-A3C PDF source requires PDF evidence';
    elsif new.ingestion_format='URL' and artifact_payload->>'mimeType'<>'text/html' then
      raise exception 'SEED-PROCUREMENT-A3C URL source requires HTML evidence';
    end if;
    if new.observed_at>new.created_at or (new.status='ACTIVE' and new.valid_until is not null and new.valid_until<=new.created_at) then
      raise exception 'SEED-PROCUREMENT-A3C future or expired active Product Source is invalid';
    end if;
    for upstream in select value from jsonb_array_elements(new.upstream_artifact_refs) loop
      if not (upstream ?& array['artifactId','artifactVersion']) or (select count(*) from jsonb_object_keys(upstream))<>2
        or upstream->>'artifactId'=new.artifact_id then
        raise exception 'SEED-PROCUREMENT-A3C upstream Evidence Artifact reference is malformed or duplicated';
      end if;
      select project_id,status,object_version into upstream_project_id,upstream_status,upstream_version
        from public.seed_procurement_evidence_artifacts where tenant_id=new.tenant_id and artifact_id=upstream->>'artifactId';
      if not found or upstream_project_id is distinct from new.project_id or upstream_status<>'ACTIVE' or upstream_version<>upstream->>'artifactVersion' then
        raise exception 'SEED-PROCUREMENT-A3C upstream Evidence Artifact reference is stale, unreviewed, or isolated';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(new.upstream_artifact_refs))<>(select count(distinct value->>'artifactId') from jsonb_array_elements(new.upstream_artifact_refs)) then
      raise exception 'SEED-PROCUREMENT-A3C upstream Evidence Artifact references must be unique';
    end if;
    if new.duplicate_of_source_id is not null then
      select project_id into duplicate_project_id from public.seed_product_sources where tenant_id=new.tenant_id and product_source_id=new.duplicate_of_source_id;
      if not found or duplicate_project_id is distinct from new.project_id or new.status<>'REVIEW_REQUIRED' then raise exception 'SEED-PROCUREMENT-A3C duplicate Product Source is invalid'; end if;
    end if;
  elsif tg_table_name = 'seed_product_candidates' then
    select project_id,status into parent_project_id,parent_status from public.seed_product_sources where tenant_id=new.tenant_id and product_source_id=new.product_source_id;
    if not found or parent_project_id is distinct from new.project_id or (parent_status<>'ACTIVE' and new.status<>'REVIEW_REQUIRED') then raise exception 'SEED-PROCUREMENT-A3C Product Candidate source lineage is invalid'; end if;
    if new.canonical_payload->>'vendorId' is not null then
      select account_id into supplier_account_id from public.seed_supplier_profile_versions where tenant_id=new.tenant_id and supplier_profile_id=new.supplier_profile_id and object_version=new.supplier_profile_version and status='ELIGIBLE' and capabilities ? 'CATALOG_SOURCE' and valid_from<=new.created_at and valid_until>new.created_at;
      if not found or supplier_account_id<>new.canonical_payload->>'vendorId' then raise exception 'SEED-PROCUREMENT-A3C Product Candidate supplier eligibility is invalid'; end if;
    end if;
    if new.duplicate_of_candidate_id is not null then
      select project_id into duplicate_project_id from public.seed_product_candidates where tenant_id=new.tenant_id and product_candidate_id=new.duplicate_of_candidate_id;
      if not found or duplicate_project_id is distinct from new.project_id or new.status<>'REVIEW_REQUIRED' then raise exception 'SEED-PROCUREMENT-A3C duplicate Product Candidate is invalid'; end if;
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.seed_procurement_a3_validate_product_lineage() from public;

create function public.seed_procurement_a3c_validate_downstream()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_command_type text;
  expected_object_type text;
  expected_object_version text;
  owner_id text;
  receipt public.p110_command_receipts%rowtype;
  profile_account text;
  profile_ref jsonb;
  quote_profile_id text;
  quote_profile_version text;
  expected_profile_count integer;
  row_data jsonb;
  row_created_at timestamptz;
begin
  row_data:=to_jsonb(new);
  row_created_at:=case when tg_table_name='seed_procurement_selection_decisions' then (row_data->>'decided_at')::timestamptz else (row_data->>'created_at')::timestamptz end;
  if new.tenant_id<>btrim(new.tenant_id) or new.created_command_id<>btrim(new.created_command_id) or new.created_by<>btrim(new.created_by)
    or new.command_payload_hash!~'^[a-f0-9]{64}$' then raise exception 'SEED-PROCUREMENT-A3C canonical identifiers or payload hash are invalid'; end if;
  if tg_table_name='seed_rfq_drafts' then
    expected_command_type:='rfq.create_draft'; expected_object_type:='rfq'; owner_id:=row_data->>'rfq_id'; expected_object_version:='ABSENT';
  elsif tg_table_name='seed_supplier_quotes' then
    expected_command_type:='supplier_quote.normalize'; expected_object_type:='supplier_quote'; owner_id:=row_data->>'supplier_quote_id'; expected_object_version:='ABSENT';
  elsif tg_table_name='seed_bid_comparisons' and (row_data->>'version')::integer=1 then
    expected_command_type:='bid_comparison.create'; expected_object_type:='bid_comparison'; owner_id:=row_data->>'bid_comparison_id'; expected_object_version:='ABSENT';
  elsif tg_table_name='seed_bid_comparisons' then
    expected_command_type:='bid_comparison.approve_from_selection'; expected_object_type:='bid_comparison'; owner_id:=row_data->>'bid_comparison_id'; expected_object_version:='bid-comparison:'||(row_data->>'bid_comparison_id')||':v1';
  else
    expected_command_type:='procurement_selection.record'; expected_object_type:='procurement_selection'; owner_id:=row_data->>'selection_decision_id'; expected_object_version:=row_data->>'expected_bid_comparison_version';
  end if;
  if new.command_payload->>'commandType' is distinct from expected_command_type
    or (expected_command_type<>'bid_comparison.approve_from_selection' and new.command_payload->>'commandId' is distinct from new.created_command_id)
    or new.command_payload->>'expectedVersion' is distinct from expected_object_version and expected_command_type<>'bid_comparison.approve_from_selection' then
    raise exception 'SEED-PROCUREMENT-A3C stored command payload is inconsistent';
  end if;
  select * into receipt from public.p110_command_receipts where tenant_id=new.tenant_id and command_id=new.created_command_id;
  if not found or receipt.state<>'DOMAIN_COMMITTED' or receipt.command_type<>expected_command_type
    or (expected_command_type<>'bid_comparison.approve_from_selection' and receipt.idempotency_key is distinct from new.command_payload->>'idempotencyKey')
    or receipt.payload_hash<>new.command_payload_hash or receipt.committed_object_version<>new.object_version or receipt.actor_id<>new.created_by or receipt.actor_type<>new.created_by_type
    or receipt.target_owner_project<>'LUZIONE_PROCUREMENT' or receipt.target_object_type<>expected_object_type or receipt.target_object_id<>owner_id
    or receipt.policy_version<>'2026-09-05.seed-procurement.no-effect.v2' or receipt.expected_object_version<>expected_object_version
    or receipt.requested_at is distinct from row_created_at or receipt.committed_at is null then
    raise exception 'SEED-PROCUREMENT-A3C exact DOMAIN_COMMITTED P110 receipt is missing or inconsistent';
  end if;
  if tg_table_name='seed_rfq_drafts' and (
      new.command_payload->>'projectId' is distinct from row_data->>'project_id'
      or new.command_payload->>'projectVersion' is distinct from row_data->>'project_version'
      or new.command_payload->>'specificationId' is distinct from row_data->>'specification_id'
      or new.command_payload->>'specificationVersion' is distinct from row_data->>'specification_version'
      or new.command_payload->>'supplierId' is distinct from row_data->>'supplier_id'
      or jsonb_array_length(new.command_payload->'specificationLines')<>(select count(*) from jsonb_object_keys(row_data->'specification_line_versions'))
      or exists (
        select 1 from jsonb_array_elements(new.command_payload->'specificationLines') line
        where (row_data->'specification_line_versions')->>(line->>'specificationLineId') is distinct from line->>'specificationLineVersion')) then
    raise exception 'SEED-PROCUREMENT-A3C RFQ exact project, specification, line, or supplier binding is corrupt';
  elsif tg_table_name='seed_supplier_quotes' and (
      new.command_payload->>'projectId' is distinct from row_data->>'project_id'
      or new.command_payload->>'rfqId' is distinct from row_data->>'rfq_id'
      or new.command_payload->>'rfqVersion' is distinct from row_data->>'rfq_version'
      or new.command_payload->>'evidenceArtifactId' is distinct from row_data->>'evidence_artifact_id'
      or new.command_payload->>'evidenceArtifactVersion' is distinct from row_data->>'evidence_artifact_version'
      or new.command_payload->>'supplierId' is distinct from row_data->>'supplier_id') then
    raise exception 'SEED-PROCUREMENT-A3C Supplier Quote exact RFQ, evidence, or supplier binding is corrupt';
  elsif tg_table_name='seed_bid_comparisons' and (row_data->>'version')::integer=2 and (
      new.command_payload->>'bidComparisonId' is distinct from row_data->>'bid_comparison_id'
      or new.command_payload->>'selectionDecisionId' is distinct from row_data->>'selected_by_human_approval_ref'
      or new.command_payload->>'selectedSupplierQuoteId' is null) then
    raise exception 'SEED-PROCUREMENT-A3C approved Bid Comparison lacks its exact Selection derivation';
  elsif tg_table_name='seed_procurement_selection_decisions' and (
      new.command_payload->>'projectId' is distinct from row_data->>'project_id'
      or new.command_payload->>'bidComparisonId' is distinct from row_data->>'bid_comparison_id'
      or new.command_payload->>'selectedSupplierQuoteId' is distinct from row_data->>'selected_supplier_quote_id') then
    raise exception 'SEED-PROCUREMENT-A3C Selection exact Bid or quote binding is corrupt';
  end if;
  if tg_table_name='seed_bid_comparisons' then
    if (row_data->>'version')::integer=2 then
      if not exists (
        select 1 from public.seed_bid_comparisons prior
        where prior.tenant_id=new.tenant_id and prior.bid_comparison_id=row_data->>'bid_comparison_id' and prior.version=1
          and prior.project_id=row_data->>'project_id' and prior.project_version=row_data->>'project_version'
          and prior.specification_id=row_data->>'specification_id' and prior.specification_version=row_data->>'specification_version'
          and prior.rfq_ids=row_data->'rfq_ids' and prior.supplier_quote_ids=row_data->'supplier_quote_ids'
          and prior.supplier_profile_refs=row_data->'supplier_profile_refs')
        or not exists (
          select 1 from public.seed_procurement_selection_decisions selection
          where selection.tenant_id=new.tenant_id and selection.selection_decision_id=row_data->>'selected_by_human_approval_ref'
            and selection.bid_comparison_id=row_data->>'bid_comparison_id'
            and selection.selected_supplier_quote_id=new.command_payload->>'selectedSupplierQuoteId') then
        raise exception 'SEED-PROCUREMENT-A3C approved Bid Comparison does not derive from exact v1 plus human Selection';
      end if;
    end if;
    select count(distinct (quote.supplier_profile_id,quote.supplier_profile_version)) into expected_profile_count
      from public.seed_supplier_quotes quote
      where quote.tenant_id=new.tenant_id and quote.project_id=row_data->>'project_id'
        and quote.supplier_quote_id in (select jsonb_array_elements_text(row_data->'supplier_quote_ids'));
    if expected_profile_count<>(select count(*) from jsonb_array_elements(row_data->'supplier_profile_refs')) then
      raise exception 'SEED-PROCUREMENT-A3C Bid supplier profile set does not match its exact quotes';
    end if;
    for profile_ref in select value from jsonb_array_elements(row_data->'supplier_profile_refs') loop
      if (select count(*) from jsonb_object_keys(profile_ref))<>5
        or profile_ref->>'tenantId'<>new.tenant_id
        or profile_ref->>'objectType'<>'SUPPLIER_PROFILE'
        or profile_ref->>'ownerProject'<>'LUZIONE_SUPPLIER_IDENTITY'
        or not exists (
          select 1 from public.seed_supplier_quotes quote
          where quote.tenant_id=new.tenant_id and quote.project_id=row_data->>'project_id'
            and quote.supplier_quote_id in (select jsonb_array_elements_text(row_data->'supplier_quote_ids'))
            and quote.supplier_profile_id=profile_ref->>'objectId'
            and quote.supplier_profile_version=profile_ref->>'version') then
        raise exception 'SEED-PROCUREMENT-A3C Bid Supplier Profile reference is malformed or unrelated';
      end if;
      select account_id into profile_account from public.seed_supplier_profile_versions
        where tenant_id=new.tenant_id and supplier_profile_id=profile_ref->>'objectId' and object_version=profile_ref->>'version'
          and status='ELIGIBLE' and capabilities ? 'QUOTE_SUBMISSION' and valid_from<=row_created_at and valid_until>row_created_at;
      if not found then raise exception 'SEED-PROCUREMENT-A3C exact eligible Bid supplier profile is missing'; end if;
    end loop;
  else
    select account_id into profile_account from public.seed_supplier_profile_versions
      where tenant_id=new.tenant_id and supplier_profile_id=row_data->>'supplier_profile_id' and object_version=row_data->>'supplier_profile_version'
        and status='ELIGIBLE'
        and capabilities ? case when tg_table_name='seed_rfq_drafts' then 'RFQ_RESPONSE' else 'QUOTE_SUBMISSION' end
        and valid_from<=row_created_at and valid_until>row_created_at;
    if not found then raise exception 'SEED-PROCUREMENT-A3C exact eligible Supplier Profile is missing'; end if;
    if tg_table_name in ('seed_rfq_drafts','seed_supplier_quotes') and profile_account<>row_data->>'supplier_id' then raise exception 'SEED-PROCUREMENT-A3C Supplier Profile Account mismatch'; end if;
    if tg_table_name='seed_procurement_selection_decisions' then
      select supplier_profile_id,supplier_profile_version into quote_profile_id,quote_profile_version
        from public.seed_supplier_quotes where tenant_id=new.tenant_id and supplier_quote_id=row_data->>'selected_supplier_quote_id';
      if not found or quote_profile_id<>row_data->>'supplier_profile_id' or quote_profile_version<>row_data->>'supplier_profile_version' then
        raise exception 'SEED-PROCUREMENT-A3C Selection Supplier Profile must match the exact selected quote';
      end if;
    end if;
  end if;
  if tg_table_name='seed_procurement_selection_decisions' and (new.created_by_type<>'user' or row_data->>'human_authentication_ref' is null) then raise exception 'SEED-PROCUREMENT-A3C selection requires credential-bound human authority'; end if;
  return null;
end
$$;

revoke all on function public.seed_procurement_a3c_validate_downstream() from public;

drop trigger seed_rfq_dependency_hold on public.seed_rfq_drafts;
drop trigger seed_supplier_quote_dependency_hold on public.seed_supplier_quotes;
drop trigger seed_bid_comparison_dependency_hold on public.seed_bid_comparisons;
drop trigger seed_selection_decision_dependency_hold on public.seed_procurement_selection_decisions;

create constraint trigger seed_rfq_a3c_integrity after insert on public.seed_rfq_drafts deferrable initially deferred for each row execute function public.seed_procurement_a3c_validate_downstream();
create constraint trigger seed_quote_a3c_integrity after insert on public.seed_supplier_quotes deferrable initially deferred for each row execute function public.seed_procurement_a3c_validate_downstream();
create constraint trigger seed_bid_a3c_integrity after insert on public.seed_bid_comparisons deferrable initially deferred for each row execute function public.seed_procurement_a3c_validate_downstream();
create constraint trigger seed_selection_a3c_integrity after insert on public.seed_procurement_selection_decisions deferrable initially deferred for each row execute function public.seed_procurement_a3c_validate_downstream();

do $$
begin
  if exists (select 1 from pg_roles where rolname='luzione_api_runtime') then
    revoke all on table public.seed_rfq_drafts,public.seed_supplier_quotes,public.seed_bid_comparisons,public.seed_procurement_selection_decisions from luzione_api_runtime;
    grant select,insert on table public.seed_rfq_drafts,public.seed_supplier_quotes,public.seed_bid_comparisons,public.seed_procurement_selection_decisions to luzione_api_runtime;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions')
      and (not c.relrowsecurity or not c.relforcerowsecurity))
    or (select count(*) from pg_policies where schemaname='public' and tablename in ('seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions') and roles @> array['luzione_api_runtime']::name[])<>4 then
    raise exception 'SEED-PROCUREMENT-A3-CORRECTION-01 requires forced tenant RLS and one explicit runtime policy per admitted relation';
  end if;
end $$;

comment on table public.seed_rfq_drafts is 'Immutable default-off NO_EFFECT RFQ/v1 drafts. A3C requires exact current SupplierProfile/v1 eligibility; sending remains prohibited.';
comment on table public.seed_purchase_order_drafts is 'Reserved PurchaseOrder/v1 draft schema. A2P ProposalVersion canonical readback remains mandatory and inserts remain database-held.';

commit;
