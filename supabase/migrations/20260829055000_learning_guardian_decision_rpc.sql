BEGIN;

ALTER TABLE public.learning_guardian_decisions
  ADD COLUMN rationale text NOT NULL
  DEFAULT 'Legacy guardian decision without a captured rationale.';

ALTER TABLE public.learning_guardian_decisions
  ALTER COLUMN rationale DROP DEFAULT;

ALTER TABLE public.learning_guardian_decisions
  ADD CONSTRAINT learning_guardian_decisions_rationale_check
  CHECK (
    char_length(btrim(rationale)) BETWEEN 1 AND 2000
    AND rationale = btrim(rationale)
  );

CREATE OR REPLACE FUNCTION public.record_learning_guardian_decision(
  p_tenant_id uuid,
  p_command_id text,
  p_guardian_identity_id text,
  p_decision text,
  p_rationale text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, luzione_api_private, extensions
AS $$
DECLARE
  command_row record;
  candidate record;
  evaluation record;
  existing_decision record;
  v_candidate_version_id uuid;
  v_evaluation_receipt_id text;
  expected_digest text;
  canonical_decision text;
  v_approval_id text;
  configured_guardian_count integer;
  inserted boolean := false;
  decided_at timestamptz := now();
BEGIN
  IF p_tenant_id IS NULL
     OR p_command_id IS NULL
     OR p_guardian_identity_id IS NULL
     OR p_command_id !~ '^cmd:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_guardian_identity_id !~ '^user:[A-Za-z0-9._:@-]{1,190}$'
     OR p_decision NOT IN ('APPROVE', 'DENY')
     OR p_rationale IS NULL
     OR char_length(btrim(p_rationale)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A canonical tenant, command, human guardian, decision, and bounded rationale are required.';
  END IF;
  canonical_decision := CASE p_decision
    WHEN 'APPROVE' THEN 'APPROVED'
    ELSE 'REJECTED'
  END;

  SELECT *
    INTO command_row
    FROM public.p110_command_receipts
   WHERE canonical_tenant_id = p_tenant_id
     AND command_id = p_command_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Learning command was not found for the canonical tenant.';
  END IF;

  IF command_row.command_type IS DISTINCT FROM 'learning.candidate.promote'
     OR command_row.authority_contract_version IS DISTINCT FROM 'luzione-authority/v2'
     OR command_row.authority_class IS DISTINCT FROM 'A2'
     OR command_row.capability IS DISTINCT FROM 'learning.candidate.promote'
     OR command_row.target_owner_project IS DISTINCT FROM 'CIBOTFLOW/Luzione-API'
     OR command_row.target_object_type IS DISTINCT FROM 'learning_candidate_version'
     OR command_row.target_object_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR command_row.metadata->'authorityDecision'->'allowed' IS DISTINCT FROM 'true'::jsonb
     OR command_row.metadata->'authorityDecision'->'externalEffectAuthorized'
          IS DISTINCT FROM 'false'::jsonb
     OR command_row.metadata->'action'->>'provider' IS DISTINCT FROM 'luzione.learning'
     OR command_row.metadata->'action'->'readbackPlanned' IS DISTINCT FROM 'true'::jsonb
     OR command_row.compensation_plan_ref IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Guardian review requires an exact allowed reversible A2 learning promotion.';
  END IF;

  v_candidate_version_id := command_row.target_object_id::uuid;
  v_evaluation_receipt_id := command_row.metadata->'payload'->>'evaluationReceiptId';
  IF v_evaluation_receipt_id IS NULL
     OR v_evaluation_receipt_id !~ '^learning_evaluation_[a-f0-9]{24}$'
     OR command_row.metadata->'payload'->>'candidateVersionId'
          IS DISTINCT FROM v_candidate_version_id::text
     OR command_row.expected_object_version IS DISTINCT FROM 'CANARY'
     OR command_row.metadata->'payload'->>'expectedStage' IS DISTINCT FROM 'CANARY'
     OR command_row.metadata->'payload'->>'targetStage' IS DISTINCT FROM 'DEPLOYED'
     OR command_row.metadata->'payload'->>'targetVersion' IS NULL
     OR command_row.resource_scope IS DISTINCT FROM jsonb_build_array(
       'learning_candidate:' || v_candidate_version_id::text
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Guardian review command does not bind one exact promotion transition.';
  END IF;

  expected_digest := luzione_api_private.learning_command_content_digest(
    p_tenant_id,
    command_row.command_type,
    v_candidate_version_id,
    v_evaluation_receipt_id,
    'CANARY',
    'DEPLOYED',
    command_row.metadata->'payload'->>'targetVersion'
  );
  IF command_row.metadata->'action'->>'contentDigest' IS DISTINCT FROM expected_digest THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Guardian review digest does not bind the exact transition.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.platform_identities identity
      JOIN public.tenant_memberships membership
        ON membership.identity_id = identity.identity_id
       AND membership.tenant_id = p_tenant_id
      JOIN public.tenant_accounts tenant
        ON tenant.tenant_id = membership.tenant_id
     WHERE identity.identity_id = p_guardian_identity_id
       AND identity.identity_type = 'USER'
       AND identity.status = 'ACTIVE'
       AND membership.status = 'ACTIVE'
       AND membership.capabilities @> '["learning.guardian"]'::jsonb
       AND tenant.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Guardian decision requires an active canonical human guardian membership.';
  END IF;

  SELECT tenant_id, candidate_version_id, candidate_id, version, kind, stage,
         changes_action_eligibility, proposed_by_actor_id
    INTO candidate
    FROM public.learning_candidate_versions
   WHERE tenant_id = p_tenant_id
     AND candidate_version_id = v_candidate_version_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Learning candidate was not found for the canonical tenant.';
  END IF;

  SELECT evaluation_row.tenant_id,
         evaluation_row.candidate_version_id,
         evaluation_row.receipt_id,
         evaluation_row.decision,
         evaluation_row.evaluator_actor_id
    INTO evaluation
    FROM public.learning_evaluation_receipts evaluation_row
   WHERE evaluation_row.tenant_id = p_tenant_id
     AND evaluation_row.candidate_version_id = candidate.candidate_version_id
     AND evaluation_row.receipt_id = v_evaluation_receipt_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Learning evaluation was not found for the canonical candidate.';
  END IF;

  IF NOT candidate.changes_action_eligibility
     OR candidate.version::text IS DISTINCT FROM command_row.metadata->'payload'->>'targetVersion'
     OR evaluation.decision IS DISTINCT FROM 'PROMOTION_ELIGIBLE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Guardian decisions are limited to exact promotion-eligible action changes.';
  END IF;
  IF p_guardian_identity_id IN (
       candidate.proposed_by_actor_id,
       evaluation.evaluator_actor_id
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'The proposer and evaluator are recused from guardian review.';
  END IF;

  SELECT *
    INTO existing_decision
    FROM public.learning_guardian_decisions decision
   WHERE decision.tenant_id = p_tenant_id
     AND decision.candidate_version_id = candidate.candidate_version_id
     AND decision.evaluation_receipt_id = evaluation.receipt_id
     AND decision.guardian_identity_id = p_guardian_identity_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_decision.content_digest IS DISTINCT FROM expected_digest
       OR existing_decision.decision IS DISTINCT FROM canonical_decision
       OR existing_decision.rationale IS DISTINCT FROM btrim(p_rationale) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Guardian idempotency collision: the immutable decision differs.';
    END IF;
    RETURN jsonb_build_object(
      'approvalId', existing_decision.approval_id,
      'candidateVersionId', existing_decision.candidate_version_id,
      'commandId', command_row.command_id,
      'contentDigest', existing_decision.content_digest,
      'decidedAt', existing_decision.decided_at,
      'decision', existing_decision.decision,
      'evaluationReceiptId', existing_decision.evaluation_receipt_id,
      'expiresAt', existing_decision.expires_at,
      'externalEffectsAuthorized', false,
      'guardianIdentityId', existing_decision.guardian_identity_id,
      'rationale', existing_decision.rationale,
      'replayed', true,
      'status', 'RECORDED'
    );
  END IF;

  IF command_row.state IS DISTINCT FROM 'VALIDATED'
     OR candidate.stage IS DISTINCT FROM 'CANARY' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Guardian review is stale or the candidate is no longer in CANARY.';
  END IF;

  SELECT count(*)
    INTO configured_guardian_count
    FROM public.platform_identities identity
    JOIN public.tenant_memberships membership
      ON membership.identity_id = identity.identity_id
     AND membership.tenant_id = p_tenant_id
   WHERE identity.identity_type = 'USER'
     AND identity.status = 'ACTIVE'
     AND membership.status = 'ACTIVE'
     AND membership.capabilities @> '["learning.guardian"]'::jsonb;
  IF configured_guardian_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Guardian review requires exactly three configured canonical humans.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.integration_capability_registry capability
     WHERE capability.provider = 'luzione.learning'
       AND capability.capability = command_row.capability
       AND capability.authority_contract_version = 'luzione-authority/v2'
       AND capability.authority_class = 'A2'
       AND capability.operation_kind = 'INTERNAL'
       AND NOT capability.provider_effect
       AND capability.enabled
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Learning promotion capability is disabled or no longer registered.';
  END IF;

  PERFORM 1
    FROM public.policy_evaluations policy
    JOIN public.policy_definitions definition
      ON definition.policy_definition_id = policy.policy_definition_id
     AND definition.tenant_id = p_tenant_id
     AND definition.status = 'ACTIVE'
   WHERE policy.evaluation_id = command_row.policy_decision_id
     AND policy.tenant_id = p_tenant_id
     AND policy.authority_contract_version = 'luzione-authority/v2'
     AND policy.authority_class = 'A2'
     AND policy.capability = command_row.capability
     AND policy.correlation_id = command_row.correlation_id
     AND policy.actor_ref = command_row.actor_id
     AND policy.domain = 'learning'
     AND policy.action = command_row.command_type
     AND policy.resource_scope = command_row.resource_scope
     AND policy.payload_hash = expected_digest
     AND policy.created_at <= command_row.requested_at
     AND policy.created_at >= command_row.requested_at - interval '5 minutes'
     AND policy.allowed
     AND NOT policy.hard_blocked
   FOR KEY SHARE OF policy, definition;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Guardian review requires the exact active tenant policy.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.p110_kill_switches kill
     WHERE kill.active
       AND (
         kill.canonical_tenant_id = p_tenant_id
         OR (
           kill.canonical_tenant_id IS NULL
           AND kill.tenant_id = command_row.tenant_id
         )
       )
       AND (
         kill.scope_type = 'GLOBAL'
         OR (kill.scope_type = 'PROVIDER' AND kill.scope_ref = 'luzione.learning')
         OR (kill.scope_type = 'CAPABILITY' AND kill.scope_ref = command_row.capability)
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning guardian decision is blocked by an active kill switch.';
  END IF;

  v_approval_id := 'approval:guardian_' || substr(
    encode(
      extensions.digest(
        convert_to(
          concat_ws(
            '|',
            'learning-guardian/v1',
            p_tenant_id::text,
            candidate.candidate_version_id::text,
            evaluation.receipt_id,
            p_guardian_identity_id
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    1,
    24
  );

  INSERT INTO public.learning_guardian_decisions (
    approval_id,
    tenant_id,
    candidate_version_id,
    evaluation_receipt_id,
    guardian_identity_id,
    decision,
    content_digest,
    rationale,
    decided_at,
    expires_at
  ) VALUES (
    v_approval_id,
    p_tenant_id,
    candidate.candidate_version_id,
    evaluation.receipt_id,
    p_guardian_identity_id,
    canonical_decision,
    expected_digest,
    btrim(p_rationale),
    decided_at,
    decided_at + interval '15 minutes'
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO existing_decision;
  inserted := FOUND;

  IF NOT inserted THEN
    SELECT *
      INTO existing_decision
      FROM public.learning_guardian_decisions decision
     WHERE decision.tenant_id = p_tenant_id
       AND decision.candidate_version_id = candidate.candidate_version_id
       AND decision.evaluation_receipt_id = evaluation.receipt_id
       AND decision.guardian_identity_id = p_guardian_identity_id;
    IF NOT FOUND
       OR existing_decision.content_digest IS DISTINCT FROM expected_digest
       OR existing_decision.decision IS DISTINCT FROM canonical_decision
       OR existing_decision.rationale IS DISTINCT FROM btrim(p_rationale) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Guardian idempotency collision: the immutable decision differs.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'approvalId', existing_decision.approval_id,
    'candidateVersionId', existing_decision.candidate_version_id,
    'commandId', command_row.command_id,
    'contentDigest', existing_decision.content_digest,
    'decidedAt', existing_decision.decided_at,
    'decision', existing_decision.decision,
    'evaluationReceiptId', existing_decision.evaluation_receipt_id,
    'expiresAt', existing_decision.expires_at,
    'externalEffectsAuthorized', false,
    'guardianIdentityId', existing_decision.guardian_identity_id,
    'rationale', existing_decision.rationale,
    'replayed', NOT inserted,
    'status', 'RECORDED'
  );
END
$$;

REVOKE INSERT ON TABLE public.learning_guardian_decisions FROM service_role;
REVOKE ALL ON FUNCTION public.record_learning_guardian_decision(
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_learning_guardian_decision(
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

COMMENT ON FUNCTION public.record_learning_guardian_decision(
  uuid,
  text,
  text,
  text,
  text
) IS
  'Records one immutable, recused, policy-current human guardian decision for the exact server-resolved learning promotion command; creates no external effect.';

COMMIT;
