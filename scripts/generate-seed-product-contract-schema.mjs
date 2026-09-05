import { writeFileSync } from "node:fs";

const output = "contracts/core/v1/luzione-seed-product-contracts-v1.schema.json";
const descriptors = [
  ["ApprovalDecision", "ApprovalDecision/v1", "APPROVAL_DECISION", ["ACTIVE", "REVOKED", "SUPERSEDED"], ["comment", "decidedAt", "decidedBy", "decision", "evidenceRefs", "proposalVersion", "proposalVersionId", "scope", "targetId"]],
  ["AuthorityPolicy", "AuthorityPolicy/v1", "AUTHORITY_POLICY", ["ACTIVE", "ARCHIVED", "DISABLED"], ["capabilityRules", "effectCeiling", "fieldRules", "killSwitchActive", "scopeRef"]],
  ["BidComparison", "BidComparison/v1", "BID_COMPARISON", ["APPROVED", "ARCHIVED", "DRAFT", "REVIEW_REQUIRED"], ["basisCurrency", "recommendationEvidenceRefs", "recommendedSupplierQuoteId", "rfqIds", "rows", "selectedByHumanApprovalRef", "supplierQuoteIds"]],
  ["EvidenceArtifact", "EvidenceArtifact/v1", "EVIDENCE_ARTIFACT", ["ACTIVE", "ARCHIVED", "QUARANTINED", "REVIEW_REQUIRED"], ["capturedAt", "confidence", "contentDigest", "kind", "mimeType", "promptInjectionState", "provider", "sourceRecordRef", "storageRef"]],
  ["FieldChangeProposal", "FieldChangeProposal/v1", "FIELD_CHANGE_PROPOSAL", ["ACCEPTED", "CONFLICT", "EDITED", "PENDING", "REJECTED"], ["confidence", "conflictVersion", "evidenceRefs", "fieldPath", "newValue", "oldValue", "targetId", "targetType", "targetVersion"]],
  ["InstallationRecord", "InstallationRecord/v1", "INSTALLATION_RECORD", ["CANCELLED", "COMPLETE", "IN_PROGRESS", "ISSUE", "SCHEDULED"], ["completedAt", "installerId", "issueEvidenceRefs", "projectId", "scheduledAt", "spaceIds", "startedAt"]],
  ["OutcomeReceipt", "OutcomeReceipt/v1", "OUTCOME_RECEIPT", ["FAILED", "INDETERMINATE", "OWNER_COMMITTED", "SOURCE_CONFIRMED"], ["actionType", "actualEffect", "operationId", "result", "subjectRef", "value"]],
  ["Package", "Package/v1", "PACKAGE", ["DAMAGED", "DELIVERED", "IN_TRANSIT", "MISSING", "PLANNED", "RECEIVED"], ["dimensions", "label", "quantity", "shipmentId", "trackingNumber", "weight"]],
  ["ProductCandidate", "ProductCandidate/v1", "PRODUCT_CANDIDATE", ["ARCHIVED", "ELIGIBLE", "REJECTED", "REVIEW_REQUIRED", "SELECTED"], ["attributes", "confidence", "lane", "leadTimeDays", "price", "productSourceId", "sku", "title", "vendorId"]],
  ["ProductSource", "ProductSource/v1", "PRODUCT_SOURCE", ["ACTIVE", "ARCHIVED", "CONFLICT", "REVIEW_REQUIRED"], ["contentDigest", "kind", "locator", "observedAt", "sourceArtifactRef", "validUntil"]],
  ["Project", "Project/v1", "PROJECT", ["ACTIVE", "ARCHIVED", "DRAFT", "ON_HOLD"], ["accountId", "budget", "name", "opportunityId", "ownerId", "targetEndAt", "targetStartAt"]],
  ["ProjectPackage", "ProjectPackage/v1", "PROJECT_PACKAGE", ["ARCHIVED", "PUBLISHED", "SUPERSEDED"], ["assetRefs", "canonicalProjectId", "plannerProjectRef", "provenanceRefs", "publishedAt", "sourceVersionHash", "spaceRefs", "specificationRefs", "uncertainty"]],
  ["ProposalLine", "ProposalLine/v1", "PROPOSAL_LINE", ["ACTIVE", "ARCHIVED", "OPTIONAL", "REMOVED"], ["confidence", "costMinor", "description", "landedCostMinor", "lineType", "optionGroupId", "proposalVersionId", "quantity", "sourceRef", "totalMinor", "unitPriceMinor"]],
  ["ProposalTemplate", "ProposalTemplate/v1", "PROPOSAL_TEMPLATE", ["ACTIVE", "ARCHIVED", "INVALID", "VALIDATING"], ["contentDigest", "format", "mergeTokens", "name", "storageObjectRef", "validationIssues"]],
  ["ProposalVersion", "ProposalVersion/v1", "PROPOSAL_VERSION", ["ACCEPTED", "ARCHIVED", "DRAFT", "REJECTED", "SENT", "SUPERSEDED"], ["currency", "decisionState", "lineIds", "pdfArtifactRef", "projectId", "revision", "templateId", "totalMinor", "webViewRef"]],
  ["PurchaseOrder", "PurchaseOrder/v1", "PURCHASE_ORDER", ["ACKNOWLEDGED", "ARCHIVED", "DRAFT", "RELEASED", "VOID"], ["bidComparisonId", "currency", "lineRefs", "proposalVersionId", "releaseApprovalRef", "supplierId", "supplierQuoteId", "totalMinor"]],
  ["PurchaseOrderAcknowledgement", "PurchaseOrderAcknowledgement/v1", "PURCHASE_ORDER_ACKNOWLEDGEMENT", ["CONFLICT", "PROVIDER_ACKNOWLEDGED", "SOURCE_CONFIRMED"], ["acknowledgedPurchaseOrderVersion", "expectedReadyAt", "purchaseOrderId", "supplierId", "variances"]],
  ["ReceivingRecord", "ReceivingRecord/v1", "RECEIVING_RECORD", ["COMPLETE", "DISCREPANCY", "DRAFT"], ["counts", "discrepancyEvidenceRefs", "packageIds", "receivedAt", "receivedBy", "shipmentId"]],
  ["RFQ", "RFQ/v1", "RFQ", ["ARCHIVED", "CANCELLED", "DRAFT", "OPEN", "RESPONDED", "SENT"], ["dueAt", "projectId", "requestedFields", "specificationId", "specificationLineIds", "supplierId"]],
  ["Shipment", "Shipment/v1", "SHIPMENT", ["CANCELLED", "DELIVERED", "EXCEPTION", "IN_TRANSIT", "PLANNED", "READY"], ["carrier", "expectedDeliveryAt", "purchaseOrderIds", "risk", "supplierId", "trackingNumber"]],
  ["Space", "Space/v1", "SPACE", ["ACTIVE", "ARCHIVED", "DRAFT"], ["floor", "kind", "name", "projectId", "sequence"]],
  ["Specification", "Specification/v1", "SPECIFICATION", ["ACTIVE_PROCUREMENT", "APPROVED", "ARCHIVED", "DRAFT", "REVISION_PROPOSED"], ["activatedAt", "plannerPackageId", "projectId", "publishedPackageVersion", "revisionOfVersion", "spaceIds", "title"]],
  ["SpecificationLine", "SpecificationLine/v1", "SPECIFICATION_LINE", ["APPROVED", "ARCHIVED", "DRAFT", "SOURCING", "SUBSTITUTION_PROPOSED"], ["approvalState", "deliveryRisk", "description", "productCandidateIds", "quantity", "selectedCandidateId", "sourcingState", "spaceId", "specificationId", "unit"]],
  ["SupplierQuote", "SupplierQuote/v1", "SUPPLIER_QUOTE", ["ARCHIVED", "NORMALIZED", "REJECTED", "REVIEW_REQUIRED", "SELECTED"], ["evidenceArtifactId", "lines", "responseSource", "rfqId", "supplierId", "validUntil"]],
  ["SultanReviewItem", "SultanReviewItem/v1", "SULTAN_REVIEW_ITEM", ["ACCEPTED", "APPLIED", "EDITED", "PENDING", "REJECTED"], ["authorityPolicyId", "critic", "evidenceRefs", "outcomeReceiptId", "recommendation", "reviewType", "subjectRefs", "summary", "uncertainty"]],
  ["TimelineEvent", "TimelineEvent/v1", "TIMELINE_EVENT", ["ACTIVE", "ARCHIVED"], ["actorId", "aggregateRefs", "eventType", "evidenceRefs", "occurredAt", "recordedAt", "summary", "visibility"]],
];

