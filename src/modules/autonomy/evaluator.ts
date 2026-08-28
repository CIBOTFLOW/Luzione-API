import {
  AUTONOMY_CONSTITUTION_VERSION,
  policyForCapability,
} from "./constitution";
import type {
  AutonomyActionPlan,
  AutonomyEvaluation,
  AutonomyEvaluationContext,
  AutonomyReasonCode,
  EffectClass,
  VerifiedAuthorityGrant,
} from "./types";

const EFFECT_RANK: Record<EffectClass, number> = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
};

const BREAK_GLASS_MAX_WINDOW_MS = 15 * 60 * 1000;

function result(input: Omit<AutonomyEvaluation, "constitutionVersion">): AutonomyEvaluation {
  return { ...input, constitutionVersion: AUTONOMY_CONSTITUTION_VERSION };
}

function controlFailures(plan: AutonomyActionPlan, effectClass: EffectClass, providerEffect: boolean) {
  const reasons: AutonomyReasonCode[] = [];
  const controls: string[] = [];
  const require = (ready: boolean, control: string, reason: AutonomyReasonCode) => {
    if (ready) return;
    controls.push(control);
    reasons.push(reason);
  };

  require(plan.controls.evidenceComplete, "evidenceComplete", "CONTROL_EVIDENCE_MISSING");
  require(plan.controls.dependenciesReady, "dependenciesReady", "CONTROL_DEPENDENCY_MISSING");

  if (effectClass !== "A0" && effectClass !== "A4") {
    require(plan.controls.simulationPassed, "simulationPassed", "CONTROL_SIMULATION_MISSING");
    require(plan.controls.budgetWithinLimit, "budgetWithinLimit", "CONTROL_BUDGET_MISSING");
    require(plan.controls.killSwitchReady, "killSwitchReady", "CONTROL_KILL_SWITCH_MISSING");
    require(Boolean(plan.controls.idempotencyKey?.trim()), "idempotencyKey", "CONTROL_IDEMPOTENCY_MISSING");
    require(plan.controls.rollbackPlanned, "rollbackPlanned", "CONTROL_ROLLBACK_MISSING");
    require(plan.controls.readbackPlanned, "readbackPlanned", "CONTROL_READBACK_MISSING");
  }

  if (providerEffect) {
    require(
      plan.controls.providerReconciliationPlanned,
      "providerReconciliationPlanned",
      "CONTROL_RECONCILIATION_MISSING",
    );
  }

  return { controls, reasons };
}

function validateAuthority(
  plan: AutonomyActionPlan,
  context: AutonomyEvaluationContext,
  effectClass: Exclude<EffectClass, "A0" | "A4">,
): AutonomyReasonCode[] {
  const grant: VerifiedAuthorityGrant | undefined = context.authorityGrant;
  if (!grant) {
    return [effectClass === "A1" ? "BOUNDED_GRANT_REQUIRED" : "HUMAN_APPROVAL_REQUIRED"];
  }

  const reasons: AutonomyReasonCode[] = [];
  const expiresAt = Date.parse(grant.expiresAt);
  const now = Date.parse(context.now);

  if (grant.verification !== "CANONICAL_STORE"
    || !grant.grantId.trim()
    || !grant.approvedBy.trim()
    || grant.tenantId !== context.actor.tenantId
    || grant.granteeActorId !== context.actor.actorId
    || grant.capability !== plan.capability
    || grant.purpose !== plan.purpose
    || EFFECT_RANK[grant.effectClassMaximum] < EFFECT_RANK[effectClass]) {
    reasons.push("AUTHORITY_SCOPE_MISMATCH");
  }
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now) {
    reasons.push("AUTHORITY_EXPIRED");
  }
  if (grant.consumed) reasons.push("GRANT_ALREADY_CONSUMED");

  if (effectClass === "A1") {
    if (grant.source === "POLICY_GRANT" && grant.effectClassMaximum !== "A1") {
      reasons.push("POLICY_GRANT_TOO_POWERFUL");
    }
  } else {
    if (grant.source === "POLICY_GRANT") reasons.push("HUMAN_APPROVAL_REQUIRED");
    if (grant.actionId !== plan.actionId || grant.actionVersion !== plan.actionVersion) {
      reasons.push("ACTION_VERSION_MISMATCH");
    }
    if (!grant.oneTime) reasons.push("AUTHORITY_SCOPE_MISMATCH");
  }

  if (grant.source === "BREAK_GLASS") {
    if (!grant.oneTime || expiresAt - now > BREAK_GLASS_MAX_WINDOW_MS) {
      reasons.push("BREAK_GLASS_WINDOW_INVALID");
    }
  }

  return [...new Set(reasons)];
}

