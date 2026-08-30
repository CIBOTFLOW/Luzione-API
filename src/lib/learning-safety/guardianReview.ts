import "server-only";

import type { CanonicalActor } from "@/lib/control-plane/actor";
import { ControlPlaneStoreError } from "@/lib/control-plane/store";
import { databasePool } from "@/lib/db";

export type LearningGuardianDecisionInput = {
  decision: "APPROVE" | "DENY";
  rationale: string;
};

function assertCommandId(commandId: string) {
  if (!/^cmd:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
    throw new Error("A canonical learning command id is required.");
  }
}

function postgresCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export async function getLearningGuardianReview(
  actor: CanonicalActor,
  commandId: string,
) {
  assertCommandId(commandId);
  const result = await databasePool().query<{ review: Record<string, unknown> }>(
    `with exact_review as (
       select
         command.command_id,
         command.state as command_state,
         command.policy_decision_id,
         command.requested_at,
         command.metadata->'action'->>'contentDigest' as content_digest,
         candidate.candidate_version_id,
         candidate.candidate_id,
         candidate.version,
         candidate.kind,
         candidate.stage,
         candidate.changes_action_eligibility,
         candidate.proposed_by_actor_id,
         candidate.candidate_payload,
         candidate.evidence_refs,
         candidate.feedback_refs,
         candidate.payload_checksum,
         evaluation.receipt_id as evaluation_receipt_id,
         evaluation.decision as evaluation_decision,
         evaluation.reason_codes,
         evaluation.metrics_snapshot,
         evaluation.evaluation_contract_version,
         evaluation.evaluator_actor_id,
         evaluation.next_safe_action,
         exists (
           select 1
             from public.integration_capability_registry capability
            where capability.provider = 'luzione.learning'
              and capability.capability = command.capability
              and capability.authority_contract_version = 'luzione-authority/v2'
              and capability.authority_class = 'A2'
              and capability.operation_kind = 'INTERNAL'
              and not capability.provider_effect
              and capability.enabled
         ) as capability_active,
         exists (
           select 1
             from public.p110_kill_switches kill
            where kill.active
              and (
                kill.canonical_tenant_id = command.canonical_tenant_id
                or (
                  kill.canonical_tenant_id is null
                  and kill.tenant_id = command.tenant_id
                )
              )
              and (
                kill.scope_type = 'GLOBAL'
                or (kill.scope_type = 'PROVIDER' and kill.scope_ref = 'luzione.learning')
                or (kill.scope_type = 'CAPABILITY' and kill.scope_ref = command.capability)
              )
         ) as kill_switch_active,
         exists (
           select 1
             from public.policy_evaluations policy
             join public.policy_definitions definition
               on definition.policy_definition_id = policy.policy_definition_id
              and definition.tenant_id = command.canonical_tenant_id
              and definition.status = 'ACTIVE'
            where policy.evaluation_id = command.policy_decision_id
              and policy.tenant_id = command.canonical_tenant_id
              and policy.authority_contract_version = 'luzione-authority/v2'
              and policy.authority_class = 'A2'
              and policy.capability = command.capability
              and policy.correlation_id = command.correlation_id
              and policy.actor_ref = command.actor_id
              and policy.domain = 'learning'
              and policy.action = command.command_type
              and policy.resource_scope = command.resource_scope
              and policy.payload_hash = command.metadata->'action'->>'contentDigest'
              and policy.created_at <= command.requested_at
              and policy.created_at >= command.requested_at - interval '5 minutes'
              and policy.allowed
              and not policy.hard_blocked
         ) as active_policy
       from public.p110_command_receipts command
       join public.learning_candidate_versions candidate
         on candidate.tenant_id = command.canonical_tenant_id
        and candidate.candidate_version_id::text = command.target_object_id
       join public.learning_evaluation_receipts evaluation
         on evaluation.tenant_id = candidate.tenant_id
        and evaluation.candidate_version_id = candidate.candidate_version_id
        and evaluation.receipt_id = command.metadata->'payload'->>'evaluationReceiptId'
      where command.canonical_tenant_id = $1
        and command.command_id = $2
        and command.command_type = 'learning.candidate.promote'
        and command.authority_contract_version = 'luzione-authority/v2'
        and command.authority_class = 'A2'
        and command.capability = 'learning.candidate.promote'
        and command.target_owner_project = 'CIBOTFLOW/Luzione-API'
        and command.target_object_type = 'learning_candidate_version'
        and command.expected_object_version = 'CANARY'
        and command.metadata->'authorityDecision'->'allowed' = 'true'::jsonb
        and command.metadata->'authorityDecision'->'externalEffectAuthorized' = 'false'::jsonb
        and command.metadata->'action'->>'provider' = 'luzione.learning'
        and command.metadata->'action'->'readbackPlanned' = 'true'::jsonb
        and command.compensation_plan_ref is not null
        and command.metadata->'payload'->>'candidateVersionId' = candidate.candidate_version_id::text
        and command.metadata->'payload'->>'expectedStage' = 'CANARY'
        and command.metadata->'payload'->>'targetStage' = 'DEPLOYED'
        and command.metadata->'payload'->>'targetVersion' = candidate.version::text
        and command.metadata->'action'->>'contentDigest' =
          luzione_api_private.learning_command_content_digest(
            command.canonical_tenant_id,
            command.command_type,
            candidate.candidate_version_id,
            evaluation.receipt_id,
            'CANARY',
            'DEPLOYED',
            candidate.version::text
          )
        and candidate.changes_action_eligibility
        and evaluation.decision = 'PROMOTION_ELIGIBLE'
        and command.resource_scope = jsonb_build_array(
          'learning_candidate:' || candidate.candidate_version_id::text
        )
     ), guardian_state as (
       select
         review.*,
         (
           select count(*)
             from public.platform_identities identity
             join public.tenant_memberships membership
               on membership.identity_id = identity.identity_id
              and membership.tenant_id = $1
            where identity.identity_type = 'USER'
              and identity.status = 'ACTIVE'
              and membership.status = 'ACTIVE'
              and membership.capabilities @> '["learning.guardian"]'::jsonb
         ) as configured_guardian_count,
         coalesce((
           select jsonb_agg(
             jsonb_build_object(
               'approvalId', decision.approval_id,
               'guardianIdentityId', decision.guardian_identity_id,
               'guardianDisplayName', identity.display_name,
               'decision', decision.decision,
               'rationale', decision.rationale,
               'decidedAt', decision.decided_at,
               'expiresAt', decision.expires_at,
               'current', decision.expires_at > now()
             ) order by decision.decided_at, decision.approval_id
           )
             from public.learning_guardian_decisions decision
             join public.platform_identities identity
               on identity.identity_id = decision.guardian_identity_id
            where decision.tenant_id = $1
              and decision.candidate_version_id = review.candidate_version_id
              and decision.evaluation_receipt_id = review.evaluation_receipt_id
              and decision.content_digest = review.content_digest
         ), '[]'::jsonb) as guardian_decisions
       from exact_review review
     )
     select jsonb_build_object(
       'commandId', command_id,
       'commandState', command_state,
       'policyDecisionId', policy_decision_id,
       'policyActive', active_policy,
       'capabilityActive', capability_active,
       'killSwitchActive', kill_switch_active,
       'requestedAt', requested_at,
       'candidate', jsonb_build_object(
         'candidateVersionId', candidate_version_id,
         'candidateId', candidate_id,
         'version', version,
         'kind', kind,
         'stage', stage,
         'changesActionEligibility', changes_action_eligibility,
         'proposedByActorId', proposed_by_actor_id,
         'payload', candidate_payload,
         'payloadChecksum', payload_checksum,
         'evidenceRefs', evidence_refs,
         'feedbackRefs', feedback_refs
       ),
       'evaluation', jsonb_build_object(
         'receiptId', evaluation_receipt_id,
         'decision', evaluation_decision,
         'reasonCodes', reason_codes,
         'metricsSnapshot', metrics_snapshot,
         'contractVersion', evaluation_contract_version,
         'evaluatorActorId', evaluator_actor_id,
         'nextSafeAction', next_safe_action
       ),
       'contentDigest', content_digest,
       'contentTrust', 'UNTRUSTED_EVIDENCE',
       'configuredGuardianCount', configured_guardian_count,
       'guardianDecisions', guardian_decisions,
       'reviewer', jsonb_build_object(
         'identityId', $3::text,
         'recused', $3::text in (proposed_by_actor_id, evaluator_actor_id),
         'eligibleToDecide',
           command_state = 'VALIDATED'
           and stage = 'CANARY'
           and changes_action_eligibility
           and evaluation_decision = 'PROMOTION_ELIGIBLE'
           and active_policy
           and capability_active
           and not kill_switch_active
           and configured_guardian_count = 3
           and $3::text not in (proposed_by_actor_id, evaluator_actor_id)
           and not exists (
             select 1
               from jsonb_array_elements(guardian_decisions) item
              where item->>'guardianIdentityId' = $3::text
           )
       ),
       'externalEffectsAuthorized', false
     ) as review
     from guardian_state`,
    [actor.tenantId, commandId, actor.principal.identityId],
  );
  if (result.rows.length !== 1 || !result.rows[0].review) {
    throw new ControlPlaneStoreError(
      "LEARNING_REVIEW_NOT_FOUND",
      "The exact action-eligibility learning review was not found for this tenant.",
      404,
    );
  }
  return result.rows[0].review;
}

