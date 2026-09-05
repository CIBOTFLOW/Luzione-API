import type { CanonicalHumanRole, G2Effect, HardZeroMetricKey } from "./contracts";

export const OPS_CORRECTION_ASSURANCE = Object.freeze({
  fingerprintSha256: "80ae6a53c8ff28259389b1175f7029bf920013e03c7e5419b145c9c2a569decf",
  probeSourceSha256: "6d370c6ca70405f93bf91b1fa24c53a4d4d73e0936bbb85cd6bb66ab8c0f56ad",
  packetId: "OPS-CONTRACTS-ASSURE-01/v1",
} as const);

export const OPS_LEDGER_LIMITS = Object.freeze({
  maximumCapabilityProofDays: 30,
  minimumCompletenessDenominator: 1,
  requiredCompletenessBps: 10000,
  requiredTelemetryBps: 10000,
  weeklyCalendarDays: 7,
} as const);

export const HARD_ZERO_METRIC_KEYS = Object.freeze([
  "duplicateEffect",
  "falseFinality",
  "p0P1AutoClose",
  "secretExposure",
  "unauthorizedCrossTenantSuccess",
  "unauthorizedEffect",
  "unapprovedProviderDispatch",
  "unverifiedClosure",
] as const satisfies readonly HardZeroMetricKey[]);

export const REQUIRED_PROOF_ENTRY_G2_EFFECTS = Object.freeze([
  { actionId: "g2:activate-reads", effect: "TENANT_LIVE_READ", requestedStage: "READS" },
  { actionId: "g2:activate-reversible-writes", effect: "TENANT_REVERSIBLE_WRITE", requestedStage: "REVERSIBLE_WRITES" },
  { actionId: "g2:activate-bounded-provider-actions", effect: "BOUNDED_PROVIDER_ACTION", requestedStage: "BOUNDED_PROVIDER_ACTIONS" },
  { actionId: "g2:open-formal-proof", effect: "FORMAL_PROOF_OPEN", requestedStage: "FORMAL_PROOF" },
] as const satisfies readonly { actionId: string; effect: G2Effect; requestedStage: string }[]);

export const STAGE_G2_EFFECT = Object.freeze({
  BOUNDED_PROVIDER_ACTIONS: "BOUNDED_PROVIDER_ACTION",
  DARK: null,
  FORMAL_PROOF: "FORMAL_PROOF_OPEN",
  READS: null,
  REVERSIBLE_WRITES: "TENANT_REVERSIBLE_WRITE",
} as const);

export const OWNER_FUNCTIONS_BY_ROLE = Object.freeze({
  FOUNDER: Object.freeze(["FOUNDER"]),
  IREM: Object.freeze(["PLATFORM_OPERATIONS", "SUPPORT_OPERATIONS"]),
} as const satisfies Readonly<Record<CanonicalHumanRole, readonly string[]>>);

export const OPS_LEDGER_SCHEMA_KEYS = Object.freeze({
  authorityGrant: Object.freeze([
    "actionId", "authorityEvidenceRefId", "contractVersion", "effect", "expiresAt", "grantId",
    "grantedAt", "requestedStage", "signerFunction", "signerOwnerId", "state", "tenantId",
  ]),
  capabilityEpochReset: Object.freeze([
    "capabilityId", "contractVersion", "effectiveDate", "incidentRecordId", "newEpochId", "priorEpochId",
    "recoveryEvidenceRefId", "resetId", "tenantId",
  ]),
  entry: Object.freeze(["contentDigest", "document"]),
  hardZeroObservation: Object.freeze(["evidenceRefId", "metricId", "metricKey", "value"]),
  ledger: Object.freeze([
    "assessmentTime", "authorityGrants", "capabilityEpochResets", "contractVersion", "dailyMetricBindings",
    "effectAuthority", "entries", "ledgerDigest", "ledgerId", "ownerContexts", "priorRecordSetDigest",
    "recordSetDigest", "tenantId",
  ]),
  ownerContext: Object.freeze([
    "authorityEvidenceRefId", "contractVersion", "function", "membershipState", "ownerId", "principalType",
    "role", "tenantId",
  ]),
  dailyMetricBinding: Object.freeze([
    "completenessEvidenceRefId", "completenessMetricId", "completenessReportRecordId", "contractVersion",
    "dailyRecordId", "hardZeros", "metricCatalogRecordId", "telemetryEvidenceRefId", "telemetryMetricId",
  ]),
} as const);

export const OPS_CORRECTION_ADVERSE_PROBES = Object.freeze([
  "A01_APPEND_ONLY_IDENTITY_SUPERSESSION",
  "A02_UNRESOLVED_CAPABILITY_EVIDENCE",
  "A03_INVALID_FUTURE_CALENDAR_DAY",
  "A04_ORPHAN_WEEKLY_CAPABILITY_DAILY_REFERENCE",
  "A05_SELF_ASSERTED_EXIT_ORPHAN_RECOVERY",
  "A06_READY_WITHOUT_COMPLETE_G2_SET",
  "A07_ARBITRARY_STAGE_APPROVAL",
  "A08_AGENT_OR_PAYLOAD_ASSERTED_OWNER",
  "A09_P0_P1_AUTO_CLOSE_OMISSION",
  "A10_CALLER_COMPLETENESS_WITHOUT_EXACT_BINDING",
  "A11_ZERO_DENOMINATOR_AND_THIRTY_DAY_PARITY",
] as const);
