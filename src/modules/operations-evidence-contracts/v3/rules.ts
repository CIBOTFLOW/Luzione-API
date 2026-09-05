import type { CanonicalHumanRoleV3, G2Effect } from "./contracts";

export const OPS_CORRECTION_02_ASSURANCE = Object.freeze({
  assuranceFingerprintSha256: "b11f3cb5b9901a37a36c2543aba3542ef8e4b7349f62d14bac16e9813faa103f",
  controllerAuthority: "65dcf041236133af9c3c3cdf2a7d27789b8ee9b2",
  packetId: "OPS-CONTRACTS-CORRECTION-02/v1",
  sourceMapFingerprintSha256: "66ca2ccbaca70ef60b407be7ac9230184b55cdeccbd9c50fdc67566802d72959",
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
  creditCeiling: Object.freeze(["g2", "production", "proofDays"]),
  epochAnchor: Object.freeze(["capabilityId", "epochId", "epochSequence", "tenantId"]),
  epochReset: Object.freeze(["capabilityId", "contractVersion", "effectiveAt", "incidentRecordId", "incidentRecoveryBindingDigest", "incidentRecoveryBindingId", "newEpochId", "newEpochSequence", "priorEpochId", "priorEpochSequence", "resetDigest", "resetId", "tenantId"]),
  g2Grant: Object.freeze(["actionId", "approvalAppendOnly", "approvalSource", "approvalState", "contractVersion", "effect", "expiresAt", "grantDigest", "grantId", "humanAuthorityBindingDigest", "humanAuthorityBindingId", "issuedAt", "issuerSubjectId", "legacyAuthorityEvidenceRefId", "legacyGrantId", "requestedStage", "revokedAt", "state", "supersededByGrantId", "tenantId", "validFrom"]),
  humanBinding: Object.freeze(["bindingDigest", "bindingId", "canonicalFunction", "canonicalRole", "contractVersion", "issuerSubjectId", "legacyAuthorityEvidenceRefId", "membershipSource", "membershipState", "principalType", "revokedAt", "supersededByBindingId", "tenantId", "validFrom", "validUntil"]),
  incidentBinding: Object.freeze(["acknowledgedAt", "bindingDigest", "bindingId", "capabilityId", "contractVersion", "incidentRecordId", "incidentSource", "incidentState", "openedAt", "recoveryCompletedAt", "recoveryIncidentRecordId", "recoverySource", "recoveryState", "resolvedAt", "revokedAt", "supersededByBindingId", "tenantId"]),
  ledger: Object.freeze(["assessmentTime", "baseLedger", "capabilityEpochResets", "contractVersion", "creditCeiling", "decisionPolicy", "effectAuthority", "g2EffectAuthorityGrants", "humanAuthoritySourceBindings", "incidentRecoverySourceBindings", "ledgerDigest", "ledgerId", "sourcePackets", "tenantId"]),
  sourcePackets: Object.freeze(["l2", "l3"]),
  sourceReadback: Object.freeze(["objectHash", "objectId", "objectType", "objectVersion", "readbackAt", "readbackHash", "readbackId", "readbackObjectId", "readbackObjectVersion", "sourceSystem", "tenantId"]),
  sourceSnapshot: Object.freeze(["contractVersion", "g2EffectAuthorityGrants", "humanAuthoritySourceBindings", "incidentRecoverySourceBindings", "resolvedBy", "snapshotAt", "tenantId"]),
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
