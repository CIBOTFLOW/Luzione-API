begin;

do $$
declare
  correction_rows bigint;
  correction_receipts bigint;
begin
  select
    (select count(*) from public.seed_product_sources where jsonb_array_length(upstream_artifact_refs)>0)
    + (select count(*) from public.seed_product_candidates where supplier_profile_id is not null)
    + (select count(*) from public.seed_rfq_drafts)
    + (select count(*) from public.seed_supplier_quotes)
    + (select count(*) from public.seed_bid_comparisons)
    + (select count(*) from public.seed_procurement_selection_decisions)
    into correction_rows;
  select count(*) into correction_receipts from public.p110_command_receipts
    where policy_version='2026-09-05.seed-procurement.no-effect.v2';
  if correction_rows>0 or correction_receipts>0 then
    raise exception 'SEED-PROCUREMENT-A3-CORRECTION-01 rollback refused: correction rows=% receipts=% require a forward fix',correction_rows,correction_receipts;
  end if;
end $$;

revoke insert on table public.seed_rfq_drafts,public.seed_supplier_quotes,public.seed_bid_comparisons,public.seed_procurement_selection_decisions from luzione_api_runtime;

drop trigger seed_rfq_a3c_integrity on public.seed_rfq_drafts;
drop trigger seed_quote_a3c_integrity on public.seed_supplier_quotes;
drop trigger seed_bid_a3c_integrity on public.seed_bid_comparisons;
drop trigger seed_selection_a3c_integrity on public.seed_procurement_selection_decisions;
drop function public.seed_procurement_a3c_validate_downstream();

create trigger seed_rfq_dependency_hold before insert on public.seed_rfq_drafts for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();
create trigger seed_supplier_quote_dependency_hold before insert on public.seed_supplier_quotes for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();
create trigger seed_bid_comparison_dependency_hold before insert on public.seed_bid_comparisons for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();
create trigger seed_selection_decision_dependency_hold before insert on public.seed_procurement_selection_decisions for each row execute function public.seed_procurement_a3_hold_unresolved_dependencies();

drop index seed_product_candidates_supplier_profile_idx;
drop index seed_rfq_supplier_profile_idx;
drop index seed_quote_supplier_profile_idx;
drop index seed_selection_supplier_profile_idx;

alter table public.seed_procurement_selection_decisions drop constraint seed_selection_supplier_profile_fk,drop constraint seed_selection_supplier_profile_unpadded,drop constraint seed_selection_command_payload_object,drop constraint seed_selection_command_payload_hash,
  drop column supplier_profile_id,drop column supplier_profile_version,drop column command_payload,drop column command_payload_hash,drop column human_authentication_ref;
alter table public.seed_bid_comparisons drop constraint seed_bid_supplier_profile_refs_array,drop constraint seed_bid_source_refs_array,drop constraint seed_bid_command_payload_object,drop constraint seed_bid_command_payload_hash,
  drop column supplier_profile_refs,drop column source_refs,drop column command_payload,drop column command_payload_hash;
alter table public.seed_supplier_quotes drop constraint seed_quote_supplier_profile_fk,drop constraint seed_quote_supplier_profile_unpadded,drop constraint seed_quote_command_payload_object,drop constraint seed_quote_command_payload_hash,
  drop constraint seed_quote_objective_fit_inputs_array,drop constraint seed_quote_objective_fit_weights_array,
  add constraint seed_supplier_quotes_objective_fit_inputs_check check (jsonb_typeof(objective_fit_inputs)='object'),
  add constraint seed_supplier_quotes_objective_fit_weights_check check (jsonb_typeof(objective_fit_weights)='object'),
  drop column rfq_version,drop column evidence_artifact_version,drop column supplier_profile_id,drop column supplier_profile_version,drop column command_payload,drop column command_payload_hash;
alter table public.seed_rfq_drafts drop constraint seed_rfq_supplier_profile_fk,drop constraint seed_rfq_supplier_profile_unpadded,drop constraint seed_rfq_command_payload_object,drop constraint seed_rfq_command_payload_hash,
  drop column supplier_profile_id,drop column supplier_profile_version,drop column command_payload,drop column command_payload_hash;
alter table public.seed_product_candidates drop constraint seed_product_candidates_supplier_profile_fk,drop constraint seed_product_candidates_supplier_profile_coherence,drop constraint seed_product_candidates_supplier_profile_unpadded,
  drop column supplier_profile_id,drop column supplier_profile_version;
alter table public.seed_product_sources drop column upstream_artifact_refs;

commit;
