import type { CustomerZeroStage } from "../contracts";
import type {
  G2Effect,
  LuzioneOperationsEvidenceLedgerV2,
  OperationsEvidenceLedgerPriorSetV2,
} from "../v2/contracts";
export type { G2Effect } from "../v2/contracts";

export const OPERATIONS_EVIDENCE_LEDGER_V3_VERSION = "LuzioneOperationsEvidenceLedger/v3" as const;
export const OPERATIONS_EVIDENCE_LEDGER_V3_MANIFEST_VERSION = "LuzioneOperationsEvidenceLedgerManifest/v3" as const;

export const OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS = Object.freeze({
  appendState: "OperationsEvidenceAppendState/v1",
  capabilityEpochReset: "CapabilityEpochReset/v2",
  canonicalSourceAttestation: "OperationsEvidenceCanonicalSourceAttestation/v1",
  canonicalSourceReadback: "OperationsEvidenceCanonicalSourceReadback/v1",
  canonicalG2Approval: "OperationsEvidenceCanonicalG2Approval/v1",
  canonicalIncidentRecovery: "OperationsEvidenceCanonicalIncidentRecovery/v1",
  canonicalProofIncident: "OperationsEvidenceCanonicalProofIncident/v1",
  canonicalTenantMembership: "OperationsEvidenceCanonicalTenantMembership/v1",
  g2EffectAuthorityGrant: "G2EffectAuthorityGrant/v2",
  humanAuthoritySourceBinding: "HumanAuthoritySourceBinding/v1",
  incidentRecoverySourceBinding: "IncidentRecoverySourceBinding/v1",
  sourceSnapshot: "OperationsEvidenceAuthorityRecoverySourceSnapshot/v2",
} as const);

export type CanonicalHumanFunctionV3 = "FOUNDER" | "PLATFORM_OPERATIONS" | "SUPPORT_OPERATIONS";
export type CanonicalHumanRoleV3 = "FOUNDER" | "IREM";
export type AuthorityRecoverySourceSystem = "LUZIONE_CORE" | "LUZIONE_CRM_APP";
export type AuthorityRecoverySourceObjectType = "G2_APPROVAL" | "RECOVERY_RECEIPT" | "PROOF_INCIDENT" | "TENANT_MEMBERSHIP";

export type ExactAuthorityRecoverySourceReadbackV1 = {
  objectHash: string;
  objectId: string;
  objectType: AuthorityRecoverySourceObjectType;
  objectVersion: string;
  readbackAt: string;
  readbackHash: string;
  readbackId: string;
  readbackObjectId: string;
  readbackObjectVersion: string;
  sourceSystem: AuthorityRecoverySourceSystem;
  tenantId: string;
};

export type CanonicalTenantMembershipSourceV1 = {
  canonicalFunction: CanonicalHumanFunctionV3;
  canonicalRole: CanonicalHumanRoleV3;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalTenantMembership;
  membershipState: "ACTIVE";
  principalType: "HUMAN";
  revokedAt: null;
  subjectId: string;
  supersededByBindingId: null;
  tenantId: string;
  validFrom: string;
  validUntil: string;
};

export type CanonicalG2ApprovalSourceV1 = {
  actionId: string;
  approvalId: string;
  approvalState: "APPROVED";
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalG2Approval;
  effect: G2Effect;
  expiresAt: string;
  issuedAt: string;
  requestedStage: CustomerZeroStage;
  revokedAt: null;
  signerSubjectId: string;
  state: "GRANTED";
  supersededByGrantId: null;
  tenantId: string;
  validFrom: string;
};

export type CanonicalProofIncidentSourceV1 = {
  acknowledgedAt: string;
  capabilityId: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalProofIncident;
  incidentRecordId: string;
  openedAt: string;
  resetCapabilityEpoch: true;
  resolvedAt: string;
  state: "RESOLVED_VERIFIED";
  tenantId: string;
};

export type CanonicalIncidentRecoverySourceV1 = {
  capabilityId: string;
  completedAt: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalIncidentRecovery;
  incidentRecordId: string;
  recoveryReceiptId: string;
  state: "VERIFIED";
  tenantId: string;
};

export type OperationsEvidenceCanonicalSourceObjectV1 =
  | CanonicalG2ApprovalSourceV1
  | CanonicalIncidentRecoverySourceV1
  | CanonicalProofIncidentSourceV1
  | CanonicalTenantMembershipSourceV1;

