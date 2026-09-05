import type {
  A02CommandDraft,
  A02ReadbackDraft,
  A02ReceiptDraft,
} from "@/modules/shared-contract-drafts/contracts";

export const CORE_CONTRACT_BUNDLE_VERSION = "LuzioneCoreContracts/v1";

export const CORE_CONTRACT_VERSIONS = Object.freeze({
  connectorBinding: "ConnectorBinding/v1",
  customerReply: "CustomerReply/v1",
  featureFlags: "LuzioneCoreFeatureFlags/v1",
  importBatch: "ImportBatch/v1",
  importReceipt: "ImportReceipt/v1",
  releaseManifest: "LuzioneCoreReleaseManifest/v1",
  setupMandate: "SetupMandate/v1",
  sultanOperation: "SultanOperation/v1",
  sultanReadback: "SultanReadback/v1",
  sultanReceipt: "SultanReceipt/v1",
  supportAction: "SupportAction/v1",
  supportCase: "SupportCase/v1",
  syncReceipt: "SyncReceipt/v1",
  tenantBlueprint: "TenantBlueprint/v1",
} as const);

export type CoreContractVersion = (typeof CORE_CONTRACT_VERSIONS)[keyof typeof CORE_CONTRACT_VERSIONS];

export const CORE_A02_PINS = Object.freeze({
  bundle: "luzione-shared-contracts/v0.2-draft.1",
  command: "luzione-command-envelope/v0.2-draft.1",
  identityTenant: "luzione-identity-tenant/v0.2-draft.1",
  readback: "luzione-readback-envelope/v0.2-draft.1",
  receipt: "luzione-receipt-envelope/v0.2-draft.1",
} as const);

export const CORE_EFFECT_MODES = [
  "NO_EFFECT",
  "SANDBOX_ONLY",
  "REVERSIBLE_TENANT_CONFIGURATION",
  "BOUNDED_PROVIDER_EFFECT",
] as const;
export type CoreEffectMode = (typeof CORE_EFFECT_MODES)[number];

export const SUPPORT_POLICY = Object.freeze({
  ambiguityStates: ["CLEAR", "INDETERMINATE"] as const,
  approvalDecisions: ["ALLOW", "DENY", "REQUIRE_HUMAN"] as const,
  caseStates: ["CLOSED_VERIFIED", "INVESTIGATING", "OPEN", "PENDING_CUSTOMER", "PENDING_HUMAN"] as const,
  entitlementStates: ["ACTIVE", "REVOKED", "UNVERIFIED"] as const,
  finalityStates: ["NOT_FINAL", "OWNER_COMMITTED", "SOURCE_CONFIRMED"] as const,
  severity: ["P0", "P1", "P2", "P3"] as const,
  slaPauseReasons: ["APPROVED_EXCEPTION", "CUSTOMER_WAITING", "NONE"] as const,
  slaStates: ["CLOCK_STOPPED", "PAUSED", "RUNNING"] as const,
} as const);

export type SupportActorBoundary = {
  logicalActorId: string;
  membershipState: "ACTIVE" | "REVOKED";
  serverDerivedIdentityRef: string;
};

export type SupportAuditHead = {
  entryDigest: string;
  entryId: string;
  previousEntryDigest: string | null;
  sequence: number;
};

export type SupportPolicyDecision = {
  approvalRef: string | null;
  decision: "ALLOW" | "DENY" | "REQUIRE_HUMAN";
  evaluatedAt: string;
  policyVersion: string;
  reasonCodes: readonly string[];
};

export type SupportReplayBoundary = {
  idempotencyKey: string;
  payloadHash: string;
  replayOfId: string | null;
};

export type SupportReservation = {
  receiptRef: string | null;
  state: "CONFLICT" | "INDETERMINATE" | "NOT_RESERVED_G0" | "RESERVED";
};

export type CoreVersionRef = {
  objectId: string;
  objectType: string;
  ownerProject: string;
  version: string;
};

export type SultanOperationV1 = {
  a02Command: A02CommandDraft;
  a02Pins: typeof CORE_A02_PINS;
  causation: {
    correlationId: string;
    requestId: string;
    traceId: string;
  };
  contractVersion: typeof CORE_CONTRACT_VERSIONS.sultanOperation;
  deadline: string;
  effectMode: CoreEffectMode;
  operationId: string;
  reservation: {
    reservedAt: string | null;
    reservationReceiptRef: string | null;
    state: "NOT_RESERVED_G0" | "RESERVED" | "CONFLICT" | "INDETERMINATE";
  };
  versionIntent: {
    preconditionVersion: string;
    targetVersionAtRequest: string;
  };
};

