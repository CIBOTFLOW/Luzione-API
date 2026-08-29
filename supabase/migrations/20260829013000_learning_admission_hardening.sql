BEGIN;

ALTER TABLE public.learning_candidate_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.learning_evaluation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.learning_promotion_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.learning_rollback_receipts FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_learning_candidate_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Learning candidate versions are append-only and cannot be deleted.';
END
$$;

DROP TRIGGER IF EXISTS learning_candidate_version_delete_blocked
  ON public.learning_candidate_versions;
CREATE TRIGGER learning_candidate_version_delete_blocked
BEFORE DELETE ON public.learning_candidate_versions
FOR EACH ROW EXECUTE FUNCTION public.prevent_learning_candidate_delete();

DO $$
BEGIN
  ALTER TABLE public.learning_promotion_receipts
    ADD CONSTRAINT learning_promotion_receipt_id_format_check
    CHECK (promotion_receipt_id ~ '^learning_promotion_[a-f0-9]{24}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.learning_promotion_receipts
    ADD CONSTRAINT learning_promotion_canonical_approval_id_format_check
    CHECK (canonical_approval_id ~ '^learning_quorum_[a-f0-9]{24}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.learning_promotion_receipts
    ADD CONSTRAINT learning_promotion_command_id_format_check
    CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,190}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.learning_promotion_receipts
    ADD CONSTRAINT learning_promotion_idempotency_key_format_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,190}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.learning_promotion_receipts
    ADD CONSTRAINT learning_promotion_source_readback_contract_check
    CHECK (
      source_readback->>'status' = 'VERIFIED'
      AND source_readback->>'candidateVersionId' = candidate_version_id::text
      AND source_readback->>'evaluationReceiptId' = evaluation_receipt_id
      AND source_readback->>'commandId' = command_id
      AND source_readback->>'contentDigest' ~ '^[a-f0-9]{64}$'
      AND source_readback->'externalEffectsAuthorized' = 'false'::jsonb
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.learning_rollback_receipts
    ADD CONSTRAINT learning_rollback_receipt_id_format_check
    CHECK (rollback_receipt_id ~ '^learning_rollback_[a-f0-9]{24}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.learning_rollback_receipts
    ADD CONSTRAINT learning_rollback_command_id_format_check
    CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,190}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.learning_rollback_receipts
    ADD CONSTRAINT learning_rollback_idempotency_key_format_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,190}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.learning_rollback_receipts
    ADD CONSTRAINT learning_rollback_source_readback_contract_check
    CHECK (
      source_readback->>'status' = 'VERIFIED'
      AND source_readback->>'candidateVersionId' = candidate_version_id::text
      AND source_readback->>'evaluationReceiptId' = evaluation_receipt_id
      AND source_readback->>'commandId' = command_id
      AND source_readback->>'contentDigest' ~ '^[a-f0-9]{64}$'
      AND source_readback->'externalEffectsAuthorized' = 'false'::jsonb
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_learning_promotion_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate record;
  evaluation record;
  reference_count integer;
  distinct_approval_count integer;
  distinct_guardian_count integer;
BEGIN
  SELECT tenant_id, stage, changes_action_eligibility, proposed_by_actor_id
    INTO candidate
    FROM public.learning_candidate_versions
   WHERE tenant_id = NEW.tenant_id
     AND candidate_version_id = NEW.candidate_version_id;

  SELECT tenant_id, candidate_version_id, decision, evaluator_actor_id
    INTO evaluation
    FROM public.learning_evaluation_receipts
   WHERE tenant_id = NEW.tenant_id
     AND receipt_id = NEW.evaluation_receipt_id
     AND candidate_version_id = NEW.candidate_version_id;

  IF candidate.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR evaluation.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR evaluation.candidate_version_id IS DISTINCT FROM NEW.candidate_version_id
     OR evaluation.decision IS DISTINCT FROM 'PROMOTION_ELIGIBLE'
     OR candidate.stage IS DISTINCT FROM 'CANARY' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Promotion requires the same-tenant CANARY candidate and matching PROMOTION_ELIGIBLE evaluation.';
  END IF;

  IF NEW.source_readback->>'status' IS DISTINCT FROM 'VERIFIED'
     OR NEW.source_readback->>'candidateVersionId' IS DISTINCT FROM NEW.candidate_version_id::text
     OR NEW.source_readback->>'evaluationReceiptId' IS DISTINCT FROM NEW.evaluation_receipt_id
     OR NEW.source_readback->>'commandId' IS DISTINCT FROM NEW.command_id
     OR COALESCE(NEW.source_readback->>'contentDigest', '') !~ '^[a-f0-9]{64}$'
     OR NEW.source_readback->'externalEffectsAuthorized' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Promotion requires exact-version VERIFIED source readback with zero external effects.';
  END IF;

  IF candidate.changes_action_eligibility THEN
    IF jsonb_typeof(NEW.guardian_approval_refs) IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW.guardian_approval_refs) NOT BETWEEN 2 AND 3 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Action-eligibility promotion requires a 2-of-3 guardian quorum.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(NEW.guardian_approval_refs) AS approval(value)
       WHERE jsonb_typeof(approval.value) IS DISTINCT FROM 'object'
          OR COALESCE(approval.value->>'approvalId', '') !~ '^approval:[A-Za-z0-9][A-Za-z0-9._:-]{7,190}$'
          OR COALESCE(approval.value->>'guardianId', '') !~ '^user:[A-Za-z0-9._:@-]{1,190}$'
          OR approval.value->>'decision' IS DISTINCT FROM 'APPROVED'
          OR COALESCE(approval.value->>'contentDigest', '') !~ '^[a-f0-9]{64}$'
          OR (approval.value->>'decidedAt')::timestamptz > NEW.promoted_at
          OR (approval.value->>'expiresAt')::timestamptz <= NEW.promoted_at
          OR approval.value->>'guardianId' = candidate.proposed_by_actor_id
          OR approval.value->>'guardianId' = evaluation.evaluator_actor_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Guardian approvals must be current, canonical, human, independent, and recused from proposal and evaluation.';
    END IF;

    SELECT count(*),
           count(DISTINCT approval.value->>'approvalId'),
           count(DISTINCT approval.value->>'guardianId')
      INTO reference_count, distinct_approval_count, distinct_guardian_count
      FROM jsonb_array_elements(NEW.guardian_approval_refs) AS approval(value);

    IF reference_count < 2
       OR distinct_approval_count IS DISTINCT FROM reference_count
       OR distinct_guardian_count IS DISTINCT FROM reference_count THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Guardian approval and guardian identity references must be distinct.';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.validate_learning_rollback_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate record;
  evaluation record;
