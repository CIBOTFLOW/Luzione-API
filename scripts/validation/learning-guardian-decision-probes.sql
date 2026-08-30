-- Run in the same validation transaction/session immediately after
-- learning-command-kernel-probes.sql. That pack creates the rolled-back
-- fixture helpers and pg_temp.learning_command_probe_results used here.
-- This file never commits fixtures and creates no provider/outbox effect.

CREATE OR REPLACE FUNCTION pg_temp.seed_learning_guardians(p_tenant_id uuid)
RETURNS text[]
LANGUAGE plpgsql
AS $guardian_seed$
DECLARE
  v_one uuid := gen_random_uuid();
  v_two uuid := gen_random_uuid();
  v_three uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.auth_users (
    user_id,
    email,
    name,
    password_hash,
    role,
    tenant_id
  ) VALUES
    (
      v_one,
      'guardian-' || v_one::text || '@validation.invalid',
      'Validation Guardian One',
      'validation-only-disabled',
      'Read Only',
      'luzione'
    ),
    (
      v_two,
      'guardian-' || v_two::text || '@validation.invalid',
      'Validation Guardian Two',
      'validation-only-disabled',
      'Read Only',
      'luzione'
    ),
    (
      v_three,
      'guardian-' || v_three::text || '@validation.invalid',
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
  ) VALUES
    ('user:' || v_one::text, 'USER', v_one, 'Validation Guardian One', 'ACTIVE'),
    ('user:' || v_two::text, 'USER', v_two, 'Validation Guardian Two', 'ACTIVE'),
    ('user:' || v_three::text, 'USER', v_three, 'Validation Guardian Three', 'ACTIVE');

  INSERT INTO public.tenant_memberships (
    tenant_id,
    identity_id,
    role,
    capabilities,
    status,
    source
  ) VALUES
    (
      p_tenant_id,
      'user:' || v_one::text,
      'LEARNING_GUARDIAN',
      '["learning.guardian"]'::jsonb,
      'ACTIVE',
      'PLATFORM'
    ),
    (
      p_tenant_id,
      'user:' || v_two::text,
      'LEARNING_GUARDIAN',
      '["learning.guardian"]'::jsonb,
      'ACTIVE',
      'PLATFORM'
    ),
    (
      p_tenant_id,
      'user:' || v_three::text,
      'LEARNING_GUARDIAN',
      '["learning.guardian"]'::jsonb,
      'ACTIVE',
      'PLATFORM'
    );

  RETURN ARRAY[
    'user:' || v_one::text,
    'user:' || v_two::text,
    'user:' || v_three::text
  ];
END
$guardian_seed$;

DO $probe$
DECLARE
  v_fixture jsonb;
  v_guardians text[];
  v_first jsonb;
  v_replay jsonb;
  v_second jsonb;
  v_transition jsonb;
  v_post_transition_replay jsonb;
  v_collision_sqlstate text;
  v_mutation_sqlstate text;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion(true);
    v_guardians := pg_temp.seed_learning_guardians(
      (v_fixture->>'tenantId')::uuid
    );

    v_first := public.record_learning_guardian_decision(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      v_guardians[1],
      'APPROVE',
      'The exact canary metrics support this bounded action-policy change.'
    );
    v_replay := public.record_learning_guardian_decision(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      v_guardians[1],
      'APPROVE',
      'The exact canary metrics support this bounded action-policy change.'
    );
    BEGIN
      PERFORM public.record_learning_guardian_decision(
        (v_fixture->>'tenantId')::uuid,
        v_fixture->>'commandId',
        v_guardians[1],
        'APPROVE',
        'A changed rationale must not mutate an immutable decision.'
      );
    EXCEPTION WHEN OTHERS THEN
      v_collision_sqlstate := SQLSTATE;
    END;
    v_second := public.record_learning_guardian_decision(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      v_guardians[2],
      'APPROVE',
      'The independent evidence review supports this exact transition.'
    );

    v_transition := public.apply_learning_command(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      'agent:sultan-os'
    );
    v_post_transition_replay := public.record_learning_guardian_decision(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      v_guardians[1],
      'APPROVE',
      'The exact canary metrics support this bounded action-policy change.'
    );

    BEGIN
      UPDATE public.learning_guardian_decisions
         SET rationale = 'Mutation must fail.'
       WHERE approval_id = v_first->>'approvalId';
    EXCEPTION WHEN OTHERS THEN
      v_mutation_sqlstate := SQLSTATE;
    END;

    SELECT jsonb_build_object(
      'firstReplayed', v_first->'replayed',
      'exactReplay', v_replay->'replayed',
      'postTransitionReplay', v_post_transition_replay->'replayed',
      'sameApprovalReceipt',
        v_first->>'approvalId' = v_replay->>'approvalId'
        AND v_first->>'approvalId' = v_post_transition_replay->>'approvalId',
      'collisionSqlstate', v_collision_sqlstate,
      'mutationSqlstate', v_mutation_sqlstate,
      'decisionCount', (
        SELECT count(*)
          FROM public.learning_guardian_decisions decision
         WHERE decision.candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
      ),
      'receiptGuardianRefCount', (
        SELECT jsonb_array_length(receipt.guardian_approval_refs)
          FROM public.learning_promotion_receipts receipt
         WHERE receipt.command_id = v_fixture->>'commandId'
      ),
      'transitionStatus', v_transition->>'status',
      'candidateStage', (
        SELECT stage
          FROM public.learning_candidate_versions
         WHERE candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
      ),
      'receiptCount', (
        SELECT count(*)
          FROM public.learning_promotion_receipts receipt
         WHERE receipt.command_id = v_fixture->>'commandId'
      ),
      'serviceCanInsertTable', has_table_privilege(
        'service_role',
        'public.learning_guardian_decisions',
        'INSERT'
      ),
      'serviceCanExecuteRpc', has_function_privilege(
        'service_role',
        'public.record_learning_guardian_decision(uuid,text,text,text,text)',
        'EXECUTE'
      ),
      'externalEffectsAuthorized', v_transition->'externalEffectsAuthorized',
      'outboxCount', (
        SELECT count(*)
          FROM public.p110_outbox_messages message
         WHERE message.receipt_id = v_fixture->>'receiptId'
      )
    ) INTO v_evidence;

    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'guardian_rpc_exact_replay_and_promotion',
      v_evidence->'firstReplayed' = 'false'::jsonb
      AND v_evidence->'exactReplay' = 'true'::jsonb
      AND v_evidence->'postTransitionReplay' = 'true'::jsonb
      AND v_evidence->'sameApprovalReceipt' = 'true'::jsonb
      AND v_evidence->>'collisionSqlstate' = '23505'
      AND v_evidence->>'mutationSqlstate' = '55000'
      AND (v_evidence->>'decisionCount')::integer = 2
      AND (v_evidence->>'receiptGuardianRefCount')::integer = 2
      AND v_evidence->>'transitionStatus' = 'VERIFIED'
      AND v_evidence->>'candidateStage' = 'DEPLOYED'
      AND (v_evidence->>'receiptCount')::integer = 1
      AND v_evidence->'serviceCanInsertTable' = 'false'::jsonb
      AND v_evidence->'serviceCanExecuteRpc' = 'true'::jsonb
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
  v_guardians text[];
  v_transition_sqlstate text;
  v_evidence jsonb;
