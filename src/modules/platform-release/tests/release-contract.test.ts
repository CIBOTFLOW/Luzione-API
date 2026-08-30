import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createReleaseRecord,
  deriveReleaseGate,
  releaseEvidenceLaw,
  type ReleaseEvidenceRef,
} from "../releaseContract";

const sha = "c".repeat(40);
const localEvidence = (kind: ReleaseEvidenceRef["kind"], evidenceId: string): ReleaseEvidenceRef => ({
  environment: "LOCAL",
  evidenceId,
  evidenceTier: "LOCAL_PROVEN",
  exactSha: sha,
  kind,
  observedAt: "2026-08-30T00:00:00.000Z",
  sourceRef: `local:${evidenceId}`,
  status: "PASS",
});

function localRecord() {
  return createReleaseRecord({
    candidateSha: sha,
    canaryEvidence: [],
    contractVersions: ["luzione-release-evidence/v1"],
    deploymentId: null,
    endedAt: "2026-08-30T00:10:00.000Z",
    environment: "LOCAL",
    healthEvidence: [],
    knownDeferredEvidence: [{ blocking: false, description: "preview deployment" }],
    migrationVersions: [],
    promotionDecision: "HOLD",
    productionObservation: null,
    rollback: { capabilityState: "DOCUMENTED", lastKnownGoodDeploymentId: null, rehearsalRef: null, strategy: "Discard local artifact." },
    startedAt: "2026-08-30T00:00:00.000Z",
    verificationEvidence: [localEvidence("BUILD", "build"), localEvidence("TEST", "tests")],
  });
}

test("local build and test evidence supports only a bounded release candidate", () => {
  const gate = deriveReleaseGate(localRecord());
  assert.equal(gate.decisionAllowed, true);
  assert.equal(gate.strongestClaim, "RELEASE_CANDIDATE");
  assert.equal(releaseEvidenceLaw.deploymentAcknowledgementIsBusinessCompletion, false);
});

test("SHA mismatch and deployment-only records fail closed", () => {
  assert.throws(() => createReleaseRecord({
    ...localRecord(),
    candidateSha: "a".repeat(40),
  }), /sha-mismatch/);
  const noTests = { ...localRecord(), verificationEvidence: [] };
  assert.ok(deriveReleaseGate(noTests).failures.includes("MISSING_PASSING_BUILD"));
  assert.ok(deriveReleaseGate(noTests).failures.includes("MISSING_PASSING_TESTS"));
});

test("production promotion requires preview canary, health and rollback rehearsal", () => {
  const candidate = { ...localRecord(), promotionDecision: "PROMOTE_PRODUCTION" as const };
  const failures = deriveReleaseGate(candidate).failures;
  assert.ok(failures.includes("MISSING_PREVIEW_CANARY"));
  assert.ok(failures.includes("MISSING_PREVIEW_HEALTH"));
  assert.ok(failures.includes("ROLLBACK_NOT_PREVIEW_REHEARSED"));
});

test("production finality cannot be claimed without production observation", () => {
  assert.notEqual(deriveReleaseGate(localRecord()).strongestClaim, "PRODUCTION_OBSERVED_FINAL_FOR_SCOPE");
  const catalog = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(catalog, /releaseEvidence:/);
  assert.match(catalog, /releaseEvidenceLaw/);
});
