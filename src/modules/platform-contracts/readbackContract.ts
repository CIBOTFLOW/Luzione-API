export const CAUSAL_READBACK_CONTRACT_VERSION = "luzione-causal-readback/v0.1";

export const causalReadbackLaw = Object.freeze({
  httpSuccessIsBusinessCompletion: false,
  providerAcknowledgementIsBusinessFinality: false,
  sourceConfirmationRequiresReadback: true,
  staleConfirmationIsCurrent: false,
  tenantExistenceMayLeak: false,
});

export type ReadbackFreshness = "FRESH" | "NOT_APPLICABLE" | "STALE" | "UNKNOWN";
export type ReadbackFinality =
  | "DOMAIN_COMMITTED"
  | "MISSING"
  | "PROVIDER_ACKNOWLEDGED"
  | "RECONCILING"
  | "SOURCE_CONFIRMED";

export type CausalReadbackEvidence = {
  attemptId: string | null;
  commandId: string | null;
  eventId: string | null;
  outboxMessageId: string | null;
  providerAcknowledgementRef: string | null;
  receiptId: string;
  reconciliationId: string | null;
  sourceReadbackRef: string | null;
};

export type CausalReadback = {
  businessFinal: boolean;
  contractVersion: typeof CAUSAL_READBACK_CONTRACT_VERSION;
  evidence: CausalReadbackEvidence;
  finality: ReadbackFinality;
  freshness: {
    freshUntil: string | null;
    observedAt: string | null;
    policyMs: number | null;
    state: ReadbackFreshness;
  };
  object: {
    id: string | null;
    ownerProject: string | null;
    type: string | null;
    version: string | null;
  };
  projection: {
    owner: "CIBOTFLOW/Luzione-API";
    source: "canonical-postgres";
    version: string;
  };
  reason: string;
  tenantId: string;
};

type CommandReadbackRow = {
  attemptId?: string | null;
  checkedAt?: string | null;
  commandId: string;
  committedAt?: string | null;
  committedObjectVersion?: string | null;
  eventId?: string | null;
  outboxMessageId?: string | null;
  outboxState?: string | null;
  providerAcknowledgedAt?: string | null;
  providerAcknowledgementRef?: string | null;
  receiptId: string;
  receiptState: string;
  reconciliationId?: string | null;
  reconciliationResult?: string | null;
  sourceConfirmedAt?: string | null;
  sourceReadbackRef?: string | null;
  targetObjectId: string;
  targetObjectType: string;
  targetOwnerProject: string;
  tenantId: string;
};

function timestamp(value: string | null | undefined, field: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}

function freshness(observedAt: string | null, now: string, policyMs: number | null) {
  if (!observedAt) {
    return { freshUntil: null, observedAt: null, policyMs, state: "UNKNOWN" as const };
  }
  if (policyMs === null) {
    return { freshUntil: null, observedAt, policyMs, state: "NOT_APPLICABLE" as const };
  }
  if (!Number.isFinite(policyMs) || policyMs <= 0) {
    throw new Error("freshnessPolicyMs must be a positive finite duration or null.");
  }
  const freshUntil = new Date(Date.parse(observedAt) + policyMs).toISOString();
  return {
    freshUntil,
    observedAt,
    policyMs,
    state: Date.parse(freshUntil) > Date.parse(now) ? "FRESH" as const : "STALE" as const,
  };
}

export function missingCausalReadback(input: { receiptId: string; tenantId: string }): CausalReadback {
  return {
    businessFinal: false,
    contractVersion: CAUSAL_READBACK_CONTRACT_VERSION,
    evidence: {
      attemptId: null,
      commandId: null,
      eventId: null,
      outboxMessageId: null,
      providerAcknowledgementRef: null,
      receiptId: input.receiptId,
      reconciliationId: null,
      sourceReadbackRef: null,
    },
    finality: "MISSING",
    freshness: { freshUntil: null, observedAt: null, policyMs: null, state: "UNKNOWN" },
    object: { id: null, ownerProject: null, type: null, version: null },
    projection: {
      owner: "CIBOTFLOW/Luzione-API",
      source: "canonical-postgres",
      version: CAUSAL_READBACK_CONTRACT_VERSION,
    },
    reason: "No tenant-authorized canonical receipt evidence is available.",
    tenantId: input.tenantId,
  };
}

