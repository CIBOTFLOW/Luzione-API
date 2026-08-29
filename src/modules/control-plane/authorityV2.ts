import {
  AUTHORITY_CONTRACT_VERSION,
  type AuthorityDecision,
  type CapabilityContract,
  type EffectAction,
  type EffectEnvelope,
  type ExactApproval,
  type Money,
} from "./types";

type EvaluationInput = {
  action: EffectAction;
  approval?: ExactApproval;
  capability: CapabilityContract;
  envelope: EffectEnvelope;
  now: string;
  selectedModel?: string;
};

function decision(
  input: EvaluationInput,
  allowed: boolean,
  code: AuthorityDecision["code"],
  reason: string,
): AuthorityDecision {
  return {
    allowed,
    authorityClass: input.envelope.authorityClass,
    code,
    externalEffectAuthorized: allowed && input.capability.providerEffect,
    reason,
  };
}

function validMoney(value: Money | undefined) {
  return value !== undefined
    && /^[A-Z]{3}$/.test(value.currency)
    && /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value.amount);
}

function sameMoney(left: Money | undefined, right: Money | undefined) {
  return left !== undefined
    && right !== undefined
    && left.currency === right.currency
    && left.amount === right.amount;
}

function sameScope(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function validEnvelope(envelope: EffectEnvelope) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.tenantId)
    && /^(user|service|agent):[A-Za-z0-9._:@-]{1,190}$/.test(envelope.actor.identityId)
    && /^[a-z][a-z0-9._-]+$/.test(envelope.capability)
    && envelope.resourceScope.length > 0
    && envelope.resourceScope.every((scope) => scope.length > 0 && scope.length <= 500)
    && /^[A-Za-z0-9._:-]{8,200}$/.test(envelope.policyDecisionId)
    && /^[A-Za-z0-9._:-]{8,200}$/.test(envelope.idempotencyKey)
    && /^[A-Za-z0-9._:-]{8,200}$/.test(envelope.correlationId)
    && (envelope.estimatedCost === undefined || validMoney(envelope.estimatedCost));
}

function exactApprovalMatches(input: EvaluationInput, approval: ExactApproval) {
  const { action, envelope, capability } = input;
  return approval.approvalId === envelope.approvalId
    && approval.tenantId === envelope.tenantId
    && approval.actorIdentityId === envelope.actor.identityId
    && approval.authorityClass === "A3"
    && approval.capability === envelope.capability
    && approval.actionId === action.actionId
    && approval.actionVersion === action.actionVersion
    && approval.contentDigest === action.contentDigest
    && approval.provider === action.provider
    && approval.provider === capability.provider
    && sameScope(approval.resourceScope, envelope.resourceScope)
    && sameMoney(approval.estimatedCost, envelope.estimatedCost);
}

export function evaluateAuthorityV2(input: EvaluationInput): AuthorityDecision {
  const { action, approval, capability, envelope } = input;
  // selectedModel is intentionally not read. Model selection cannot grant or weaken authority.
  if (envelope.contractVersion !== AUTHORITY_CONTRACT_VERSION) {
    return decision(input, false, "CONTRACT_MISMATCH", "The effect envelope is not authority-v2.");
  }
  if (!validEnvelope(envelope)) {
    return decision(input, false, "ENVELOPE_INVALID", "The effect envelope is incomplete or malformed.");
  }
  if (!capability.enabled) {
    return decision(input, false, capability.authorityClass === "A4" ? "BLOCK_A4" : "CAPABILITY_DISABLED", "The capability is disabled.");
  }
  if (capability.authorityClass === "A4" || envelope.authorityClass === "A4" || capability.operationKind === "PROHIBITED") {
    return decision(input, false, "BLOCK_A4", "A4 capabilities are prohibited and never grantable.");
  }
  if (capability.capability !== envelope.capability
    || capability.authorityClass !== envelope.authorityClass
    || capability.provider !== action.provider) {
    return decision(input, false, "OPERATION_CLASS_MISMATCH", "The requested operation does not match the registered capability contract.");
  }
  if (envelope.authorityClass === "A0") {
    return !capability.providerEffect && capability.operationKind === "READ"
      ? decision(input, true, "ALLOW_A0", "Read, analysis, or simulation is allowed.")
      : decision(input, false, "OPERATION_CLASS_MISMATCH", "A0 cannot authorize a state change.");
  }
  if (envelope.authorityClass === "A1") {
    return !capability.providerEffect && capability.operationKind === "INTERNAL"
      ? decision(input, true, "ALLOW_A1", "The bounded internal action is allowed.")
      : decision(input, false, "OPERATION_CLASS_MISMATCH", "A1 cannot authorize an external provider effect.");
  }
  if (envelope.authorityClass === "A2") {
    if (!capability.providerEffect || capability.operationKind !== "EXTERNAL") {
      return decision(input, false, "OPERATION_CLASS_MISMATCH", "A2 is reserved for bounded reversible external effects.");
    }
    if (!action.readbackPlanned) {
      return decision(input, false, "A2_READBACK_REQUIRED", "A2 requires provider readback as a separate resumable step.");
    }
    if (!action.compensationPlanRef && !action.safeReconciliationPlanned) {
      return decision(input, false, "A2_RECOVERY_REQUIRED", "A2 requires compensation or a safe reconciliation path.");
    }
    return decision(input, true, "ALLOW_A2", "The bounded reversible effect satisfies readback and recovery requirements.");
  }
  if (!envelope.approvalId || !approval || approval.status !== "APPROVED") {
    return decision(input, false, "A3_APPROVAL_REQUIRED", "A3 requires an exact active approval.");
  }
  const expiry = Date.parse(approval.expiresAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(expiry) || !Number.isFinite(now) || expiry <= now) {
    return decision(input, false, "A3_APPROVAL_EXPIRED", "The exact approval has expired.");
  }
  if (!exactApprovalMatches(input, approval)) {
    return decision(input, false, "A3_APPROVAL_MISMATCH", "The approval does not exactly match the actor, content, version, provider, scope, and estimated cost.");
  }
  return decision(input, true, "ALLOW_A3", "The binding effect has a matching unexpired exact approval.");
}
