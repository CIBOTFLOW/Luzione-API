export const OPERATIONS_EVIDENCE_BUNDLE_VERSION = "LuzioneOperationsEvidence/v1";
export const OPERATIONS_EVIDENCE_MANIFEST_VERSION = "LuzioneOperationsEvidenceManifest/v1";

export const OPERATIONS_EVIDENCE_VERSIONS = Object.freeze({
  capabilityWindowLedger: "CapabilityWindowLedger/v1",
  capacityObservation: "CapacityObservation/v1",
  caseHandoff: "CaseHandoff/v1",
  changeFreeze: "ChangeFreeze/v1",
  customerZeroCadence: "CustomerZeroCadence/v1",
  evidenceCompletenessReport: "EvidenceCompletenessReport/v1",
  evidenceRef: "EvidenceRef/v1",
  feedbackRecord: "FeedbackRecord/v1",
  metricCatalog: "MetricCatalog/v1",
  proofDailyRecord: "ProofDailyRecord/v1",
  proofException: "ProofException/v1",
  proofExitDecision: "ProofExitDecision/v1",
  proofIncident: "ProofIncident/v1",
  proofWeeklySignoff: "ProofWeeklySignoff/v1",
  proofWindowEntry: "ProofWindowEntry/v1",
  stageReadiness: "StageReadiness/v1",
  trainingAttestation: "TrainingAttestation/v1",
} as const);

export type OperationsEvidenceVersion =
  (typeof OPERATIONS_EVIDENCE_VERSIONS)[keyof typeof OPERATIONS_EVIDENCE_VERSIONS];

export const OPS_PACKET_PINS = Object.freeze({
  customerZero: {
    fingerprintSha256: "ae1c5225f8bb1c45420572433ac659ff054a1fd2bfad1cb2bf740e5ae008e57c",
    packetId: "CUSTOMER-ZERO-OPS-01/v1",
  },
  proof: {
    fingerprintSha256: "b2c79f6a580267adfcac1745047518979070ee3f18d90df478dc4b6ec511cb8b",
    packetId: "PROOF-OPS-01/v1",
  },
} as const);

export const OPS_CORE_COMPOSITION = Object.freeze({
  bundleVersion: "LuzioneCoreContracts/v1",
  finalSha: "bb5eb395af0873f4483ba2dc10c76f9941051dde",
  implementationSha: "828de754e4104cd860e3f47adbf2e84c576e5c10",
  schemaTree: "d57ccc4cccd97b37acd1a1575b1e07ede5787349",
  sdkTree: "d594fa014d7020fdf8386c7a6926ff9b573ac355",
} as const);

export type AccountableOwner = {
  function: "FOUNDER" | "PLATFORM_OPERATIONS" | "SUPPORT_OPERATIONS";
  ownerId: string;
  ownerType: "HUMAN";
};

export type SourcePacket =
  | typeof OPS_PACKET_PINS.customerZero
  | typeof OPS_PACKET_PINS.proof;

export type EvidenceRefV1 = {
  artifactKind:
    | "AUTHORITY"
    | "HANDOFF"
    | "INCIDENT"
    | "METRIC"
    | "RECOVERY"
    | "RELEASE"
    | "SOURCE_READBACK"
    | "TRAINING";
  artifactVersion: string;
  containsSecretOrPii: false;
  contractVersion: typeof OPERATIONS_EVIDENCE_VERSIONS.evidenceRef;
  dataClassification: "NON_SENSITIVE_METADATA";
  evidenceRefId: string;
  immutable: true;
  observedAt: string;
  releaseSha: string;
  sha256: string;
  tenantId: string;
  verifierId: string;
};

export type OperationsRecordBase<V extends OperationsEvidenceVersion, P> = {
  accountableOwner: AccountableOwner;
  contractVersion: V;
  effectAuthority: "NO_EFFECT";
  evidenceRefs: readonly EvidenceRefV1[];
  immutable: true;
  observedAt: string;
  payload: P;
  recordedAt: string;
  recordId: string;
  sourcePacket: SourcePacket;
  supersedesRecordId: string | null;
  tenantId: string;
};

export type MetricDefinition = {
  denominatorEvidenceClass: string;
  formula: "COUNT" | "HARD_ZERO" | "RATIO_BPS" | "SUM";
  hardZero: boolean;
  metricId: string;
  missingDataRule: "NO_CREDIT";
  numeratorEvidenceClass: string;
  ownerId: string;
  unit: "BASIS_POINTS" | "COUNT" | "DAYS" | "MILLISECONDS" | "MINUTES";
};

