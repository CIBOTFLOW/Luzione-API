BEGIN;

CREATE TABLE public.learning_guardian_decisions (
  approval_id text PRIMARY KEY
    CHECK (approval_id ~ '^approval:[A-Za-z0-9][A-Za-z0-9._:-]{7,190}$'),
  tenant_id uuid NOT NULL REFERENCES public.tenant_accounts(tenant_id) ON DELETE CASCADE,
  candidate_version_id uuid NOT NULL,
  evaluation_receipt_id text NOT NULL,
  guardian_identity_id text NOT NULL
    REFERENCES public.platform_identities(identity_id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  decided_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    tenant_id,
    candidate_version_id,
    evaluation_receipt_id,
    guardian_identity_id
  ),
  FOREIGN KEY (tenant_id, candidate_version_id)
    REFERENCES public.learning_candidate_versions(tenant_id, candidate_version_id),
  FOREIGN KEY (tenant_id, evaluation_receipt_id, candidate_version_id)
    REFERENCES public.learning_evaluation_receipts(
      tenant_id,
      receipt_id,
      candidate_version_id
    ),
  CHECK (expires_at > decided_at)
);

CREATE INDEX learning_guardian_decisions_current_idx
  ON public.learning_guardian_decisions (
    tenant_id,
    candidate_version_id,
    evaluation_receipt_id,
    expires_at
  );

CREATE OR REPLACE FUNCTION public.prevent_learning_guardian_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Learning guardian decisions are immutable; review a new candidate version.';
END
$$;

CREATE OR REPLACE FUNCTION public.validate_learning_guardian_decision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate record;
  evaluation record;
BEGIN
  SELECT tenant_id, stage, proposed_by_actor_id
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
     OR candidate.stage IS DISTINCT FROM 'CANARY'
     OR evaluation.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR evaluation.candidate_version_id IS DISTINCT FROM NEW.candidate_version_id
     OR evaluation.decision IS DISTINCT FROM 'PROMOTION_ELIGIBLE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Guardian review requires the same-tenant CANARY candidate and exact promotion evaluation.';
  END IF;

  IF NEW.decided_at > now()
     OR NEW.expires_at <= now()
     OR NEW.guardian_identity_id = candidate.proposed_by_actor_id
     OR NEW.guardian_identity_id = evaluation.evaluator_actor_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Guardian review must be current and recused from proposal and evaluation.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.platform_identities identity
      JOIN public.tenant_memberships membership
        ON membership.identity_id = identity.identity_id
       AND membership.tenant_id = NEW.tenant_id
     WHERE identity.identity_id = NEW.guardian_identity_id
       AND identity.identity_type = 'USER'
       AND identity.status = 'ACTIVE'
       AND membership.status = 'ACTIVE'
       AND membership.capabilities @> '["learning.guardian"]'::jsonb
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Guardian review requires an active canonical human guardian membership.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER learning_guardian_decisions_validate
BEFORE INSERT ON public.learning_guardian_decisions
FOR EACH ROW EXECUTE FUNCTION public.validate_learning_guardian_decision();

CREATE TRIGGER learning_guardian_decisions_immutable
BEFORE UPDATE OR DELETE ON public.learning_guardian_decisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_learning_guardian_decision_mutation();

