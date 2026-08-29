import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateLearningCandidate } from "../evaluator";
import type {
  GuardianLearningReview,
  LearningCandidate,
  LearningEvaluationContext,
} from "../types";

const tenantId = "tenant_luzione";
const context: LearningEvaluationContext = {
  canonicalGuardianIds: ["guardian_a", "guardian_b", "guardian_c"],
  evaluatorActorId: "service_learning_gate",
  now: "2026-08-29T12:00:00.000Z",
};

function guardian(
  reviewerId: string,
  decision: GuardianLearningReview["decision"] = "APPROVE",
): GuardianLearningReview {
  return {
    candidateId: "candidate_1",
    candidateVersion: 7,
    decision,
    expiresAt: "2026-08-30T12:00:00.000Z",
    reviewerId,
    tenantId,
    verification: "CANONICAL_STORE",
  };
}

function candidate(overrides: Partial<LearningCandidate> = {}): LearningCandidate {
  return {
    candidateId: "candidate_1",
    canaryPassed: true,
    changesActionEligibility: false,
    evidence: [
      {
        contentHash: "a".repeat(64),
        promptInjectionDetected: false,
        provenanceRef: "outcome:1",
        sourceType: "VERIFIED_OUTCOME",
        tenantId,
        verified: true,
      },
      {
        contentHash: "b".repeat(64),
        promptInjectionDetected: false,
        provenanceRef: "provider:2",
        sourceType: "PROVIDER_READBACK",
        tenantId,
        verified: true,
      },
      {
        contentHash: "c".repeat(64),
        promptInjectionDetected: false,
        provenanceRef: "outcome:3",
        sourceType: "VERIFIED_OUTCOME",
        tenantId,
        verified: true,
      },
    ],
    feedback: ["actor_a", "actor_b", "actor_c", "actor_d"].map((actorId) => ({
      actorId,
      influenceWeight: 1,
      maliciousSignal: false,
      outcomeVerified: true,
      tenantId,
      verifiedByServer: true,
    })),
    guardianReviews: [],
    kind: "SKILL",
    lastKnownGoodVersion: "6",
    metrics: {
      baselineTaskSuccess: 0.82,
      calibrationError: 0.08,
      candidateTaskSuccess: 0.93,
      dataLeakageEvents: 0,
      distributionShiftScore: 0.08,
      humanOverrideRate: 0.08,
      improvementLowerBound: 0.04,
      independentEligibleEpisodes: 300,
      rareEventSuitePassed: true,
      readbackFailures: 0,
      safetyRegressionRate: 0,
      tenantBoundaryViolations: 0,
      unexplainedCostRatio: 1.05,
      unresolvedUnsafeOutcomes: 0,
      verifiedOutcomeCoverage: 0.4,
    },
    proposedByActorId: "sultan",
    proposedByActorType: "agent",
    rollbackTested: true,
    simulationPassed: true,
    stage: "CANARY",
    tenantId,
    version: 7,
    ...overrides,
  };
}

test("a fully evidenced canary becomes promotion-eligible but never promotes itself", () => {
  const result = evaluateLearningCandidate(candidate(), context);
  assert.equal(result.decision, "PROMOTION_ELIGIBLE");
  assert.deepEqual(result.reasonCodes, ["PROMOTION_GATES_PASSED"]);
  assert.equal(result.promotionExecuted, false);
  assert.equal(result.externalEffectsAuthorized, false);
});

test("evaluation receipts are deterministic for the exact candidate version and evidence", () => {
  const first = evaluateLearningCandidate(candidate(), context);
  const retry = evaluateLearningCandidate(candidate(), context);
  assert.equal(first.receiptId, retry.receiptId);
  assert.equal(first.receiptHash, retry.receiptHash);
});

test("memory poisoning is quarantined and cannot enter retrieval", () => {
  const poisoned = candidate({
    evidence: [{
      contentHash: "d".repeat(64),
      promptInjectionDetected: true,
      provenanceRef: "memory:poisoned",
      sourceType: "MODEL_OUTPUT",
      tenantId,
      verified: false,
    }],
    kind: "MEMORY",
  });
  const result = evaluateLearningCandidate(poisoned, context);
  assert.equal(result.decision, "QUARANTINE");
  assert.deepEqual(result.reasonCodes, ["MEMORY_POISONING_DETECTED"]);
});

test("cross-tenant evidence fails closed before content is promoted or retrieved", () => {
  const otherTenantEvidence = candidate().evidence.map((item, index) =>
    index === 0 ? { ...item, tenantId: "tenant_other" } : item,
  );
  const result = evaluateLearningCandidate(candidate({ evidence: otherTenantEvidence }), context);
  assert.equal(result.decision, "QUARANTINE");
  assert.ok(result.reasonCodes.includes("CROSS_TENANT_EVIDENCE"));
  assert.ok(result.reasonCodes.includes("TENANT_BOUNDARY_VIOLATION"));
});

