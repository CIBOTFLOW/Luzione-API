import { deriveReleaseGate, releaseRecordViolations, type ReleaseEvidenceTier, type ReleaseRecord } from "@/modules/platform-release/releaseContract";
import { operationalAlertRegistry, operationalDashboardRegistry } from "@/modules/platform-operations/registry";
import { sloRegistry } from "@/modules/platform-slo/registry";

export const PRODUCTION_CONVERGENCE_EVIDENCE_VERSION = "luzione-production-convergence-evidence/v0.1";

type Environment = "LOCAL" | "PREVIEW" | "PRODUCTION";
type EvidenceStatus = "FAIL" | "PASS" | "UNKNOWN";

export type SloWindowEvidence = {
  environment: Environment;
  evidenceId: string;
  evidenceTier: ReleaseEvidenceTier;
  exactSha: string;
  observedAt: string;
  sampleCount: number;
  sloId: string;
  sourceRef: string;
  status: EvidenceStatus;
  windowEndedAt: string;
  windowStartedAt: string;
};

export type RecoveryObservation = {
  environment: Environment;
  evidenceId: string;
  evidenceTier: ReleaseEvidenceTier;
  exactSha: string;
  kind: "LOCAL_LOGICAL_RESTORE" | "MANAGED_BACKUP_RESTORE" | "MANAGED_PITR_RESTORE";
  observedAt: string;
  readbackMatched: boolean;
  sourceRef: string;
  status: EvidenceStatus;
};

export type RollbackObservation = {
  environment: Environment;
  evidenceId: string;
  evidenceTier: ReleaseEvidenceTier;
  exactSha: string;
  observedAt: string;
  readbackMatched: boolean;
  sourceRef: string;
  status: EvidenceStatus;
};

export type ProductionConvergenceEvidenceBundle = {
  alertIds: readonly string[];
  candidateSha: string;
  contractVersion: typeof PRODUCTION_CONVERGENCE_EVIDENCE_VERSION;
  dashboardIds: readonly string[];
  deferredEvidence: readonly { blocking: boolean; description: string }[];
  environment: Environment;
  evaluatedAt: string;
  productionObservation: { evidenceId: string; exactSha: string; observedAt: string; sourceRef: string; status: EvidenceStatus } | null;
  recoveryObservations: readonly RecoveryObservation[];
  releaseRecord: ReleaseRecord;
  rollbackObservations: readonly RollbackObservation[];
  securityObservations: readonly { environment: Environment; evidenceId: string; evidenceTier: ReleaseEvidenceTier; exactSha: string; observedAt: string; sourceRef: string; status: EvidenceStatus }[];
  sloWindows: readonly SloWindowEvidence[];
};

const SHA = /^[0-9a-f]{40}$/;

function validTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function observationViolations(candidateSha: string, observations: readonly { environment: Environment; evidenceId: string; evidenceTier: ReleaseEvidenceTier; exactSha: string; observedAt: string; sourceRef: string }[]) {
  const violations: string[] = [];
  for (const observation of observations) {
    if (observation.exactSha !== candidateSha) violations.push(`sha-mismatch:${observation.evidenceId}`);
    if (!validTimestamp(observation.observedAt)) violations.push(`invalid-observed-at:${observation.evidenceId}`);
    if (!observation.sourceRef.trim()) violations.push(`missing-source:${observation.evidenceId}`);
    if (observation.evidenceTier === "LOCAL_PROVEN" && observation.environment !== "LOCAL") violations.push(`local-environment-mismatch:${observation.evidenceId}`);
    if (observation.evidenceTier === "PREVIEW_PROVEN" && observation.environment !== "PREVIEW") violations.push(`preview-environment-mismatch:${observation.evidenceId}`);
    if (observation.evidenceTier === "PRODUCTION_OBSERVED" && observation.environment !== "PRODUCTION") violations.push(`production-environment-mismatch:${observation.evidenceId}`);
  }
  return violations;
}

