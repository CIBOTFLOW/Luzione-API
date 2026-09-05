import a02Fixture from "../../../contracts/drafts/fixtures/a02-v0.2-draft.1-producer-consumer.json";
import type { A02CommandDraft, A02ReadbackDraft, A02ReceiptDraft } from "@/modules/shared-contract-drafts/contracts";
import {
  CORE_A02_PINS,
  CORE_CONTRACT_BUNDLE_VERSION,
  CORE_CONTRACT_VERSIONS,
  type ConnectorBindingV1,
  type CustomerReplyV1,
  type ImportBatchV1,
  type ImportReceiptV1,
  type LuzioneCoreFeatureFlagsV1,
  type LuzioneCoreReleaseManifestV1,
  type SetupMandateV1,
  type SultanOperationV1,
  type SultanReadbackV1,
  type SultanReceiptV1,
  type SupportActionV1,
  type SupportCaseV1,
  type SyncReceiptV1,
  type TenantBlueprintV1,
} from "./contracts";

const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const shaB = "5a131b7bae4a8f3cea4e66404c1ab9c5905b1c32c6c5015d16f8bd72a7fa3c59";
const shaC = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const operationId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const actionId = "33333333-3333-4333-8333-333333333333";

const baseCommand = a02Fixture.producer.command as unknown as A02CommandDraft;
const operationCommand = {
  ...baseCommand,
  commandId: operationId,
  commandType: "support.case.investigate",
  expectedObjectVersion: "support-case:v7",
  idempotencyKey: "support-action:idem-1",
  payload: { action: "DIAGNOSTIC", caseId, simulation: true },
  payloadHash: shaB,
  requestedAt: "2026-09-05T00:00:00.000Z",
  target: {
    objectId: caseId,
    objectType: "support-case",
    objectVersion: "support-case:v7",
    ownerProject: "LUZIONE_CRM_SUPPORT",
  },
} as A02CommandDraft;

export const sultanOperationFixture: SultanOperationV1 = {
  a02Command: operationCommand,
  a02Pins: CORE_A02_PINS,
  causation: {
    correlationId: operationCommand.context.request.correlationId,
    requestId: operationCommand.context.request.requestId,
    traceId: operationCommand.context.request.traceId,
  },
  contractVersion: CORE_CONTRACT_VERSIONS.sultanOperation,
  deadline: "2026-09-05T00:05:00.000Z",
  effectMode: "NO_EFFECT",
  operationId,
  reservation: { reservedAt: null, reservationReceiptRef: null, state: "NOT_RESERVED_G0" },
  versionIntent: { preconditionVersion: "support-case:v7", targetVersionAtRequest: "support-case:v7" },
};

const receipt = {
  ...(a02Fixture.producer.receipt as unknown as A02ReceiptDraft),
  commandId: operationId,
  correlationId: operationCommand.context.request.correlationId,
  idempotency: { key: operationCommand.idempotencyKey, payloadHash: shaB, replay: false },
  object: { id: caseId, ownerProject: "LUZIONE_CRM_SUPPORT", type: "support-case", version: "support-case:v8" },
  receiptId: "receipt-support-action-1",
  tenantId: "tenant-luzione",
} as A02ReceiptDraft;

export const sultanReceiptFixture: SultanReceiptV1 = {
  a02Receipt: receipt,
  contractVersion: CORE_CONTRACT_VERSIONS.sultanReceipt,
  effect: { actual: "NO_EFFECT", providerAcknowledgementRef: null },
  finality: "DISPATCH_PENDING",
  issuedAt: "2026-09-05T00:00:01.000Z",
  issuedBy: "LUZIONE_CRM_SUPPORT",
  operationRef: { operationId, payloadHash: shaB },
  versions: {
    committedVersion: "support-case:v8",
    preconditionVersion: "support-case:v7",
    targetVersionAtRequest: "support-case:v7",
  },
};

const readback = {
  ...(a02Fixture.producer.readback as unknown as A02ReadbackDraft),
  evidence: {
    commandId: operationId,
    eventId: receipt.evidence.eventId,
    providerAcknowledgementRef: null,
    receiptId: receipt.receiptId,
    reconciliationId: null,
    sourceReadbackRef: "postgres:support-case:v8",
  },
  freshness: {
    freshUntil: "2099-09-05T00:10:00.000Z",
    observedAt: "2026-09-05T00:00:02.000Z",
    state: "FRESH",
  },
  object: { id: caseId, ownerProject: "LUZIONE_CRM_SUPPORT", type: "support-case", version: "support-case:v8" },
  tenantId: "tenant-luzione",
} as A02ReadbackDraft;

export const sultanReadbackFixture: SultanReadbackV1 = {
  a02Readback: readback,
  contractVersion: CORE_CONTRACT_VERSIONS.sultanReadback,
  operationId,
  receiptId: receipt.receiptId,
  verification: {
    businessFinal: readback.businessFinal,
    finality: readback.finality,
    freshUntil: readback.freshness.freshUntil,
    observedAt: readback.freshness.observedAt,
    sourceReadbackRef: readback.evidence.sourceReadbackRef,
  },
  versions: { committedVersion: "support-case:v8", observedVersion: "support-case:v8" },
};