export type SultanReceiptV1 = {
  a02Receipt: A02ReceiptDraft;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.sultanReceipt;
  effect: {
    actual: CoreEffectMode;
    providerAcknowledgementRef: string | null;
  };
  finality: "DOMAIN_COMMITTED" | "DISPATCH_PENDING";
  issuedAt: string;
  issuedBy: string;
  operationRef: {
    operationId: string;
    payloadHash: string;
  };
  versions: {
    committedVersion: string;
    preconditionVersion: string;
    targetVersionAtRequest: string;
  };
};

export type SultanReadbackV1 = {
  a02Readback: A02ReadbackDraft;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.sultanReadback;
  operationId: string;
  receiptId: string;
  verification: {
    businessFinal: boolean;
    finality: A02ReadbackDraft["finality"];
    freshUntil: string | null;
    observedAt: string | null;
    sourceReadbackRef: string | null;
  };
  versions: {
    committedVersion: string;
    observedVersion: string | null;
  };
};

export type TenantBlueprintV1 = {
  approval: {
    approvedAt: string | null;
    approvalRef: string | null;
    state: "DRAFT" | "APPROVED" | "SUPERSEDED";
  };
  blueprintId: string;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.tenantBlueprint;
  sections: {
    aiPolicies: readonly string[];
    approvals: readonly string[];
    connectors: readonly string[];
    fields: readonly string[];
    icp: readonly string[];
    retention: readonly string[];
    roles: readonly string[];
    stages: readonly string[];
    terminology: Readonly<Record<string, string>>;
    workflows: readonly string[];
  };
  tenantId: string;
  version: string;
};

export type SetupMandateV1 = {
  active: boolean;
  allowedActions: readonly (
    | "APPLY_TENANT_CONFIGURATION"
    | "DRY_RUN_IMPORT"
    | "RECONCILE_IMPORT"
    | "VALIDATE_CONNECTOR_READBACK"
  )[];
  approvalRef: string;
  blueprintRef: { blueprintId: string; version: string };
  contractVersion: typeof CORE_CONTRACT_VERSIONS.setupMandate;
  effectCeiling: Exclude<CoreEffectMode, "BOUNDED_PROVIDER_EFFECT">;
  expiresAt: string;
  limits: { maxImportRecords: number; maxRuntimeMinutes: number };
  mandateId: string;
  prohibitedActions: readonly string[];
  rollbackPlanRef: string;
  tenantId: string;
};

export type ImportBatchV1 = {
  batchId: string;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.importBatch;
  dedupeKey: string;
  effectMode: "NO_EFFECT" | "SANDBOX_ONLY";
  mandateRef: string;
  mappingVersion: string;
  source: {
    consentRef: string;
    digest: string;
    kind: "CSV" | "DOCUMENT" | "XLSX";
    provenanceRef: string;
  };
  stagedCounts: { records: number; rejected: number };
  status: "STAGED" | "VALIDATED" | "RECONCILIATION_REQUIRED";
  tenantId: string;
};

export type ImportReceiptV1 = {
  batchId: string;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.importReceipt;
  counts: { accepted: number; duplicates: number; rejected: number; total: number };
  effectMode: "NO_EFFECT" | "SANDBOX_ONLY";
  exceptionRefs: readonly string[];
  finality: "VALIDATED_NO_EFFECT" | "STAGED" | "RECONCILIATION_REQUIRED";
  reconciliationRef: string | null;
  rollbackRef: string;
  tenantId: string;
};

export type ConnectorBindingV1 = {
  bindingId: string;
  consentRef: string;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.connectorBinding;
  credentialReference: string;
  cursor: string | null;
  provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365" | "QUICKBOOKS_ONLINE";
  revocation: { revokedAt: string | null; revocationRef: string | null };
  scopes: readonly string[];
  status: "CONSENT_REQUIRED" | "DRAFT" | "BOUND" | "REVOKED";
  tenantId: string;
};

export type SyncReceiptV1 = {
  bindingId: string;
  changes: { created: number; duplicates: number; failed: number; updated: number };
  contractVersion: typeof CORE_CONTRACT_VERSIONS.syncReceipt;
  cursor: { after: string | null; before: string | null };
  finality: "ACKNOWLEDGED" | "RECONCILING" | "SOURCE_CONFIRMED";
  providerAcknowledgementRef: string | null;
  reconciliationRef: string | null;
  sourceReadbackRef: string | null;
  tenantId: string;
};

