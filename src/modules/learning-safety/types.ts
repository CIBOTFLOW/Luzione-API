export const learningCandidateKinds = [
  "ACTION_POLICY",
  "MEMORY",
  "MODEL_ROUTING",
  "PROMPT",
  "SKILL",
] as const;

export type LearningCandidateKind = (typeof learningCandidateKinds)[number];

export const learningCandidateStages = [
  "CANDIDATE",
  "SHADOW",
  "CANARY",
  "DEPLOYED",
] as const;

export type LearningCandidateStage = (typeof learningCandidateStages)[number];

export type LearningEvidenceObservation = {
  contentHash: string;
  promptInjectionDetected: boolean;
  provenanceRef: string;
  sourceType: "HUMAN_FEEDBACK" | "MODEL_OUTPUT" | "PROVIDER_READBACK" | "VERIFIED_OUTCOME";
  tenantId: string;
  verified: boolean;
};

export type LearningFeedbackObservation = {
  actorId: string;
  influenceWeight: number;
  maliciousSignal: boolean;
  outcomeVerified: boolean;
  tenantId: string;
  verifiedByServer: boolean;
};

export type LearningEvaluationMetrics = {
  baselineTaskSuccess: number;
  calibrationError: number;
  candidateTaskSuccess: number;
  dataLeakageEvents: number;
  distributionShiftScore: number;
  humanOverrideRate: number;
  improvementLowerBound: number;
  independentEligibleEpisodes: number;
  rareEventSuitePassed: boolean;
  readbackFailures: number;
  safetyRegressionRate: number;
  tenantBoundaryViolations: number;
  unexplainedCostRatio: number;
  unresolvedUnsafeOutcomes: number;
  verifiedOutcomeCoverage: number;
};

export type GuardianLearningReview = {
  candidateId: string;
  candidateVersion: number;
  decision: "APPROVE" | "REJECT";
  expiresAt: string;
  reviewerId: string;
  tenantId: string;
  verification: "CANONICAL_STORE";
};

export type LearningCandidate = {
  candidateId: string;
  canaryPassed: boolean;
  changesActionEligibility: boolean;
  evidence: readonly LearningEvidenceObservation[];
  feedback: readonly LearningFeedbackObservation[];
  guardianReviews: readonly GuardianLearningReview[];
  kind: LearningCandidateKind;
  lastKnownGoodVersion: string | null;
  metrics: LearningEvaluationMetrics;
  proposedByActorId: string;
  proposedByActorType: "agent" | "service" | "user";
  rollbackTested: boolean;
  simulationPassed: boolean;
  stage: LearningCandidateStage;
  tenantId: string;
  version: number;
};

export type LearningSafetyDecision =
  | "CANARY_ELIGIBLE"
  | "GUARDIAN_REVIEW_REQUIRED"
  | "MONITOR"
  | "PROMOTION_ELIGIBLE"
  | "QUARANTINE"
  | "ROLLBACK_REQUIRED"
  | "SHADOW_ONLY";

export type LearningSafetyReasonCode =
  | "CALIBRATION_ERROR_TOO_HIGH"
  | "CANARY_NOT_PASSED"
  | "COST_SPIKE_DETECTED"
  | "CROSS_TENANT_EVIDENCE"
  | "DATA_LEAKAGE_DETECTED"
  | "DISTRIBUTION_SHIFT_DETECTED"
  | "EVIDENCE_PROVENANCE_INSUFFICIENT"
  | "FEEDBACK_CONCENTRATION_TOO_HIGH"
  | "GUARDIAN_QUORUM_REQUIRED"
  | "GUARDIAN_REJECTED"
  | "IMPROVEMENT_NOT_CREDIBLE"
  | "INSUFFICIENT_ELIGIBLE_EPISODES"
  | "MALICIOUS_FEEDBACK_DETECTED"
  | "MEMORY_POISONING_DETECTED"
  | "OVERRIDE_RATE_TOO_HIGH"
  | "PROMOTION_GATES_PASSED"
  | "RARE_EVENT_SUITE_FAILED"
  | "READBACK_FAILURE_DETECTED"
  | "ROLLBACK_PLAN_NOT_TESTED"
  | "ROLLBACK_TARGET_MISSING"
  | "SAFETY_REGRESSION_DETECTED"
  | "SIMULATION_NOT_PASSED"
  | "TASK_SUCCESS_TOO_LOW"
  | "TENANT_BOUNDARY_VIOLATION"
  | "UNRESOLVED_UNSAFE_OUTCOMES"
  | "UNVERIFIED_FEEDBACK_IGNORED"
  | "VERIFIED_OUTCOME_COVERAGE_TOO_LOW";

export type LearningEvaluationReceipt = {
  candidateId: string;
  candidateVersion: number;
  decision: LearningSafetyDecision;
  evaluatedAt: string;
  evaluationContractVersion: string;
  evaluatorActorId: string;
  externalEffectsAuthorized: false;
  metricsSnapshot: LearningEvaluationMetrics;
  nextSafeAction: string;
  promotionExecuted: false;
  reasonCodes: readonly LearningSafetyReasonCode[];
  receiptHash: string;
  receiptId: string;
  rollbackExecuted: false;
  rollbackTargetVersion: string | null;
  tenantId: string;
};

export type LearningEvaluationContext = {
  canonicalGuardianIds: readonly string[];
  evaluatorActorId: string;
  now: string;
};
