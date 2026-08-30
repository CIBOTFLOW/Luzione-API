export const PLATFORM_READINESS_EVIDENCE_VERSION = "luzione-readiness-evidence/v1";

export const readinessEvidenceLaw = Object.freeze({
  configurationIsObservation: false,
  productionRequiresExactSha: true,
  staleBlockingEvidenceFailsClosed: true,
  tiers: ["CONFIGURED", "LOCAL_PROVEN", "PREVIEW_PROVEN", "PRODUCTION_OBSERVED"] as const,
});

export type ReadinessEvidenceTier = "CONFIGURED" | "LOCAL_PROVEN" | "PREVIEW_PROVEN" | "PRODUCTION_OBSERVED";

export type ReadinessEvidence = {
  actual: boolean | number | string | null;
  environment: "local" | "preview" | "production";
  evidenceId: string;
  evidenceTier: ReadinessEvidenceTier;
  exactSha: string | null;
  impact: "BLOCKING" | "DEGRADED" | "INFORMATIONAL";
  observedAt: string | null;
  owner: string;
  scope: string;
  source: string;
  sourceKind: "CANONICAL_READBACK" | "CONFIGURATION" | "SYNTHETIC_OBSERVATION";
  status: "FAIL" | "PASS" | "UNKNOWN";
  threshold: string;
  validForMs: number;
};

const TIER_ORDER: Record<ReadinessEvidenceTier, number> = {
  CONFIGURED: 0,
  LOCAL_PROVEN: 1,
  PREVIEW_PROVEN: 2,
  PRODUCTION_OBSERVED: 3,
};

export function runtimeReadinessEvidenceContext() {
  const environment = process.env.VERCEL_ENV === "production"
    ? "production" as const
    : process.env.VERCEL_ENV === "preview"
      ? "preview" as const
      : "local" as const;
  const exactSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) ?? null;
  const observedTier = environment === "production" && exactSha
    ? "PRODUCTION_OBSERVED" as const
    : environment === "preview" && exactSha
      ? "PREVIEW_PROVEN" as const
      : "LOCAL_PROVEN" as const;
  return { environment, exactSha, observedTier };
}

export function readinessEvidenceViolations(evidence: readonly ReadinessEvidence[]) {
  const ids = new Set<string>();
  const violations: string[] = [];
  for (const item of evidence) {
    if (ids.has(item.evidenceId)) violations.push(`duplicate:${item.evidenceId}`);
    ids.add(item.evidenceId);
    if (!Number.isInteger(item.validForMs) || item.validForMs <= 0) violations.push(`invalid-freshness:${item.evidenceId}`);
    if (item.sourceKind === "CONFIGURATION" && item.evidenceTier !== "CONFIGURED") {
      violations.push(`configuration-promoted:${item.evidenceId}`);
    }
    if ((item.evidenceTier === "PREVIEW_PROVEN" || item.evidenceTier === "PRODUCTION_OBSERVED") && !item.exactSha) {
      violations.push(`unbound-release:${item.evidenceId}`);
    }
    if (item.evidenceTier === "PREVIEW_PROVEN" && item.environment !== "preview") {
      violations.push(`preview-environment-mismatch:${item.evidenceId}`);
    }
    if (item.evidenceTier === "PRODUCTION_OBSERVED" && item.environment !== "production") {
      violations.push(`production-environment-mismatch:${item.evidenceId}`);
    }
  }
  return violations;
}

export function deriveReadinessEvidenceSummary(
  evidence: readonly ReadinessEvidence[],
  now = new Date().toISOString(),
) {
  const violations = readinessEvidenceViolations(evidence);
  if (violations.length) throw new Error(`Invalid readiness evidence: ${violations.join(",")}`);
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Readiness evaluation time must be valid.");
  const observations = evidence.map((item) => {
    const observedMs = item.observedAt === null ? Number.NaN : new Date(item.observedAt).getTime();
    if (item.observedAt !== null && !Number.isFinite(observedMs)) throw new Error(`Invalid observedAt:${item.evidenceId}`);
    if (Number.isFinite(observedMs) && observedMs > nowMs + 300_000) throw new Error(`Future observation:${item.evidenceId}`);
    const freshness = !Number.isFinite(observedMs)
      ? "UNOBSERVED" as const
      : nowMs - observedMs > item.validForMs
        ? "STALE" as const
        : "FRESH" as const;
    return {
      ...item,
      effectiveStatus: freshness === "FRESH" ? item.status : "UNKNOWN" as const,
      freshness,
    };
  });
  const blocking = observations.filter((item) => item.impact === "BLOCKING");
  const blockingFailed = blocking.some((item) => item.effectiveStatus !== "PASS");
  const degraded = observations.some((item) => item.impact === "DEGRADED" && item.effectiveStatus !== "PASS");
  const overallStatus = blockingFailed ? "NOT_READY" as const : degraded ? "DEGRADED" as const : "READY" as const;
  const weakestBlockingEvidenceTier = blocking.length
    ? blocking.reduce((weakest, item) => TIER_ORDER[item.evidenceTier] < TIER_ORDER[weakest] ? item.evidenceTier : weakest, blocking[0].evidenceTier)
    : null;
  return {
    contractVersion: PLATFORM_READINESS_EVIDENCE_VERSION,
    evaluatedAt: new Date(nowMs).toISOString(),
    observations,
    overallStatus,
    productionReleaseReady: overallStatus === "READY"
      && blocking.length > 0
      && blocking.every((item) => item.evidenceTier === "PRODUCTION_OBSERVED" && item.freshness === "FRESH"),
    weakestBlockingEvidenceTier,
  };
}