const id = { type: "string", minLength: 2, maxLength: 512 };
const nullableId = { oneOf: [id, { type: "null" }] };
const timestamp = { type: "string", format: "date-time" };
const nullableTimestamp = { oneOf: [timestamp, { type: "null" }] };
const sha256 = { type: "string", pattern: "^[a-f0-9]{64}$" };

const definitions = {
  SourceRef: {
    type: "object", additionalProperties: false,
    required: ["objectId", "objectType", "ownerProject", "tenantId", "version"],
    properties: { objectId: id, objectType: id, ownerProject: id, tenantId: id, version: id },
  },
  MutationBoundary: {
    type: "object", additionalProperties: false,
    required: ["expectedVersion", "idempotencyKey", "payloadHash"],
    properties: { expectedVersion: nullableId, idempotencyKey: id, payloadHash: sha256 },
  },
  AuthorityBoundary: {
    type: "object", additionalProperties: false,
    required: ["actorId", "actorType", "approvalRef", "capability", "decision", "effectClass", "policyVersion", "serverDerivedIdentityRef"],
    properties: {
      actorId: id, actorType: { enum: ["HUMAN", "SERVICE", "SULTAN_AGENT"] }, approvalRef: nullableId,
      capability: id, decision: { enum: ["ALLOW", "DENY", "REQUIRE_HUMAN"] }, effectClass: { enum: ["A0", "A1", "A2", "A3", "A4"] },
      policyVersion: id, serverDerivedIdentityRef: id,
    },
  },
  ReceiptReadback: {
    type: "object", additionalProperties: false,
    required: ["committedVersion", "finality", "observedAt", "observedVersion", "providerAcknowledgementRef", "receiptId", "sourceReadbackRef"],
    properties: {
      committedVersion: id, finality: { enum: ["DOMAIN_COMMITTED", "PROVIDER_ACKNOWLEDGED", "RECONCILING", "SOURCE_CONFIRMED"] },
      observedAt: nullableTimestamp, observedVersion: nullableId, providerAcknowledgementRef: nullableId,
      receiptId: id, sourceReadbackRef: nullableId,
    },
  },
};