export function productionConvergenceEvidenceViolations(bundle: ProductionConvergenceEvidenceBundle) {
  const violations = SHA.test(bundle.candidateSha) ? [] : ["invalid-candidate-sha"];
  if (bundle.contractVersion !== PRODUCTION_CONVERGENCE_EVIDENCE_VERSION) violations.push("contract-version-mismatch");
  if (!validTimestamp(bundle.evaluatedAt)) violations.push("invalid-evaluated-at");
  if (bundle.releaseRecord.candidateSha !== bundle.candidateSha) violations.push("release-candidate-mismatch");
  if (bundle.releaseRecord.environment !== bundle.environment) violations.push("release-environment-mismatch");
  violations.push(...releaseRecordViolations(bundle.releaseRecord).map((item) => `release:${item}`));
  const expectedDashboards = new Set(operationalDashboardRegistry.map((item) => item.dashboardId));
  const expectedAlerts = new Set(operationalAlertRegistry.map((item) => item.alertId));
  if (new Set(bundle.dashboardIds).size !== bundle.dashboardIds.length) violations.push("duplicate-dashboard-evidence");
  if (new Set(bundle.alertIds).size !== bundle.alertIds.length) violations.push("duplicate-alert-evidence");
  for (const id of bundle.dashboardIds) if (!expectedDashboards.has(id)) violations.push(`unknown-dashboard:${id}`);
  for (const id of bundle.alertIds) if (!expectedAlerts.has(id)) violations.push(`unknown-alert:${id}`);
  const allObservations = [...bundle.sloWindows, ...bundle.recoveryObservations, ...bundle.rollbackObservations, ...bundle.securityObservations];
  const evidenceIds = new Set<string>();
  for (const observation of allObservations) {
    if (evidenceIds.has(observation.evidenceId)) violations.push(`duplicate-evidence:${observation.evidenceId}`);
    evidenceIds.add(observation.evidenceId);
  }
  violations.push(...observationViolations(bundle.candidateSha, allObservations));
  const sloIds = new Set(sloRegistry.map((item) => item.sloId));
  for (const window of bundle.sloWindows) {
    if (!sloIds.has(window.sloId)) violations.push(`unknown-slo:${window.sloId}`);
    if (!Number.isInteger(window.sampleCount) || window.sampleCount < 0) violations.push(`invalid-sample-count:${window.evidenceId}`);
    if (!validTimestamp(window.windowStartedAt) || !validTimestamp(window.windowEndedAt)
      || Date.parse(window.windowEndedAt) <= Date.parse(window.windowStartedAt)) violations.push(`invalid-slo-window:${window.evidenceId}`);
  }
  if (bundle.productionObservation) {
    if (bundle.productionObservation.exactSha !== bundle.candidateSha) violations.push(`sha-mismatch:${bundle.productionObservation.evidenceId}`);
    if (!validTimestamp(bundle.productionObservation.observedAt)) violations.push(`invalid-observed-at:${bundle.productionObservation.evidenceId}`);
    if (!bundle.productionObservation.sourceRef.trim()) violations.push(`missing-source:${bundle.productionObservation.evidenceId}`);
  }
  return violations;
}

export function evaluateProductionConvergenceEvidence(bundle: ProductionConvergenceEvidenceBundle) {
  const validationFailures = productionConvergenceEvidenceViolations(bundle);
  if (validationFailures.length) return { failures: validationFailures, productionReady: false, strongestClaim: "INVALID" as const };
  const failures: string[] = [];
  const releaseGate = deriveReleaseGate(bundle.releaseRecord);
  failures.push(...releaseGate.failures.map((item) => `release:${item}`));
  const dashboardIds = new Set(bundle.dashboardIds);
  for (const item of operationalDashboardRegistry) if (!dashboardIds.has(item.dashboardId)) failures.push(`dashboard-unbound:${item.dashboardId}`);
  const alertIds = new Set(bundle.alertIds);
  for (const item of operationalAlertRegistry) if (!alertIds.has(item.alertId)) failures.push(`alert-unbound:${item.alertId}`);
  for (const slo of sloRegistry) {
    const observed = bundle.sloWindows.some((item) => item.sloId === slo.sloId && item.environment === "PRODUCTION"
      && item.evidenceTier === "PRODUCTION_OBSERVED" && item.status === "PASS" && item.sampleCount > 0);
    if (!observed) failures.push(`production-slo-window-missing:${slo.sloId}`);
  }
  if (!bundle.recoveryObservations.some((item) => item.environment === "PRODUCTION" && item.evidenceTier === "PRODUCTION_OBSERVED"
    && ["MANAGED_BACKUP_RESTORE", "MANAGED_PITR_RESTORE"].includes(item.kind) && item.status === "PASS" && item.readbackMatched)) {
    failures.push("managed-production-restore-missing");
  }
  if (!bundle.rollbackObservations.some((item) => item.environment === "PREVIEW" && item.evidenceTier === "PREVIEW_PROVEN"
    && item.status === "PASS" && item.readbackMatched)) failures.push("preview-rollback-rehearsal-missing");
  if (!bundle.securityObservations.some((item) => item.environment === "PRODUCTION" && item.evidenceTier === "PRODUCTION_OBSERVED" && item.status === "PASS")) {
    failures.push("production-security-observation-missing");
  }
  if (!bundle.productionObservation || bundle.productionObservation.status !== "PASS") failures.push("production-observation-missing");
  if (bundle.deferredEvidence.some((item) => item.blocking)) failures.push("blocking-deferred-evidence");
  const productionReady = bundle.environment === "PRODUCTION"
    && releaseGate.strongestClaim === "PRODUCTION_OBSERVED_FINAL_FOR_SCOPE"
    && failures.length === 0;
  return {
    failures: [...new Set(failures)],
    productionReady,
    strongestClaim: productionReady
      ? "PRODUCTION_OBSERVED_FINAL_FOR_SCOPE" as const
      : bundle.environment === "PREVIEW"
        ? "PREVIEW_EVIDENCE_BOUNDED" as const
        : "LOCAL_EVIDENCE_BOUNDED" as const,
  };
}
