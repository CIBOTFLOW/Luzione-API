import assert from "node:assert/strict";
import test from "node:test";
import {
  certifyProductionReadiness,
  type ProductionReadinessCertificationInput,
  type ProductionReadinessInvariant,
  productionReadinessInputViolations,
} from "../certification";

const CANDIDATE_SHA = "a".repeat(40);

function productionInvariant(overrides: Partial<ProductionReadinessInvariant> = {}): ProductionReadinessInvariant {
  return {
    assertionStatus: "PASS",
    blocking: true,
    evidenceCandidateSha: CANDIDATE_SHA,
    evidenceRef: "production:synthetic-and-readback",
    evidenceTier: "PRODUCTION_OBSERVED",
    invariantId: "tenant-command-readback",
    latestObservedAt: "2026-08-29T23:59:00.000Z",
    openFailureRefs: [],
    owner: "Luzione API platform owner",
    recoveryObjectiveRef: "runbook:command-recovery",
    recoveryPosture: "PRODUCTION_EXERCISED",
    remainingUncertainty: [],
    sourceEnvironment: "production",
    validForMs: 300_000,
    ...overrides,
  };
}

function input(invariants: readonly ProductionReadinessInvariant[]): ProductionReadinessCertificationInput {
  return {
    candidateSha: CANDIDATE_SHA,
    evaluatedAt: "2026-08-30T00:00:00.000Z",
    invariants,
  };
}

test("production readiness requires fresh exact-candidate observations for every blocking invariant", () => {
  const certificate = certifyProductionReadiness(input([
    productionInvariant(),
    productionInvariant({ invariantId: "release-recovery", recoveryPosture: "NOT_APPLICABLE", recoveryObjectiveRef: null }),
  ]));
  assert.equal(certificate.certificationStatus, "PRODUCTION_READY");
  assert.equal(certificate.finality, "PRODUCTION_OBSERVED_FINAL_FOR_SCOPE");
  assert.ok(certificate.invariantResults.every((item) => item.productionReady));
});

test("passing local evidence cannot become a production pass", () => {
  const certificate = certifyProductionReadiness(input([
    productionInvariant({
      evidenceTier: "LOCAL_PROVEN",
      sourceEnvironment: "local",
      recoveryPosture: "LOCAL_EXERCISED",
    }),
  ]));
  assert.equal(certificate.certificationStatus, "NOT_READY");
  assert.equal(certificate.finality, "NOT_FINAL");
  assert.ok(certificate.invariantResults[0].blockers.includes("evidence-tier:LOCAL_PROVEN"));
  assert.ok(certificate.invariantResults[0].blockers.includes("recovery:LOCAL_EXERCISED"));
});

test("SHA drift, stale evidence, open failures and uncertainty independently block finality", () => {
  const certificate = certifyProductionReadiness(input([
    productionInvariant({
      evidenceCandidateSha: "b".repeat(40),
      latestObservedAt: "2026-08-29T20:00:00.000Z",
      openFailureRefs: ["FAILURE-1"],
      remainingUncertainty: ["source readback was inferred"],
    }),
  ]));
  const blockers = certificate.invariantResults[0].blockers;
  assert.ok(blockers.includes("candidate-sha-mismatch"));
  assert.ok(blockers.includes("freshness:STALE"));
  assert.ok(blockers.includes("open-failures"));
  assert.ok(blockers.includes("remaining-uncertainty"));
});

test("invalid and configuration-only evidence cannot express a supported production observation", () => {
  const configured = productionInvariant({
    evidenceCandidateSha: null,
    evidenceRef: null,
    evidenceTier: "NOT_ASSESSED",
    latestObservedAt: null,
    sourceEnvironment: "unknown",
  });
  assert.deepEqual(productionReadinessInputViolations(input([configured])), []);
  assert.equal(certifyProductionReadiness(input([configured])).certificationStatus, "NOT_READY");

  const invalidProduction = productionInvariant({ sourceEnvironment: "preview" });
  assert.ok(productionReadinessInputViolations(input([invalidProduction]))
    .includes("production-environment-mismatch:tenant-command-readback"));
  assert.throws(() => certifyProductionReadiness(input([invalidProduction])));
});
