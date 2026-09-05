begin;

do $$
declare
  admitted_rows bigint := 0;
  durable_receipts bigint := 0;
begin
  if to_regclass('public.seed_procurement_evidence_artifacts') is not null then
    select
      (select count(*) from public.seed_procurement_evidence_artifacts)
      + (select count(*) from public.seed_product_sources)
      + (select count(*) from public.seed_product_candidates)
      + (select count(*) from public.seed_rfq_drafts)
      + (select count(*) from public.seed_supplier_quotes)
      + (select count(*) from public.seed_bid_comparisons)
      + (select count(*) from public.seed_procurement_selection_decisions)
      + (select count(*) from public.seed_purchase_order_drafts)
      + (select count(*) from public.seed_purchase_order_acknowledgements)
      into admitted_rows;
  end if;
  if to_regclass('public.p110_command_receipts') is not null then
    select count(*) into durable_receipts from public.p110_command_receipts
     where command_type in (
       'evidence_artifact.register', 'product_source.record', 'product_candidate.record',
       'rfq.create_draft', 'supplier_quote.normalize', 'bid_comparison.create',
       'procurement_selection.record', 'purchase_order.create_draft',
       'purchase_order_acknowledgement.record'
     );
  end if;
  if admitted_rows > 0 or durable_receipts > 0 then
    raise exception 'Refusing destructive A3 rollback: admitted rows=% and durable receipts=%; ship an additive forward fix instead', admitted_rows, durable_receipts;
  end if;
end $$;

drop table if exists public.seed_purchase_order_acknowledgements;
drop table if exists public.seed_purchase_order_drafts;
drop table if exists public.seed_procurement_selection_decisions;
drop table if exists public.seed_bid_comparisons;
drop table if exists public.seed_supplier_quotes;
drop table if exists public.seed_rfq_drafts;
drop table if exists public.seed_product_candidates;
drop table if exists public.seed_product_sources;
drop table if exists public.seed_procurement_evidence_artifacts;
drop function if exists public.seed_procurement_a3_hold_unresolved_dependencies();
drop function if exists public.seed_procurement_a3_reject_mutation();

commit;