export function buildCommandCausalReadback(input: {
  freshnessPolicyMs?: number | null;
  now?: string;
  row: CommandReadbackRow;
}): CausalReadback {
  const now = timestamp(input.now ?? new Date().toISOString(), "now") as string;
  const sourceConfirmedAt = timestamp(input.row.sourceConfirmedAt, "sourceConfirmedAt");
  const providerAcknowledgedAt = timestamp(input.row.providerAcknowledgedAt, "providerAcknowledgedAt");
  const checkedAt = timestamp(input.row.checkedAt, "checkedAt");
  const committedAt = timestamp(input.row.committedAt, "committedAt");
  const policyMs = input.freshnessPolicyMs === undefined ? 5 * 60 * 1000 : input.freshnessPolicyMs;
  const hasSourceConfirmation = Boolean(sourceConfirmedAt && input.row.sourceReadbackRef);
  const latestObservation = hasSourceConfirmation ? sourceConfirmedAt : checkedAt ?? providerAcknowledgedAt ?? committedAt;
  const readbackFreshness = freshness(latestObservation, now, hasSourceConfirmation ? policyMs : null);

  let finality: ReadbackFinality = "DOMAIN_COMMITTED";
  let reason = "Canonical command and domain-commit evidence exists; source finality is not confirmed.";
  if (hasSourceConfirmation && readbackFreshness.state === "FRESH") {
    finality = "SOURCE_CONFIRMED";
    reason = "Fresh authoritative source readback confirms the committed object version.";
  } else if (hasSourceConfirmation) {
    finality = "RECONCILING";
    reason = "Authoritative source confirmation exists historically but is stale under the declared freshness policy.";
  } else if (
    input.row.reconciliationResult
    || input.row.receiptState === "RECONCILIATION_REQUIRED"
    || input.row.outboxState === "RECONCILIATION_REQUIRED"
  ) {
    finality = "RECONCILING";
    reason = `Source finality requires reconciliation${input.row.reconciliationResult ? ` (${input.row.reconciliationResult})` : ""}.`;
  } else if (providerAcknowledgedAt || input.row.receiptState === "PROVIDER_ACKNOWLEDGED" || input.row.outboxState === "PROVIDER_ACKNOWLEDGED") {
    finality = "PROVIDER_ACKNOWLEDGED";
    reason = "The provider acknowledged delivery, but authoritative source readback has not confirmed business completion.";
  }

  return {
    businessFinal: finality === "SOURCE_CONFIRMED",
    contractVersion: CAUSAL_READBACK_CONTRACT_VERSION,
    evidence: {
      attemptId: input.row.attemptId ?? null,
      commandId: input.row.commandId,
      eventId: input.row.eventId ?? null,
      outboxMessageId: input.row.outboxMessageId ?? null,
      providerAcknowledgementRef: input.row.providerAcknowledgementRef ?? null,
      receiptId: input.row.receiptId,
      reconciliationId: input.row.reconciliationId ?? null,
      sourceReadbackRef: input.row.sourceReadbackRef ?? null,
    },
    finality,
    freshness: readbackFreshness,
    object: {
      id: input.row.targetObjectId,
      ownerProject: input.row.targetOwnerProject,
      type: input.row.targetObjectType,
      version: input.row.committedObjectVersion ?? null,
    },
    projection: {
      owner: "CIBOTFLOW/Luzione-API",
      source: "canonical-postgres",
      version: CAUSAL_READBACK_CONTRACT_VERSION,
    },
    reason,
    tenantId: input.row.tenantId,
  };
}

export function buildProjectionFreshness(input: {
  freshnessPolicyMs: number;
  now?: string;
  observedAt: string | null;
  owner: string;
  source: string;
  sourceVersion: string | null;
}) {
  const now = timestamp(input.now ?? new Date().toISOString(), "now") as string;
  const observedAt = timestamp(input.observedAt, "observedAt");
  return {
    contractVersion: CAUSAL_READBACK_CONTRACT_VERSION,
    freshness: freshness(observedAt, now, input.freshnessPolicyMs),
    owner: input.owner,
    source: input.source,
    sourceVersion: input.sourceVersion,
  };
}
