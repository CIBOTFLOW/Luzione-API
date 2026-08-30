export const AUTHORITY_CONTRACT_VERSION = "luzione-authority/v2" as const;

export type AuthorityClass = "A0" | "A1" | "A2" | "A3" | "A4";

export type Money = {
  amount: string;
  currency: string;
};

export type AuthenticatedPrincipal = {
  identityId: string;
  principalType: "USER" | "SERVICE" | "AGENT";
  membershipRole: string;
};

export type EffectEnvelope = {
  contractVersion: typeof AUTHORITY_CONTRACT_VERSION;
  tenantId: string;
  actor: AuthenticatedPrincipal;
  capability: string;
  resourceScope: string[];
  authorityClass: AuthorityClass;
  policyDecisionId: string;
  approvalId?: string;
  idempotencyKey: string;
  correlationId: string;
  estimatedCost?: Money;
};

export type EffectAction = {
  actionId: string;
  actionVersion: string;
  connectionId?: string;
  contentDigest: string;
  model?: string;
  provider: string;
  readbackPlanned: boolean;
  compensationPlanRef?: string;
  safeReconciliationPlanned?: boolean;
};

export type CapabilityContract = {
  authorityClass: AuthorityClass;
  capability: string;
  enabled: boolean;
  operationKind: "READ" | "INTERNAL" | "EXTERNAL" | "PROHIBITED";
  provider: string;
  providerEffect: boolean;
};

export type ExactApproval = {
  approvalId: string;
  tenantId: string;
  actorIdentityId: string;
  authorityClass: "A3";
  capability: string;
  actionId: string;
  actionVersion: string;
  contentDigest: string;
  provider: string;
  resourceScope: string[];
  estimatedCost: Money;
  status: "REQUESTED" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED" | "REVOKED";
  expiresAt: string;
};

export type AuthorityDecision = {
  allowed: boolean;
  authorityClass: AuthorityClass;
  code:
    | "ALLOW_A0"
    | "ALLOW_A1"
    | "ALLOW_A2"
    | "ALLOW_A3"
    | "BLOCK_A4"
    | "CAPABILITY_DISABLED"
    | "CONTRACT_MISMATCH"
    | "ENVELOPE_INVALID"
    | "OPERATION_CLASS_MISMATCH"
    | "A2_RECOVERY_REQUIRED"
    | "A2_READBACK_REQUIRED"
    | "A3_APPROVAL_REQUIRED"
    | "A3_APPROVAL_MISMATCH"
    | "A3_APPROVAL_EXPIRED";
  externalEffectAuthorized: boolean;
  reason: string;
};

export type ProviderOutcome = {
  actualCost?: Money;
  adapterVersion: string;
  auditReference: string;
  normalizedOutcome: Record<string, unknown>;
  providerReadback: Record<string, unknown>;
};
