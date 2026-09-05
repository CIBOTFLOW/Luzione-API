import { createHash } from "node:crypto";
import operationsAbsentFixture from "../fixtures/operations-v3-typed-absent.json";
import {
  customerReplyFixture,
  supportActionFixture,
  supportCaseFixture,
} from "../../../../src/modules/luzione-core-contracts";
import * as supportSdk from "../generated/typescript";

export const tenantId = "tenant-luzione";
export const observedAt = "2026-09-05T18:30:00.000Z";
export const laterAt = "2026-09-05T18:31:00.000Z";
export const validUntil = "2099-09-05T18:30:00.000Z";
export const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const shaC = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const readPackets = new Set([
  "SupportPolicyEntitlementReadPacket/v1",
  "SupportRosterCoverageReadPacket/v1",
  "SupportPrivacyRetentionReadPacket/v1",
  "SupportLegacyCompatibilityReadPacket/v1",
  "SupportInvestigationReadPacket/v1",
  "SupportIncidentEscalationReadPacket/v1",
  "SupportObservabilityRecoveryReadPacket/v1",
]);

const documentOrder = [
  "QualifiedSupportSourceRef/v1", "SupportRedactionReceipt/v1", "SupportPrivacyRetentionRef/v1",
  "SupportDataDispositionReceipt/v1", "SupportPolicyEntitlementRef/v1", "SupportIntakeEvidence/v1",
  "SupportOwnershipAcceptanceEvidence/v1", "SupportSlaScheduleEvent/v1", "SupportCaseIncidentBinding/v1",
  "SupportClosureEvidence/v1", "SupportReopenEvidence/v1", "LegacySupportQuarantineManifest/v1",
  "SupportPolicyEntitlementReadPacket/v1", "SupportRosterCoverageReadPacket/v1",
  "SupportPrivacyRetentionReadPacket/v1", "SupportLegacyCompatibilityReadPacket/v1",
  "SupportInvestigationReadPacket/v1", "SupportIncidentEscalationReadPacket/v1",
  "SupportObservabilityRecoveryReadPacket/v1", "SupportOutputHandoff/v1",
] as const;

export type TestDocument = {
  contractVersion: string;
  dependencyState: string;
  documentId: string;
  effectMode: string;
  finality: string;
  idempotencyKey: string;
  observedAt: string;
  payload: Record<string, unknown>;
  payloadDigest: string;
  supersedesDocumentId: string | null;
  tenantId: string;
  readPacketState?: string;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function absent(expectedType: string, reason = "SOURCE_NOT_RETURNED") {
  return {
    expectedOwner: "CIBOTFLOW/Luzione-UI",
    expectedType,
    expectedVersion: `${expectedType}/v1`,
    reason,
    observedAt,
  };
}

export function operationsAbsent() {
  return clone(operationsAbsentFixture);
}

export function presentRef(
  objectId: string,
  objectType = "SyntheticSupportEvidence/v1",
  overrides: Record<string, unknown> = {},
) {
  return {
    state: "PRESENT",
    repository: "CIBOTFLOW/Luzione-UI",
    objectType,
    tenantId,
    objectId,
    version: "source:v1",
    contentHash: shaA,
    sourceHash: shaB,
    validity: { observedAt, validUntil },
    readback: { ref: `readback:${objectId.replace(/[^A-Za-z0-9._:@/-]/g, "-")}`, observedAt },
    privacy: { class: "REDACTED", redactionReceiptRef: "redaction:receipt-v1" },
    review: { state: "APPROVED", reviewerRef: "human:reviewer-1", reviewedAt: observedAt },
    supersedesRef: null,
    ...overrides,
  };
}

function hasAbsent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasAbsent);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!("state" in record) && "expectedOwner" in record && "expectedType" in record) return true;
  return Object.values(record).some(hasAbsent);
}

