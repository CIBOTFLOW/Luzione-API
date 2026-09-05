import type { CanonicalHumanRoleV3, G2Effect } from "./contracts";

export const OPS_CORRECTION_02_ASSURANCE = Object.freeze({
  assuranceFingerprintSha256: "b11f3cb5b9901a37a36c2543aba3542ef8e4b7349f62d14bac16e9813faa103f",
  controllerAuthority: "65dcf041236133af9c3c3cdf2a7d27789b8ee9b2",
  packetId: "OPS-CONTRACTS-CORRECTION-02/v1",
  sourceMapFingerprintSha256: "66ca2ccbaca70ef60b407be7ac9230184b55cdeccbd9c50fdc67566802d72959",
} as const);

export const OPS_CORRECTION_03_ASSURANCE = Object.freeze({
  assuranceCanonicalJsonSha256: "02c7b353f9fbc43cd78f0af096c55a9622a68158794f1735924a29aa036af4a8",
  assuranceRawPacketSha256: "e33687257cf0b8e1c8d8061b793c456e11d7e28c16e04f41b8fb40b83131ffe8",
  controllerAuthority: "b20899aa38b3e57aa809924266d9f68a94495468",
  packetId: "OPS-CONTRACTS-CORRECTION-03/v1",
} as const);

export const OPS_V3_SYNTHETIC_SOURCE_TRUST_ROOT = Object.freeze({
  algorithm: "Ed25519",
  creditAuthority: "ZERO",
  keyId: "ops-v3-synthetic-assurance-ed25519-20260905",
  publicKeyJwk: Object.freeze({
    crv: "Ed25519",
    kty: "OKP",
    x: "00XWRTcc6-UJO9_j1CFlTzNyymMLwV3Z0dF-Xo94riw",
  }),
  scope: "SYNTHETIC_TEST_HARNESS_ONLY",
} as const);

export const OWNER_FUNCTIONS_BY_ROLE_V3 = Object.freeze({
  FOUNDER: Object.freeze(["FOUNDER"]),
  IREM: Object.freeze(["PLATFORM_OPERATIONS", "SUPPORT_OPERATIONS"]),
} as const satisfies Readonly<Record<CanonicalHumanRoleV3, readonly string[]>>);

export const REQUIRED_G2_SCOPES_V2 = Object.freeze([
  { actionId: "g2:activate-reads", effect: "TENANT_LIVE_READ", requestedStage: "READS" },
  { actionId: "g2:activate-reversible-writes", effect: "TENANT_REVERSIBLE_WRITE", requestedStage: "REVERSIBLE_WRITES" },
  { actionId: "g2:activate-bounded-provider-actions", effect: "BOUNDED_PROVIDER_ACTION", requestedStage: "BOUNDED_PROVIDER_ACTIONS" },
  { actionId: "g2:open-formal-proof", effect: "FORMAL_PROOF_OPEN", requestedStage: "FORMAL_PROOF" },
] as const satisfies readonly { actionId: string; effect: G2Effect; requestedStage: string }[]);