export type SupportCaseV1 = {
  actor: SupportActorBoundary;
  auditHead: SupportAuditHead;
  caseId: string;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.supportCase;
  entitlement: {
    entitlementRef: string;
    policyVersion: string;
    state: "ACTIVE" | "REVOKED" | "UNVERIFIED";
    verifiedAt: string;
  };
  evidenceRefs: readonly string[];
  objectVersion: string;
  ownerRole: string;
  severity: "P0" | "P1" | "P2" | "P3";
  sla: {
    dueAt: string;
    pauseReason: "APPROVED_EXCEPTION" | "CUSTOMER_WAITING" | "NONE";
    pausedAt: string | null;
    policyVersion: string;
    startedAt: string;
    state: "CLOCK_STOPPED" | "PAUSED" | "RUNNING";
  };
  source: "CHAT" | "EMAIL" | "FORM" | "IN_APP";
  staleAfter: string;
  status: "CLOSED_VERIFIED" | "INVESTIGATING" | "OPEN" | "PENDING_CUSTOMER" | "PENDING_HUMAN";
  tenantId: string;
};

export type SupportActionV1 = {
  actionId: string;
  actionType: "CONFIGURATION" | "DIAGNOSTIC" | "ESCALATION" | "REPLY_DRAFT" | "SYNC_RETRY";
  actor: SupportActorBoundary;
  ambiguity: "CLEAR" | "INDETERMINATE";
  auditHead: SupportAuditHead;
  caseId: string;
  caseVersion: { expected: string; observed: string };
  contractVersion: typeof CORE_CONTRACT_VERSIONS.supportAction;
  effectMode: CoreEffectMode;
  evidenceRefs: readonly string[];
  finality: "NOT_FINAL" | "OWNER_COMMITTED" | "SOURCE_CONFIRMED";
  operation: SultanOperationV1;
  policy: SupportPolicyDecision;
  replay: SupportReplayBoundary;
  reservation: SupportReservation;
  resultReadbackRef: string | null;
  severityChange: { approvalRef: string | null; from: "P0" | "P1" | "P2" | "P3"; to: "P0" | "P1" | "P2" | "P3" } | null;
  status: "APPROVED" | "COMPLETED_VERIFIED" | "PROPOSED" | "REJECTED";
  tenantId: string;
};

export type CustomerReplyV1 = {
  actionId: string;
  actor: SupportActorBoundary;
  approval: SupportPolicyDecision;
  auditHead: SupportAuditHead;
  caseId: string;
  caseVersion: string;
  contentDigest: string;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.customerReply;
  delivery: {
    deliveredAt: string | null;
    providerReceiptRef: string | null;
    readbackRef: string | null;
    state: "DRAFT" | "FAILED" | "SENT_VERIFIED";
  };
  finality: "NOT_FINAL" | "SOURCE_CONFIRMED";
  followUpAt: string | null;
  replay: SupportReplayBoundary;
  reservation: SupportReservation;
  replyId: string;
  tenantId: string;
  truthSourceRefs: readonly string[];
};

export type LuzioneCoreFeatureFlagsV1 = {
  contractVersion: typeof CORE_CONTRACT_VERSIONS.featureFlags;
  defaultState: "DISABLED";
  flags: {
    connectorSync: false;
    customerReplyDelivery: false;
    importCommit: false;
    onboardingApply: false;
    operationEffects: false;
    providerDispatch: false;
    supportActionEffects: false;
  };
  overrideAuthority: "G2_HUMAN_GO_REQUIRED";
};

export type LuzioneCoreReleaseManifestV1 = {
  a02Pins: typeof CORE_A02_PINS;
  candidateSha: string;
  contractVersions: typeof CORE_CONTRACT_VERSIONS;
  contractBundleVersion: typeof CORE_CONTRACT_BUNDLE_VERSION;
  contractVersion: typeof CORE_CONTRACT_VERSIONS.releaseManifest;
  controllerAuthority: string;
  effectAuthority: "NO_EFFECT";
  featureFlagsVersion: typeof CORE_CONTRACT_VERSIONS.featureFlags;
  fepDependency: false;
  productionReady: false;
  runtimeActivation: "DARK_ONLY";
};

export type LuzioneCoreContractDocument =
  | ConnectorBindingV1
  | CustomerReplyV1
  | ImportBatchV1
  | ImportReceiptV1
  | LuzioneCoreFeatureFlagsV1
  | LuzioneCoreReleaseManifestV1
  | SetupMandateV1
  | SultanOperationV1
  | SultanReadbackV1
  | SultanReceiptV1
  | SupportActionV1
  | SupportCaseV1
  | SyncReceiptV1
  | TenantBlueprintV1;
