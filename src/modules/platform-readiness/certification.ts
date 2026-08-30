export const PRODUCTION_READINESS_CERTIFICATION_VERSION = "luzione-production-readiness-certification/v1";

export type CertificationEvidenceTier =
  | "NOT_ASSESSED"
  | "DEFERRED_EXTERNAL_INFRA"
  | "LOCAL_PROVEN"
  | "PREVIEW_PROVEN"
  | "PRODUCTION_OBSERVED";

export type RecoveryPosture =
  | "NOT_APPLICABLE"
  | "DEFINED_ONLY"
  | "LOCAL_EXERCISED"
  | "PREVIEW_EXERCISED"
  | "PRODUCTION_EXERCISED";

export type ProductionReadinessInvariant = {
  assertionStatus: "PASS" | "FAIL" | "UNKNOWN";
  blocking: boolean;
  evidenceCandidateSha: string | null;
  evidenceRef: string | null;
  evidenceTier: CertificationEvidenceTier;
  invariantId: string;
  latestObservedAt: string | null;
  openFailureRefs: readonly string[];
  owner: string;
  recoveryObjectiveRef: string | null;
  recoveryPosture: RecoveryPosture;
  remainingUncertainty: readonly string[];
  sourceEnvironment: "local" | "preview" | "production" | "unknown";
  validForMs: number;
};

export type ProductionReadinessCertificationInput = {
  candidateSha: string;
  evaluatedAt: string;
  invariants: readonly ProductionReadinessInvariant[];
};

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const OBSERVED_TIERS = new Set<CertificationEvidenceTier>([
  "LOCAL_PROVEN",
  "PREVIEW_PROVEN",
  "PRODUCTION_OBSERVED",
]);

export const productionReadinessCertificationLaw = Object.freeze({
  configurationCanProveReadiness: false,
  contractVersion: PRODUCTION_READINESS_CERTIFICATION_VERSION,
  openBlockingFailureCanPass: false,
  productionPassRequires: [
    "all blocking assertions pass",
    "fresh production observation",
    "exact candidate SHA binding",
    "no open blocking failures",
    "production-exercised or not-applicable recovery",
    "no blocking uncertainty",
  ] as const,
  unsupportedFinalityCanPass: false,
});

export function productionReadinessInputViolations(input: ProductionReadinessCertificationInput) {
  const violations: string[] = [];
  if (!SHA_PATTERN.test(input.candidateSha)) violations.push("invalid-candidate-sha");
  if (!Number.isFinite(new Date(input.evaluatedAt).getTime())) violations.push("invalid-evaluated-at");
  const invariantIds = new Set<string>();
  for (const invariant of input.invariants) {
    if (!invariant.invariantId.trim()) violations.push("missing-invariant-id");
    if (invariantIds.has(invariant.invariantId)) violations.push(`duplicate-invariant:${invariant.invariantId}`);
    invariantIds.add(invariant.invariantId);
    if (!invariant.owner.trim()) violations.push(`missing-owner:${invariant.invariantId}`);
    if (!Number.isInteger(invariant.validForMs) || invariant.validForMs <= 0) {
      violations.push(`invalid-freshness:${invariant.invariantId}`);
    }
    if (OBSERVED_TIERS.has(invariant.evidenceTier)) {
      if (!invariant.evidenceRef?.trim()) violations.push(`missing-evidence-ref:${invariant.invariantId}`);
      if (!invariant.evidenceCandidateSha || !SHA_PATTERN.test(invariant.evidenceCandidateSha)) {
        violations.push(`invalid-evidence-sha:${invariant.invariantId}`);
      }
      if (!invariant.latestObservedAt || !Number.isFinite(new Date(invariant.latestObservedAt).getTime())) {
        violations.push(`invalid-observed-at:${invariant.invariantId}`);
      }
    }
    if (invariant.evidenceTier === "PRODUCTION_OBSERVED" && invariant.sourceEnvironment !== "production") {
      violations.push(`production-environment-mismatch:${invariant.invariantId}`);
    }
    if (invariant.recoveryPosture !== "NOT_APPLICABLE" && !invariant.recoveryObjectiveRef?.trim()) {
      violations.push(`missing-recovery-objective:${invariant.invariantId}`);
    }
  }
  if (!input.invariants.some((invariant) => invariant.blocking)) violations.push("missing-blocking-invariant");
  return violations;
}

export function certifyProductionReadiness(input: ProductionReadinessCertificationInput) {
  const violations = productionReadinessInputViolations(input);
  if (violations.length) throw new Error(`Invalid production readiness input: ${violations.join(",")}`);
  const evaluatedAtMs = new Date(input.evaluatedAt).getTime();
  const invariantResults = input.invariants.map((invariant) => {
    const observedAtMs = invariant.latestObservedAt === null
      ? Number.NaN
      : new Date(invariant.latestObservedAt).getTime();
    const freshness = !Number.isFinite(observedAtMs)
      ? "UNOBSERVED" as const
      : observedAtMs > evaluatedAtMs + 300_000
        ? "FUTURE" as const
        : evaluatedAtMs - observedAtMs > invariant.validForMs
          ? "STALE" as const
          : "FRESH" as const;
    const blockers = invariant.blocking
      ? [
        invariant.assertionStatus !== "PASS" ? `assertion:${invariant.assertionStatus}` : null,
        invariant.evidenceTier !== "PRODUCTION_OBSERVED" ? `evidence-tier:${invariant.evidenceTier}` : null,
        invariant.evidenceCandidateSha !== input.candidateSha ? "candidate-sha-mismatch" : null,
        freshness !== "FRESH" ? `freshness:${freshness}` : null,
        invariant.openFailureRefs.length ? "open-failures" : null,
        !["NOT_APPLICABLE", "PRODUCTION_EXERCISED"].includes(invariant.recoveryPosture)
          ? `recovery:${invariant.recoveryPosture}`
          : null,
        invariant.remainingUncertainty.length ? "remaining-uncertainty" : null,
      ].filter((blocker): blocker is string => blocker !== null)
      : [];
    return { ...invariant, blockers, freshness, productionReady: blockers.length === 0 };
  });
  const blockingResults = invariantResults.filter((invariant) => invariant.blocking);
  const productionReady = blockingResults.length > 0
    && blockingResults.every((invariant) => invariant.productionReady);
  return {
    candidateSha: input.candidateSha,
    certificationStatus: productionReady ? "PRODUCTION_READY" as const : "NOT_READY" as const,
    contractVersion: PRODUCTION_READINESS_CERTIFICATION_VERSION,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    finality: productionReady ? "PRODUCTION_OBSERVED_FINAL_FOR_SCOPE" as const : "NOT_FINAL" as const,
    invariantResults,
  };
}
