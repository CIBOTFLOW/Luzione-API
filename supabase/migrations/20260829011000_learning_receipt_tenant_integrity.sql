begin;

do $$
begin
  if exists (
    select 1
      from public.learning_evaluation_receipts evaluation
      join public.learning_candidate_versions candidate
        on candidate.candidate_version_id = evaluation.candidate_version_id
     where evaluation.tenant_id <> candidate.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'Cross-tenant learning evaluation receipt exists.';
  end if;
  if exists (
    select 1
      from public.learning_promotion_receipts promotion
      join public.learning_candidate_versions candidate
        on candidate.candidate_version_id = promotion.candidate_version_id
      join public.learning_evaluation_receipts evaluation
        on evaluation.receipt_id = promotion.evaluation_receipt_id
     where promotion.tenant_id <> candidate.tenant_id
        or promotion.tenant_id <> evaluation.tenant_id
        or promotion.candidate_version_id <> evaluation.candidate_version_id
  ) then
    raise exception using errcode = '23514', message = 'Cross-tenant learning promotion receipt exists.';
  end if;
  if exists (
    select 1
      from public.learning_rollback_receipts rollback_receipt
      join public.learning_candidate_versions candidate
        on candidate.candidate_version_id = rollback_receipt.candidate_version_id
      join public.learning_evaluation_receipts evaluation
        on evaluation.receipt_id = rollback_receipt.evaluation_receipt_id
     where rollback_receipt.tenant_id <> candidate.tenant_id
        or rollback_receipt.tenant_id <> evaluation.tenant_id
        or rollback_receipt.candidate_version_id <> evaluation.candidate_version_id
  ) then
    raise exception using errcode = '23514', message = 'Cross-tenant learning rollback receipt exists.';
  end if;
end
$$;

do $$
begin
  alter table public.learning_candidate_versions
    add constraint learning_candidate_versions_tenant_version_id_unique
    unique (tenant_id, candidate_version_id);
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.learning_evaluation_receipts
    add constraint learning_evaluation_receipts_tenant_receipt_candidate_unique
    unique (tenant_id, receipt_id, candidate_version_id);
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.learning_evaluation_receipts
    add constraint learning_evaluation_receipts_tenant_candidate_fk
    foreign key (tenant_id, candidate_version_id)
    references public.learning_candidate_versions (tenant_id, candidate_version_id);
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.learning_promotion_receipts
    add constraint learning_promotion_receipts_tenant_candidate_fk
    foreign key (tenant_id, candidate_version_id)
    references public.learning_candidate_versions (tenant_id, candidate_version_id);
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.learning_promotion_receipts
    add constraint learning_promotion_receipts_tenant_evaluation_fk
    foreign key (tenant_id, evaluation_receipt_id, candidate_version_id)
    references public.learning_evaluation_receipts (tenant_id, receipt_id, candidate_version_id);
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.learning_rollback_receipts
    add constraint learning_rollback_receipts_tenant_candidate_fk
    foreign key (tenant_id, candidate_version_id)
    references public.learning_candidate_versions (tenant_id, candidate_version_id);
exception when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.learning_rollback_receipts
    add constraint learning_rollback_receipts_tenant_evaluation_fk
    foreign key (tenant_id, evaluation_receipt_id, candidate_version_id)
    references public.learning_evaluation_receipts (tenant_id, receipt_id, candidate_version_id);
exception when duplicate_object then null;
end
$$;

commit;