export const tenantBlueprintFixture: TenantBlueprintV1 = {
  approval: { approvedAt: "2026-09-05T00:00:00.000Z", approvalRef: "approval:blueprint-1", state: "APPROVED" },
  blueprintId: "44444444-4444-4444-8444-444444444444",
  contractVersion: CORE_CONTRACT_VERSIONS.tenantBlueprint,
  sections: {
    aiPolicies: ["ai-policy:v1"], approvals: ["approval-policy:v1"], connectors: ["google-workspace"],
    fields: ["lead-source"], icp: ["b2b-saas"], retention: ["retention:v1"], roles: ["support-agent"],
    stages: ["qualified"], terminology: { lead: "prospect" }, workflows: ["lead-procurement"],
  },
  tenantId: "tenant-luzione",
  version: "tenant-blueprint:v1",
};

export const setupMandateFixture: SetupMandateV1 = {
  active: false,
  allowedActions: ["DRY_RUN_IMPORT", "VALIDATE_CONNECTOR_READBACK"],
  approvalRef: "approval:setup-mandate-1",
  blueprintRef: { blueprintId: tenantBlueprintFixture.blueprintId, version: tenantBlueprintFixture.version },
  contractVersion: CORE_CONTRACT_VERSIONS.setupMandate,
  effectCeiling: "NO_EFFECT",
  expiresAt: "2099-09-05T00:00:00.000Z",
  limits: { maxImportRecords: 100, maxRuntimeMinutes: 15 },
  mandateId: "55555555-5555-4555-8555-555555555555",
  prohibitedActions: [
    "CHANGE_SHARED_CODE_OR_SCHEMA", "COMPLETE_OAUTH", "CREATE_OR_READ_CREDENTIAL", "CROSS_TENANT",
    "DESTRUCTIVE_DATA_CLEANUP", "EXPAND_AUTHORITY", "SEND_EXTERNAL_COMMUNICATION",
  ],
  rollbackPlanRef: "rollback:setup-v1",
  tenantId: "tenant-luzione",
};

export const importBatchFixture: ImportBatchV1 = {
  batchId: "66666666-6666-4666-8666-666666666666",
  contractVersion: CORE_CONTRACT_VERSIONS.importBatch,
  dedupeKey: "import:tenant-luzione:1",
  effectMode: "NO_EFFECT",
  mandateRef: setupMandateFixture.mandateId,
  mappingVersion: "crm-import-map:v1",
  source: { consentRef: "consent:import-1", digest: shaA, kind: "CSV", provenanceRef: "upload:synthetic-1" },
  stagedCounts: { records: 8, rejected: 2 },
  status: "VALIDATED",
  tenantId: "tenant-luzione",
};

export const importReceiptFixture: ImportReceiptV1 = {
  batchId: importBatchFixture.batchId,
  contractVersion: CORE_CONTRACT_VERSIONS.importReceipt,
  counts: { accepted: 7, duplicates: 1, rejected: 2, total: 10 },
  effectMode: "NO_EFFECT",
  exceptionRefs: ["exception:row-9", "exception:row-10"],
  finality: "VALIDATED_NO_EFFECT",
  reconciliationRef: null,
  rollbackRef: "rollback:discard-staging-1",
  tenantId: "tenant-luzione",
};

export const connectorBindingFixture: ConnectorBindingV1 = {
  bindingId: "77777777-7777-4777-8777-777777777777",
  consentRef: "consent:google-workspace-1",
  contractVersion: CORE_CONTRACT_VERSIONS.connectorBinding,
  credentialReference: "secret-ref:google-workspace-tenant-luzione",
  cursor: null,
  provider: "GOOGLE_WORKSPACE",
  revocation: { revokedAt: null, revocationRef: null },
  scopes: ["contacts.readonly"],
  status: "DRAFT",
  tenantId: "tenant-luzione",
};

export const syncReceiptFixture: SyncReceiptV1 = {
  bindingId: connectorBindingFixture.bindingId,
  changes: { created: 0, duplicates: 0, failed: 0, updated: 0 },
  contractVersion: CORE_CONTRACT_VERSIONS.syncReceipt,
  cursor: { after: null, before: null },
  finality: "SOURCE_CONFIRMED",
  providerAcknowledgementRef: null,
  reconciliationRef: null,
  sourceReadbackRef: "provider-readback:synthetic-1",
  tenantId: "tenant-luzione",
};

