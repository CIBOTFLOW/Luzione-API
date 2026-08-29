export const RECONCILIATION_STATE_CONTRACT_VERSION = "luzione-reconciliation-state/v1";

export type ReconciliationState = "BLOCKED" | "CONVERGED" | "DRIFTED" | "RECONCILING" | "UNKNOWN";

export type DesiredObservedState = {
  contractVersion: typeof RECONCILIATION_STATE_CONTRACT_VERSION;
  desired: {
    source: string;
    state: string;
  };
  evidenceRefs: readonly string[];
  observed: {
    freshUntil: string | null;
    observedAt: string | null;
    source: string | null;
    state: string | null;
  };
  reconciliation: {
    nextAction: string;
    owner: string;
    reason: string;
    state: ReconciliationState;
  };
  scope: string;
};

function iso(value: string | null, field: string) {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field} must be an ISO timestamp.`);
  return new Date(timestamp).toISOString();
}

export function deriveDesiredObservedState(input: {
  activeReconciliation?: {
    reason: string;
    state: "BLOCKED" | "RECONCILING";
  } | null;
  desiredSource: string;
  desiredState: string;
  evidenceRefs?: readonly string[];
  freshnessMs?: number | null;
  nextAction: string;
  now?: string;
  observedAt: string | null;
  observedSource: string | null;
  observedState: string | null;
  owner: string;
  scope: string;
}): DesiredObservedState {
  const now = iso(input.now ?? new Date().toISOString(), "now") as string;
  const observedAt = iso(input.observedAt, "observedAt");
  const freshnessMs = input.freshnessMs ?? null;
  if (freshnessMs !== null && (!Number.isFinite(freshnessMs) || freshnessMs <= 0)) {
    throw new Error("freshnessMs must be a positive finite duration.");
  }
  const freshUntil = observedAt && freshnessMs
    ? new Date(Date.parse(observedAt) + freshnessMs).toISOString()
    : null;
  const stale = freshUntil ? Date.parse(freshUntil) <= Date.parse(now) : false;

  let state: ReconciliationState;
  let reason: string;
  if (input.activeReconciliation) {
    state = input.activeReconciliation.state;
    reason = input.activeReconciliation.reason.trim();
    if (!reason) throw new Error("activeReconciliation.reason is required.");
  } else if (!input.observedState || !observedAt || !input.observedSource) {
    state = "UNKNOWN";
    reason = "No authoritative observation with source and timestamp is available.";
  } else if (stale) {
    state = "DRIFTED";
    reason = "The latest authoritative observation is stale.";
  } else if (input.observedState === input.desiredState) {
    state = "CONVERGED";
    reason = "Desired and fresh observed state agree.";
  } else {
    state = "DRIFTED";
    reason = "Desired and observed state differ.";
  }

  return {
    contractVersion: RECONCILIATION_STATE_CONTRACT_VERSION,
    desired: { source: input.desiredSource, state: input.desiredState },
    evidenceRefs: [...new Set(input.evidenceRefs ?? [])].sort(),
    observed: {
      freshUntil,
      observedAt,
      source: input.observedSource,
      state: input.observedState,
    },
    reconciliation: {
      nextAction: input.nextAction,
      owner: input.owner,
      reason,
      state,
    },
    scope: input.scope,
  };
}
