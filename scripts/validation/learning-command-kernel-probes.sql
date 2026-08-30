-- Reusable restored-clone probes for the Sultan learning command kernel.
-- Every permanent fixture is created inside a PL/pgSQL subtransaction that is
-- deliberately rolled back. Only temporary probe results survive long enough
-- for the final SELECT. Run as the migration/operator role on validation only.

CREATE TEMPORARY TABLE learning_command_probe_results (
  scenario text PRIMARY KEY,
  passed boolean NOT NULL,
  evidence jsonb NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.seed_learning_promotion(
  p_changes_action_eligibility boolean DEFAULT false,
  p_policy_age interval DEFAULT interval '1 second',
  p_policy_status public.policy_definition_status DEFAULT 'ACTIVE',
  p_command_expected_stage text DEFAULT 'CANARY',
  p_wrong_scope boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_tenant constant uuid := 'c474af6e-f018-42ac-a17b-5ced23d3a4c6';
  v_candidate uuid := gen_random_uuid();
  v_policy_definition uuid := gen_random_uuid();
  v_command text := 'cmd:' || gen_random_uuid()::text;
  v_evaluation text := (
    'learning_evaluation_' || substr(md5(gen_random_uuid()::text), 1, 24)
  );
  v_policy text := 'policy:learning-probe-' || gen_random_uuid()::text;
  v_correlation text := 'correlation:learning-probe-' || gen_random_uuid()::text;
  v_receipt text := 'receipt:' || gen_random_uuid()::text;
  v_idempotency text := 'idempotency:learning-probe-' || gen_random_uuid()::text;
  v_digest text;
  v_scope jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  v_scope := jsonb_build_array(
    'learning_candidate:'
    || CASE
      WHEN p_wrong_scope THEN gen_random_uuid()::text
      ELSE v_candidate::text
    END
  );
  INSERT INTO public.policy_definitions (
    policy_definition_id,
    tenant_id,
    code,
    version,
    status,
    policy_json,
    compiled_json,
    checksum
  )
  VALUES (
    v_policy_definition,
    v_tenant,
    'LEARNING_PROBE_' || upper(substr(replace(v_policy_definition::text, '-', ''), 1, 12)),
    1,
    p_policy_status,
    '{"purpose":"validation-only"}'::jsonb,
    '{"allowed":true}'::jsonb,
    encode(extensions.digest(v_policy_definition::text, 'sha256'), 'hex')
  );

  INSERT INTO public.learning_candidate_versions (
    candidate_version_id,
    tenant_id,
    candidate_id,
    version,
    kind,
    stage,
    changes_action_eligibility,
    proposed_by_actor_id,
    proposed_by_actor_type,
    candidate_payload,
    evidence_refs,
    feedback_refs,
    payload_checksum,
    last_known_good_version
  )
  VALUES (
    v_candidate,
    v_tenant,
    'candidate:probe:' || v_candidate::text,
    7,
    CASE WHEN p_changes_action_eligibility THEN 'ACTION_POLICY' ELSE 'MEMORY' END,
    'SHADOW',
    p_changes_action_eligibility,
    'agent:sultan-os',
    'agent',
    '{"summary":"validation-only"}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    encode(extensions.digest(v_candidate::text, 'sha256'), 'hex'),
    '6'
  );

  UPDATE public.learning_candidate_versions
     SET stage = 'CANARY'
   WHERE tenant_id = v_tenant
     AND candidate_version_id = v_candidate;

  INSERT INTO public.learning_evaluation_receipts (
    receipt_id,
    tenant_id,
    candidate_version_id,
    decision,
    reason_codes,
    metrics_snapshot,
    evaluation_contract_version,
    evaluator_actor_id,
    rollback_target_version,
    next_safe_action,
    receipt_hash,
    evaluated_at
  )
  VALUES (
    v_evaluation,
    v_tenant,
    v_candidate,
    'PROMOTION_ELIGIBLE',
    '[]'::jsonb,
    '{"taskSuccessRate":0.99}'::jsonb,
    'learning-evaluation/v1',
    'service:legacy-import',
    null,
    'ADMIT_EXACT_PROMOTION',
    encode(extensions.digest(v_evaluation, 'sha256'), 'hex'),
    v_now - interval '2 seconds'
  );

  v_digest := luzione_api_private.learning_command_content_digest(
    v_tenant,
    'learning.candidate.promote',
    v_candidate,
    v_evaluation,
    'CANARY',
    'DEPLOYED',
    '7'
  );

  INSERT INTO public.policy_evaluations (
    evaluation_id,
    domain,
    action,
    payload_hash,
    result_json,
    allowed,
    requires_approval,
    hard_blocked,
    created_at,
    tenant_id,
    actor_ref,
    policy_definition_id,
    request_id,
    authority_contract_version,
    authority_class,
    capability,
    resource_scope,
    correlation_id
  )
  VALUES (
    v_policy,
    'learning',
    'learning.candidate.promote',
    v_digest,
    '{"decision":"ALLOW"}'::jsonb,
    true,
    false,
    false,
    v_now - p_policy_age,
    v_tenant,
    'agent:sultan-os',
    v_policy_definition,
    'request:learning-probe-promote',
    'luzione-authority/v2',
    'A2',
    'learning.candidate.promote',
    v_scope,
    v_correlation
  );

  INSERT INTO public.p110_command_receipts (
    tenant_id,
    receipt_id,
    command_id,
    command_type,
    idempotency_key,
    payload_hash,
    correlation_id,
    target_owner_project,
    target_object_type,
    target_object_id,
    expected_object_version,
    policy_version,
    actor_id,
    actor_type,
    actor_roles,
    state,
    requested_at,
    metadata,
    canonical_tenant_id,
    authority_contract_version,
    authority_class,
    capability,
    policy_decision_id,
    resource_scope,
    compensation_plan_ref
  )
  VALUES (
    'luzione',
    v_receipt,
    v_command,
    'learning.candidate.promote',
    v_idempotency,
    encode(extensions.digest(v_command, 'sha256'), 'hex'),
    v_correlation,
    'CIBOTFLOW/Luzione-API',
    'learning_candidate_version',
    v_candidate::text,
    p_command_expected_stage,
    'luzione-authority/v2',
    'agent:sultan-os',
    'agent',
    '["SULTAN_AGENT"]'::jsonb,
    'VALIDATED',
    v_now,
    jsonb_build_object(
      'action', jsonb_build_object(
        'actionId', 'learning:promote:' || v_candidate::text,
        'actionVersion', '7',
        'provider', 'luzione.learning',
        'readbackPlanned', true,
        'contentDigest', v_digest
      ),
      'authorityDecision', jsonb_build_object(
        'allowed', true,
        'externalEffectAuthorized', false,
        'code', 'ALLOW_A2'
      ),
      'payload', jsonb_build_object(
        'candidateVersionId', v_candidate::text,
        'evaluationReceiptId', v_evaluation,
        'expectedStage', p_command_expected_stage,
        'targetStage', 'DEPLOYED',
        'targetVersion', '7'
      )
    ),
    v_tenant,
    'luzione-authority/v2',
    'A2',
    'learning.candidate.promote',
    v_policy,
    v_scope,
    'learning-rollback:exact-last-known-good'
  );

  RETURN jsonb_build_object(
    'candidateVersionId', v_candidate,
    'commandId', v_command,
    'contentDigest', v_digest,
    'correlationId', v_correlation,
    'evaluationReceiptId', v_evaluation,
    'idempotencyKey', v_idempotency,
    'policyDefinitionId', v_policy_definition,
    'policyEvaluationId', v_policy,
    'receiptId', v_receipt,
    'requestedAt', v_now,
    'tenantId', v_tenant
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.add_competing_promotion_command(
  p_fixture jsonb,
  p_reuse_idempotency_key boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_command text := 'cmd:' || gen_random_uuid()::text;
  v_correlation text := 'correlation:learning-competitor-' || gen_random_uuid()::text;
  v_policy text := 'policy:learning-competitor-' || gen_random_uuid()::text;
  v_receipt text := 'receipt:' || gen_random_uuid()::text;
  v_idempotency text := CASE
    WHEN p_reuse_idempotency_key THEN p_fixture->>'idempotencyKey'
    ELSE 'idempotency:learning-competitor-' || gen_random_uuid()::text
  END;
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.policy_evaluations (
    evaluation_id,
    domain,
    action,
    payload_hash,
    result_json,
    allowed,
    requires_approval,
    hard_blocked,
    created_at,
    tenant_id,
    actor_ref,
    policy_definition_id,
    request_id,
    authority_contract_version,
    authority_class,
    capability,
    resource_scope,
    correlation_id
  )
  SELECT
    v_policy,
    policy.domain,
    policy.action,
    policy.payload_hash,
    policy.result_json,
    policy.allowed,
    policy.requires_approval,
    policy.hard_blocked,
    v_now - interval '1 second',
    policy.tenant_id,
    policy.actor_ref,
    policy.policy_definition_id,
    'request:learning-competitor',
    policy.authority_contract_version,
    policy.authority_class,
    policy.capability,
    policy.resource_scope,
    v_correlation
  FROM public.policy_evaluations policy
  WHERE policy.evaluation_id = p_fixture->>'policyEvaluationId';

  INSERT INTO public.p110_command_receipts (
    tenant_id,
    receipt_id,
    command_id,
    command_type,
    idempotency_key,
    payload_hash,
    correlation_id,
    target_owner_project,
    target_object_type,
    target_object_id,
    expected_object_version,
    policy_version,
    actor_id,
    actor_type,
    actor_roles,
    state,
    requested_at,
    metadata,
    canonical_tenant_id,
    authority_contract_version,
    authority_class,
    capability,
    policy_decision_id,
    approval_id,
    resource_scope,
    estimated_cost,
    actual_cost,
    compensation_plan_ref
  )
  SELECT
    command.tenant_id,
    v_receipt,
    v_command,
    command.command_type,
    v_idempotency,
    encode(extensions.digest(v_command, 'sha256'), 'hex'),
    v_correlation,
    command.target_owner_project,
    command.target_object_type,
    command.target_object_id,
    command.expected_object_version,
    command.policy_version,
    command.actor_id,
    command.actor_type,
    command.actor_roles,
    'VALIDATED',
    v_now,
    command.metadata,
    command.canonical_tenant_id,
    command.authority_contract_version,
    command.authority_class,
    command.capability,
    v_policy,
    null,
    command.resource_scope,
    command.estimated_cost,
    null,
    command.compensation_plan_ref
  FROM public.p110_command_receipts command
  WHERE command.command_id = p_fixture->>'commandId';

  RETURN p_fixture || jsonb_build_object(
    'competingCommandId', v_command,
    'competingPolicyEvaluationId', v_policy,
    'competingReceiptId', v_receipt
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.add_learning_rollback_command(
  p_fixture jsonb,
  p_target_version text DEFAULT '6'
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_tenant uuid := (p_fixture->>'tenantId')::uuid;
  v_candidate uuid := (p_fixture->>'candidateVersionId')::uuid;
  v_command text := 'cmd:' || gen_random_uuid()::text;
  v_evaluation text := (
    'learning_evaluation_' || substr(md5(gen_random_uuid()::text), 1, 24)
  );
  v_policy text := 'policy:learning-rollback-' || gen_random_uuid()::text;
  v_correlation text := 'correlation:learning-rollback-' || gen_random_uuid()::text;
  v_receipt text := 'receipt:' || gen_random_uuid()::text;
  v_idempotency text := 'idempotency:learning-rollback-' || gen_random_uuid()::text;
  v_digest text;
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.learning_evaluation_receipts (
    receipt_id,
    tenant_id,
    candidate_version_id,
    decision,
    reason_codes,
    metrics_snapshot,
    evaluation_contract_version,
    evaluator_actor_id,
    rollback_target_version,
    next_safe_action,
    receipt_hash,
    evaluated_at
  )
  VALUES (
    v_evaluation,
    v_tenant,
    v_candidate,
    'ROLLBACK_REQUIRED',
    '["SAFETY_REGRESSION"]'::jsonb,
    '{"regression":true}'::jsonb,
    'learning-evaluation/v1',
    'service:legacy-import',
    p_target_version,
    'ROLL_BACK_TO_LAST_KNOWN_GOOD',
    encode(extensions.digest(v_evaluation, 'sha256'), 'hex'),
    v_now - interval '2 seconds'
  );

  v_digest := luzione_api_private.learning_command_content_digest(
    v_tenant,
    'learning.candidate.rollback',
    v_candidate,
    v_evaluation,
    'DEPLOYED',
    'ROLLED_BACK',
    p_target_version
  );

  INSERT INTO public.policy_evaluations (
    evaluation_id,
    domain,
    action,
    payload_hash,
    result_json,
    allowed,
    requires_approval,
    hard_blocked,
    created_at,
    tenant_id,
    actor_ref,
    policy_definition_id,
    request_id,
    authority_contract_version,
    authority_class,
    capability,
    resource_scope,
    correlation_id
  )
  VALUES (
    v_policy,
    'learning',
    'learning.candidate.rollback',
    v_digest,
    '{"decision":"ALLOW"}'::jsonb,
    true,
    false,
    false,
    v_now - interval '1 second',
    v_tenant,
    'agent:sultan-os',
    (p_fixture->>'policyDefinitionId')::uuid,
    'request:learning-rollback',
    'luzione-authority/v2',
    'A2',
    'learning.candidate.rollback',
    jsonb_build_array('learning_candidate:' || v_candidate::text),
    v_correlation
  );

  INSERT INTO public.p110_command_receipts (
    tenant_id,
    receipt_id,
    command_id,
    command_type,
    idempotency_key,
    payload_hash,
    correlation_id,
    target_owner_project,
    target_object_type,
    target_object_id,
    expected_object_version,
    policy_version,
    actor_id,
    actor_type,
    actor_roles,
    state,
    requested_at,
    metadata,
    canonical_tenant_id,
    authority_contract_version,
    authority_class,
    capability,
    policy_decision_id,
    resource_scope,
    compensation_plan_ref
  )
  VALUES (
    'luzione',
    v_receipt,
    v_command,
    'learning.candidate.rollback',
    v_idempotency,
    encode(extensions.digest(v_command, 'sha256'), 'hex'),
    v_correlation,
    'CIBOTFLOW/Luzione-API',
    'learning_candidate_version',
    v_candidate::text,
    'DEPLOYED',
    'luzione-authority/v2',
    'agent:sultan-os',
    'agent',
    '["SULTAN_AGENT"]'::jsonb,
    'VALIDATED',
    v_now,
    jsonb_build_object(
      'action', jsonb_build_object(
        'actionId', 'learning:rollback:' || v_candidate::text,
        'actionVersion', '7',
        'provider', 'luzione.learning',
        'readbackPlanned', true,
        'contentDigest', v_digest
      ),
      'authorityDecision', jsonb_build_object(
        'allowed', true,
        'externalEffectAuthorized', false,
        'code', 'ALLOW_A2'
      ),
      'payload', jsonb_build_object(
        'candidateVersionId', v_candidate::text,
        'evaluationReceiptId', v_evaluation,
        'expectedStage', 'DEPLOYED',
        'targetStage', 'ROLLED_BACK',
        'targetVersion', p_target_version
      )
    ),
    v_tenant,
    'luzione-authority/v2',
    'A2',
    'learning.candidate.rollback',
    v_policy,
    jsonb_build_array('learning_candidate:' || v_candidate::text),
    'learning-restore:exact-deployed-version'
  );

  RETURN p_fixture || jsonb_build_object(
    'rollbackCommandId', v_command,
    'rollbackContentDigest', v_digest,
    'rollbackEvaluationReceiptId', v_evaluation,
    'rollbackIdempotencyKey', v_idempotency,
    'rollbackPolicyEvaluationId', v_policy,
    'rollbackReceiptId', v_receipt
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.observe_promotion_attempt(
  p_fixture jsonb,
  p_tenant_id uuid DEFAULT null,
  p_actor_identity_id text DEFAULT 'agent:sultan-os'
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_sqlstate text;
BEGIN
  BEGIN
    v_result := public.apply_learning_command(
      coalesce(p_tenant_id, (p_fixture->>'tenantId')::uuid),
      p_fixture->>'commandId',
      p_actor_identity_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE;
  END;

  RETURN jsonb_build_object(
    'candidateStage', (
      SELECT candidate.stage
        FROM public.learning_candidate_versions candidate
       WHERE candidate.candidate_version_id = (p_fixture->>'candidateVersionId')::uuid
    ),
    'commandState', (
      SELECT command.state
        FROM public.p110_command_receipts command
       WHERE command.command_id = p_fixture->>'commandId'
    ),
    'externalEffectsAuthorized', v_result->'externalEffectsAuthorized',
    'outboxCount', (
      SELECT count(*)
        FROM public.p110_outbox_messages message
       WHERE message.receipt_id = p_fixture->>'receiptId'
    ),
    'receiptCount', (
      SELECT count(*)
        FROM public.learning_promotion_receipts receipt
       WHERE receipt.command_id = p_fixture->>'commandId'
    ),
    'sqlstate', v_sqlstate,
    'status', v_result->>'status'
  );
END
$$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_first jsonb;
  v_second jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    v_first := public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      'agent:sultan-os'
    );
    v_second := public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      'agent:sultan-os'
    );

    SELECT jsonb_build_object(
      'firstStatus', v_first->>'status',
      'firstReplayed', v_first->'replayed',
      'secondStatus', v_second->>'status',
      'secondReplayed', v_second->'replayed',
      'candidateStage', candidate.stage,
      'commandState', command.state,
      'receiptCount', (
        SELECT count(*)
          FROM public.learning_promotion_receipts receipt
         WHERE receipt.command_id = v_fixture->>'commandId'
      ),
      'externalEffectsAuthorized', v_first->'externalEffectsAuthorized',
      'outboxCount', (
        SELECT count(*)
          FROM public.p110_outbox_messages message
         WHERE message.receipt_id = v_fixture->>'receiptId'
      )
    )
      INTO v_evidence
      FROM public.learning_candidate_versions candidate
      JOIN public.p110_command_receipts command
        ON command.command_id = v_fixture->>'commandId'
     WHERE candidate.candidate_version_id = (v_fixture->>'candidateVersionId')::uuid;

    RAISE EXCEPTION USING
      ERRCODE = 'P7777',
      MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'promotion_and_exact_replay',
      v_evidence->>'firstStatus' = 'VERIFIED'
      AND v_evidence->'firstReplayed' = 'false'::jsonb
      AND v_evidence->>'secondStatus' = 'VERIFIED'
      AND v_evidence->'secondReplayed' = 'true'::jsonb
      AND v_evidence->>'candidateStage' = 'DEPLOYED'
      AND v_evidence->>'commandState' = 'SOURCE_CONFIRMED'
      AND (v_evidence->>'receiptCount')::integer = 1
      AND v_evidence->'externalEffectsAuthorized' = 'false'::jsonb
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion(true);
    v_evidence := pg_temp.observe_promotion_attempt(v_fixture);
    v_evidence := v_evidence || jsonb_build_object(
      'configuredHumanGuardians', (
        SELECT count(*)
          FROM public.platform_identities identity
          JOIN public.tenant_memberships membership
            ON membership.identity_id = identity.identity_id
           AND membership.tenant_id = (v_fixture->>'tenantId')::uuid
         WHERE identity.identity_type = 'USER'
           AND identity.status = 'ACTIVE'
           AND membership.status = 'ACTIVE'
           AND membership.capabilities @> '["learning.guardian"]'::jsonb
      )
    );
    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'action_change_without_guardians_blocked',
      v_evidence->>'sqlstate' = '23514'
      AND (v_evidence->>'configuredHumanGuardians')::integer = 0
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion(
      false,
      interval '1 second',
      'ACTIVE',
      'SHADOW'
    );
    v_evidence := pg_temp.observe_promotion_attempt(v_fixture);
    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'stale_expected_stage_blocked',
      v_evidence->>'sqlstate' = '23514'
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion(
      false,
      interval '6 minutes'
    );
    v_evidence := pg_temp.observe_promotion_attempt(v_fixture);
    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'expired_policy_receipt_blocked',
      v_evidence->>'sqlstate' = '42501'
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    UPDATE public.policy_definitions
       SET status = 'ARCHIVED', updated_at = clock_timestamp()
     WHERE policy_definition_id = (v_fixture->>'policyDefinitionId')::uuid;
    v_evidence := pg_temp.observe_promotion_attempt(v_fixture);
    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'archived_policy_at_commit_blocked_atomically',
      v_evidence->>'sqlstate' = '42501'
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    INSERT INTO public.p110_kill_switches (
      tenant_id,
      switch_id,
      scope_type,
      scope_ref,
      active,
      reason,
      activated_by,
      canonical_tenant_id
    )
    VALUES (
      'luzione',
      'switch:' || gen_random_uuid()::text,
      'CAPABILITY',
      'learning.candidate.promote',
      true,
      'Validation-only learning kill switch',
      'service:legacy-import',
      (v_fixture->>'tenantId')::uuid
    );
    v_evidence := pg_temp.observe_promotion_attempt(v_fixture);
    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'active_capability_kill_switch_blocked',
      v_evidence->>'sqlstate' = '55000'
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    v_evidence := pg_temp.observe_promotion_attempt(
      v_fixture,
      gen_random_uuid()
    );
    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'wrong_tenant_blocked',
      v_evidence->>'sqlstate' = 'P0002'
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    v_evidence := pg_temp.observe_promotion_attempt(
      v_fixture,
      null,
      'service:legacy-import'
    );
    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'wrong_actor_blocked',
      v_evidence->>'sqlstate' = '42501'
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion(
      false,
      interval '1 second',
      'ACTIVE',
      'CANARY',
      true
    );
    v_evidence := pg_temp.observe_promotion_attempt(v_fixture);
    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'wrong_candidate_scope_blocked',
      v_evidence->>'sqlstate' = '23514'
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_command_update_sqlstate text;
  v_command_delete_sqlstate text;
  v_policy_update_sqlstate text;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    BEGIN
      UPDATE public.p110_command_receipts
         SET expected_object_version = 'SHADOW'
       WHERE command_id = v_fixture->>'commandId';
    EXCEPTION WHEN OTHERS THEN
      v_command_update_sqlstate := SQLSTATE;
    END;
    BEGIN
      DELETE FROM public.p110_command_receipts
       WHERE command_id = v_fixture->>'commandId';
    EXCEPTION WHEN OTHERS THEN
      v_command_delete_sqlstate := SQLSTATE;
    END;
    BEGIN
      UPDATE public.policy_evaluations
         SET allowed = false
       WHERE evaluation_id = v_fixture->>'policyEvaluationId';
    EXCEPTION WHEN OTHERS THEN
      v_policy_update_sqlstate := SQLSTATE;
    END;

    SELECT jsonb_build_object(
      'commandUpdateSqlstate', v_command_update_sqlstate,
      'commandDeleteSqlstate', v_command_delete_sqlstate,
      'policyUpdateSqlstate', v_policy_update_sqlstate,
      'commandCount', (
        SELECT count(*) FROM public.p110_command_receipts
         WHERE command_id = v_fixture->>'commandId'
      ),
      'expectedObjectVersion', (
        SELECT expected_object_version FROM public.p110_command_receipts
         WHERE command_id = v_fixture->>'commandId'
      ),
      'policyAllowed', (
        SELECT allowed FROM public.policy_evaluations
         WHERE evaluation_id = v_fixture->>'policyEvaluationId'
      ),
      'receiptCount', (
        SELECT count(*) FROM public.learning_promotion_receipts
         WHERE command_id = v_fixture->>'commandId'
      )
    ) INTO v_evidence;

    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'command_and_policy_evidence_immutable',
      v_evidence->>'commandUpdateSqlstate' = '55000'
      AND v_evidence->>'commandDeleteSqlstate' = '55000'
      AND v_evidence->>'policyUpdateSqlstate' = '55000'
      AND (v_evidence->>'commandCount')::integer = 1
      AND v_evidence->>'expectedObjectVersion' = 'CANARY'
      AND (v_evidence->>'policyAllowed')::boolean
      AND (v_evidence->>'receiptCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_sqlstate text;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    BEGIN
      PERFORM pg_temp.add_competing_promotion_command(v_fixture, true);
    EXCEPTION WHEN OTHERS THEN
      v_sqlstate := SQLSTATE;
    END;

    SELECT jsonb_build_object(
      'sqlstate', v_sqlstate,
      'commandCount', (
        SELECT count(*)
          FROM public.p110_command_receipts command
         WHERE command.tenant_id = 'luzione'
           AND command.idempotency_key = v_fixture->>'idempotencyKey'
      ),
      'candidateStage', (
        SELECT stage FROM public.learning_candidate_versions
         WHERE candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
      ),
      'receiptCount', (
        SELECT count(*) FROM public.learning_promotion_receipts
         WHERE candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
      )
    ) INTO v_evidence;

    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'idempotency_collision_blocked_before_effect',
      v_evidence->>'sqlstate' = '23505'
      AND (v_evidence->>'commandCount')::integer = 1
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND (v_evidence->>'receiptCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_first jsonb;
  v_second_sqlstate text;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.add_competing_promotion_command(
      pg_temp.seed_learning_promotion()
    );
    v_first := public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      'agent:sultan-os'
    );
    BEGIN
      PERFORM public.apply_learning_command(
        (v_fixture->>'tenantId')::uuid,
        v_fixture->>'competingCommandId',
        'agent:sultan-os'
      );
    EXCEPTION WHEN OTHERS THEN
      v_second_sqlstate := SQLSTATE;
    END;

    SELECT jsonb_build_object(
      'firstStatus', v_first->>'status',
      'secondSqlstate', v_second_sqlstate,
      'candidateStage', candidate.stage,
      'firstCommandState', first_command.state,
      'secondCommandState', second_command.state,
      'receiptCount', (
        SELECT count(*) FROM public.learning_promotion_receipts receipt
         WHERE receipt.candidate_version_id = candidate.candidate_version_id
      ),
      'outboxCount', (
        SELECT count(*) FROM public.p110_outbox_messages message
         WHERE message.receipt_id IN (
           v_fixture->>'receiptId',
           v_fixture->>'competingReceiptId'
         )
      )
    )
      INTO v_evidence
      FROM public.learning_candidate_versions candidate
      JOIN public.p110_command_receipts first_command
        ON first_command.command_id = v_fixture->>'commandId'
      JOIN public.p110_command_receipts second_command
        ON second_command.command_id = v_fixture->>'competingCommandId'
     WHERE candidate.candidate_version_id = (v_fixture->>'candidateVersionId')::uuid;

    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'competing_commands_commit_exactly_one_receipt',
      v_evidence->>'firstStatus' = 'VERIFIED'
      AND v_evidence->>'secondSqlstate' = '55000'
      AND v_evidence->>'candidateStage' = 'DEPLOYED'
      AND v_evidence->>'firstCommandState' = 'SOURCE_CONFIRMED'
      AND v_evidence->>'secondCommandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 1
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_promotion jsonb;
  v_first jsonb;
  v_second jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    v_promotion := public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      'agent:sultan-os'
    );
    v_fixture := pg_temp.add_learning_rollback_command(v_fixture);
    v_first := public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'rollbackCommandId',
      'agent:sultan-os'
    );
    v_second := public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'rollbackCommandId',
      'agent:sultan-os'
    );

    SELECT jsonb_build_object(
      'promotionStatus', v_promotion->>'status',
      'rollbackStatus', v_first->>'status',
      'rollbackReplayed', v_second->'replayed',
      'candidateStage', candidate.stage,
      'promotionCommandState', promotion_command.state,
      'rollbackCommandState', rollback_command.state,
      'promotionReceiptCount', (
        SELECT count(*) FROM public.learning_promotion_receipts receipt
         WHERE receipt.candidate_version_id = candidate.candidate_version_id
      ),
      'rollbackReceiptCount', (
        SELECT count(*) FROM public.learning_rollback_receipts receipt
         WHERE receipt.candidate_version_id = candidate.candidate_version_id
      ),
      'rollbackTarget', (
        SELECT receipt.to_version FROM public.learning_rollback_receipts receipt
         WHERE receipt.command_id = v_fixture->>'rollbackCommandId'
      ),
      'externalEffectsAuthorized', v_first->'externalEffectsAuthorized',
      'outboxCount', (
        SELECT count(*) FROM public.p110_outbox_messages message
         WHERE message.receipt_id IN (
           v_fixture->>'receiptId',
           v_fixture->>'rollbackReceiptId'
         )
      )
    )
      INTO v_evidence
      FROM public.learning_candidate_versions candidate
      JOIN public.p110_command_receipts promotion_command
        ON promotion_command.command_id = v_fixture->>'commandId'
      JOIN public.p110_command_receipts rollback_command
        ON rollback_command.command_id = v_fixture->>'rollbackCommandId'
     WHERE candidate.candidate_version_id = (v_fixture->>'candidateVersionId')::uuid;

    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'exact_last_known_good_rollback_and_replay',
      v_evidence->>'promotionStatus' = 'VERIFIED'
      AND v_evidence->>'rollbackStatus' = 'VERIFIED'
      AND v_evidence->'rollbackReplayed' = 'true'::jsonb
      AND v_evidence->>'candidateStage' = 'ROLLED_BACK'
      AND v_evidence->>'promotionCommandState' = 'SOURCE_CONFIRMED'
      AND v_evidence->>'rollbackCommandState' = 'SOURCE_CONFIRMED'
      AND (v_evidence->>'promotionReceiptCount')::integer = 1
      AND (v_evidence->>'rollbackReceiptCount')::integer = 1
      AND v_evidence->>'rollbackTarget' = '6'
      AND v_evidence->'externalEffectsAuthorized' = 'false'::jsonb
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_sqlstate text;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion();
    PERFORM public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      'agent:sultan-os'
    );
    v_fixture := pg_temp.add_learning_rollback_command(v_fixture, '5');
    BEGIN
      PERFORM public.apply_learning_command(
        (v_fixture->>'tenantId')::uuid,
        v_fixture->>'rollbackCommandId',
        'agent:sultan-os'
      );
    EXCEPTION WHEN OTHERS THEN
      v_sqlstate := SQLSTATE;
    END;

    SELECT jsonb_build_object(
      'sqlstate', v_sqlstate,
      'candidateStage', candidate.stage,
      'rollbackCommandState', rollback_command.state,
      'promotionReceiptCount', (
        SELECT count(*) FROM public.learning_promotion_receipts receipt
         WHERE receipt.candidate_version_id = candidate.candidate_version_id
      ),
      'rollbackReceiptCount', (
        SELECT count(*) FROM public.learning_rollback_receipts receipt
         WHERE receipt.candidate_version_id = candidate.candidate_version_id
      ),
      'outboxCount', (
        SELECT count(*) FROM public.p110_outbox_messages message
         WHERE message.receipt_id = v_fixture->>'rollbackReceiptId'
      )
    )
      INTO v_evidence
      FROM public.learning_candidate_versions candidate
      JOIN public.p110_command_receipts rollback_command
        ON rollback_command.command_id = v_fixture->>'rollbackCommandId'
     WHERE candidate.candidate_version_id = (v_fixture->>'candidateVersionId')::uuid;

    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'wrong_rollback_target_blocked',
      v_evidence->>'sqlstate' = '23514'
      AND v_evidence->>'candidateStage' = 'DEPLOYED'
      AND v_evidence->>'rollbackCommandState' = 'VALIDATED'
      AND (v_evidence->>'promotionReceiptCount')::integer = 1
      AND (v_evidence->>'rollbackReceiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_guardian_one uuid := gen_random_uuid();
  v_guardian_two uuid := gen_random_uuid();
  v_guardian_three uuid := gen_random_uuid();
  v_decided_at timestamptz := clock_timestamp() - interval '1 second';
  v_expires_at timestamptz := clock_timestamp() + interval '5 minutes';
  v_duplicate_sqlstate text;
  v_result jsonb;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion(true);

    INSERT INTO public.auth_users (
      user_id,
      email,
      name,
      password_hash,
      role,
      tenant_id
    )
    VALUES
      (
        v_guardian_one,
        'guardian-' || v_guardian_one::text || '@validation.invalid',
        'Validation Guardian One',
        'validation-only-disabled',
        'Read Only',
        'luzione'
      ),
      (
        v_guardian_two,
        'guardian-' || v_guardian_two::text || '@validation.invalid',
        'Validation Guardian Two',
        'validation-only-disabled',
        'Read Only',
        'luzione'
      ),
      (
        v_guardian_three,
        'guardian-' || v_guardian_three::text || '@validation.invalid',
        'Validation Guardian Three',
        'validation-only-disabled',
        'Read Only',
        'luzione'
      );

    INSERT INTO public.platform_identities (
      identity_id,
      identity_type,
      auth_user_id,
      display_name,
      status
    )
    VALUES
      ('user:' || v_guardian_one::text, 'USER', v_guardian_one, 'Validation Guardian One', 'ACTIVE'),
      ('user:' || v_guardian_two::text, 'USER', v_guardian_two, 'Validation Guardian Two', 'ACTIVE'),
      ('user:' || v_guardian_three::text, 'USER', v_guardian_three, 'Validation Guardian Three', 'ACTIVE');

    INSERT INTO public.tenant_memberships (
      tenant_id,
      identity_id,
      role,
      capabilities,
      status,
      source
    )
    VALUES
      (
        (v_fixture->>'tenantId')::uuid,
        'user:' || v_guardian_one::text,
        'LEARNING_GUARDIAN',
        '["learning.guardian"]'::jsonb,
        'ACTIVE',
        'PLATFORM'
      ),
      (
        (v_fixture->>'tenantId')::uuid,
        'user:' || v_guardian_two::text,
        'LEARNING_GUARDIAN',
        '["learning.guardian"]'::jsonb,
        'ACTIVE',
        'PLATFORM'
      ),
      (
        (v_fixture->>'tenantId')::uuid,
        'user:' || v_guardian_three::text,
        'LEARNING_GUARDIAN',
        '["learning.guardian"]'::jsonb,
        'ACTIVE',
        'PLATFORM'
      );

    -- One statement models two approvers reaching the ledger together. The
    -- unique tenant/candidate/evaluation/guardian key serializes duplicates.
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
    )
    VALUES
      (
        'approval:' || gen_random_uuid()::text,
        (v_fixture->>'tenantId')::uuid,
        (v_fixture->>'candidateVersionId')::uuid,
        v_fixture->>'evaluationReceiptId',
        'user:' || v_guardian_one::text,
        'APPROVED',
        v_fixture->>'contentDigest',
        'Validation guardian one approved the exact canary evidence.',
        v_decided_at,
        v_expires_at
      ),
      (
        'approval:' || gen_random_uuid()::text,
        (v_fixture->>'tenantId')::uuid,
        (v_fixture->>'candidateVersionId')::uuid,
        v_fixture->>'evaluationReceiptId',
        'user:' || v_guardian_two::text,
        'APPROVED',
        v_fixture->>'contentDigest',
        'Validation guardian two approved the exact canary evidence.',
        v_decided_at,
        v_expires_at
      );

    BEGIN
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
      )
      VALUES (
        'approval:' || gen_random_uuid()::text,
        (v_fixture->>'tenantId')::uuid,
        (v_fixture->>'candidateVersionId')::uuid,
        v_fixture->>'evaluationReceiptId',
        'user:' || v_guardian_one::text,
        'APPROVED',
        v_fixture->>'contentDigest',
        'Conflicting duplicate guardian write.',
        v_decided_at,
        v_expires_at
      );
    EXCEPTION WHEN OTHERS THEN
      v_duplicate_sqlstate := SQLSTATE;
    END;

    v_result := public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      'agent:sultan-os'
    );

    SELECT jsonb_build_object(
      'status', v_result->>'status',
      'duplicateGuardianSqlstate', v_duplicate_sqlstate,
      'configuredGuardianCount', (
        SELECT count(*)
          FROM public.platform_identities identity
          JOIN public.tenant_memberships membership
            ON membership.identity_id = identity.identity_id
           AND membership.tenant_id = (v_fixture->>'tenantId')::uuid
         WHERE identity.identity_type = 'USER'
           AND identity.status = 'ACTIVE'
           AND membership.status = 'ACTIVE'
           AND membership.capabilities @> '["learning.guardian"]'::jsonb
      ),
      'decisionCount', (
        SELECT count(*) FROM public.learning_guardian_decisions decision
         WHERE decision.candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
      ),
      'receiptGuardianRefCount', (
        SELECT jsonb_array_length(receipt.guardian_approval_refs)
          FROM public.learning_promotion_receipts receipt
         WHERE receipt.command_id = v_fixture->>'commandId'
      ),
      'candidateStage', (
        SELECT stage FROM public.learning_candidate_versions
         WHERE candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
      ),
      'receiptCount', (
        SELECT count(*) FROM public.learning_promotion_receipts
         WHERE command_id = v_fixture->>'commandId'
      ),
      'externalEffectsAuthorized', v_result->'externalEffectsAuthorized',
      'outboxCount', (
        SELECT count(*) FROM public.p110_outbox_messages
         WHERE receipt_id = v_fixture->>'receiptId'
      )
    ) INTO v_evidence;

    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'simultaneous_two_of_three_guardian_quorum',
      v_evidence->>'status' = 'VERIFIED'
      AND v_evidence->>'duplicateGuardianSqlstate' = '23505'
      AND (v_evidence->>'configuredGuardianCount')::integer = 3
      AND (v_evidence->>'decisionCount')::integer = 2
      AND (v_evidence->>'receiptGuardianRefCount')::integer = 2
      AND v_evidence->>'candidateStage' = 'DEPLOYED'
      AND (v_evidence->>'receiptCount')::integer = 1
      AND v_evidence->'externalEffectsAuthorized' = 'false'::jsonb
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

SELECT scenario, passed, evidence
  FROM pg_temp.learning_command_probe_results
 ORDER BY scenario;