export async function recordLearningGuardianDecision(
  actor: CanonicalActor,
  commandId: string,
  input: LearningGuardianDecisionInput,
) {
  assertCommandId(commandId);
  let result: { rows: Array<{ receipt: Record<string, unknown> }> };
  try {
    result = await databasePool().query<{ receipt: Record<string, unknown> }>(
      "select public.record_learning_guardian_decision($1::uuid, $2::text, $3::text, $4::text, $5::text) as receipt",
      [
        actor.tenantId,
        commandId,
        actor.principal.identityId,
        input.decision,
        input.rationale,
      ],
    );
  } catch (error) {
    const code = postgresCode(error);
    if (code === "P0002") {
      throw new ControlPlaneStoreError(
        "LEARNING_REVIEW_NOT_FOUND",
        "The canonical learning command, candidate, or evaluation was not found.",
        404,
      );
    }
    if (code === "42501") {
      throw new ControlPlaneStoreError(
        "LEARNING_GUARDIAN_DENIED",
        "This human membership is not currently authorized to decide the learning review.",
        403,
      );
    }
    if (["23505", "23514", "55000"].includes(code ?? "")) {
      throw new ControlPlaneStoreError(
        "LEARNING_GUARDIAN_CONFLICT",
        "The learning review is stale, recused, already decided differently, or conflicts with authoritative state.",
        409,
      );
    }
    if (code === "22023") {
      throw new ControlPlaneStoreError(
        "LEARNING_GUARDIAN_INVALID",
        "The learning guardian decision is invalid.",
        400,
      );
    }
    throw error;
  }
  if (result.rows.length !== 1 || !result.rows[0].receipt) {
    throw new Error("Learning guardian decision did not return authoritative readback.");
  }
  return result.rows[0].receipt;
}