export const supportCaseFixture: SupportCaseV1 = {
  actor: {
    logicalActorId: operationCommand.context.logicalActor?.actorId ?? "invalid-missing-logical-actor",
    membershipState: "ACTIVE",
    serverDerivedIdentityRef: operationCommand.context.request.requestId,
  },
  auditHead: { entryDigest: shaA, entryId: "88888888-8888-4888-8888-888888888888", previousEntryDigest: null, sequence: 1 },
  caseId,
  contractVersion: CORE_CONTRACT_VERSIONS.supportCase,
  entitlement: { entitlementRef: "entitlement:support-standard", policyVersion: "support-entitlement:v1", state: "ACTIVE", verifiedAt: "2026-09-05T00:00:00.000Z" },
  evidenceRefs: ["evidence:case-source-1"],
  objectVersion: "support-case:v7",
  ownerRole: "support-agent",
  severity: "P2",
  sla: { dueAt: "2099-09-05T04:00:00.000Z", pauseReason: "NONE", pausedAt: null, policyVersion: "support-sla:v1", startedAt: "2026-09-05T00:00:00.000Z", state: "RUNNING" },
  source: "IN_APP",
  staleAfter: "2099-09-05T00:10:00.000Z",
  status: "INVESTIGATING",
  tenantId: "tenant-luzione",
};

export const supportActionFixture: SupportActionV1 = {
  actionId,
  actionType: "DIAGNOSTIC",
  actor: supportCaseFixture.actor,
  ambiguity: "CLEAR",
  auditHead: { entryDigest: shaB, entryId: "99999999-9999-4999-8999-999999999999", previousEntryDigest: shaA, sequence: 2 },
  caseId,
  caseVersion: { expected: "support-case:v7", observed: "support-case:v7" },
  contractVersion: CORE_CONTRACT_VERSIONS.supportAction,
  effectMode: "NO_EFFECT",
  evidenceRefs: ["evidence:diagnostic-1"],
  finality: "NOT_FINAL",
  operation: sultanOperationFixture,
  policy: { approvalRef: null, decision: "ALLOW", evaluatedAt: "2026-09-05T00:00:00.000Z", policyVersion: "support-action-policy:v1", reasonCodes: ["READ_ONLY_DIAGNOSTIC"] },
  replay: { idempotencyKey: "support-action:idem-1", payloadHash: shaB, replayOfId: null },
  reservation: { receiptRef: null, state: "NOT_RESERVED_G0" },
  resultReadbackRef: null,
  severityChange: null,
  status: "PROPOSED",
  tenantId: "tenant-luzione",
};

export const customerReplyFixture: CustomerReplyV1 = {
  actionId,
  actor: supportCaseFixture.actor,
  approval: { approvalRef: null, decision: "ALLOW", evaluatedAt: "2026-09-05T00:00:00.000Z", policyVersion: "customer-reply-policy:v1", reasonCodes: ["DRAFT_ONLY"] },
  auditHead: { entryDigest: shaC, entryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", previousEntryDigest: shaB, sequence: 3 },
  caseId,
  caseVersion: "support-case:v7",
  contentDigest: shaC,
  contractVersion: CORE_CONTRACT_VERSIONS.customerReply,
  delivery: { deliveredAt: null, providerReceiptRef: null, readbackRef: null, state: "DRAFT" },
  finality: "NOT_FINAL",
  followUpAt: null,
  replay: { idempotencyKey: "customer-reply:idem-1", payloadHash: shaC, replayOfId: null },
  reservation: { receiptRef: null, state: "NOT_RESERVED_G0" },
  replyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  tenantId: "tenant-luzione",
  truthSourceRefs: ["evidence:diagnostic-1"],
};

export const featureFlagsFixture: LuzioneCoreFeatureFlagsV1 = {
  contractVersion: CORE_CONTRACT_VERSIONS.featureFlags,
  defaultState: "DISABLED",
  flags: { connectorSync: false, customerReplyDelivery: false, importCommit: false, onboardingApply: false, operationEffects: false, providerDispatch: false, supportActionEffects: false },
  overrideAuthority: "G2_HUMAN_GO_REQUIRED",
};

export const releaseManifestFixture: LuzioneCoreReleaseManifestV1 = {
  a02Pins: CORE_A02_PINS,
  candidateSha: "UNBOUND_G0",
  contractBundleVersion: CORE_CONTRACT_BUNDLE_VERSION,
  contractVersion: CORE_CONTRACT_VERSIONS.releaseManifest,
  contractVersions: CORE_CONTRACT_VERSIONS,
  controllerAuthority: "b19a4d858c0c90dba8600facbf329b7de7c322ad",
  effectAuthority: "NO_EFFECT",
  featureFlagsVersion: CORE_CONTRACT_VERSIONS.featureFlags,
  fepDependency: false,
  productionReady: false,
  runtimeActivation: "DARK_ONLY",
};

export const luzioneCorePositiveFixtures = Object.freeze({
  connectorBinding: connectorBindingFixture,
  customerReply: customerReplyFixture,
  featureFlags: featureFlagsFixture,
  importBatch: importBatchFixture,
  importReceipt: importReceiptFixture,
  releaseManifest: releaseManifestFixture,
  setupMandate: setupMandateFixture,
  sultanOperation: sultanOperationFixture,
  sultanReadback: sultanReadbackFixture,
  sultanReceipt: sultanReceiptFixture,
  supportAction: supportActionFixture,
  supportCase: supportCaseFixture,
  syncReceipt: syncReceiptFixture,
  tenantBlueprint: tenantBlueprintFixture,
});
