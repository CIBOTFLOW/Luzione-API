import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  PRODUCTION_CONVERGENCE_EVIDENCE_VERSION,
  evaluateProductionConvergenceEvidence,
  productionConvergenceEvidenceViolations,
  type ProductionConvergenceEvidenceBundle,
} from "../evidence";
import {
  operationalAlertRegistry,
  operationalDashboardRegistry,
  operationsRegistryViolations,
} from "../registry";
import { createReleaseRecord } from "@/modules/platform-release/releaseContract";
import { sloRegistry } from "@/modules/platform-slo/registry";

const sha = "a".repeat(40);
const observedAt = "2026-08-31T05:00:00.000Z";

function localBundle(): ProductionConvergenceEvidenceBundle {
  const evidence = (evidenceId: string, kind: "BUILD" | "SECURITY" | "TEST") => ({
    environment: "LOCAL" as const,
    evidenceId,
    evidenceTier: "LOCAL_PROVEN" as const,
    exactSha: sha,
    kind,
    observedAt,
    sourceRef: `local:${evidenceId}`,
    status: "PASS" as const,
  });
  return {
    alertIds: operationalAlertRegistry.map((item) => item.alertId),
    candidateSha: sha,
    contractVersion: PRODUCTION_CONVERGENCE_EVIDENCE_VERSION,
    dashboardIds: operationalDashboardRegistry.map((item) => item.dashboardId),
    deferredEvidence: [{ blocking: true, description: "Managed and deployed observations are unavailable." }],
    environment: "LOCAL",
    evaluatedAt: observedAt,
    productionObservation: null,
    recoveryObservations: [{ environment: "LOCAL", evidenceId: "local-restore", evidenceTier: "LOCAL_PROVEN", exactSha: sha, kind: "LOCAL_LOGICAL_RESTORE", observedAt, readbackMatched: true, sourceRef: "local:restore", status: "PASS" }],
    releaseRecord: createReleaseRecord({
      candidateSha: sha,
      canaryEvidence: [],
      contractVersions: [PRODUCTION_CONVERGENCE_EVIDENCE_VERSION],
      deploymentId: null,
      endedAt: observedAt,
      environment: "LOCAL",
      healthEvidence: [],
      knownDeferredEvidence: [],
      migrationVersions: ["20260831090000"],
      promotionDecision: "HOLD",
      productionObservation: null,
      rollback: { capabilityState: "REHEARSED_LOCAL", lastKnownGoodDeploymentId: null, rehearsalRef: "local:rollback", strategy: "Discard the candidate and restore the prior local fixture." },
      startedAt: "2026-08-31T04:59:00.000Z",
      verificationEvidence: [evidence("local-build", "BUILD"), evidence("local-tests", "TEST"), evidence("local-security", "SECURITY")],
    }),
    rollbackObservations: [{ environment: "LOCAL", evidenceId: "local-rollback", evidenceTier: "LOCAL_PROVEN", exactSha: sha, observedAt, readbackMatched: true, sourceRef: "local:rollback", status: "PASS" }],
    securityObservations: [{ environment: "LOCAL", evidenceId: "local-security-observation", evidenceTier: "LOCAL_PROVEN", exactSha: sha, observedAt, sourceRef: "local:security", status: "PASS" }],
    sloWindows: [],
  };
}

test("dashboard and alert definitions cover only registered signals and resolve runbooks", () => {
  assert.deepEqual(operationsRegistryViolations(), []);
  assert.equal(operationalDashboardRegistry.length, 3);
  assert.ok(operationalAlertRegistry.some((item) => item.zeroTolerance));
  for (const dashboard of operationalDashboardRegistry) for (const path of dashboard.runbookRefs) assert.ok(existsSync(path), path);
  for (const alert of operationalAlertRegistry) assert.ok(existsSync(alert.runbookRef), alert.runbookRef);
  const bad = [{ ...operationalDashboardRegistry[0], panels: [{ ...operationalDashboardRegistry[0].panels[0], metricNames: ["unknown.metric"] }] }];
  assert.ok(operationsRegistryViolations(bad, operationalAlertRegistry).some((item) => item.startsWith("unknown-panel-metric:")));
});

test("a complete exact-SHA local package stays bounded and names every external blocker", () => {
  const bundle = localBundle();
  assert.deepEqual(productionConvergenceEvidenceViolations(bundle), []);
  const result = evaluateProductionConvergenceEvidence(bundle);
  assert.equal(result.strongestClaim, "LOCAL_EVIDENCE_BOUNDED");
  assert.equal(result.productionReady, false);
  for (const slo of sloRegistry) assert.ok(result.failures.includes(`production-slo-window-missing:${slo.sloId}`));
  assert.ok(result.failures.includes("managed-production-restore-missing"));
  assert.ok(result.failures.includes("preview-rollback-rehearsal-missing"));
  assert.ok(result.failures.includes("production-security-observation-missing"));
  assert.ok(result.failures.includes("production-observation-missing"));
  assert.ok(result.failures.includes("blocking-deferred-evidence"));
});

test("SHA drift and configuration-shaped production evidence fail validation", () => {
  const bundle = localBundle();
  const bad = {
    ...bundle,
    recoveryObservations: [{ ...bundle.recoveryObservations[0], exactSha: "b".repeat(40) }],
  };
  assert.ok(productionConvergenceEvidenceViolations(bad).includes("sha-mismatch:local-restore"));
  assert.equal(evaluateProductionConvergenceEvidence(bad).strongestClaim, "INVALID");
});

test("catalog publishes definitions, not invented deployed observations", () => {
  const route = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(route, /operationalDashboardRegistry/);
  assert.match(route, /operationalAlertRegistry/);
  assert.match(route, /PRODUCTION_CONVERGENCE_EVIDENCE_VERSION/);
  assert.ok(operationalDashboardRegistry.every((item) => item.evidenceState === "DEFINED_NOT_DEPLOYED"));
  assert.ok(operationalAlertRegistry.every((item) => item.evidenceState === "DEFINED_NOT_DEPLOYED"));
});