BEGIN
  SELECT tenant_id, version, stage, last_known_good_version
    INTO candidate
    FROM public.learning_candidate_versions
   WHERE tenant_id = NEW.tenant_id
     AND candidate_version_id = NEW.candidate_version_id;

  SELECT tenant_id, candidate_version_id, decision, rollback_target_version
    INTO evaluation
    FROM public.learning_evaluation_receipts
   WHERE tenant_id = NEW.tenant_id
     AND receipt_id = NEW.evaluation_receipt_id
     AND candidate_version_id = NEW.candidate_version_id;

  IF candidate.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR evaluation.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR evaluation.candidate_version_id IS DISTINCT FROM NEW.candidate_version_id
     OR evaluation.decision IS DISTINCT FROM 'ROLLBACK_REQUIRED'
     OR candidate.stage IS DISTINCT FROM 'DEPLOYED'
     OR NEW.from_version IS DISTINCT FROM candidate.version::text
     OR candidate.last_known_good_version IS NULL
     OR evaluation.rollback_target_version IS DISTINCT FROM candidate.last_known_good_version
     OR NEW.to_version IS DISTINCT FROM candidate.last_known_good_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Rollback requires the same-tenant DEPLOYED candidate and exact last-known-good target.';
  END IF;

  IF NEW.source_readback->>'status' IS DISTINCT FROM 'VERIFIED'
     OR NEW.source_readback->>'candidateVersionId' IS DISTINCT FROM NEW.candidate_version_id::text
     OR NEW.source_readback->>'evaluationReceiptId' IS DISTINCT FROM NEW.evaluation_receipt_id
     OR NEW.source_readback->>'commandId' IS DISTINCT FROM NEW.command_id
     OR COALESCE(NEW.source_readback->>'contentDigest', '') !~ '^[a-f0-9]{64}$'
     OR NEW.source_readback->'externalEffectsAuthorized' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Rollback requires exact-target VERIFIED source readback with zero external effects.';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.protect_learning_candidate_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage NOT IN ('CANDIDATE', 'SHADOW', 'QUARANTINED') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'A learning candidate must enter as CANDIDATE, SHADOW, or QUARANTINED.';
    END IF;
    NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at, now());
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.changes_action_eligibility IS DISTINCT FROM OLD.changes_action_eligibility
     OR NEW.proposed_by_actor_id IS DISTINCT FROM OLD.proposed_by_actor_id
     OR NEW.proposed_by_actor_type IS DISTINCT FROM OLD.proposed_by_actor_type
     OR NEW.candidate_payload IS DISTINCT FROM OLD.candidate_payload
     OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
     OR NEW.feedback_refs IS DISTINCT FROM OLD.feedback_refs
     OR NEW.payload_checksum IS DISTINCT FROM OLD.payload_checksum
     OR NEW.last_known_good_version IS DISTINCT FROM OLD.last_known_good_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning candidate evidence is immutable; create a new candidate version.';
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NOT (
      (OLD.stage = 'CANDIDATE' AND NEW.stage IN ('SHADOW', 'QUARANTINED', 'SUPERSEDED'))
      OR (OLD.stage = 'SHADOW' AND NEW.stage IN ('CANARY', 'QUARANTINED', 'SUPERSEDED'))
      OR (OLD.stage = 'CANARY' AND NEW.stage IN ('DEPLOYED', 'QUARANTINED', 'SUPERSEDED'))
      OR (OLD.stage = 'DEPLOYED' AND NEW.stage IN ('ROLLED_BACK', 'SUPERSEDED'))
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Learning candidate stage transition is not permitted.';
    END IF;

    IF NEW.stage = 'DEPLOYED' AND NOT EXISTS (
      SELECT 1
        FROM public.learning_promotion_receipts receipt
       WHERE receipt.tenant_id = NEW.tenant_id
         AND receipt.candidate_version_id = NEW.candidate_version_id
         AND receipt.source_readback->>'status' = 'VERIFIED'
         AND receipt.source_readback->'externalEffectsAuthorized' = 'false'::jsonb
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'DEPLOYED requires an authoritative promotion receipt and exact source readback.';
    END IF;

    IF NEW.stage = 'ROLLED_BACK' AND NOT EXISTS (
      SELECT 1
        FROM public.learning_rollback_receipts receipt
       WHERE receipt.tenant_id = NEW.tenant_id
         AND receipt.candidate_version_id = NEW.candidate_version_id
         AND receipt.source_readback->>'status' = 'VERIFIED'
         AND receipt.source_readback->'externalEffectsAuthorized' = 'false'::jsonb
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'ROLLED_BACK requires an authoritative rollback receipt and exact source readback.';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS learning_candidate_version_immutable_evidence
  ON public.learning_candidate_versions;
CREATE TRIGGER learning_candidate_version_immutable_evidence
BEFORE INSERT OR UPDATE ON public.learning_candidate_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_learning_candidate_version();

REVOKE ALL ON FUNCTION public.prevent_learning_candidate_delete()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_learning_promotion_receipt()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_learning_rollback_receipt()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_learning_candidate_version()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.validate_learning_promotion_receipt() IS
  'Fail-closed promotion admission: same-tenant canary, exact evaluation/readback, and distinct 2-of-3 human guardian evidence for action-eligibility changes.';
COMMENT ON FUNCTION public.protect_learning_candidate_version() IS
  'Append-only candidate evidence and monotonic stage transitions; deployment and rollback require immutable authoritative receipts.';

COMMIT;
