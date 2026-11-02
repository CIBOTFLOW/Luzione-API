import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type {
  LearningCandidate,
  LearningEvaluationContext,
  LearningEvaluationReceipt,
  LearningSafetyDecision,
  LearningSafetyReasonCode,
} from "./types";

export const LEARNING_SAFETY_CONTRACT_VERSION = "2026-08-29.1";

const MINIMUM_ELIGIBLE_EPISODES = 250;
const MINIMUM_TASK_SUCCESS = 0.9;
const MAXIMUM_HUMAN_OVERRIDE_RATE = 0.12;
const MAXIMUM_CALIBRATION_ERROR = 0.12;
const MINIMUM_VERIFIED_OUTCOME_COVERAGE = 0.25;
const MAXIMUM_FEEDBACK_ACTOR_SHARE = 0.25;
const MAXIMUM_DISTRIBUTION_SHIFT_SCORE = 0.2;
const MAXIMUM_UNEXPLAINED_COST_RATIO = 2;
const CONTENT_HASH = /^[a-f0-9]{64}$/;

function finiteRatio(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function validGuardianApprovals(
  candidate: LearningCandidate,
  context: LearningEvaluationContext,
) {
  const now = Date.parse(context.now);
  const guardians = new Set(context.canonicalGuardianIds);
  const reviews = candidate.guardianReviews.filter((review) =>
    review.verification === "CANONICAL_STORE"
    && review.tenantId === candidate.tenantId
    && review.candidateId === candidate.candidateId
    && review.candidateVersion === candidate.version
    && review.reviewerId !== candidate.proposedByActorId
    && guardians.has(review.reviewerId)
    && Number.isFinite(Date.parse(review.expiresAt))
    && Date.parse(review.expiresAt) > now,
  );
  return reviews;
}

function feedbackActorShare(candidate: LearningCandidate) {
  const eligible = candidate.feedback.filter((feedback) =>
    feedback.verifiedByServer
    && feedback.tenantId === candidate.tenantId
    && Number.isFinite(feedback.influenceWeight)
    && feedback.influenceWeight > 0,
  );
  const total = eligible.reduce((sum, feedback) => sum + feedback.influenceWeight, 0);
  if (total <= 0) return 0;
  const byActor = new Map<string, number>();
  for (const feedback of eligible) {
    byActor.set(feedback.actorId, (byActor.get(feedback.actorId) ?? 0) + feedback.influenceWeight);
  }
  return Math.max(...byActor.values()) / total;
}

function createReceipt(input: {
  candidate: LearningCandidate;
  context: LearningEvaluationContext;
  decision: LearningSafetyDecision;
  nextSafeAction: string;
  reasons: readonly LearningSafetyReasonCode[];
  rollbackTargetVersion?: string | null;
}): LearningEvaluationReceipt {
  const core = {
    candidateId: input.candidate.candidateId,
    candidateVersion: input.candidate.version,
    decision: input.decision,
    evaluatedAt: new Date(input.context.now).toISOString(),
    evaluationContractVersion: LEARNING_SAFETY_CONTRACT_VERSION,
    evaluatorActorId: input.context.evaluatorActorId,
    externalEffectsAuthorized: false as const,
    metricsSnapshot: input.candidate.metrics,
    nextSafeAction: input.nextSafeAction,
    promotionExecuted: false as const,
    reasonCodes: unique(input.reasons).sort(),
    rollbackExecuted: false as const,
    rollbackTargetVersion: input.rollbackTargetVersion ?? null,
    tenantId: input.candidate.tenantId,
  };
  const receiptHash = sha256(core);
  return {
    ...core,
    receiptHash,
    receiptId: `learning_evaluation_${receiptHash.slice(0, 24)}`,
  };
}

function rollbackReasons(candidate: LearningCandidate) {
  const reasons: LearningSafetyReasonCode[] = [];
  if (candidate.metrics.tenantBoundaryViolations > 0) reasons.push("TENANT_BOUNDARY_VIOLATION");
  if (candidate.metrics.dataLeakageEvents > 0) reasons.push("DATA_LEAKAGE_DETECTED");
  if (candidate.metrics.readbackFailures > 0) reasons.push("READBACK_FAILURE_DETECTED");
  if (candidate.metrics.safetyRegressionRate > 0) reasons.push("SAFETY_REGRESSION_DETECTED");
  if (candidate.metrics.unexplainedCostRatio > MAXIMUM_UNEXPLAINED_COST_RATIO) {
    reasons.push("COST_SPIKE_DETECTED");
  }
  return reasons;
}

export function evaluateLearningCandidate(
  candidate: LearningCandidate,
  context: LearningEvaluationContext,
): LearningEvaluationReceipt {
  if (!candidate.candidateId.trim() || !candidate.tenantId.trim() || candidate.version < 1) {
    throw new Error("Learning candidate identity and positive version are required.");
  }
  if (!context.evaluatorActorId.trim() || !Number.isFinite(Date.parse(context.now))) {
    throw new Error("A canonical evaluator actor and current ISO timestamp are required.");
  }

  const crossTenant = candidate.evidence.some((item) => item.tenantId !== candidate.tenantId)
    || candidate.feedback.some((item) => item.tenantId !== candidate.tenantId)
    || candidate.guardianReviews.some((item) => item.tenantId !== candidate.tenantId);
  if (crossTenant) {
    return createReceipt({
      candidate,
      context,
      decision: "QUARANTINE",
      nextSafeAction: "Quarantine the candidate and open a tenant-boundary incident without retrieving or promoting its payload.",
      reasons: ["CROSS_TENANT_EVIDENCE", "TENANT_BOUNDARY_VIOLATION"],
    });
  }

  const poisonedEvidence = candidate.evidence.some((item) =>
    item.promptInjectionDetected
    || !item.provenanceRef.trim()
    || !CONTENT_HASH.test(item.contentHash),
  );
  if (poisonedEvidence) {
    return createReceipt({
      candidate,
      context,
      decision: "QUARANTINE",
      nextSafeAction: "Keep the material as untrusted evidence, remove it from retrieval, and require independent provenance review.",
      reasons: ["MEMORY_POISONING_DETECTED"],
    });
  }

  if (candidate.feedback.some((item) => item.verifiedByServer && item.maliciousSignal)) {
    return createReceipt({
      candidate,
      context,
      decision: "QUARANTINE",
      nextSafeAction: "Exclude the malicious observation, preserve it for audit, and rebuild the candidate from independent outcomes.",
      reasons: ["MALICIOUS_FEEDBACK_DETECTED"],
    });
  }

  const deployedRollbackReasons = rollbackReasons(candidate);
  if (candidate.stage === "DEPLOYED" && deployedRollbackReasons.length > 0) {
    if (!candidate.lastKnownGoodVersion) deployedRollbackReasons.push("ROLLBACK_TARGET_MISSING");
    if (!candidate.rollbackTested) deployedRollbackReasons.push("ROLLBACK_PLAN_NOT_TESTED");
    return createReceipt({
      candidate,
      context,
      decision: "ROLLBACK_REQUIRED",
      nextSafeAction: candidate.lastKnownGoodVersion
        ? "Pause the candidate, submit one idempotent rollback command, and verify the last-known-good version by readback."
        : "Pause the candidate and escalate: no verified last-known-good rollback target exists.",
      reasons: deployedRollbackReasons,
      rollbackTargetVersion: candidate.lastKnownGoodVersion,
    });
  }

  const reasons: LearningSafetyReasonCode[] = [];
  if (candidate.feedback.some((item) => !item.verifiedByServer)) reasons.push("UNVERIFIED_FEEDBACK_IGNORED");
  if (feedbackActorShare(candidate) > MAXIMUM_FEEDBACK_ACTOR_SHARE) {
    reasons.push("FEEDBACK_CONCENTRATION_TOO_HIGH");
  }
  const verifiedEvidence = candidate.evidence.filter((item) => item.verified);
  const independentEvidenceSources = unique(verifiedEvidence.map((item) => item.provenanceRef));
  if (independentEvidenceSources.length < 3) reasons.push("EVIDENCE_PROVENANCE_INSUFFICIENT");
  if (!candidate.simulationPassed) reasons.push("SIMULATION_NOT_PASSED");
  if (!candidate.rollbackTested) reasons.push("ROLLBACK_PLAN_NOT_TESTED");
  if (candidate.metrics.independentEligibleEpisodes < MINIMUM_ELIGIBLE_EPISODES) {
    reasons.push("INSUFFICIENT_ELIGIBLE_EPISODES");
  }
  if (!finiteRatio(candidate.metrics.candidateTaskSuccess)
      || candidate.metrics.candidateTaskSuccess < MINIMUM_TASK_SUCCESS) {
    reasons.push("TASK_SUCCESS_TOO_LOW");
  }
  if (!finiteRatio(candidate.metrics.humanOverrideRate)
      || candidate.metrics.humanOverrideRate > MAXIMUM_HUMAN_OVERRIDE_RATE) {
    reasons.push("OVERRIDE_RATE_TOO_HIGH");
  }
  if (!finiteRatio(candidate.metrics.calibrationError)
      || candidate.metrics.calibrationError > MAXIMUM_CALIBRATION_ERROR) {
    reasons.push("CALIBRATION_ERROR_TOO_HIGH");
  }
  if (!finiteRatio(candidate.metrics.verifiedOutcomeCoverage)
      || candidate.metrics.verifiedOutcomeCoverage < MINIMUM_VERIFIED_OUTCOME_COVERAGE) {
    reasons.push("VERIFIED_OUTCOME_COVERAGE_TOO_LOW");
  }
  if (candidate.metrics.unresolvedUnsafeOutcomes !== 0) reasons.push("UNRESOLVED_UNSAFE_OUTCOMES");
  if (!Number.isFinite(candidate.metrics.improvementLowerBound)
      || candidate.metrics.improvementLowerBound <= 0
      || candidate.metrics.candidateTaskSuccess <= candidate.metrics.baselineTaskSuccess) {
    reasons.push("IMPROVEMENT_NOT_CREDIBLE");
  }
  if (!finiteRatio(candidate.metrics.distributionShiftScore)
      || candidate.metrics.distributionShiftScore > MAXIMUM_DISTRIBUTION_SHIFT_SCORE) {
    reasons.push("DISTRIBUTION_SHIFT_DETECTED");
  }
  if (!candidate.metrics.rareEventSuitePassed) reasons.push("RARE_EVENT_SUITE_FAILED");

  if (candidate.stage === "DEPLOYED") {
    return createReceipt({
      candidate,
      context,
      decision: "MONITOR",
      nextSafeAction: "Keep the current version bounded and continue outcome, drift, safety, cost, and source-readback monitoring.",
      reasons,
      rollbackTargetVersion: candidate.lastKnownGoodVersion,
    });
  }

  if (reasons.length > 0) {
    return createReceipt({
      candidate,
      context,
      decision: "SHADOW_ONLY",
      nextSafeAction: "Keep the candidate out of authority and production; collect independent evidence and rerun the full gate.",
      reasons,
    });
  }

  if (candidate.stage !== "CANARY") {
    return createReceipt({
      candidate,
      context,
      decision: "CANARY_ELIGIBLE",
      nextSafeAction: "Request a bounded single-tenant canary with explicit budget, rollback, and source-readback controls.",
      reasons: [],
    });
  }

  if (!candidate.canaryPassed) {
    return createReceipt({
      candidate,
      context,
      decision: "SHADOW_ONLY",
      nextSafeAction: "Return the candidate to shadow evaluation and preserve the failed canary evidence.",
      reasons: ["CANARY_NOT_PASSED"],
    });
  }

  if (candidate.changesActionEligibility) {
    const reviews = validGuardianApprovals(candidate, context);
    if (reviews.some((review) => review.decision === "REJECT")) {
      return createReceipt({
        candidate,
        context,
        decision: "QUARANTINE",
        nextSafeAction: "Record the guardian rejection and create a new candidate version before any further review.",
        reasons: ["GUARDIAN_REJECTED"],
      });
    }
    const approvingGuardians = unique(
      reviews.filter((review) => review.decision === "APPROVE").map((review) => review.reviewerId),
    );
    if (approvingGuardians.length < 2) {
      return createReceipt({
        candidate,
        context,
        decision: "GUARDIAN_REVIEW_REQUIRED",
        nextSafeAction: "Obtain two independent canonical guardian approvals; the proposer cannot vote.",
        reasons: ["GUARDIAN_QUORUM_REQUIRED"],
      });
    }
  }

  return createReceipt({
    candidate,
    context,
    decision: "PROMOTION_ELIGIBLE",
    nextSafeAction: "Submit a separate exact-version A2 promotion command; this evaluation receipt does not promote the candidate.",
    reasons: ["PROMOTION_GATES_PASSED"],
  });
}
