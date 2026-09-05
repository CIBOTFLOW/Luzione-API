import {
  OPERATIONS_EVIDENCE_VERSIONS,
  OPS_PACKET_PINS,
  type CapabilityWindowLedgerV1,
  type CapacityObservationV1,
  type CaseHandoffV1,
  type ChangeFreezeV1,
  type CustomerZeroCadenceV1,
  type EvidenceCompletenessReportV1,
  type EvidenceRefV1,
  type FeedbackRecordV1,
  type MetricCatalogV1,
  type OperationsEvidenceDocumentV1,
  type ProofDailyRecordV1,
  type ProofExceptionV1,
  type ProofExitDecisionV1,
  type ProofIncidentV1,
  type ProofWeeklySignoffV1,
  type ProofWindowEntryV1,
  type StageReadinessV1,
  type TrainingAttestationV1,
} from "./contracts";

export const operationsEvidenceFixtureClock = { assessmentTime: "2026-09-05T12:00:00.000Z" } as const;

const tenantId = "tenant:luzione-customer-zero";
const iremOwner = "human:irem";
const founderOwner = "human:founder";
const releaseSha = "c981a13cbef1cf41fac4cd07a5d9992d61fd3288";
const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export const evidenceRefFixture: EvidenceRefV1 = {
  artifactKind: "METRIC",
  artifactVersion: "synthetic-ops-evidence/v1",
  containsSecretOrPii: false,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.evidenceRef,
  dataClassification: "NON_SENSITIVE_METADATA",
  evidenceRefId: "evidence:synthetic:ops-1",
  immutable: true,
  observedAt: "2026-09-05T02:00:00.000Z",
  releaseSha,
  sha256: shaA,
  tenantId,
  verifierId: "service:offline-fixture-verifier",
};

const base = {
  accountableOwner: { function: "PLATFORM_OPERATIONS", ownerId: iremOwner, ownerType: "HUMAN" },
  effectAuthority: "NO_EFFECT",
  evidenceRefs: [evidenceRefFixture],
  immutable: true,
  observedAt: "2026-09-05T02:00:00.000Z",
  recordedAt: "2026-09-05T02:01:00.000Z",
  supersedesRecordId: null,
  tenantId,
} as const;

