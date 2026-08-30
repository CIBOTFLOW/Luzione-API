BEGIN;

CREATE INDEX learning_guardian_decisions_identity_idx
  ON public.learning_guardian_decisions (guardian_identity_id);

CREATE INDEX learning_guardian_decisions_tenant_evaluation_candidate_idx
  ON public.learning_guardian_decisions (
    tenant_id,
    evaluation_receipt_id,
    candidate_version_id
  );

COMMIT;