export function makeDocument(
  contractVersion: string,
  payload: Record<string, unknown>,
  overrides: Partial<TestDocument> = {},
): TestDocument {
  const index = documentOrder.indexOf(contractVersion as (typeof documentOrder)[number]);
  if (index < 0) throw new Error(`unknown fixture contract ${contractVersion}`);
  const blocked = hasAbsent(payload);
  const document: TestDocument = {
    contractVersion,
    dependencyState: blocked ? "BLOCKED_INCOMPLETE" : "PRESENT",
    documentId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    effectMode: "NO_EFFECT",
    finality: "NOT_FINAL",
    idempotencyKey: `support:${index + 1}:fixture-v1`,
    observedAt,
    payload,
    payloadDigest: digest(payload),
    supersedesDocumentId: null,
    tenantId,
  };
  if (readPackets.has(contractVersion)) document.readPacketState = blocked ? "BLOCKED_INCOMPLETE" : "AVAILABLE";
  return { ...document, ...overrides };
}

export function reseal<T extends TestDocument>(document: T): T {
  document.payloadDigest = digest(document.payload);
  return document;
}

export function parseByVersion(
  version: (typeof documentOrder)[number],
  document: unknown,
  context?: { priorDocuments?: readonly Uint8Array[]; sourceDocuments?: readonly Uint8Array[] },
) {
  const parserNames: Record<(typeof documentOrder)[number], string> = {
    "QualifiedSupportSourceRef/v1": "parseQualifiedSupportSourceRefV1",
    "SupportRedactionReceipt/v1": "parseSupportRedactionReceiptV1",
    "SupportPrivacyRetentionRef/v1": "parseSupportPrivacyRetentionRefV1",
    "SupportDataDispositionReceipt/v1": "parseSupportDataDispositionReceiptV1",
    "SupportPolicyEntitlementRef/v1": "parseSupportPolicyEntitlementRefV1",
    "SupportIntakeEvidence/v1": "parseSupportIntakeEvidenceV1",
    "SupportOwnershipAcceptanceEvidence/v1": "parseSupportOwnershipAcceptanceEvidenceV1",
    "SupportSlaScheduleEvent/v1": "parseSupportSlaScheduleEventV1",
    "SupportCaseIncidentBinding/v1": "parseSupportCaseIncidentBindingV1",
    "SupportClosureEvidence/v1": "parseSupportClosureEvidenceV1",
    "SupportReopenEvidence/v1": "parseSupportReopenEvidenceV1",
    "LegacySupportQuarantineManifest/v1": "parseLegacySupportQuarantineManifestV1",
    "SupportPolicyEntitlementReadPacket/v1": "parseSupportPolicyEntitlementReadPacketV1",
    "SupportRosterCoverageReadPacket/v1": "parseSupportRosterCoverageReadPacketV1",
    "SupportPrivacyRetentionReadPacket/v1": "parseSupportPrivacyRetentionReadPacketV1",
    "SupportLegacyCompatibilityReadPacket/v1": "parseSupportLegacyCompatibilityReadPacketV1",
    "SupportInvestigationReadPacket/v1": "parseSupportInvestigationReadPacketV1",
    "SupportIncidentEscalationReadPacket/v1": "parseSupportIncidentEscalationReadPacketV1",
    "SupportObservabilityRecoveryReadPacket/v1": "parseSupportObservabilityRecoveryReadPacketV1",
    "SupportOutputHandoff/v1": "parseSupportOutputHandoffV1",
  };
  const parser = (supportSdk as unknown as Record<string, (input: Uint8Array, parseContext?: typeof context) => unknown>)[parserNames[version]];
  return parser(bytes(document), context);
}