export type MetricCatalogV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.metricCatalog,
  {
    catalogId: string;
    catalogVersion: string;
    effectiveAt: string;
    metrics: readonly MetricDefinition[];
    retiredMetricIds: readonly string[];
  }
>;

export type G2ApprovalRef = {
  actionId: string;
  evidenceRefId: string;
};

export type ProofWindowEntryV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.proofWindowEntry,
  {
    activationConeCleared: boolean;
    blockingIncidentCount: number;
    capabilityCount: 40;
    clearedCapabilityCount: number;
    coreContractVersion: "LuzioneCoreContracts/v1";
    entryState: "BLOCKED" | "READY";
    g1ReleaseShas: readonly string[];
    g2Approvals: readonly G2ApprovalRef[];
  }
>;

export type CapabilityCoverage = {
  capabilityId: string;
  evidenceRefIds: readonly string[];
  ownerId: string;
};

export type HardZeroCounters = {
  duplicateEffect: number;
  falseFinality: number;
  secretExposure: number;
  unauthorizedCrossTenantSuccess: number;
  unauthorizedEffect: number;
  unapprovedProviderDispatch: number;
  unverifiedClosure: number;
};

export type ProofDailyRecordV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord,
  {
    blockingIncidentCount: number;
    calculatedCredit: 0 | 1;
    capabilityCoverage: readonly CapabilityCoverage[];
    claimedCredit: 0 | 1;
    completenessBps: number;
    date: string;
    hardZeroCounters: HardZeroCounters;
    requiredCapabilities: readonly string[];
    telemetryCoverageBps: number;
  }
>;

export type ProofWeeklySignoffV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.proofWeeklySignoff,
  {
    creditedDays: number;
    dailyRecordIds: readonly string[];
    requiredDays: 7;
    signedAt: string | null;
    signedBy: string | null;
    signoffState: "DRAFT" | "READY" | "SIGNED";
    weekStart: string;
  }
>;

export type CapabilityWindowLedgerV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.capabilityWindowLedger,
  {
    capabilityId: string;
    creditedDays: number;
    dailyRecordIds: readonly string[];
    requiredDays: 30;
    state: "BLOCKED" | "COMPLETE" | "NOT_STARTED" | "OPEN";
    windowEnd: string;
    windowStart: string;
  }
>;

export type EvidenceCompletenessReportV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.evidenceCompletenessReport,
  {
    calculatedCompletenessBps: number;
    claimedCompletenessBps: number;
    coverageOwnerIds: readonly string[];
    missingEvidenceKeys: readonly string[];
    presentValidEvidenceCount: number;
    requiredEvidenceCount: number;
  }
>;

export type ProofExceptionV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.proofException,
  {
    approvalEvidenceRefId: string | null;
    approvedBy: string | null;
    exceptionType: "EVIDENCE_DELAY" | "PLANNED_MAINTENANCE" | "TELEMETRY_GAP";
    expiresAt: string;
    hardZeroWaiver: false;
    reasonCode: string;
    scope: readonly string[];
    status: "APPROVED" | "DRAFT" | "EXPIRED" | "REJECTED";
  }
>;

export type ProofIncidentV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.proofIncident,
  {
    acknowledgedAt: string | null;
    capabilityIds: readonly string[];
    openedAt: string;
    readbackEvidenceRefIds: readonly string[];
    resetCapabilityEpoch: boolean;
    resolvedAt: string | null;
    severity: "P0" | "P1" | "P2" | "P3";
    state: "ACKNOWLEDGED" | "OPEN" | "RESOLVED_VERIFIED";
  }
>;

export type ProofExitDecisionV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.proofExitDecision,
  {
    allCapabilitiesComplete: boolean;
    allHardZerosPass: boolean;
    blockingReasons: readonly string[];
    creditedDays: number;
    decision: "BLOCKED" | "PASS";
    decisionAt: string;
    decisionBy: string;
    managedRecoveryEvidenceRefId: string | null;
    requiredDays: 30;
    windowEnd: string;
    windowStart: string;
  }
>;

export type CustomerZeroCadenceV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.customerZeroCadence,
  {
    dailyCeremonies: readonly ("CLOSE" | "CONTROL_HUDDLE" | "OPEN")[];
    externalCustomers: 0;
    founderMinutesPlanned: 195;
    iremMinutesPlanned: 600;
    liveEffects: 0;
    rehearsalFounderMinutes: 360;
    rehearsalIremMinutes: 630;
    state: "PLANNED" | "REHEARSED_SYNTHETIC";
    weekStart: string;
    weeklyCeremonies: readonly ("CHANGE" | "PROOF" | "TRAINING")[];
  }
>;

