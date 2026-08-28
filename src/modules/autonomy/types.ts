export const effectClasses = ["A0", "A1", "A2", "A3", "A4"] as const;

export type EffectClass = (typeof effectClasses)[number];

export const dataClassifications = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
] as const;

export type DataClassification = (typeof dataClassifications)[number];

export type AutonomyDecision =
  | "ALLOW"
  | "BLOCK"
  | "REQUIRE_APPROVAL"
  | "SIMULATE_ONLY";

export type AutonomyControlState = {
  budgetWithinLimit: boolean;
  dependenciesReady: boolean;
  evidenceComplete: boolean;
  idempotencyKey: string | null;
  killSwitchReady: boolean;
  providerReconciliationPlanned: boolean;
  readbackPlanned: boolean;
  rollbackPlanned: boolean;
  simulationPassed: boolean;
};

export type AutonomyActionPlan = {
  actionId: string;
  actionVersion: string;
  capability: string;
  controls: AutonomyControlState;
  dataClassification: DataClassification;
  declaredEffectClass: EffectClass;
  purpose: string;
};

/**
 * This value is an internal contract. API callers cannot submit one. A future
 * adapter may construct it only after reading and verifying a canonical grant.
 */
export type VerifiedAuthorityGrant = {
  actionId: string | null;
  actionVersion: string | null;
  approvedBy: string;
  capability: string;
  consumed: boolean;
  effectClassMaximum: Exclude<EffectClass, "A0" | "A4">;
  expiresAt: string;
  grantId: string;
  granteeActorId: string;
  oneTime: boolean;
  purpose: string;
  source: "BREAK_GLASS" | "HUMAN_APPROVAL" | "POLICY_GRANT";
  tenantId: string;
  verification: "CANONICAL_STORE";
};

export type AutonomyEvaluationContext = {
  actor: {
    actorId: string;
    actorType: "agent" | "service" | "user";
    tenantId: string;
  };
  authorityGrant?: VerifiedAuthorityGrant;
  now: string;
};

export type CapabilityPolicy = {
  capability: string;
  effectClass: EffectClass;
  providerEffect: boolean;
  summary: string;
};

export type AutonomyReasonCode =
  | "ACTION_VERSION_MISMATCH"
  | "AUTHORITY_EXPIRED"
  | "AUTHORITY_SCOPE_MISMATCH"
  | "BOUNDED_GRANT_REQUIRED"
  | "BREAK_GLASS_WINDOW_INVALID"
  | "CAPABILITY_UNKNOWN"
  | "CONTROL_BUDGET_MISSING"
  | "CONTROL_DEPENDENCY_MISSING"
  | "CONTROL_EVIDENCE_MISSING"
  | "CONTROL_IDEMPOTENCY_MISSING"
  | "CONTROL_KILL_SWITCH_MISSING"
  | "CONTROL_READBACK_MISSING"
  | "CONTROL_RECONCILIATION_MISSING"
  | "CONTROL_ROLLBACK_MISSING"
  | "CONTROL_SIMULATION_MISSING"
  | "DATA_POLICY_BLOCKED"
  | "EFFECT_CLASS_MISMATCH"
  | "GRANT_ALREADY_CONSUMED"
  | "HUMAN_APPROVAL_REQUIRED"
  | "POLICY_GRANT_TOO_POWERFUL"
  | "PROHIBITED_CAPABILITY"
  | "READ_ONLY_ACTION_ALLOWED"
  | "VERIFIED_BOUNDED_ACTION_ALLOWED";

export type AutonomyEvaluation = {
  actionAuthorized: boolean;
  capabilityKnown: boolean;
  constitutionVersion: string;
  decision: AutonomyDecision;
  effectiveEffectClass: EffectClass | null;
  externalEffectsAuthorized: boolean;
  nextSafeAction: string;
  reasonCodes: AutonomyReasonCode[];
  requiredControls: string[];
};