export function payloadFor(contractVersion: (typeof documentOrder)[number]): Record<string, unknown> {
  const r = (name: string, type?: string) => presentRef(name, type);
  switch (contractVersion) {
    case "QualifiedSupportSourceRef/v1": return { sourceRef: r("evidence:qualified-1") };
    case "SupportRedactionReceipt/v1": return { sourceRef: r("evidence:redaction-source-1"), policyVersion: "redaction-policy:v1", detectorVersions: ["pii-detector:v1", "secret-detector:v1"], omittedClassCounts: { PII: 1, SECRET: 0, RAW_PRIVATE: 1 }, result: "PASS", redactedContentDigest: shaC };
    case "SupportPrivacyRetentionRef/v1": return { sourceRef: r("evidence:privacy-source-1"), dataCategory: "SUPPORT_EVIDENCE", purpose: "support-investigation", opaqueLocationRef: "opaque:location-1", opaqueLocationVersion: "opaque:v1", encryptionAlias: "kms-alias:support", encryptionVersion: "kms:v1", retentionPolicyRef: r("policy:retention-1"), retainUntil: validUntil, legalHoldRef: absent("LegalHoldReadback"), redactionReceiptRef: r("redaction:receipt-1", "SupportRedactionReceipt/v1"), sourceReadbackRef: r("readback:privacy-1"), tombstoneRef: null };
    case "SupportDataDispositionReceipt/v1": return { privacyRetentionRef: r("privacy:retention-1", "SupportPrivacyRetentionRef/v1"), objectCopyLineage: [r("copy:postgres-1"), r("copy:storage-1")], actorAuthorityRef: absent("G2EffectAuthorityGrant"), retentionState: "ACTIVE", legalHoldState: "UNKNOWN", sourceDispositionReadbacks: [absent("SourceDispositionReadback")], residualCopyRefs: [r("copy:storage-1")], localDisposition: "RETAINED", remoteFinality: "NOT_FINAL" };
    case "SupportPolicyEntitlementRef/v1": return { principalRef: absent("HumanAuthoritySourceBinding"), capability: "support.investigate", action: "DIAGNOSTIC", entitlementRef: r("entitlement:support-1"), policyRef: r("policy:support-1"), slaRef: r("policy:sla-1"), channelRef: r("channel:in-app-1"), providerRef: absent("ProviderBinding"), workspaceRef: r("workspace:crm-1"), featureRef: r("feature:support-1"), killRef: r("kill:support-1"), validFrom: observedAt, validUntil, supersessionRef: null };
    case "SupportIntakeEvidence/v1": return { channel: "IN_APP", sourceRef: r("intake:source-1"), transportReceiptRef: r("intake:transport-1"), customerIdentityRef: absent("CanonicalCustomerIdentity"), redactionReceiptRef: r("redaction:intake-1", "SupportRedactionReceipt/v1"), provisionalSeverity: "P2", caseRef: r(supportCaseFixture.caseId, "SupportCase/v1"), p110OperationRef: r("p110:intake-operation-1"), intakePayloadDigest: shaA };
    case "SupportOwnershipAcceptanceEvidence/v1": return { caseRef: r(supportCaseFixture.caseId, "SupportCase/v1"), proposedOwnerRef: absent("ProposedHumanOwner"), acceptedHumanAuthorityRef: operationsAbsent(), rosterCoverageRef: absent("SupportRosterCoverage"), acceptedAt: observedAt, p110OperationRef: r("p110:ownership-operation-1") };
    case "SupportSlaScheduleEvent/v1": return { caseRef: r(supportCaseFixture.caseId, "SupportCase/v1"), caseVersion: "support-case:v7", policyRef: r("policy:sla-1"), severity: "P2", condition: "HALF_BUDGET", dueAt: validUntil, eventObservedAt: observedAt, schedulerPrincipalRef: absent("SupportSchedulerPrincipal"), p110EventRef: r("p110:sla-event-1"), p111AttemptRef: absent("P111DeliveryAttempt") };
    case "SupportCaseIncidentBinding/v1": return { caseRef: r(supportCaseFixture.caseId, "SupportCase/v1"), incidentRef: absent("ResolvedVerifiedIncident"), humanAcknowledgementRef: operationsAbsent(), recoverySourceRef: operationsAbsent(), boundAt: observedAt };
    case "SupportClosureEvidence/v1": return { priorCaseRef: r("case:prior-v7", "SupportCase/v1"), closedCaseRef: r("case:closed-v8", "SupportCase/v1"), priorAuditHeadRef: r("audit:prior-1"), closedAuditHeadRef: r("audit:closed-1"), resolutionActionRef: r(supportActionFixture.actionId, "SupportAction/v1"), verifiedReplyRef: r(customerReplyFixture.replyId, "CustomerReply/v1"), humanNoReplyExceptionRef: null, ownerAcceptanceRef: absent("SupportOwnershipAcceptanceEvidence"), slaStopRef: absent("SupportSlaStopEvidence"), sourceReadbackRefs: [r("readback:closure-1")], latestInboundWatermark: "inbound:watermark-7", closureState: "BLOCKED_INCOMPLETE", closureDigest: shaC };
    case "SupportReopenEvidence/v1": return { closureEvidenceRef: r("closure:evidence-1", "SupportClosureEvidence/v1"), inboundReceiptRef: r("inbound:receipt-8"), inboundMessageRef: r("inbound:message-8"), closureWatermark: "inbound:watermark-7", inboundWatermark: "inbound:watermark-8", priorCaseVersion: "support-case:v8", newCaseVersion: "support-case:v9", newSlaEpochRef: absent("CapabilityEpochReset"), newDeadline: validUntil, p110OperationRef: r("p110:reopen-operation-1"), reopenState: "BLOCKED_INCOMPLETE" };
    case "LegacySupportQuarantineManifest/v1": return { p110ObservationRef: r("p110:legacy-observation-1"), relation: "public.support_cases", schemaDigest: shaA, primaryKeyDigest: shaB, rowCount: 0, rowRootDigest: shaC, watermark: "legacy:watermark-1", sensitivity: "RESTRICTED", tenantPosture: "TENANT_UNKNOWN", sourcePosture: "LEGACY_UNTRUSTED", reverseBoundary: "EMPTY_PRE_PIN_ONLY", containsCustomerValues: false };
    case "SupportPolicyEntitlementReadPacket/v1": return { policyEntitlementRef: absent("SupportPolicyEntitlementRef"), stageResults: { intake: "BLOCKED_INCOMPLETE", ownership: "BLOCKED_INCOMPLETE", investigation: "BLOCKED_INCOMPLETE", slaClaim: "BLOCKED_INCOMPLETE", escalation: "BLOCKED_INCOMPLETE", customerReply: "BLOCKED_INCOMPLETE", closure: "BLOCKED_INCOMPLETE", privacyDisposition: "BLOCKED_INCOMPLETE" }, snapshotDigest: shaA, derivedStatus: "BLOCKED_INCOMPLETE" };
    case "SupportRosterCoverageReadPacket/v1": return { humanAuthorityRef: operationsAbsent(), membershipRef: absent("CurrentTenantMembership"), rosterPolicyRef: absent("SupportRosterPolicy"), coverageWindowRefs: [absent("SupportCoverageWindow")], primaryHumanRef: absent("PrimarySupportHuman"), plannedAbsenceRef: absent("PlannedAbsence"), substituteRef: absent("AcceptedSubstitute"), sourceReadbackRef: absent("RosterSourceReadback"), derivedCoverage: "BLOCKED_INCOMPLETE", snapshotDigest: shaA };
    case "SupportPrivacyRetentionReadPacket/v1": return { privacyRetentionRefs: [r("privacy:retention-1", "SupportPrivacyRetentionRef/v1")], dispositionReceiptRefs: [absent("SupportDataDispositionReceipt")], copyInventoryRefs: [absent("SupportCopyInventory")], redactionState: "BLOCKED_INCOMPLETE", retentionState: "BLOCKED_INCOMPLETE", holdState: "BLOCKED_INCOMPLETE", erasureState: "BLOCKED_INCOMPLETE", derivedStatus: "BLOCKED_INCOMPLETE", snapshotDigest: shaA };
    case "SupportLegacyCompatibilityReadPacket/v1": return { quarantineManifestRef: r("legacy:manifest-1", "LegacySupportQuarantineManifest/v1"), relationRef: r("legacy:relation-1"), rowRootDigest: shaA, tenantPosture: "TENANT_UNKNOWN", sourcePosture: "LEGACY_UNTRUSTED", orphanState: "HELD", privacyRetentionRef: absent("SupportPrivacyRetentionRef"), redactedDigest: shaB, opaquePrivateRef: "opaque:legacy-1", canonicalAdmissionRef: absent("CanonicalSupportAdmission"), replayState: "UNKNOWN", derivedStatus: "BLOCKED_INCOMPLETE" };
    case "SupportInvestigationReadPacket/v1": return { caseRef: r(supportCaseFixture.caseId, "SupportCase/v1"), approvedKnowledgeRefs: [r("knowledge:approved-1")], redactedEvidenceRefs: [r("evidence:diagnostic-1")], privateOpaqueRefs: [r("opaque:private-1")], redactionReceiptRefs: [r("redaction:diagnostic-1", "SupportRedactionReceipt/v1")], policyReadPacketRef: absent("SupportPolicyEntitlementReadPacket"), rosterReadPacketRef: absent("SupportRosterCoverageReadPacket"), releaseRef: r("release:api-1"), flagRef: r("flags:support-1"), engineerAcceptanceRef: absent("EngineeringAcceptance"), closureReadbackRef: absent("SupportClosureReadback"), derivedStatus: "BLOCKED_INCOMPLETE", snapshotDigest: shaA };
    case "SupportIncidentEscalationReadPacket/v1": return { caseIncidentBindingRef: absent("SupportCaseIncidentBinding"), currentCaseRef: r(supportCaseFixture.caseId, "SupportCase/v1"), ownerAcceptanceRef: absent("SupportOwnershipAcceptanceEvidence"), policyReadPacketRef: absent("SupportPolicyEntitlementReadPacket"), killRef: r("kill:support-1"), observationRefs: [r("observation:support-1")], dlqRef: absent("P111DeadLetter"), reconciliationRef: absent("P111Reconciliation"), p111RecoveryRef: operationsAbsent(), incidentRecoverySourceRef: operationsAbsent(), conditionMatrix: failureMatrix(), derivedStatus: "BLOCKED_INCOMPLETE", snapshotDigest: shaA };
    case "SupportObservabilityRecoveryReadPacket/v1": return { caseRef: r(supportCaseFixture.caseId, "SupportCase/v1"), ownerAcceptanceRef: absent("SupportOwnershipAcceptanceEvidence"), policyReadPacketRef: absent("SupportPolicyEntitlementReadPacket"), signalRefs: [r("signal:support-1")], operationRef: r("p110:operation-1"), attemptRefs: [r("p111:attempt-1")], dlqRefs: [absent("P111DeadLetter")], reconciliationRefs: [absent("P111Reconciliation")], recoveryRefs: [operationsAbsent()], sourceReadbackRefs: [absent("SupportSourceReadback")], conditionMatrix: failureMatrix(), derivedStatus: "BLOCKED_INCOMPLETE", snapshotDigest: shaA };
    case "SupportOutputHandoff/v1": {
      const caseSource = r("evidence:case-source-1");
      const diagnosticSource = r("evidence:diagnostic-1");
      return {
        evidence_bundle: { caseSnapshot: clone(supportCaseFixture), investigationReadPacketRef: absent("SupportInvestigationReadPacket"), qualifiedSourceRefs: [caseSource, diagnosticSource] },
        uncertainty_statement: { statements: ["Canonical human authority and incident recovery remain absent."], unresolvedSourceRefs: [operationsAbsent()] },
        severity_recommendation: { value: "P2", authoritative: false, sourceRefs: [diagnosticSource] },
        proposed_SupportAction: clone(supportActionFixture),
        draft_CustomerReply: clone(customerReplyFixture),
      };
    }
  }
}

function failureMatrix() {
  return { intakeLoss: "BLOCKED_INCOMPLETE", unownedCase: "BLOCKED_INCOMPLETE", overdueUpdate: "BLOCKED_INCOMPLETE", slaBreach: "BLOCKED_INCOMPLETE", failedEscalation: "BLOCKED_INCOMPLETE", undeliveredReply: "BLOCKED_INCOMPLETE", closureRace: "BLOCKED_INCOMPLETE", privacyBlock: "BLOCKED_INCOMPLETE", policyKillDenial: "BLOCKED_INCOMPLETE" };
}

export { documentOrder };