for (const [name, version, resourceType, statuses, dataKeys] of descriptors) {
  definitions[name] = {
    type: "object", additionalProperties: false,
    required: ["authority", "contractVersion", "createdAt", "data", "mutation", "receipt", "resource", "sourceRefs", "tenantId", "updatedAt"],
    properties: {
      authority: { $ref: "#/$defs/AuthorityBoundary" }, contractVersion: { const: version }, createdAt: timestamp,
      data: { type: "object", additionalProperties: false, required: dataKeys, properties: Object.fromEntries(dataKeys.map((key) => [key, {}])) },
      mutation: { $ref: "#/$defs/MutationBoundary" }, receipt: { $ref: "#/$defs/ReceiptReadback" },
      resource: {
        type: "object", additionalProperties: false, required: ["archivedAt", "id", "status", "type", "version"],
        properties: { archivedAt: nullableTimestamp, id, status: { enum: statuses }, type: { const: resourceType }, version: id },
      },
      sourceRefs: { type: "array", minItems: 1, items: { $ref: "#/$defs/SourceRef" } }, tenantId: id, updatedAt: timestamp,
    },
  };
}

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://api.luzione.com/contracts/core/v1/luzione-seed-product-contracts-v1.schema.json",
  title: "Luzione seed product contracts v1",
  description: "Additive strict P0 business graph contracts within LuzioneCoreContracts/v1. Library-only and not runtime activation authority.",
  oneOf: descriptors.map(([name]) => ({ $ref: `#/$defs/${name}` })),
  $defs: definitions,
};

writeFileSync(output, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
