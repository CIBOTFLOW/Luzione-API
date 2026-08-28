import type { AutonomyActionPlan, EffectClass } from "@/modules/autonomy/types";
import type { TenantPolicyDecision, TenantPolicySnapshot } from "./types";

const rank: Record<EffectClass, number> = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4 };
const dataRank = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 } as const;

export function evaluateTenantPolicy(input: {
  actorType: "agent" | "service" | "user";
  plan: AutonomyActionPlan;
  policy: TenantPolicySnapshot;
}): TenantPolicyDecision {
  const rule = input.policy.rules.find((candidate) => candidate.capability === input.plan.capability);
  const reasons: string[] = [];
  const decision = rule?.decision ?? input.policy.defaultDecision;
  if (!rule) reasons.push("NO_EXPLICIT_CAPABILITY_RULE");
  if (rank[input.plan.declaredEffectClass] > rank[input.policy.maximumEffectClass]) {
    reasons.push("TENANT_EFFECT_CEILING_EXCEEDED");
  }
  if (rule && rank[input.plan.declaredEffectClass] > rank[rule.maximumEffectClass]) {
    reasons.push("CAPABILITY_EFFECT_CEILING_EXCEEDED");
  }
  if (rule && !rule.actorTypes.includes(input.actorType)) reasons.push("ACTOR_TYPE_NOT_ALLOWED");
  if (rule && rule.purposes.length > 0 && !rule.purposes.includes(input.plan.purpose)) {
    reasons.push("PURPOSE_NOT_ALLOWED");
  }
  if (dataRank[input.plan.dataClassification] > dataRank[input.policy.maximumDataClassification]) {
    reasons.push("DATA_CLASSIFICATION_NOT_ALLOWED");
  }
  if (decision === "BLOCK") reasons.push("CAPABILITY_BLOCKED_BY_TENANT");
  if (decision === "APPROVAL") reasons.push("TENANT_APPROVAL_REQUIRED");
  return {
    allowedByPolicy: decision === "ALLOW" && reasons.length === 0,
    capabilityDecision: decision,
    policyDefinitionId: input.policy.policyDefinitionId,
    policyVersion: input.policy.version,
    reasonCodes: Object.freeze(reasons),
    ruleMatched: Boolean(rule),
  };
}