export const metricCatalogFixture: MetricCatalogV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.metricCatalog,
  payload: {
    catalogId: "catalog:proof-window:v1",
    catalogVersion: "metrics:proof-window:v1",
    effectiveAt: "2026-09-05T02:00:00.000Z",
    metrics: [
      {
        denominatorEvidenceClass: "REQUIRED_EVIDENCE",
        formula: "RATIO_BPS",
        hardZero: false,
        metricId: "proof.evidence_completeness_bps",
        missingDataRule: "NO_CREDIT",
        numeratorEvidenceClass: "PRESENT_VALID_EVIDENCE",
        ownerId: iremOwner,
        unit: "BASIS_POINTS",
      },
      {
        denominatorEvidenceClass: "NONE",
        formula: "HARD_ZERO",
        hardZero: true,
        metricId: "proof.unauthorized_effect_count",
        missingDataRule: "NO_CREDIT",
        numeratorEvidenceClass: "UNAUTHORIZED_EFFECT",
        ownerId: founderOwner,
        unit: "COUNT",
      },
    ],
    retiredMetricIds: [],
  },
  recordId: "record:metric-catalog:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const proofWindowEntryFixture: ProofWindowEntryV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.proofWindowEntry,
  payload: {
    activationConeCleared: false,
    blockingIncidentCount: 0,
    capabilityCount: 40,
    clearedCapabilityCount: 0,
    coreContractVersion: "LuzioneCoreContracts/v1",
    entryState: "BLOCKED",
    g1ReleaseShas: [],
    g2Approvals: [],
  },
  recordId: "record:proof-window-entry:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const proofDailyRecordFixture: ProofDailyRecordV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord,
  payload: {
    blockingIncidentCount: 0,
    calculatedCredit: 1,
    capabilityCoverage: [{ capabilityId: "crm.support", evidenceRefIds: [evidenceRefFixture.evidenceRefId], ownerId: iremOwner }],
    claimedCredit: 1,
    completenessBps: 10000,
    date: "2026-09-05",
    hardZeroCounters: {
      duplicateEffect: 0,
      falseFinality: 0,
      secretExposure: 0,
      unauthorizedCrossTenantSuccess: 0,
      unauthorizedEffect: 0,
      unapprovedProviderDispatch: 0,
      unverifiedClosure: 0,
    },
    requiredCapabilities: ["crm.support"],
    telemetryCoverageBps: 10000,
  },
  recordId: "record:proof-daily:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const proofWeeklySignoffFixture: ProofWeeklySignoffV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.proofWeeklySignoff,
  payload: {
    creditedDays: 1,
    dailyRecordIds: [proofDailyRecordFixture.recordId],
    requiredDays: 7,
    signedAt: null,
    signedBy: null,
    signoffState: "DRAFT",
    weekStart: "2026-09-01",
  },
  recordId: "record:proof-weekly:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const capabilityWindowLedgerFixture: CapabilityWindowLedgerV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.capabilityWindowLedger,
  payload: {
    capabilityId: "crm.support",
    creditedDays: 1,
    dailyRecordIds: [proofDailyRecordFixture.recordId],
    requiredDays: 30,
    state: "OPEN",
    windowEnd: "2026-10-04",
    windowStart: "2026-09-05",
  },
  recordId: "record:capability-ledger:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const evidenceCompletenessReportFixture: EvidenceCompletenessReportV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.evidenceCompletenessReport,
  payload: {
    calculatedCompletenessBps: 7500,
    claimedCompletenessBps: 7500,
    coverageOwnerIds: [iremOwner, founderOwner],
    missingEvidenceKeys: ["managed-recovery-receipt"],
    presentValidEvidenceCount: 3,
    requiredEvidenceCount: 4,
  },
  recordId: "record:evidence-completeness:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const proofExceptionFixture: ProofExceptionV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.proofException,
  payload: {
    approvalEvidenceRefId: null,
    approvedBy: null,
    exceptionType: "TELEMETRY_GAP",
    expiresAt: "2026-09-06T02:00:00.000Z",
    hardZeroWaiver: false,
    reasonCode: "UPSTREAM_TELEMETRY_UNAVAILABLE",
    scope: ["crm.support"],
    status: "DRAFT",
  },
  recordId: "record:proof-exception:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const proofIncidentFixture: ProofIncidentV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.proofIncident,
  payload: {
    acknowledgedAt: null,
    capabilityIds: ["crm.support"],
    openedAt: "2026-09-05T02:00:00.000Z",
    readbackEvidenceRefIds: [],
    resetCapabilityEpoch: false,
    resolvedAt: null,
    severity: "P2",
    state: "OPEN",
  },
  recordId: "record:proof-incident:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const proofExitDecisionFixture: ProofExitDecisionV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.proofExitDecision,
  payload: {
    allCapabilitiesComplete: false,
    allHardZerosPass: true,
    blockingReasons: ["ACTIVATION_CONE_NOT_CLEARED"],
    creditedDays: 1,
    decision: "BLOCKED",
    decisionAt: "2026-09-05T02:00:00.000Z",
    decisionBy: founderOwner,
    managedRecoveryEvidenceRefId: null,
    requiredDays: 30,
    windowEnd: "2026-10-04",
    windowStart: "2026-09-05",
  },
  recordId: "record:proof-exit:1",
  sourcePacket: OPS_PACKET_PINS.proof,
};

export const customerZeroCadenceFixture: CustomerZeroCadenceV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.customerZeroCadence,
  payload: {
    dailyCeremonies: ["OPEN", "CONTROL_HUDDLE", "CLOSE"],
    externalCustomers: 0,
    founderMinutesPlanned: 195,
    iremMinutesPlanned: 600,
    liveEffects: 0,
    rehearsalFounderMinutes: 360,
    rehearsalIremMinutes: 630,
    state: "REHEARSED_SYNTHETIC",
    weekStart: "2026-09-01",
    weeklyCeremonies: ["CHANGE", "TRAINING", "PROOF"],
  },
  recordId: "record:customer-zero-cadence:1",
  sourcePacket: OPS_PACKET_PINS.customerZero,
};

export const caseHandoffFixture: CaseHandoffV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.caseHandoff,
  payload: {
    acceptedAt: "2026-09-05T02:05:00.000Z",
    acceptedBy: founderOwner,
    caseId: "case:synthetic:1",
    fromOwnerId: iremOwner,
    offeredAt: "2026-09-05T02:02:00.000Z",
    state: "ACCEPTED",
    summaryEvidenceRefIds: [evidenceRefFixture.evidenceRefId],
    toOwnerId: founderOwner,
  },
  recordId: "record:case-handoff:1",
  sourcePacket: OPS_PACKET_PINS.customerZero,
};

