import type {
  CustomerZeroStage,
  EvidenceRefV1,
  OperationsEvidenceDocumentV1,
} from "../contracts";

export const OPERATIONS_EVIDENCE_LEDGER_VERSION = "LuzioneOperationsEvidenceLedger/v2" as const;
export const OPERATIONS_EVIDENCE_LEDGER_MANIFEST_VERSION = "LuzioneOperationsEvidenceLedgerManifest/v2" as const;

export const OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS = Object.freeze({
  authorityGrant: "G2EffectAuthorityGrant/v1",
  capabilityEpochReset: "CapabilityEpochReset/v1",
  dailyMetricBinding: "DailyMetricEvidenceBinding/v1",
  humanOwnerContext: "CanonicalHumanOwnerContext/v1",
} as const);

export type CanonicalHumanFunction = "FOUNDER" | "PLATFORM_OPERATIONS" | "SUPPORT_OPERATIONS";
export type CanonicalHumanRole = "FOUNDER" | "IREM";

export type CanonicalHumanOwnerContextV1 = {
  authorityEvidenceRefId: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.humanOwnerContext;
  function: CanonicalHumanFunction;
  membershipState: "ACTIVE";
  ownerId: string;
  principalType: "HUMAN";
  role: CanonicalHumanRole;
  tenantId: string;
};

export type G2Effect =
  | "BOUNDED_PROVIDER_ACTION"
  | "FORMAL_PROOF_OPEN"
  | "TENANT_LIVE_READ"
  | "TENANT_REVERSIBLE_WRITE";

export type G2EffectAuthorityGrantV1 = {
  actionId: string;
  authorityEvidenceRefId: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.authorityGrant;
  effect: G2Effect;
  expiresAt: string;
  grantId: string;
  grantedAt: string;
  requestedStage: CustomerZeroStage;
  signerFunction: "FOUNDER";
  signerOwnerId: string;
  state: "GRANTED";
  tenantId: string;
};

export type CapabilityEpochResetV1 = {
  capabilityId: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.capabilityEpochReset;
  effectiveDate: string;
  incidentRecordId: string;
  newEpochId: string;
  priorEpochId: string;
  recoveryEvidenceRefId: string;
  resetId: string;
  tenantId: string;
};

export type HardZeroMetricKey =
  | "duplicateEffect"
  | "falseFinality"
  | "p0P1AutoClose"
  | "secretExposure"
  | "unauthorizedCrossTenantSuccess"
  | "unauthorizedEffect"
  | "unapprovedProviderDispatch"
  | "unverifiedClosure";

export type HardZeroMetricObservation = {
  evidenceRefId: string;
  metricId: string;
  metricKey: HardZeroMetricKey;
  value: number;
};

export type DailyMetricEvidenceBindingV1 = {
  completenessEvidenceRefId: string;
  completenessMetricId: string;
  completenessReportRecordId: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.dailyMetricBinding;
  dailyRecordId: string;
  hardZeros: readonly HardZeroMetricObservation[];
  metricCatalogRecordId: string;
  telemetryEvidenceRefId: string;
  telemetryMetricId: string;
};

export type OperationsEvidenceLedgerEntryV2 = {
  contentDigest: string;
  document: OperationsEvidenceDocumentV1;
};

export type LuzioneOperationsEvidenceLedgerV2 = {
  assessmentTime: string;
  authorityGrants: readonly G2EffectAuthorityGrantV1[];
  capabilityEpochResets: readonly CapabilityEpochResetV1[];
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_VERSION;
  dailyMetricBindings: readonly DailyMetricEvidenceBindingV1[];
  effectAuthority: "NO_EFFECT";
  entries: readonly OperationsEvidenceLedgerEntryV2[];
  ledgerDigest: string;
  ledgerId: string;
  ownerContexts: readonly CanonicalHumanOwnerContextV1[];
  priorRecordSetDigest: string | null;
  recordSetDigest: string;
  tenantId: string;
};

export type OperationsEvidenceLedgerPriorSetV2 = {
  entries: readonly OperationsEvidenceLedgerEntryV2[];
  ledgerId: string;
  recordSetDigest: string;
  tenantId: string;
};

export type DerivedOperationsEvidenceStateV2 = {
  capabilityCreditedDays: Readonly<Record<string, number>>;
  dailyCredit: Readonly<Record<string, 0 | 1>>;
  exitDecisions: Readonly<Record<string, "BLOCKED" | "PASS">>;
  proofEntryStates: Readonly<Record<string, "BLOCKED" | "READY">>;
  stageDecisions: Readonly<Record<string, "ADVANCE" | "HOLD">>;
  weeklyCreditedDays: Readonly<Record<string, number>>;
};

export type ParsedOperationsEvidenceLedgerV2 = {
  derived: DerivedOperationsEvidenceStateV2;
  ledger: LuzioneOperationsEvidenceLedgerV2;
};

export type LuzioneOperationsEvidenceLedgerManifestV2 = {
  artifacts: {
    l2ConsumerPacket: string;
    l3ConsumerPacket: string;
    ruleSource: string;
    schemaBundle: string;
    semanticFixtures: string;
    strictConsumerSdk: string;
  };
  assuranceFingerprintSha256: string;
  baseRecordBundleVersion: "LuzioneOperationsEvidence/v1";
  candidateSha: string;
  compatibility: {
    decisionBearingV1UseProhibited: true;
    exactFieldSets: true;
    priorSetRequiredAfterGenesis: true;
    unknownVersionsRejected: true;
  };
  controllerAuthority: string;
  effectAuthority: "NO_EFFECT";
  ledgerVersion: typeof OPERATIONS_EVIDENCE_LEDGER_VERSION;
  productionReady: false;
  runtimeActivation: "NOT_IMPLEMENTED";
  schemaVersion: typeof OPERATIONS_EVIDENCE_LEDGER_MANIFEST_VERSION;
};

export type EvidenceIndex = ReadonlyMap<string, EvidenceRefV1>;
