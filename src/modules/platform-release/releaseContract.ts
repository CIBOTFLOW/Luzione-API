export const PLATFORM_RELEASE_EVIDENCE_VERSION = "luzione-release-evidence/v1";

export type ReleaseEnvironment = "LOCAL" | "PREVIEW" | "PRODUCTION";
export type ReleaseEvidenceTier = "LOCAL_PROVEN" | "PREVIEW_PROVEN" | "PRODUCTION_OBSERVED";

export type ReleaseEvidenceRef = {
  environment: ReleaseEnvironment;
  evidenceId: string;
  evidenceTier: ReleaseEvidenceTier;
  exactSha: string;
  kind: "BUILD" | "CANARY" | "HEALTH" | "PRODUCTION_OBSERVATION" | "ROLLBACK_REHEARSAL" | "SECURITY" | "TEST";
  observedAt: string;
  sourceRef: string;
  status: "FAIL" | "PASS" | "UNKNOWN";
};

export type ReleaseRecord = {
  candidateSha: string;
  canaryEvidence: readonly ReleaseEvidenceRef[];
  contractVersion: typeof PLATFORM_RELEASE_EVIDENCE_VERSION;
  contractVersions: readonly string[];
  deploymentId: string | null;
  endedAt: string | null;
  environment: ReleaseEnvironment;
  healthEvidence: readonly ReleaseEvidenceRef[];
  knownDeferredEvidence: readonly { blocking: boolean; description: string }[];
  migrationVersions: readonly string[];
  promotionDecision: "BLOCK" | "HOLD" | "PROMOTE_PREVIEW" | "PROMOTE_PRODUCTION" | "ROLLBACK";
  productionObservation: ReleaseEvidenceRef | null;
  repository: "CIBOTFLOW/Luzione-API";
  rollback: {
    capabilityState: "DOCUMENTED" | "NOT_ASSESSED" | "REHEARSED_LOCAL" | "REHEARSED_PREVIEW" | "PRODUCTION_OBSERVED";
    lastKnownGoodDeploymentId: string | null;
    rehearsalRef: string | null;
    strategy: string;
  };
  startedAt: string;
  verificationEvidence: readonly ReleaseEvidenceRef[];
};

const SHA = /^[0-9a-f]{40}$/;

function evidenceViolations(candidateSha: string, evidence: readonly ReleaseEvidenceRef[]) {
  const violations: string[] = [];
  const ids = new Set<string>();
  for (const item of evidence) {
    if (ids.has(item.evidenceId)) violations.push(`duplicate-evidence:${item.evidenceId}`);
    ids.add(item.evidenceId);
    if (item.exactSha !== candidateSha) violations.push(`sha-mismatch:${item.evidenceId}`);
    if (!Number.isFinite(Date.parse(item.observedAt))) violations.push(`invalid-observed-at:${item.evidenceId}`);
    if (item.evidenceTier === "PREVIEW_PROVEN" && item.environment !== "PREVIEW") violations.push(`preview-tier-mismatch:${item.evidenceId}`);
    if (item.evidenceTier === "PRODUCTION_OBSERVED" && item.environment !== "PRODUCTION") violations.push(`production-tier-mismatch:${item.evidenceId}`);
    if (item.evidenceTier === "LOCAL_PROVEN" && item.environment !== "LOCAL") violations.push(`local-tier-mismatch:${item.evidenceId}`);
  }
  return violations;
}

