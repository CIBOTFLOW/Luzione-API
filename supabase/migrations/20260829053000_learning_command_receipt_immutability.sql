BEGIN;

CREATE OR REPLACE FUNCTION public.protect_learning_command_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_candidate_version_id uuid;
  v_evaluation_receipt_id text;
  v_target_stage text;
  v_candidate_version integer;
  v_expected_readback_ref text;
  v_receipt_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.command_type IN (
      'learning.candidate.promote',
      'learning.candidate.rollback'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Learning command receipts are immutable execution evidence.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.command_type NOT IN (
       'learning.candidate.promote',
       'learning.candidate.rollback'
     )
     AND NEW.command_type NOT IN (
       'learning.candidate.promote',
       'learning.candidate.rollback'
     ) THEN
    RETURN NEW;
  END IF;

  IF OLD.command_type IS DISTINCT FROM NEW.command_type
     OR OLD.state IS DISTINCT FROM 'VALIDATED'
     OR NEW.state IS DISTINCT FROM 'SOURCE_CONFIRMED'
     OR (
       to_jsonb(NEW) - ARRAY[
         'state',
         'committed_object_version',
         'committed_at',
         'source_confirmed_at',
         'source_readback_ref',
         'metadata',
         'updated_at'
       ]::text[]
     ) IS DISTINCT FROM (
       to_jsonb(OLD) - ARRAY[
         'state',
         'committed_object_version',
         'committed_at',
         'source_confirmed_at',
         'source_readback_ref',
         'metadata',
         'updated_at'
       ]::text[]
     )
     OR OLD.metadata ? 'learningCommandReadback'
     OR NEW.metadata - 'learningCommandReadback' IS DISTINCT FROM OLD.metadata
     OR NEW.committed_at IS NULL
     OR NEW.source_confirmed_at IS DISTINCT FROM NEW.committed_at
     OR NEW.updated_at IS DISTINCT FROM NEW.committed_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning commands may only receive the exact atomic source-confirmation update.';
  END IF;

  BEGIN
    v_candidate_version_id := OLD.target_object_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Learning command target is not a canonical candidate version.';
  END;
  v_evaluation_receipt_id := OLD.metadata->'payload'->>'evaluationReceiptId';
  v_target_stage := OLD.metadata->'payload'->>'targetStage';

  SELECT candidate.version
    INTO v_candidate_version
    FROM public.learning_candidate_versions candidate
   WHERE candidate.tenant_id = OLD.canonical_tenant_id
     AND candidate.candidate_version_id = v_candidate_version_id
     AND candidate.stage = v_target_stage;
  IF NOT FOUND
     OR NEW.committed_object_version IS DISTINCT FROM (
       v_candidate_version::text || ':' || v_target_stage
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning command confirmation does not match authoritative candidate readback.';
  END IF;

  v_expected_readback_ref := (
    'learning_candidate_versions:'
    || v_candidate_version_id::text
    || ':'
    || v_target_stage
  );
  IF NEW.source_readback_ref IS DISTINCT FROM v_expected_readback_ref
     OR NEW.metadata->'learningCommandReadback'->>'status' IS DISTINCT FROM 'VERIFIED'
     OR NEW.metadata->'learningCommandReadback'->>'candidateVersionId'
          IS DISTINCT FROM v_candidate_version_id::text
     OR NEW.metadata->'learningCommandReadback'->>'evaluationReceiptId'
          IS DISTINCT FROM v_evaluation_receipt_id
     OR NEW.metadata->'learningCommandReadback'->>'commandId'
          IS DISTINCT FROM OLD.command_id
     OR NEW.metadata->'learningCommandReadback'->>'contentDigest'
          IS DISTINCT FROM OLD.metadata->'action'->>'contentDigest'
     OR NEW.metadata->'learningCommandReadback'->'externalEffectsAuthorized'
          IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning command confirmation lacks exact verified source readback.';
  END IF;

  IF OLD.command_type = 'learning.candidate.promote' THEN
    SELECT count(*)
      INTO v_receipt_count
      FROM public.learning_promotion_receipts receipt
     WHERE receipt.tenant_id = OLD.canonical_tenant_id
       AND receipt.candidate_version_id = v_candidate_version_id
       AND receipt.evaluation_receipt_id = v_evaluation_receipt_id
       AND receipt.command_id = OLD.command_id
       AND receipt.source_readback->>'contentDigest'
            = OLD.metadata->'action'->>'contentDigest';
  ELSE
    SELECT count(*)
      INTO v_receipt_count
      FROM public.learning_rollback_receipts receipt
     WHERE receipt.tenant_id = OLD.canonical_tenant_id
       AND receipt.candidate_version_id = v_candidate_version_id
       AND receipt.evaluation_receipt_id = v_evaluation_receipt_id
       AND receipt.command_id = OLD.command_id
       AND receipt.source_readback->>'contentDigest'
            = OLD.metadata->'action'->>'contentDigest';
  END IF;
  IF v_receipt_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning command confirmation requires exactly one authoritative transition receipt.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER learning_command_receipt_immutable
BEFORE UPDATE OR DELETE ON public.p110_command_receipts
FOR EACH ROW EXECUTE FUNCTION public.protect_learning_command_receipt();

REVOKE ALL ON FUNCTION public.protect_learning_command_receipt()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.protect_learning_command_receipt() IS
  'Freezes admitted learning command evidence and permits only an exact receipt-backed atomic SOURCE_CONFIRMED transition.';

COMMIT;