BEGIN
  BEGIN
    v_fixture := pg_temp.seed_learning_promotion(true);
    v_guardians := pg_temp.seed_learning_guardians(
      (v_fixture->>'tenantId')::uuid
    );

    PERFORM public.record_learning_guardian_decision(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      v_guardians[1],
      'DENY',
      'The evidence does not justify widening action eligibility.'
    );
    PERFORM public.record_learning_guardian_decision(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      v_guardians[2],
      'APPROVE',
      'The independent evidence supports the bounded change.'
    );
    PERFORM public.record_learning_guardian_decision(
      (v_fixture->>'tenantId')::uuid,
      v_fixture->>'commandId',
      v_guardians[3],
      'APPROVE',
      'The second independent review supports the bounded change.'
    );

    BEGIN
      PERFORM public.apply_learning_command(
        (v_fixture->>'tenantId')::uuid,
        v_fixture->>'commandId',
        'agent:sultan-os'
      );
    EXCEPTION WHEN OTHERS THEN
      v_transition_sqlstate := SQLSTATE;
    END;

    SELECT jsonb_build_object(
      'transitionSqlstate', v_transition_sqlstate,
      'decisionCount', (
        SELECT count(*)
          FROM public.learning_guardian_decisions decision
         WHERE decision.candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
      ),
      'rejectionCount', (
        SELECT count(*)
          FROM public.learning_guardian_decisions decision
         WHERE decision.candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
           AND decision.decision = 'REJECTED'
      ),
      'candidateStage', (
        SELECT stage
          FROM public.learning_candidate_versions
         WHERE candidate_version_id = (v_fixture->>'candidateVersionId')::uuid
      ),
      'commandState', (
        SELECT state
          FROM public.p110_command_receipts command
         WHERE command.command_id = v_fixture->>'commandId'
      ),
      'receiptCount', (
        SELECT count(*)
          FROM public.learning_promotion_receipts receipt
         WHERE receipt.command_id = v_fixture->>'commandId'
      ),
      'outboxCount', (
        SELECT count(*)
          FROM public.p110_outbox_messages message
         WHERE message.receipt_id = v_fixture->>'receiptId'
      )
    ) INTO v_evidence;

    RAISE EXCEPTION USING ERRCODE = 'P7777', MESSAGE = 'Rollback validation fixture';
  EXCEPTION WHEN SQLSTATE 'P7777' THEN
    INSERT INTO pg_temp.learning_command_probe_results
    VALUES (
      'guardian_rpc_rejection_overrides_two_approvals',
      v_evidence->>'transitionSqlstate' = '23514'
      AND (v_evidence->>'decisionCount')::integer = 3
      AND (v_evidence->>'rejectionCount')::integer = 1
      AND v_evidence->>'candidateStage' = 'CANARY'
      AND v_evidence->>'commandState' = 'VALIDATED'
      AND (v_evidence->>'receiptCount')::integer = 0
      AND (v_evidence->>'outboxCount')::integer = 0,
      v_evidence
    );
  END;
END
$probe$;

SELECT scenario, passed, evidence
  FROM pg_temp.learning_command_probe_results
 WHERE scenario LIKE 'guardian_rpc_%'
 ORDER BY scenario;
