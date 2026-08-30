begin;

-- Composite tenant foreign keys supersede the original single-column keys and
-- prevent cross-tenant references. Removing the redundant keys also keeps the
-- advisor from requiring duplicate candidate-version indexes.
alter table public.learning_evaluation_receipts
  drop constraint if exists learning_evaluation_receipts_candidate_version_id_fkey;
alter table public.learning_promotion_receipts
  drop constraint if exists learning_promotion_receipts_candidate_version_id_fkey,
  drop constraint if exists learning_promotion_receipts_evaluation_receipt_id_fkey;
alter table public.learning_rollback_receipts
  drop constraint if exists learning_rollback_receipts_candidate_version_id_fkey,
  drop constraint if exists learning_rollback_receipts_evaluation_receipt_id_fkey;

create index if not exists learning_promotion_receipts_tenant_evaluation_idx
  on public.learning_promotion_receipts
  (tenant_id, evaluation_receipt_id, candidate_version_id);

create index if not exists learning_rollback_receipts_tenant_evaluation_idx
  on public.learning_rollback_receipts
  (tenant_id, evaluation_receipt_id, candidate_version_id);

commit;