CREATE OR REPLACE FUNCTION luzione_api_private.learning_command_content_digest(
  p_tenant_id uuid,
  p_command_type text,
  p_candidate_version_id uuid,
  p_evaluation_receipt_id text,
  p_expected_stage text,
  p_target_stage text,
  p_target_version text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, extensions
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        concat_ws(
          '|',
          'learning-command/v1',
          p_tenant_id::text,
          p_command_type,
          p_candidate_version_id::text,
          p_evaluation_receipt_id,
          p_expected_stage,
          p_target_stage,
          p_target_version
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION public.validate_canonical_learning_guardian_refs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  candidate record;
  configured_guardian_count integer;
  referenced_guardian_count integer;
  expected_quorum_id text;
BEGIN
  SELECT changes_action_eligibility
    INTO candidate
    FROM public.learning_candidate_versions
   WHERE tenant_id = NEW.tenant_id
     AND candidate_version_id = NEW.candidate_version_id;

  IF candidate.changes_action_eligibility THEN
    SELECT count(*)
      INTO configured_guardian_count
      FROM public.platform_identities identity
      JOIN public.tenant_memberships membership
        ON membership.identity_id = identity.identity_id
       AND membership.tenant_id = NEW.tenant_id
     WHERE identity.identity_type = 'USER'
       AND identity.status = 'ACTIVE'
       AND membership.status = 'ACTIVE'
       AND membership.capabilities @> '["learning.guardian"]'::jsonb;

    IF configured_guardian_count IS DISTINCT FROM 3 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Action-eligibility learning requires exactly three configured canonical guardians.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.learning_guardian_decisions rejection
       WHERE rejection.tenant_id = NEW.tenant_id
         AND rejection.candidate_version_id = NEW.candidate_version_id
         AND rejection.evaluation_receipt_id = NEW.evaluation_receipt_id
         AND rejection.content_digest = NEW.source_readback->>'contentDigest'
         AND rejection.decision = 'REJECTED'
         AND rejection.expires_at > NEW.promoted_at
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'A current canonical guardian rejected this candidate version.';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(NEW.guardian_approval_refs) approval(value)
       WHERE NOT EXISTS (
         SELECT 1
           FROM public.learning_guardian_decisions decision
           JOIN public.platform_identities identity
             ON identity.identity_id = decision.guardian_identity_id
           JOIN public.tenant_memberships membership
             ON membership.identity_id = identity.identity_id
            AND membership.tenant_id = decision.tenant_id
          WHERE decision.approval_id = approval.value->>'approvalId'
            AND decision.tenant_id = NEW.tenant_id
            AND decision.candidate_version_id = NEW.candidate_version_id
            AND decision.evaluation_receipt_id = NEW.evaluation_receipt_id
            AND decision.guardian_identity_id = approval.value->>'guardianId'
            AND decision.decision = 'APPROVED'
            AND decision.content_digest = approval.value->>'contentDigest'
            AND decision.content_digest = NEW.source_readback->>'contentDigest'
            AND decision.decided_at::text = approval.value->>'decidedAt'
            AND decision.expires_at::text = approval.value->>'expiresAt'
            AND decision.decided_at <= NEW.promoted_at
            AND decision.expires_at > NEW.promoted_at
            AND identity.identity_type = 'USER'
            AND identity.status = 'ACTIVE'
            AND membership.status = 'ACTIVE'
            AND membership.capabilities @> '["learning.guardian"]'::jsonb
       )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Promotion guardian references must resolve to exact canonical decisions.';
    END IF;

    SELECT count(*)
      INTO referenced_guardian_count
      FROM jsonb_array_elements(NEW.guardian_approval_refs);
    IF referenced_guardian_count NOT BETWEEN 2 AND 3 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Action-eligibility promotion requires a canonical 2-of-3 quorum.';
    END IF;

    SELECT 'learning_quorum_' || left(
      encode(
        extensions.digest(
          convert_to(
            string_agg(approval.value->>'approvalId', '|' ORDER BY approval.value->>'approvalId'),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      24
    )
      INTO expected_quorum_id
      FROM jsonb_array_elements(NEW.guardian_approval_refs) approval(value);
    IF NEW.canonical_approval_id IS DISTINCT FROM expected_quorum_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Canonical learning quorum id does not match the exact guardian decisions.';
    END IF;
  ELSIF NEW.guardian_approval_refs IS DISTINCT FROM '[]'::jsonb
     OR NEW.canonical_approval_id IS DISTINCT FROM (
       'learning_quorum_' || left(NEW.source_readback->>'contentDigest', 24)
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Non-action learning promotion must use the deterministic transition quorum and no guardian decisions.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER learning_promotion_canonical_guardians
BEFORE INSERT ON public.learning_promotion_receipts
FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_learning_guardian_refs();

INSERT INTO public.integration_capability_registry (
  provider,
  capability,
  authority_contract_version,
  authority_class,
  operation_kind,
  provider_effect,
  ai_allowed,
  approval_required,
  compensation_required,
  adapter_version,
  enabled,
  description
)
VALUES
  (
    'luzione.learning',
    'learning.candidate.promote',
    'luzione-authority/v2',
    'A2',
    'INTERNAL',
    false,
    false,
    false,
    true,
    'learning-command-kernel/v1',
    true,
    'Promote one exact evaluated candidate version with atomic source readback.'
  ),
  (
    'luzione.learning',
    'learning.candidate.rollback',
    'luzione-authority/v2',
    'A2',
    'INTERNAL',
    false,
    false,
    false,
    true,
    'learning-command-kernel/v1',
    true,
    'Roll back one exact deployed candidate to its verified last-known-good version.'
  )
ON CONFLICT (provider, capability) DO UPDATE
SET authority_contract_version = EXCLUDED.authority_contract_version,
    authority_class = EXCLUDED.authority_class,
    operation_kind = EXCLUDED.operation_kind,
    provider_effect = EXCLUDED.provider_effect,
    ai_allowed = EXCLUDED.ai_allowed,
    approval_required = EXCLUDED.approval_required,
    compensation_required = EXCLUDED.compensation_required,
    adapter_version = EXCLUDED.adapter_version,
    enabled = integration_capability_registry.enabled,
    description = EXCLUDED.description,
    updated_at = now();

UPDATE public.tenant_memberships membership
   SET capabilities = membership.capabilities || '["learning.commands.execute"]'::jsonb,
       updated_at = now()
  FROM public.platform_identities identity,
       public.tenant_accounts tenant
 WHERE membership.identity_id = identity.identity_id
   AND membership.tenant_id = tenant.tenant_id
   AND identity.identity_id = 'agent:sultan-os'
   AND identity.identity_type = 'AGENT'
   AND identity.status = 'ACTIVE'
   AND membership.status = 'ACTIVE'
   AND tenant.status = 'ACTIVE'
   AND tenant.code = 'LUZIONE_INTERNAL'
   AND NOT membership.capabilities @> '["learning.commands.execute"]'::jsonb;

CREATE OR REPLACE FUNCTION public.apply_learning_command(
  p_tenant_id uuid,
  p_command_id text,
  p_actor_identity_id text
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
  v_candidate_version_id uuid;
  v_evaluation_receipt_id text;
  expected_stage text;
  target_stage text;
  target_version text;
  expected_digest text;
  v_transition_receipt_id text;
  canonical_approval_id text;
  guardian_refs jsonb := '[]'::jsonb;
  configured_guardian_count integer;
  approved_guardian_count integer;
  committed_stage text;
  committed_version integer;
  source_readback jsonb;
  existing_receipt_count integer;
  replayed boolean := false;
  executed_at timestamptz := clock_timestamp();
BEGIN
  IF p_tenant_id IS NULL
     OR p_command_id IS NULL
     OR p_actor_identity_id IS NULL
     OR p_command_id !~ '^cmd:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'A canonical tenant, command id, and actor identity are required.';
  END IF;

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

  IF command_row.actor_id IS DISTINCT FROM p_actor_identity_id
     OR p_actor_identity_id !~ '^(user|service|agent):[A-Za-z0-9._:@-]{1,190}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public.platform_identities identity
         JOIN public.tenant_memberships membership
           ON membership.identity_id = identity.identity_id
          AND membership.tenant_id = p_tenant_id
         JOIN public.tenant_accounts tenant
           ON tenant.tenant_id = membership.tenant_id
        WHERE identity.identity_id = p_actor_identity_id
          AND lower(identity.identity_type) = command_row.actor_type
          AND identity.status = 'ACTIVE'
          AND membership.status = 'ACTIVE'
          AND membership.capabilities @> '["learning.commands.execute"]'::jsonb
          AND tenant.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Learning execution requires the same active canonical actor and membership capability.';
  END IF;

  IF command_row.command_type NOT IN (
       'learning.candidate.promote',
       'learning.candidate.rollback'
     )
     OR command_row.authority_contract_version IS DISTINCT FROM 'luzione-authority/v2'
     OR command_row.authority_class IS DISTINCT FROM 'A2'
     OR command_row.capability IS DISTINCT FROM command_row.command_type
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
      MESSAGE = 'Learning command is not an exact allowed reversible A2 internal change.';
  END IF;

  v_candidate_version_id := command_row.target_object_id::uuid;
  v_evaluation_receipt_id := command_row.metadata->'payload'->>'evaluationReceiptId';
  IF v_evaluation_receipt_id IS NULL
     OR v_evaluation_receipt_id !~ '^learning_evaluation_[a-f0-9]{24}$'
     OR command_row.metadata->'payload'->>'candidateVersionId'
          IS DISTINCT FROM v_candidate_version_id::text THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Learning command payload does not bind an exact candidate and evaluation.';
  END IF;

  IF command_row.resource_scope IS DISTINCT FROM jsonb_build_array(
       'learning_candidate:' || v_candidate_version_id::text
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Learning command scope does not bind the exact candidate version.';
  END IF;

  SELECT tenant_id, candidate_version_id, candidate_id, version, kind, stage,
         changes_action_eligibility, proposed_by_actor_id, last_known_good_version
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
         evaluation_row.reason_codes,
         evaluation_row.evaluator_actor_id,
         evaluation_row.rollback_target_version
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

  IF command_row.command_type = 'learning.candidate.promote' THEN
    expected_stage := 'CANARY';
    target_stage := 'DEPLOYED';
    target_version := candidate.version::text;
    IF evaluation.decision IS DISTINCT FROM 'PROMOTION_ELIGIBLE' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Promotion requires the exact PROMOTION_ELIGIBLE evaluation.';
    END IF;
  ELSE
    expected_stage := 'DEPLOYED';
    target_stage := 'ROLLED_BACK';
    target_version := evaluation.rollback_target_version;
    IF evaluation.decision IS DISTINCT FROM 'ROLLBACK_REQUIRED'
       OR evaluation.rollback_target_version IS DISTINCT FROM candidate.last_known_good_version
       OR candidate.last_known_good_version IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Rollback requires the exact verified last-known-good evaluation target.';
    END IF;
  END IF;

  IF command_row.expected_object_version IS DISTINCT FROM expected_stage
     OR command_row.metadata->'payload'->>'expectedStage' IS DISTINCT FROM expected_stage
     OR command_row.metadata->'payload'->>'targetStage' IS DISTINCT FROM target_stage
     OR command_row.metadata->'payload'->>'targetVersion' IS DISTINCT FROM target_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Learning command carries a stale or mismatched object version.';
  END IF;

  expected_digest := luzione_api_private.learning_command_content_digest(
    p_tenant_id,
    command_row.command_type,
    candidate.candidate_version_id,
    evaluation.receipt_id,
    expected_stage,
    target_stage,
    target_version
  );
  IF command_row.metadata->'action'->>'contentDigest' IS DISTINCT FROM expected_digest THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Learning command content digest does not bind the exact transition.';
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
      MESSAGE = 'Learning command capability is disabled or no longer registered.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.policy_evaluations policy
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
       AND policy.policy_definition_id IS NOT NULL
       AND policy.created_at <= command_row.requested_at
       AND policy.created_at >= command_row.requested_at - interval '5 minutes'
       AND policy.allowed
       AND NOT policy.hard_blocked
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Learning command policy is missing, blocked, or no longer affirmative.';
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
         OR (
           kill.scope_type = 'PROVIDER'
           AND kill.scope_ref = 'luzione.learning'
         )
         OR (
           kill.scope_type = 'CAPABILITY'
           AND kill.scope_ref = command_row.capability
         )
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning command is blocked by an active kill switch.';
  END IF;

  IF command_row.state = 'SOURCE_CONFIRMED' THEN
    IF candidate.stage IS DISTINCT FROM target_stage THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Replayed learning command no longer matches authoritative candidate state.';
    END IF;
    IF command_row.command_type = 'learning.candidate.promote' THEN
      SELECT count(*)
        INTO existing_receipt_count
        FROM public.learning_promotion_receipts receipt
       WHERE receipt.tenant_id = p_tenant_id
         AND receipt.candidate_version_id = candidate.candidate_version_id
         AND receipt.evaluation_receipt_id = evaluation.receipt_id
         AND receipt.command_id = command_row.command_id
         AND receipt.source_readback->>'contentDigest' = expected_digest;
    ELSE
      SELECT count(*)
        INTO existing_receipt_count
        FROM public.learning_rollback_receipts receipt
       WHERE receipt.tenant_id = p_tenant_id
         AND receipt.candidate_version_id = candidate.candidate_version_id
         AND receipt.evaluation_receipt_id = evaluation.receipt_id
         AND receipt.command_id = command_row.command_id
         AND receipt.to_version = target_version
         AND receipt.source_readback->>'contentDigest' = expected_digest;
    END IF;
    IF existing_receipt_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Replayed learning command lacks exactly one authoritative receipt.';
    END IF;
    replayed := true;
    RETURN jsonb_build_object(
      'candidateVersionId', candidate.candidate_version_id,
      'commandId', command_row.command_id,
      'committedStage', candidate.stage,
      'committedVersion', candidate.version,
      'evaluationReceiptId', evaluation.receipt_id,
      'externalEffectsAuthorized', false,
      'replayed', replayed,
      'sourceReadbackRef', command_row.source_readback_ref,
      'status', 'VERIFIED'
    );
  END IF;

  IF command_row.state IS DISTINCT FROM 'VALIDATED' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning command state is not eligible for atomic execution.';
  END IF;
  IF candidate.stage IS DISTINCT FROM expected_stage THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning candidate stage changed after command admission.';
  END IF;

  source_readback := jsonb_build_object(
    'candidateVersionId', candidate.candidate_version_id,
    'commandId', command_row.command_id,
    'committedStage', target_stage,
    'contentDigest', expected_digest,
    'evaluationReceiptId', evaluation.receipt_id,
    'externalEffectsAuthorized', false,
    'status', 'VERIFIED',
    'targetVersion', target_version
  );

  IF command_row.command_type = 'learning.candidate.promote' THEN
    IF candidate.changes_action_eligibility THEN
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
          ERRCODE = '23514',
          MESSAGE = 'Action-eligibility learning requires exactly three configured canonical guardians.';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM public.learning_guardian_decisions decision
         WHERE decision.tenant_id = p_tenant_id
           AND decision.candidate_version_id = candidate.candidate_version_id
           AND decision.evaluation_receipt_id = evaluation.receipt_id
           AND decision.content_digest = expected_digest
           AND decision.decision = 'REJECTED'
           AND decision.expires_at > executed_at
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'A current canonical guardian rejected this candidate version.';
      END IF;

      SELECT count(*),
             coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'approvalId', decision.approval_id,
                   'contentDigest', decision.content_digest,
                   'decidedAt', decision.decided_at::text,
                   'decision', decision.decision,
                   'expiresAt', decision.expires_at::text,
                   'guardianId', decision.guardian_identity_id
                 )
                 ORDER BY decision.approval_id
               ),
               '[]'::jsonb
             )
        INTO approved_guardian_count, guardian_refs
        FROM public.learning_guardian_decisions decision
        JOIN public.platform_identities identity
          ON identity.identity_id = decision.guardian_identity_id
        JOIN public.tenant_memberships membership
          ON membership.identity_id = identity.identity_id
         AND membership.tenant_id = decision.tenant_id
       WHERE decision.tenant_id = p_tenant_id
         AND decision.candidate_version_id = candidate.candidate_version_id
         AND decision.evaluation_receipt_id = evaluation.receipt_id
         AND decision.content_digest = expected_digest
         AND decision.decision = 'APPROVED'
         AND decision.decided_at <= executed_at
         AND decision.expires_at > executed_at
         AND identity.identity_type = 'USER'
         AND identity.status = 'ACTIVE'
         AND membership.status = 'ACTIVE'
         AND membership.capabilities @> '["learning.guardian"]'::jsonb;
      IF approved_guardian_count NOT BETWEEN 2 AND 3 THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'Action-eligibility promotion requires two current canonical guardian approvals.';
      END IF;

      SELECT 'learning_quorum_' || left(
        encode(
          extensions.digest(
            convert_to(
              string_agg(
                approval.value->>'approvalId',
                '|'
                ORDER BY approval.value->>'approvalId'
              ),
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ),
        24
      )
        INTO canonical_approval_id
        FROM jsonb_array_elements(guardian_refs) approval(value);
    ELSE
      canonical_approval_id := 'learning_quorum_' || left(expected_digest, 24);
    END IF;

    v_transition_receipt_id := 'learning_promotion_' || left(
      encode(
        extensions.digest(
          convert_to(
            concat_ws(
              '|',
              p_tenant_id::text,
              candidate.candidate_version_id::text,
              evaluation.receipt_id,
              command_row.command_id,
              expected_digest
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      24
    );

    INSERT INTO public.learning_promotion_receipts (
      promotion_receipt_id,
      tenant_id,
      candidate_version_id,
      evaluation_receipt_id,
      canonical_approval_id,
      guardian_approval_refs,
      promoted_by_actor_id,
      command_id,
      idempotency_key,
      source_readback,
      external_effects_authorized,
      promoted_at
    )
    VALUES (
      v_transition_receipt_id,
      p_tenant_id,
      candidate.candidate_version_id,
      evaluation.receipt_id,
      canonical_approval_id,
      guardian_refs,
      command_row.actor_id,
      command_row.command_id,
      command_row.idempotency_key,
      source_readback,
      false,
      executed_at
    );
  ELSE
    v_transition_receipt_id := 'learning_rollback_' || left(
      encode(
        extensions.digest(
          convert_to(
            concat_ws(
              '|',
              p_tenant_id::text,
              candidate.candidate_version_id::text,
              evaluation.receipt_id,
              command_row.command_id,
              target_version,
              expected_digest
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      24
    );

    INSERT INTO public.learning_rollback_receipts (
      rollback_receipt_id,
      tenant_id,
      candidate_version_id,
      evaluation_receipt_id,
      from_version,
      to_version,
      trigger_reason_codes,
      command_id,
      idempotency_key,
      executed_by_actor_id,
      source_readback,
      external_effects_authorized,
      rolled_back_at
    )
    VALUES (
      v_transition_receipt_id,
      p_tenant_id,
      candidate.candidate_version_id,
      evaluation.receipt_id,
      candidate.version::text,
      target_version,
      evaluation.reason_codes,
      command_row.command_id,
      command_row.idempotency_key,
      command_row.actor_id,
      source_readback,
      false,
      executed_at
    );
  END IF;

  UPDATE public.learning_candidate_versions
     SET stage = target_stage
   WHERE tenant_id = p_tenant_id
     AND candidate_version_id = candidate.candidate_version_id;

  SELECT stage, version
    INTO committed_stage, committed_version
    FROM public.learning_candidate_versions
   WHERE tenant_id = p_tenant_id
     AND candidate_version_id = candidate.candidate_version_id;
  IF committed_stage IS DISTINCT FROM target_stage
     OR committed_version IS DISTINCT FROM candidate.version THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Authoritative learning source readback did not match the exact transition.';
  END IF;

  UPDATE public.p110_command_receipts
     SET state = 'SOURCE_CONFIRMED',
         committed_object_version = committed_version::text || ':' || committed_stage,
         committed_at = executed_at,
         source_confirmed_at = executed_at,
         source_readback_ref = (
           'learning_candidate_versions:'
           || candidate.candidate_version_id::text
           || ':'
           || committed_stage
         ),
         metadata = jsonb_set(
           metadata,
           '{learningCommandReadback}',
           source_readback,
           true
         ),
         updated_at = executed_at
   WHERE canonical_tenant_id = p_tenant_id
     AND command_id = command_row.command_id;

  RETURN jsonb_build_object(
    'candidateVersionId', candidate.candidate_version_id,
    'commandId', command_row.command_id,
    'committedStage', committed_stage,
    'committedVersion', committed_version,
    'evaluationReceiptId', evaluation.receipt_id,
    'externalEffectsAuthorized', false,
    'receiptId', v_transition_receipt_id,
    'replayed', replayed,
    'sourceReadbackRef', (
      'learning_candidate_versions:'
      || candidate.candidate_version_id::text
      || ':'
      || committed_stage
    ),
    'status', 'VERIFIED'
  );
END
$$;

ALTER TABLE public.learning_guardian_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_guardian_decisions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.learning_guardian_decisions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_learning_guardian_decision_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_learning_guardian_decision()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_canonical_learning_guardian_refs()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_learning_command(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION luzione_api_private.learning_command_content_digest(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE public.learning_guardian_decisions TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_learning_command(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION luzione_api_private.learning_command_content_digest(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  text
) TO service_role;

COMMENT ON TABLE public.learning_guardian_decisions IS
  'Immutable canonical human guardian decisions for one exact learning candidate, evaluation, and content digest.';
COMMENT ON FUNCTION public.apply_learning_command(uuid, text, text) IS
  'Atomic internal A2 promotion or rollback: rechecks policy and kill switches, reads canonical guardians, writes one receipt, updates one exact candidate, verifies source readback, and creates no external effect.';

COMMIT;