export type OperationsEvidenceCanonicalSourceReadbackV1 = {
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalSourceReadback;
  objectHash: string;
  objectId: string;
  objectType: AuthorityRecoverySourceObjectType;
  objectVersion: string;
  readbackAt: string;
  readbackId: string;
  sourceSystem: AuthorityRecoverySourceSystem;
  tenantId: string;
};

export type OperationsEvidenceCanonicalSourceAttestationV1 = {
  attestationDigest: string;
  attestationId: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalSourceAttestation;
  objectBytes: string;
  objectHash: string;
  objectId: string;
  objectType: AuthorityRecoverySourceObjectType;
  objectVersion: string;
  readbackBytes: string;
  readbackHash: string;
  readbackId: string;
  signature: string;
  signingKeyId: string;
  sourceSystem: AuthorityRecoverySourceSystem;
  tenantId: string;
};

export type HumanAuthoritySourceBindingV1 = {
  bindingDigest: string;
  bindingId: string;
  canonicalFunction: CanonicalHumanFunctionV3;
  canonicalRole: CanonicalHumanRoleV3;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.humanAuthoritySourceBinding;
  issuerSubjectId: string;
  legacyAuthorityEvidenceRefId: string;
  membershipSource: ExactAuthorityRecoverySourceReadbackV1;
  membershipState: "ACTIVE";
  principalType: "HUMAN";
  revokedAt: null;
  supersededByBindingId: null;
  tenantId: string;
  validFrom: string;
  validUntil: string;
};

export type G2EffectAuthorityGrantV2 = {
  actionId: string;
  approvalAppendOnly: true;
  approvalSource: ExactAuthorityRecoverySourceReadbackV1;
  approvalState: "APPROVED";
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.g2EffectAuthorityGrant;
  effect: G2Effect;
  expiresAt: string;
  grantDigest: string;
  grantId: string;
  humanAuthorityBindingDigest: string;
  humanAuthorityBindingId: string;
  issuedAt: string;
  issuerSubjectId: string;
  legacyAuthorityEvidenceRefId: string;
  legacyGrantId: string;
  requestedStage: CustomerZeroStage;
  revokedAt: null;
  state: "GRANTED";
  supersededByGrantId: null;
  tenantId: string;
  validFrom: string;
};

export type IncidentRecoverySourceBindingV1 = {
  acknowledgedAt: string;
  bindingDigest: string;
  bindingId: string;
  capabilityId: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.incidentRecoverySourceBinding;
  incidentRecordId: string;
  incidentSource: ExactAuthorityRecoverySourceReadbackV1;
  incidentState: "RESOLVED_VERIFIED";
  openedAt: string;
  recoveryCompletedAt: string;
  recoveryIncidentRecordId: string;
  recoverySource: ExactAuthorityRecoverySourceReadbackV1;
  recoveryState: "VERIFIED";
  resolvedAt: string;
  revokedAt: null;
  supersededByBindingId: null;
  tenantId: string;
};

export type CapabilityEpochResetV2 = {
  capabilityId: string;
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.capabilityEpochReset;
  effectiveAt: string;
  incidentRecordId: string;
  incidentRecoveryBindingDigest: string;
  incidentRecoveryBindingId: string;
  newEpochId: string;
  newEpochSequence: number;
  priorEpochId: string;
  priorEpochSequence: number;
  resetDigest: string;
  resetId: string;
  tenantId: string;
};

export type CapabilityEpochAnchorV1 = {
  capabilityId: string;
  epochId: string;
  epochSequence: number;
  tenantId: string;
};

export type OperationsEvidenceAuthorityRecoverySourceSnapshotV1 = {
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.sourceSnapshot;
  g2EffectAuthorityGrants: readonly G2EffectAuthorityGrantV2[];
  humanAuthoritySourceBindings: readonly HumanAuthoritySourceBindingV1[];
  incidentRecoverySourceBindings: readonly IncidentRecoverySourceBindingV1[];
  sourceAttestations: readonly OperationsEvidenceCanonicalSourceAttestationV1[];
  resolvedBy: "LUZIONE_CORE_SERVER" | "SYNTHETIC_TEST_HARNESS";
  snapshotDigest: string;
  snapshotAt: string;
  tenantId: string;
};

export type G2GrantAppendIdentityV1 = {
  actionId: string;
  approvalSourceDigest: string;
  effect: G2Effect;
  expiresAt: string;
  grantDigest: string;
  grantId: string;
  issuerSubjectId: string;
  requestedStage: CustomerZeroStage;
  state: "GRANTED";
};

