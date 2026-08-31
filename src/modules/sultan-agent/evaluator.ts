import type { ApiActor } from "@/lib/api/actor";
import { evaluateAutonomyPlan } from "@/modules/autonomy/evaluator";
import type { AutonomyEvaluation } from "@/modules/autonomy/types";
import { evaluateTenantPolicy } from "@/modules/tenant-policy/evaluator";
import type { TenantPolicySnapshot } from "@/modules/tenant-policy/types";
import {
  SULTAN_AGENT_POLICY_CONTRACT_VERSION,
  type SultanAgentAdmissionStatus,
  type SultanAgentIntent,
  type SultanAgentPolicyDecision,
} from "./contracts";
import type { SultanAgentContextVerification } from "./contextVerifier";

function overallFreshness(intent: SultanAgentIntent) {
  if (intent.sourceContext.some((context) => context.freshness === "STALE")) return "STALE" as const;
  if (intent.sourceContext.some((context) => context.freshness === "UNKNOWN")) return "UNKNOWN" as const;
  return "FRESH" as const;
}

function expectedCredentialActorId(intent: SultanAgentIntent) {
  return `${intent.agent.agentId}:${intent.agent.agentVersion}`;
}

function statusFromAutonomy(input: {
  autonomy: AutonomyEvaluation;
  identityVerified: boolean;
  intent: SultanAgentIntent;
}): SultanAgentAdmissionStatus {
  if (!input.identityVerified) return "SIMULATE_ONLY";
  if (input.autonomy.decision === "BLOCK") return "BLOCKED";
  if (input.autonomy.decision === "REQUIRE_APPROVAL") {
    return input.intent.runMode === "SHADOW" || input.intent.runMode === "SIMULATION"
      ? "SIMULATE_ONLY"
      : "REQUIRE_APPROVAL";
  }
  if (input.autonomy.decision === "SIMULATE_ONLY") return "SIMULATE_ONLY";
  return input.intent.runMode === "SIMULATION" ? "SIMULATE_ONLY" : "ADMIT_READ_ONLY";
}

export function evaluateSultanAgentIntent(input: {
  actor: ApiActor;
  contextVerification: SultanAgentContextVerification;
  intent: SultanAgentIntent;
  now?: string;
  tenantPolicy: TenantPolicySnapshot;
}): SultanAgentPolicyDecision {
  const freshness = overallFreshness(input.intent);
  const synthetic = input.intent.sourceContext.some((context) => context.sourceOwner === "SYNTHETIC_LUZIONE");
  const canonicalContextUnavailable = !synthetic
    && input.contextVerification.kind !== "CANONICAL_READBACK";
  const identityVerified = input.actor.actorType === "agent"
    && input.actor.actorId === expectedCredentialActorId(input.intent);
  const reasons: string[] = [];

  if (input.intent.agent.authorityDomain !== "LUZIONE") reasons.push("AUTHORITY_DOMAIN_MISMATCH");
  if (!identityVerified) reasons.push("AGENT_DEFINITION_NOT_BOUND_TO_CREDENTIAL");
  if (!input.actor.capabilities.includes(input.intent.capability)) reasons.push("AGENT_CAPABILITY_NOT_BOUND_TO_CREDENTIAL");
  if (synthetic && input.intent.runMode !== "SIMULATION") reasons.push("SYNTHETIC_CONTEXT_REQUIRES_SIMULATION");
  if (!synthetic && input.intent.sourceContext.some((context) => context.sourceOwner !== "CIBOTFLOW/Luzione-API")) {
    reasons.push("SOURCE_OWNER_MISMATCH");
  }

  const plan = {
    actionId: input.intent.actionId,
    actionVersion: input.intent.actionVersion,
    capability: input.intent.capability,
    controls: input.intent.controls,
    dataClassification: input.intent.dataClassification,
    declaredEffectClass: input.intent.declaredEffectClass,
    purpose: input.intent.purpose,
  };
  const tenantPolicy = evaluateTenantPolicy({
    actorType: input.actor.actorType,
    plan,
    policy: input.tenantPolicy,
  });
  const autonomy = evaluateAutonomyPlan(plan, {
    actor: {
      actorId: input.actor.actorId,
      actorType: input.actor.actorType,
      tenantId: input.actor.tenantId,
    },
    now: input.now ?? new Date().toISOString(),
  });

  if ((freshness !== "FRESH" || canonicalContextUnavailable) && input.intent.runMode !== "SIMULATION") {
    reasons.push("SOURCE_CONTEXT_NOT_FRESH");
  }
  if (canonicalContextUnavailable) {
    reasons.push("SOURCE_CONTEXT_NOT_CANONICALLY_VERIFIED");
  }
  reasons.push(...tenantPolicy.reasonCodes);
  reasons.push(...autonomy.reasonCodes);
  const uniqueReasons = Object.freeze([...new Set(reasons)]);

  let status: SultanAgentAdmissionStatus;
  if ((freshness !== "FRESH" || canonicalContextUnavailable) && input.intent.runMode !== "SIMULATION") {
    status = "ABSTAIN_STALE_CONTEXT";
  } else if (uniqueReasons.some((reason) => [
    "AGENT_CAPABILITY_NOT_BOUND_TO_CREDENTIAL",
    "AUTHORITY_DOMAIN_MISMATCH",
    "SOURCE_OWNER_MISMATCH",
    "SYNTHETIC_CONTEXT_REQUIRES_SIMULATION",
  ].includes(reason))) {
    status = "BLOCKED";
  } else if (!tenantPolicy.allowedByPolicy) {
    status = tenantPolicy.capabilityDecision === "APPROVAL"
      ? input.intent.runMode === "ASSISTED" ? "REQUIRE_APPROVAL" : "SIMULATE_ONLY"
      : "BLOCKED";
  } else {
    status = statusFromAutonomy({ autonomy, identityVerified, intent: input.intent });
  }

  const nextSafeAction = status === "ADMIT_READ_ONLY"
    ? "Run the bounded read-only work order and return an evaluation receipt; no business mutation is admitted."
    : status === "ABSTAIN_STALE_CONTEXT"
      ? "Refresh canonical context through Luzione API before reasoning or requesting any command."
      : status === "REQUIRE_APPROVAL"
        ? "Request exact-version human approval through the canonical authority store."
        : status === "SIMULATE_ONLY"
          ? "Run only in the no-effect simulation or shadow plane and retain the trace for evaluation."
          : "Reject the intent and repair its identity, source, capability, or authority boundary.";

  return Object.freeze({
    actor: Object.freeze({
      actorId: input.actor.actorId,
      actorType: input.actor.actorType,
      tenantId: input.actor.tenantId,
    }),
    agentDefinitionVerified: identityVerified,
    autonomy,
    businessStateMutated: false,
    evaluatedOnly: true,
    externalEffectsAuthorized: false,
    nextSafeAction,
    policyContractVersion: SULTAN_AGENT_POLICY_CONTRACT_VERSION,
    reasonCodes: uniqueReasons,
    sourceContext: Object.freeze({
      acceptedCount: input.intent.sourceContext.length,
      freshness,
      synthetic,
      verification: input.contextVerification.kind,
      verifiedCount: input.contextVerification.verifiedCount,
    }),
    status,
    tenantPolicy,
  });
}