export function releaseRecordViolations(record: ReleaseRecord) {
  const allEvidence = [
    ...record.verificationEvidence,
    ...record.canaryEvidence,
    ...record.healthEvidence,
    ...(record.productionObservation ? [record.productionObservation] : []),
  ];
  const violations = SHA.test(record.candidateSha) ? [] : ["invalid-candidate-sha"];
  violations.push(...evidenceViolations(record.candidateSha, allEvidence));
  if (record.environment !== "LOCAL" && !record.deploymentId) violations.push("deployed-environment-missing-deployment-id");
  if (!record.contractVersions.length) violations.push("missing-contract-versions");
  if (!record.rollback.strategy.trim()) violations.push("missing-rollback-strategy");
  if (record.rollback.capabilityState.startsWith("REHEARSED") && !record.rollback.rehearsalRef) violations.push("missing-rollback-rehearsal");
  if (record.productionObservation
    && (record.environment !== "PRODUCTION" || record.productionObservation.kind !== "PRODUCTION_OBSERVATION")) {
    violations.push("invalid-production-observation");
  }
  if (record.endedAt && Date.parse(record.endedAt) < Date.parse(record.startedAt)) violations.push("invalid-release-window");
  return violations;
}

function hasPassing(record: ReleaseRecord, kind: ReleaseEvidenceRef["kind"], minimumTier: ReleaseEvidenceTier) {
  const rank: Record<ReleaseEvidenceTier, number> = { LOCAL_PROVEN: 0, PREVIEW_PROVEN: 1, PRODUCTION_OBSERVED: 2 };
  return [...record.verificationEvidence, ...record.canaryEvidence, ...record.healthEvidence]
    .some((item) => item.kind === kind && item.status === "PASS" && rank[item.evidenceTier] >= rank[minimumTier]);
}

export function deriveReleaseGate(record: ReleaseRecord) {
  const violations = releaseRecordViolations(record);
  if (violations.length) return { decisionAllowed: false, failures: violations, strongestClaim: "INVALID" as const };
  const failures = [
    ...(!hasPassing(record, "BUILD", "LOCAL_PROVEN") ? ["MISSING_PASSING_BUILD"] : []),
    ...(!hasPassing(record, "TEST", "LOCAL_PROVEN") ? ["MISSING_PASSING_TESTS"] : []),
    ...(record.verificationEvidence.some((item) => item.kind === "SECURITY" && item.status !== "PASS") ? ["SECURITY_GATE_BLOCKED"] : []),
    ...(record.knownDeferredEvidence.some((item) => item.blocking) ? ["BLOCKING_DEFERRED_EVIDENCE"] : []),
  ];
  if (record.promotionDecision === "PROMOTE_PRODUCTION") {
    if (!hasPassing(record, "CANARY", "PREVIEW_PROVEN")) failures.push("MISSING_PREVIEW_CANARY");
    if (!hasPassing(record, "HEALTH", "PREVIEW_PROVEN")) failures.push("MISSING_PREVIEW_HEALTH");
    if (!["REHEARSED_PREVIEW", "PRODUCTION_OBSERVED"].includes(record.rollback.capabilityState)) failures.push("ROLLBACK_NOT_PREVIEW_REHEARSED");
  }
  if (record.productionObservation?.status !== "PASS") {
    return { decisionAllowed: failures.length === 0, failures, strongestClaim: failures.length ? "BLOCKED" as const : "RELEASE_CANDIDATE" as const };
  }
  return {
    decisionAllowed: failures.length === 0,
    failures,
    strongestClaim: failures.length ? "BLOCKED" as const : "PRODUCTION_OBSERVED_FINAL_FOR_SCOPE" as const,
  };
}

export function createReleaseRecord(input: Omit<ReleaseRecord, "contractVersion" | "repository">): ReleaseRecord {
  const record: ReleaseRecord = {
    ...input,
    contractVersion: PLATFORM_RELEASE_EVIDENCE_VERSION,
    contractVersions: [...new Set(input.contractVersions)].sort(),
    migrationVersions: [...new Set(input.migrationVersions)].sort(),
    repository: "CIBOTFLOW/Luzione-API",
  };
  const violations = releaseRecordViolations(record);
  if (violations.length) throw new Error(`Invalid release record: ${violations.join(",")}`);
  return record;
}

export const releaseEvidenceLaw = Object.freeze({
  deploymentAcknowledgementIsBusinessCompletion: false,
  productionPromotionRequiresPreviewCanaryAndRollbackRehearsal: true,
  productionFinalityRequiresProductionObservation: true,
  securityFailuresAreZeroTolerance: true,
});