test("malicious feedback is preserved for audit but excluded from learning", () => {
  const feedback = candidate().feedback.map((item, index) =>
    index === 0 ? { ...item, maliciousSignal: true } : item,
  );
  const result = evaluateLearningCandidate(candidate({ feedback }), context);
  assert.equal(result.decision, "QUARANTINE");
  assert.deepEqual(result.reasonCodes, ["MALICIOUS_FEEDBACK_DETECTED"]);
});

test("one actor cannot dominate a learning candidate", () => {
  const feedback = candidate().feedback.map((item, index) => ({
    ...item,
    influenceWeight: index === 0 ? 8 : 1,
  }));
  const result = evaluateLearningCandidate(candidate({ feedback }), context);
  assert.equal(result.decision, "SHADOW_ONLY");
  assert.ok(result.reasonCodes.includes("FEEDBACK_CONCENTRATION_TOO_HIGH"));
});

test("distribution shift and rare-event failure keep a candidate in shadow", () => {
  const baseline = candidate();
  const result = evaluateLearningCandidate(candidate({
    metrics: {
      ...baseline.metrics,
      distributionShiftScore: 0.31,
      rareEventSuitePassed: false,
    },
  }), context);
  assert.equal(result.decision, "SHADOW_ONLY");
  assert.ok(result.reasonCodes.includes("DISTRIBUTION_SHIFT_DETECTED"));
  assert.ok(result.reasonCodes.includes("RARE_EVENT_SUITE_FAILED"));
});

test("a deployed safety regression emits a rollback requirement without executing it", () => {
  const baseline = candidate();
  const result = evaluateLearningCandidate(candidate({
    metrics: {
      ...baseline.metrics,
      dataLeakageEvents: 1,
      readbackFailures: 1,
      safetyRegressionRate: 0.01,
    },
    stage: "DEPLOYED",
  }), context);
  assert.equal(result.decision, "ROLLBACK_REQUIRED");
  assert.equal(result.rollbackTargetVersion, "6");
  assert.equal(result.rollbackExecuted, false);
  assert.ok(result.reasonCodes.includes("DATA_LEAKAGE_DETECTED"));
  assert.ok(result.reasonCodes.includes("READBACK_FAILURE_DETECTED"));
  assert.ok(result.reasonCodes.includes("SAFETY_REGRESSION_DETECTED"));
});

test("an action-eligibility policy needs two independent guardians and excludes Sultan", () => {
  const insufficient = evaluateLearningCandidate(candidate({
    changesActionEligibility: true,
    guardianReviews: [guardian("guardian_a"), guardian("sultan")],
    kind: "ACTION_POLICY",
  }), context);
  assert.equal(insufficient.decision, "GUARDIAN_REVIEW_REQUIRED");
  assert.deepEqual(insufficient.reasonCodes, ["GUARDIAN_QUORUM_REQUIRED"]);

  const approved = evaluateLearningCandidate(candidate({
    changesActionEligibility: true,
    guardianReviews: [guardian("guardian_a"), guardian("guardian_b")],
    kind: "ACTION_POLICY",
  }), context);
  assert.equal(approved.decision, "PROMOTION_ELIGIBLE");
  assert.equal(approved.promotionExecuted, false);
});

test("the Supabase ledger is RLS-denied to clients and keeps receipts immutable", () => {
  const migration = readFileSync(
    "supabase/migrations/20260829010000_learning_candidate_promotion_and_rollback_receipts.sql",
    "utf8",
  );
  for (const table of [
    "learning_candidate_versions",
    "learning_evaluation_receipts",
    "learning_promotion_receipts",
    "learning_rollback_receipts",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`),
    );
  }
  assert.match(migration, /before update or delete on public\.learning_evaluation_receipts/);
  assert.match(migration, /decision is distinct from 'PROMOTION_ELIGIBLE'/);
  assert.match(migration, /decision is distinct from 'ROLLBACK_REQUIRED'/);
  assert.match(migration, /check \(not external_effects_authorized\)/);

  const tenantIntegrity = readFileSync(
    "supabase/migrations/20260829011000_learning_receipt_tenant_integrity.sql",
    "utf8",
  );
  assert.match(tenantIntegrity, /learning_evaluation_receipts_tenant_candidate_fk/);
  assert.match(tenantIntegrity, /learning_promotion_receipts_tenant_evaluation_fk/);
  assert.match(tenantIntegrity, /learning_rollback_receipts_tenant_evaluation_fk/);
  assert.match(tenantIntegrity, /Cross-tenant learning evaluation receipt exists/);
});