export function evaluateAutonomyPlan(
  plan: AutonomyActionPlan,
  context: AutonomyEvaluationContext,
): AutonomyEvaluation {
  const policy = policyForCapability(plan.capability);
  if (!policy) {
    return result({
      actionAuthorized: false,
      capabilityKnown: false,
      decision: "SIMULATE_ONLY",
      effectiveEffectClass: null,
      externalEffectsAuthorized: false,
      nextSafeAction: "Register and review the capability before requesting authority.",
      reasonCodes: ["CAPABILITY_UNKNOWN"],
      requiredControls: ["registeredCapabilityPolicy"],
    });
  }

  if (policy.effectClass !== plan.declaredEffectClass) {
    return result({
      actionAuthorized: false,
      capabilityKnown: true,
      decision: "BLOCK",
      effectiveEffectClass: policy.effectClass,
      externalEffectsAuthorized: false,
      nextSafeAction: "Use the constitution's effect class; models and clients cannot downgrade it.",
      reasonCodes: ["EFFECT_CLASS_MISMATCH"],
      requiredControls: [],
    });
  }

  if (policy.effectClass === "A4") {
    return result({
      actionAuthorized: false,
      capabilityKnown: true,
      decision: "BLOCK",
      effectiveEffectClass: policy.effectClass,
      externalEffectsAuthorized: false,
      nextSafeAction: "Escalate to the separate constitutional governance process.",
      reasonCodes: ["PROHIBITED_CAPABILITY"],
      requiredControls: [],
    });
  }

  if (policy.providerEffect && plan.dataClassification === "RESTRICTED") {
    return result({
      actionAuthorized: false,
      capabilityKnown: true,
      decision: "BLOCK",
      effectiveEffectClass: policy.effectClass,
      externalEffectsAuthorized: false,
      nextSafeAction: "Remove or tokenize restricted data before considering an external provider action.",
      reasonCodes: ["DATA_POLICY_BLOCKED"],
      requiredControls: ["approvedDataMinimization"],
    });
  }

  const missing = controlFailures(plan, policy.effectClass, policy.providerEffect);
  if (missing.reasons.length > 0) {
    const decision = policy.effectClass === "A0" || policy.effectClass === "A1"
      ? "SIMULATE_ONLY"
      : "BLOCK";
    return result({
      actionAuthorized: false,
      capabilityKnown: true,
      decision,
      effectiveEffectClass: policy.effectClass,
      externalEffectsAuthorized: false,
      nextSafeAction: decision === "SIMULATE_ONLY"
        ? "Complete the missing controls and rerun the no-effect simulation."
        : "Do not seek approval until the missing controls pass.",
      reasonCodes: missing.reasons,
      requiredControls: missing.controls,
    });
  }

  if (policy.effectClass === "A0") {
    return result({
      actionAuthorized: true,
      capabilityKnown: true,
      decision: "ALLOW",
      effectiveEffectClass: policy.effectClass,
      externalEffectsAuthorized: false,
      nextSafeAction: "Run the read-only action and emit an evaluation receipt.",
      reasonCodes: ["READ_ONLY_ACTION_ALLOWED"],
      requiredControls: [],
    });
  }

  const authorityReasons = validateAuthority(plan, context, policy.effectClass);
  if (authorityReasons.length > 0) {
    const onlyMissingGrant = authorityReasons.every((reason) =>
      reason === "BOUNDED_GRANT_REQUIRED" || reason === "HUMAN_APPROVAL_REQUIRED");
    return result({
      actionAuthorized: false,
      capabilityKnown: true,
      decision: onlyMissingGrant ? "REQUIRE_APPROVAL" : "BLOCK",
      effectiveEffectClass: policy.effectClass,
      externalEffectsAuthorized: false,
      nextSafeAction: onlyMissingGrant
        ? "Request a canonical, scoped, expiring grant for this exact action."
        : "Reject the grant and return the plan to its human owner for review.",
      reasonCodes: authorityReasons,
      requiredControls: onlyMissingGrant ? ["canonicalAuthorityGrant"] : [],
    });
  }

  return result({
    actionAuthorized: true,
    capabilityKnown: true,
    decision: "ALLOW",
    effectiveEffectClass: policy.effectClass,
    externalEffectsAuthorized: policy.effectClass === "A3",
    nextSafeAction: "Execute once through the command kernel, then reconcile and read back the result.",
    reasonCodes: ["VERIFIED_BOUNDED_ACTION_ALLOWED"],
    requiredControls: [],
  });
}