export type CaseHandoffV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.caseHandoff,
  {
    acceptedAt: string | null;
    acceptedBy: string | null;
    caseId: string;
    fromOwnerId: string;
    offeredAt: string;
    state: "ACCEPTED" | "OFFERED" | "REJECTED";
    summaryEvidenceRefIds: readonly string[];
    toOwnerId: string;
  }
>;

export type TrainingAttestationV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.trainingAttestation,
  {
    assessmentEvidenceRefIds: readonly string[];
    completedAt: string;
    curriculumVersion: string;
    expiresAt: string;
    scoreBps: number;
    status: "CURRENT" | "EXPIRED";
    traineeOwnerId: string;
  }
>;

export type FeedbackRecordV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.feedbackRecord,
  {
    caseId: string;
    category: "CORRECTION" | "GAP" | "IMPROVEMENT";
    changeRequestRef: string | null;
    containsCustomerContent: false;
    disposition: "ACCEPTED" | "DEFERRED" | "REJECTED" | "TRIAGED";
    feedbackId: string;
    submittedAt: string;
    submittedBy: string;
  }
>;

export type ChangeFreezeV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.changeFreeze,
  {
    approvedBy: string;
    approvalEvidenceRefId: string;
    endsAt: string;
    g2Approvals: readonly G2ApprovalRef[];
    prohibitedChanges: readonly string[];
    scope: readonly string[];
    startsAt: string;
    state: "FROZEN" | "PLANNED" | "RELEASED";
  }
>;

export type CapacityObservationV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.capacityObservation,
  {
    admissionAllowed: boolean;
    calculatedFounderUtilizationBps: number;
    calculatedIremUtilizationBps: number;
    claimedFounderUtilizationBps: number;
    claimedIremUtilizationBps: number;
    founderAvailableMinutes: number;
    founderRequiredMinutes: number;
    iremAvailableMinutes: number;
    iremRequiredMinutes: number;
    overrun: boolean;
    windowEnd: string;
    windowStart: string;
  }
>;

export const CUSTOMER_ZERO_STAGES = [
  "DARK",
  "READS",
  "REVERSIBLE_WRITES",
  "BOUNDED_PROVIDER_ACTIONS",
  "FORMAL_PROOF",
] as const;
export type CustomerZeroStage = (typeof CUSTOMER_ZERO_STAGES)[number];

export type StageReadinessV1 = OperationsRecordBase<
  typeof OPERATIONS_EVIDENCE_VERSIONS.stageReadiness,
  {
    blockingReasons: readonly string[];
    calculatedDecision: "ADVANCE" | "HOLD";
    capacityObservationId: string;
    changeFreezeId: string;
    claimedDecision: "ADVANCE" | "HOLD";
    coverageComplete: boolean;
    currentStage: CustomerZeroStage;
    evidenceComplete: boolean;
    g2Approvals: readonly G2ApprovalRef[];
    handoffRecordIds: readonly string[];
    requestedStage: CustomerZeroStage;
    trainingRecordIds: readonly string[];
  }
>;

export type OperationsEvidenceDocumentV1 =
  | CapabilityWindowLedgerV1
  | CapacityObservationV1
  | CaseHandoffV1
  | ChangeFreezeV1
  | CustomerZeroCadenceV1
  | EvidenceCompletenessReportV1
  | EvidenceRefV1
  | FeedbackRecordV1
  | MetricCatalogV1
  | ProofDailyRecordV1
  | ProofExceptionV1
  | ProofExitDecisionV1
  | ProofIncidentV1
  | ProofWeeklySignoffV1
  | ProofWindowEntryV1
  | StageReadinessV1
  | TrainingAttestationV1;

export type LuzioneOperationsEvidenceManifestV1 = {
  artifacts: {
    generatedSdk: string;
    l2ConsumerPacket: string;
    l3ConsumerPacket: string;
    schemaBundle: string;
    semanticFixtures: string;
    strictConsumerSdk: string;
  };
  bundleVersion: typeof OPERATIONS_EVIDENCE_BUNDLE_VERSION;
  candidateSha: string;
  compatibility: {
    additiveEvolutionRequiresNewVersion: true;
    exactFieldSets: true;
    unknownVersionsRejected: true;
  };
  contracts: Readonly<Record<OperationsEvidenceVersion, string>>;
  controllerAuthority: string;
  coreComposition: typeof OPS_CORE_COMPOSITION;
  effectAuthority: "NO_EFFECT";
  productionReady: false;
  runtimeActivation: "NOT_IMPLEMENTED";
  schemaVersion: typeof OPERATIONS_EVIDENCE_MANIFEST_VERSION;
  sourcePackets: typeof OPS_PACKET_PINS;
};