export const trainingAttestationFixture: TrainingAttestationV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.trainingAttestation,
  payload: {
    assessmentEvidenceRefIds: [evidenceRefFixture.evidenceRefId],
    completedAt: "2026-09-04T12:00:00.000Z",
    curriculumVersion: "customer-zero-operations-training/v1",
    expiresAt: "2026-10-05T12:00:00.000Z",
    scoreBps: 10000,
    status: "CURRENT",
    traineeOwnerId: founderOwner,
  },
  recordId: "record:training-attestation:1",
  sourcePacket: OPS_PACKET_PINS.customerZero,
};

export const feedbackRecordFixture: FeedbackRecordV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.feedbackRecord,
  payload: {
    caseId: "case:synthetic:1",
    category: "IMPROVEMENT",
    changeRequestRef: null,
    containsCustomerContent: false,
    disposition: "TRIAGED",
    feedbackId: "feedback:synthetic:1",
    submittedAt: "2026-09-05T02:00:00.000Z",
    submittedBy: iremOwner,
  },
  recordId: "record:feedback:1",
  sourcePacket: OPS_PACKET_PINS.customerZero,
};

export const changeFreezeFixture: ChangeFreezeV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.changeFreeze,
  payload: {
    approvedBy: founderOwner,
    approvalEvidenceRefId: evidenceRefFixture.evidenceRefId,
    endsAt: "2026-09-12T02:00:00.000Z",
    g2Approvals: [],
    prohibitedChanges: ["DEFAULT_BRANCH", "PRODUCTION_CONFIGURATION", "RUNTIME_AUTHORITY"],
    scope: ["customer-zero"],
    startsAt: "2026-09-05T02:00:00.000Z",
    state: "FROZEN",
  },
  recordId: "record:change-freeze:1",
  sourcePacket: OPS_PACKET_PINS.customerZero,
};

export const capacityObservationFixture: CapacityObservationV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.capacityObservation,
  payload: {
    admissionAllowed: true,
    calculatedFounderUtilizationBps: 4063,
    calculatedIremUtilizationBps: 5000,
    claimedFounderUtilizationBps: 4063,
    claimedIremUtilizationBps: 5000,
    founderAvailableMinutes: 480,
    founderRequiredMinutes: 195,
    iremAvailableMinutes: 1200,
    iremRequiredMinutes: 600,
    overrun: false,
    windowEnd: "2026-09-12T02:00:00.000Z",
    windowStart: "2026-09-05T02:00:00.000Z",
  },
  recordId: "record:capacity-observation:1",
  sourcePacket: OPS_PACKET_PINS.customerZero,
};

export const stageReadinessFixture: StageReadinessV1 = {
  ...base,
  contractVersion: OPERATIONS_EVIDENCE_VERSIONS.stageReadiness,
  payload: {
    blockingReasons: [],
    calculatedDecision: "ADVANCE",
    capacityObservationId: capacityObservationFixture.recordId,
    changeFreezeId: changeFreezeFixture.recordId,
    claimedDecision: "ADVANCE",
    coverageComplete: true,
    currentStage: "DARK",
    evidenceComplete: true,
    g2Approvals: [],
    handoffRecordIds: [caseHandoffFixture.recordId],
    requestedStage: "READS",
    trainingRecordIds: [trainingAttestationFixture.recordId],
  },
  recordId: "record:stage-readiness:1",
  sourcePacket: OPS_PACKET_PINS.customerZero,
};

export const stageReadinessFixtureReferences = {
  capacity: capacityObservationFixture,
  changeFreeze: changeFreezeFixture,
  handoffs: [caseHandoffFixture],
  trainings: [trainingAttestationFixture],
} as const;

export const operationsEvidencePositiveFixtures = Object.freeze({
  capabilityWindowLedger: capabilityWindowLedgerFixture,
  capacityObservation: capacityObservationFixture,
  caseHandoff: caseHandoffFixture,
  changeFreeze: changeFreezeFixture,
  customerZeroCadence: customerZeroCadenceFixture,
  evidenceCompletenessReport: evidenceCompletenessReportFixture,
  evidenceRef: evidenceRefFixture,
  feedbackRecord: feedbackRecordFixture,
  metricCatalog: metricCatalogFixture,
  proofDailyRecord: proofDailyRecordFixture,
  proofException: proofExceptionFixture,
  proofExitDecision: proofExitDecisionFixture,
  proofIncident: proofIncidentFixture,
  proofWeeklySignoff: proofWeeklySignoffFixture,
  proofWindowEntry: proofWindowEntryFixture,
  stageReadiness: stageReadinessFixture,
  trainingAttestation: trainingAttestationFixture,
}) satisfies Readonly<Record<string, OperationsEvidenceDocumentV1>>;