export const OPS_LEDGER_V3_SCHEMA_KEYS = Object.freeze({
  appendState: Object.freeze(["appliedLedgerDigests", "contractVersion", "epochAnchors", "epochSuccessors", "g2GrantIdentities", "priorStateDigest", "revision", "stateDigest", "stateScopeId", "tenantId"]),
  canonicalG2Approval: Object.freeze(["actionId", "approvalId", "approvalState", "contractVersion", "effect", "expiresAt", "issuedAt", "requestedStage", "revokedAt", "signerSubjectId", "state", "supersededByGrantId", "tenantId", "validFrom"]),
  canonicalIncidentRecovery: Object.freeze(["capabilityId", "completedAt", "contractVersion", "incidentRecordId", "recoveryReceiptId", "state", "tenantId"]),
  canonicalProofIncident: Object.freeze(["acknowledgedAt", "capabilityId", "contractVersion", "incidentRecordId", "openedAt", "resetCapabilityEpoch", "resolvedAt", "state", "tenantId"]),
  canonicalSourceAttestation: Object.freeze(["attestationDigest", "attestationId", "contractVersion", "objectBytes", "objectHash", "objectId", "objectType", "objectVersion", "readbackBytes", "readbackHash", "readbackId", "signature", "signingKeyId", "sourceSystem", "tenantId"]),
  canonicalSourceReadback: Object.freeze(["contractVersion", "objectHash", "objectId", "objectType", "objectVersion", "readbackAt", "readbackId", "sourceSystem", "tenantId"]),
  canonicalTenantMembership: Object.freeze(["canonicalFunction", "canonicalRole", "contractVersion", "membershipState", "principalType", "revokedAt", "subjectId", "supersededByBindingId", "tenantId", "validFrom", "validUntil"]),
  creditCeiling: Object.freeze(["g2", "production", "proofDays"]),
  epochAnchor: Object.freeze(["capabilityId", "epochId", "epochSequence", "tenantId"]),
  epochReset: Object.freeze(["capabilityId", "contractVersion", "effectiveAt", "incidentRecordId", "incidentRecoveryBindingDigest", "incidentRecoveryBindingId", "newEpochId", "newEpochSequence", "priorEpochId", "priorEpochSequence", "resetDigest", "resetId", "tenantId"]),
  g2Grant: Object.freeze(["actionId", "approvalAppendOnly", "approvalSource", "approvalState", "contractVersion", "effect", "expiresAt", "grantDigest", "grantId", "humanAuthorityBindingDigest", "humanAuthorityBindingId", "issuedAt", "issuerSubjectId", "legacyAuthorityEvidenceRefId", "legacyGrantId", "requestedStage", "revokedAt", "state", "supersededByGrantId", "tenantId", "validFrom"]),
  humanBinding: Object.freeze(["bindingDigest", "bindingId", "canonicalFunction", "canonicalRole", "contractVersion", "issuerSubjectId", "legacyAuthorityEvidenceRefId", "membershipSource", "membershipState", "principalType", "revokedAt", "supersededByBindingId", "tenantId", "validFrom", "validUntil"]),
  incidentBinding: Object.freeze(["acknowledgedAt", "bindingDigest", "bindingId", "capabilityId", "contractVersion", "incidentRecordId", "incidentSource", "incidentState", "openedAt", "recoveryCompletedAt", "recoveryIncidentRecordId", "recoverySource", "recoveryState", "resolvedAt", "revokedAt", "supersededByBindingId", "tenantId"]),
  ledger: Object.freeze(["assessmentTime", "baseLedger", "capabilityEpochResets", "contractVersion", "creditCeiling", "decisionPolicy", "effectAuthority", "g2EffectAuthorityGrants", "humanAuthoritySourceBindings", "incidentRecoverySourceBindings", "ledgerDigest", "ledgerId", "sourcePackets", "tenantId"]),
  sourcePackets: Object.freeze(["l2", "l3"]),
  sourceReadback: Object.freeze(["objectHash", "objectId", "objectType", "objectVersion", "readbackAt", "readbackHash", "readbackId", "readbackObjectId", "readbackObjectVersion", "sourceSystem", "tenantId"]),
  epochSuccessorIdentity: Object.freeze(["capabilityId", "incidentRecoveryBindingDigest", "newEpochId", "newEpochSequence", "priorEpochId", "priorEpochSequence", "resetDigest", "resetId"]),
  g2GrantIdentity: Object.freeze(["actionId", "approvalSourceDigest", "effect", "expiresAt", "grantDigest", "grantId", "issuerSubjectId", "requestedStage", "state"]),
  sourceSnapshot: Object.freeze(["contractVersion", "g2EffectAuthorityGrants", "humanAuthoritySourceBindings", "incidentRecoverySourceBindings", "resolvedBy", "snapshotAt", "snapshotDigest", "sourceAttestations", "tenantId"]),
} as const);

export const OPS_CORRECTION_02_ADVERSE_PROBES = Object.freeze([
  "B01_OWNER_STRING_RESEAL",
  "B02_FOUNDER_IREM_MALLORY_SUBSTITUTION",
  "B03_VALID_ENUM_ROLE_FUNCTION_RELABEL",
  "B04_AGENT_SERVICE_WORKLOAD_DEV_TEST_AS_HUMAN",
  "B05_CROSS_TENANT_MEMBERSHIP",
  "B06_STALE_REVOKED_SUPERSEDED_MEMBERSHIP",
  "B07_BUNDLED_MISMATCHED_EXPIRED_GRANT",
  "B08_OPEN_UNVERIFIED_INCIDENT",
  "B09_ORPHAN_RECOVERY",
  "B10_EPOCH_GAP_FORK_CYCLE_REUSED_SUCCESSOR",
  "B11_SURPLUS_MISSING_WRONG_VERSION_AND_SOURCE_DRIFT",
] as const);

export const OPS_CORRECTION_03_ADVERSE_PROBES = Object.freeze([
  "D01_CHANGED_G2_GRANT_CROSS_PARSE",
  "D02_TYPED_SOURCE_BYTES_HASH_AUTH",
  "D03_GENERIC_RECOVERY_RELABEL",
  "D04_CROSS_LEDGER_EPOCH_FORK",
  "D05_RESET_DAY_CAPABILITY_CREDIT",
  "D06_IMMUTABLE_EVIDENCE_TRUTH",
  "B07_G2_STABLE_ID_REPLAY_CONFLICT",
  "B08_CALLER_SOURCE_PROVENANCE_RESEAL",
  "B09_INCIDENT_RECOVERY_TYPED_BINDING",
  "B10_EPOCH_CROSS_LEDGER_CONTINUITY",
  "B11_SOURCE_VERSION_HASH_READBACK_DRIFT",
] as const);