export type CapabilityEpochSuccessorIdentityV1 = {
  capabilityId: string;
  incidentRecoveryBindingDigest: string;
  newEpochId: string;
  newEpochSequence: number;
  priorEpochId: string;
  priorEpochSequence: number;
  resetDigest: string;
  resetId: string;
};

export type OperationsEvidenceAppendStateV1 = {
  appliedLedgerDigests: readonly string[];
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.appendState;
  epochAnchors: readonly CapabilityEpochAnchorV1[];
  epochSuccessors: readonly CapabilityEpochSuccessorIdentityV1[];
  g2GrantIdentities: readonly G2GrantAppendIdentityV1[];
  stateScopeId: string;
  priorStateDigest: string | null;
  revision: number;
  stateDigest: string;
  tenantId: string;
};

export type OperationsEvidenceAppendStateCommitV1 = {
  disposition: "APPENDED";
  state: OperationsEvidenceAppendStateV1;
};

export interface OperationsEvidenceAppendStateStoreV1 {
  readonly contractVersion: "OperationsEvidenceAppendStateStore/v1";
  compareAndAppend(expectedStateDigest: string, nextState: OperationsEvidenceAppendStateV1): OperationsEvidenceAppendStateCommitV1;
  load(tenantId: string, ledgerId: string): unknown;
}

export type LuzioneOperationsEvidenceLedgerV3 = {
  assessmentTime: string;
  baseLedger: LuzioneOperationsEvidenceLedgerV2;
  capabilityEpochResets: readonly CapabilityEpochResetV2[];
  contractVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_VERSION;
  creditCeiling: { g2: 0; production: 0; proofDays: 0 };
  decisionPolicy: "ZERO_CREDIT_PENDING_ASSURANCE_04";
  effectAuthority: "NO_EFFECT";
  g2EffectAuthorityGrants: readonly G2EffectAuthorityGrantV2[];
  humanAuthoritySourceBindings: readonly HumanAuthoritySourceBindingV1[];
  incidentRecoverySourceBindings: readonly IncidentRecoverySourceBindingV1[];
  ledgerDigest: string;
  ledgerId: string;
  sourcePackets: { l2: "ABSENT"; l3: "ABSENT" };
  tenantId: string;
};

export type OperationsEvidenceLedgerParseContextV3 = {
  assessmentTime: string;
  appendStateStore: OperationsEvidenceAppendStateStoreV1;
  priorSet?: OperationsEvidenceLedgerPriorSetV2;
  sourceSnapshot: OperationsEvidenceAuthorityRecoverySourceSnapshotV1;
};

export type ParsedOperationsEvidenceLedgerV3 = {
  decision: {
    decisionBearingUse: "PROHIBITED_PENDING_ASSURANCE_04_AND_CANONICAL_SOURCES";
    g2Credit: 0;
    productionCredit: 0;
    proofDayCredit: 0;
  };
  appendDisposition: "APPENDED" | "EXACT_REPLAY";
  appendState: OperationsEvidenceAppendStateV1;
  ledger: LuzioneOperationsEvidenceLedgerV3;
  structurallyValidatedBaseVersion: "LuzioneOperationsEvidenceLedger/v2";
};

export type LuzioneOperationsEvidenceLedgerManifestV3 = {
  artifacts: {
    appendStateSchema: string;
    canonicalSourceObjectsSchema: string;
    l2SourcePacket: string;
    l3SourcePacket: string;
    ruleSource: string;
    schemaBundle: string;
    semanticFixtures: string;
    sourceAttestationSchema: string;
    strictConsumerSdk: string;
  };
  assuranceFingerprintSha256: string;
  baseLedgerVersion: "LuzioneOperationsEvidenceLedger/v2";
  candidateSha: string;
  compatibility: {
    appendStateRequired: true;
    canonicalSourceBytesAuthenticated: true;
    decisionBearingV1UseProhibited: true;
    decisionBearingV2UseProhibited: true;
    exactFieldSets: true;
    resetCalendarDayExcluded: true;
    sourceBindingsRequired: true;
    unknownVersionsRejected: true;
  };
  controllerAuthority: string;
  effectAuthority: "NO_EFFECT";
  ledgerVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_VERSION;
  productionReady: false;
  runtimeActivation: "NOT_IMPLEMENTED";
  schemaVersion: typeof OPERATIONS_EVIDENCE_LEDGER_V3_MANIFEST_VERSION;
  sourceAvailability: {
    canonicalG2Approval: "ABSENT";
    canonicalHumanMembership: "ABSENT";
    incidentBoundRecovery: "ABSENT";
    resolvedVerifiedIncident: "ABSENT";
  };
  sourceMapFingerprintSha256: string;
};
