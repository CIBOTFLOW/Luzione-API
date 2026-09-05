import { LuzioneCoreCompatibilityError, type LuzioneCoreCompatibilityErrorCode } from "./compatibilityError";
import {
  SEED_PRODUCT_CONTRACT_VERSIONS,
  type ApprovalDecisionV1,
  type AuthorityPolicyV1,
  type BidComparisonV1,
  type EvidenceArtifactV1,
  type FieldChangeProposalV1,
  type InstallationRecordV1,
  type LuzioneSeedProductContractDocument,
  type OutcomeReceiptV1,
  type PackageV1,
  type ProductCandidateV1,
  type ProductSourceV1,
  type ProjectPackageV1,
  type ProjectV1,
  type ProposalLineV1,
  type ProposalTemplateV1,
  type ProposalVersionV1,
  type PurchaseOrderAcknowledgementV1,
  type PurchaseOrderV1,
  type ReceivingRecordV1,
  type RFQV1,
  type SeedProductContractVersion,
  type SeedResourceV1,
  type ShipmentV1,
  type SpaceV1,
  type SpecificationLineV1,
  type SpecificationV1,
  type SultanReviewItemV1,
  type SupplierQuoteV1,
  type TimelineEventV1,
} from "./seedProductContracts";

type JsonObject = Record<string, unknown>;
type AnySeedResource = SeedResourceV1<SeedProductContractVersion, string, string, unknown>;

type Descriptor = {
  dataKeys: readonly string[];
  resourceType: string;
  statuses: readonly string[];
  version: SeedProductContractVersion;
};

const DESCRIPTORS = Object.freeze({
  approvalDecision: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.approvalDecision, "APPROVAL_DECISION", ["ACTIVE", "REVOKED", "SUPERSEDED"], ["comment", "decidedAt", "decidedBy", "decision", "evidenceRefs", "proposalVersion", "proposalVersionId", "scope", "targetId"]),
  authorityPolicy: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.authorityPolicy, "AUTHORITY_POLICY", ["ACTIVE", "ARCHIVED", "DISABLED"], ["capabilityRules", "effectCeiling", "fieldRules", "killSwitchActive", "scopeRef"]),
  bidComparison: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.bidComparison, "BID_COMPARISON", ["APPROVED", "ARCHIVED", "DRAFT", "REVIEW_REQUIRED"], ["basisCurrency", "recommendationEvidenceRefs", "recommendedSupplierQuoteId", "rfqIds", "rows", "selectedByHumanApprovalRef", "supplierQuoteIds"]),
  evidenceArtifact: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.evidenceArtifact, "EVIDENCE_ARTIFACT", ["ACTIVE", "ARCHIVED", "QUARANTINED", "REVIEW_REQUIRED"], ["capturedAt", "confidence", "contentDigest", "kind", "mimeType", "promptInjectionState", "provider", "sourceRecordRef", "storageRef"]),
  fieldChangeProposal: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.fieldChangeProposal, "FIELD_CHANGE_PROPOSAL", ["ACCEPTED", "CONFLICT", "EDITED", "PENDING", "REJECTED"], ["confidence", "conflictVersion", "evidenceRefs", "fieldPath", "newValue", "oldValue", "targetId", "targetType", "targetVersion"]),
  installationRecord: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.installationRecord, "INSTALLATION_RECORD", ["CANCELLED", "COMPLETE", "IN_PROGRESS", "ISSUE", "SCHEDULED"], ["completedAt", "installerId", "issueEvidenceRefs", "projectId", "scheduledAt", "spaceIds", "startedAt"]),
  outcomeReceipt: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.outcomeReceipt, "OUTCOME_RECEIPT", ["FAILED", "INDETERMINATE", "OWNER_COMMITTED", "SOURCE_CONFIRMED"], ["actionType", "actualEffect", "operationId", "result", "subjectRef", "value"]),
  package: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.package, "PACKAGE", ["DAMAGED", "DELIVERED", "IN_TRANSIT", "MISSING", "PLANNED", "RECEIVED"], ["dimensions", "label", "quantity", "shipmentId", "trackingNumber", "weight"]),
  productCandidate: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.productCandidate, "PRODUCT_CANDIDATE", ["ARCHIVED", "ELIGIBLE", "REJECTED", "REVIEW_REQUIRED", "SELECTED"], ["attributes", "confidence", "lane", "leadTimeDays", "price", "productSourceId", "sku", "title", "vendorId"]),
  productSource: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.productSource, "PRODUCT_SOURCE", ["ACTIVE", "ARCHIVED", "CONFLICT", "REVIEW_REQUIRED"], ["contentDigest", "kind", "locator", "observedAt", "sourceArtifactRef", "validUntil"]),
  project: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.project, "PROJECT", ["ACTIVE", "ARCHIVED", "DRAFT", "ON_HOLD"], ["accountId", "budget", "name", "opportunityId", "ownerId", "targetEndAt", "targetStartAt"]),
  projectPackage: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.projectPackage, "PROJECT_PACKAGE", ["ARCHIVED", "PUBLISHED", "SUPERSEDED"], ["assetRefs", "canonicalProjectId", "plannerProjectRef", "provenanceRefs", "publishedAt", "sourceVersionHash", "spaceRefs", "specificationRefs", "uncertainty"]),
  proposalLine: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.proposalLine, "PROPOSAL_LINE", ["ACTIVE", "ARCHIVED", "OPTIONAL", "REMOVED"], ["confidence", "costMinor", "description", "landedCostMinor", "lineType", "optionGroupId", "proposalVersionId", "quantity", "sourceRef", "totalMinor", "unitPriceMinor"]),
  proposalTemplate: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.proposalTemplate, "PROPOSAL_TEMPLATE", ["ACTIVE", "ARCHIVED", "INVALID", "VALIDATING"], ["contentDigest", "format", "mergeTokens", "name", "storageObjectRef", "validationIssues"]),
  proposalVersion: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.proposalVersion, "PROPOSAL_VERSION", ["ACCEPTED", "ARCHIVED", "DRAFT", "REJECTED", "SENT", "SUPERSEDED"], ["currency", "decisionState", "lineIds", "pdfArtifactRef", "projectId", "revision", "templateId", "totalMinor", "webViewRef"]),
  purchaseOrder: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.purchaseOrder, "PURCHASE_ORDER", ["ACKNOWLEDGED", "ARCHIVED", "DRAFT", "RELEASED", "VOID"], ["bidComparisonId", "currency", "lineRefs", "proposalVersionId", "releaseApprovalRef", "supplierId", "supplierQuoteId", "totalMinor"]),
  purchaseOrderAcknowledgement: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.purchaseOrderAcknowledgement, "PURCHASE_ORDER_ACKNOWLEDGEMENT", ["CONFLICT", "PROVIDER_ACKNOWLEDGED", "SOURCE_CONFIRMED"], ["acknowledgedPurchaseOrderVersion", "expectedReadyAt", "purchaseOrderId", "supplierId", "variances"]),
  receivingRecord: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.receivingRecord, "RECEIVING_RECORD", ["COMPLETE", "DISCREPANCY", "DRAFT"], ["counts", "discrepancyEvidenceRefs", "packageIds", "receivedAt", "receivedBy", "shipmentId"]),
  rfq: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.rfq, "RFQ", ["ARCHIVED", "CANCELLED", "DRAFT", "OPEN", "RESPONDED", "SENT"], ["dueAt", "projectId", "requestedFields", "specificationId", "specificationLineIds", "supplierId"]),
  shipment: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.shipment, "SHIPMENT", ["CANCELLED", "DELIVERED", "EXCEPTION", "IN_TRANSIT", "PLANNED", "READY"], ["carrier", "expectedDeliveryAt", "purchaseOrderIds", "risk", "supplierId", "trackingNumber"]),
  space: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.space, "SPACE", ["ACTIVE", "ARCHIVED", "DRAFT"], ["floor", "kind", "name", "projectId", "sequence"]),
  specification: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.specification, "SPECIFICATION", ["ACTIVE_PROCUREMENT", "APPROVED", "ARCHIVED", "DRAFT", "REVISION_PROPOSED"], ["activatedAt", "plannerPackageId", "projectId", "publishedPackageVersion", "revisionOfVersion", "spaceIds", "title"]),
  specificationLine: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.specificationLine, "SPECIFICATION_LINE", ["APPROVED", "ARCHIVED", "DRAFT", "SOURCING", "SUBSTITUTION_PROPOSED"], ["approvalState", "deliveryRisk", "description", "productCandidateIds", "quantity", "selectedCandidateId", "sourcingState", "spaceId", "specificationId", "unit"]),
  supplierQuote: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.supplierQuote, "SUPPLIER_QUOTE", ["ARCHIVED", "NORMALIZED", "REJECTED", "REVIEW_REQUIRED", "SELECTED"], ["evidenceArtifactId", "lines", "responseSource", "rfqId", "supplierId", "validUntil"]),
  sultanReviewItem: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.sultanReviewItem, "SULTAN_REVIEW_ITEM", ["ACCEPTED", "APPLIED", "EDITED", "PENDING", "REJECTED"], ["authorityPolicyId", "critic", "evidenceRefs", "outcomeReceiptId", "recommendation", "reviewType", "subjectRefs", "summary", "uncertainty"]),
  timelineEvent: descriptor(SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent, "TIMELINE_EVENT", ["ACTIVE", "ARCHIVED"], ["actorId", "aggregateRefs", "eventType", "evidenceRefs", "occurredAt", "recordedAt", "summary", "visibility"]),
});

export function parseProjectV1(value: unknown, prior?: ProjectV1): ProjectV1 {
  const result = parseResource(value, DESCRIPTORS.project, prior);
  const data = result.data as JsonObject;
  for (const key of ["accountId", "name", "ownerId"] as const) id(data[key], `project.data.${key}`);
  idOrNull(data.opportunityId, "project.data.opportunityId");
  timestampOrNull(data.targetStartAt, "project.data.targetStartAt");
  timestampOrNull(data.targetEndAt, "project.data.targetEndAt");
  if (data.budget !== null) parseMoney(data.budget, "project.data.budget");
  return result as ProjectV1;
}

export function parseSpaceV1(value: unknown, project?: ProjectV1, prior?: SpaceV1): SpaceV1 {
  const result = parseResource(value, DESCRIPTORS.space, prior) as SpaceV1;
  id(result.data.projectId, "space.data.projectId"); id(result.data.name, "space.data.name");
  enumeration(result.data.kind, ["AREA", "EXTERIOR", "ROOM", "WHOLE_HOME"], "space.data.kind");
  stringOrNull(result.data.floor, "space.data.floor"); nonNegativeInteger(result.data.sequence, "space.data.sequence");
  if (project) relate(result, result.data.projectId, project, "Space project");
  return result;
}

export function parseSpecificationV1(value: unknown, project?: ProjectV1, spaces: readonly SpaceV1[] = [], prior?: SpecificationV1): SpecificationV1 {
  const result = parseResource(value, DESCRIPTORS.specification, prior) as SpecificationV1;
  for (const key of ["plannerPackageId", "projectId", "publishedPackageVersion", "title"] as const) id(result.data[key], `specification.data.${key}`);
  idOrNull(result.data.revisionOfVersion, "specification.data.revisionOfVersion");
  timestampOrNull(result.data.activatedAt, "specification.data.activatedAt");
  strings(result.data.spaceIds, true, "specification.data.spaceIds");
  if (result.resource.status === "ACTIVE_PROCUREMENT" && result.data.activatedAt === null) finality("An active procurement Specification requires activatedAt evidence.");
  if (result.resource.status === "REVISION_PROPOSED" && result.data.revisionOfVersion === null) mismatch("A proposed Specification revision must pin the prior version.");
  if (project) relate(result, result.data.projectId, project, "Specification project");
  for (const space of spaces) {
    if (!result.data.spaceIds.includes(space.resource.id)) mismatch("Specification space set does not include a supplied Space.");
    sameTenant(result, space, "Specification Space");
  }
  return result;
}

export function parseSpecificationLineV1(value: unknown, specification?: SpecificationV1, space?: SpaceV1, products: readonly ProductCandidateV1[] = [], prior?: SpecificationLineV1): SpecificationLineV1 {
  const result = parseResource(value, DESCRIPTORS.specificationLine, prior) as SpecificationLineV1;
  for (const key of ["description", "spaceId", "specificationId", "unit"] as const) id(result.data[key], `specificationLine.data.${key}`);
  positiveNumber(result.data.quantity, "specificationLine.data.quantity");
  strings(result.data.productCandidateIds, false, "specificationLine.data.productCandidateIds");
  idOrNull(result.data.selectedCandidateId, "specificationLine.data.selectedCandidateId");
  if (result.data.selectedCandidateId && !result.data.productCandidateIds.includes(result.data.selectedCandidateId)) mismatch("Selected product must be one of the Specification Line candidates.");
  if (specification) relate(result, result.data.specificationId, specification, "Specification Line specification");
  if (space) relate(result, result.data.spaceId, space, "Specification Line space");
  for (const product of products) {
    if (!result.data.productCandidateIds.includes(product.resource.id)) mismatch("Specification Line candidate set does not include a supplied Product Candidate.");
    sameTenant(result, product, "Specification Line product");
  }
  return result;
}

export function parseProjectPackageV1(value: unknown, prior?: ProjectPackageV1): ProjectPackageV1 {
  const result = parseResource(value, DESCRIPTORS.projectPackage, prior) as ProjectPackageV1;
  idOrNull(result.data.canonicalProjectId, "projectPackage.data.canonicalProjectId");
  timestamp(result.data.publishedAt, "projectPackage.data.publishedAt"); digest(result.data.sourceVersionHash, "projectPackage.data.sourceVersionHash");
  refs(result.data.plannerProjectRef, result.tenantId, "projectPackage.data.plannerProjectRef");
  refArray(result.data.spaceRefs, result.tenantId, "projectPackage.data.spaceRefs");
  refArray(result.data.specificationRefs, result.tenantId, "projectPackage.data.specificationRefs");
  strings(result.data.assetRefs, false, "projectPackage.data.assetRefs"); strings(result.data.provenanceRefs, true, "projectPackage.data.provenanceRefs");
  if (result.resource.status === "PUBLISHED" && result.data.spaceRefs.length === 0) invalid("A published Project Package requires at least one Space.");
  return result;
}

export function parseProductSourceV1(value: unknown, prior?: ProductSourceV1): ProductSourceV1 {
  const result = parseResource(value, DESCRIPTORS.productSource, prior) as ProductSourceV1;
  digest(result.data.contentDigest, "productSource.data.contentDigest");
  enumeration(result.data.kind, ["MANUAL", "PDF", "ROOM_PLANNER", "SHOPIFY", "URL", "XLSX"], "productSource.data.kind");
  for (const key of ["locator", "sourceArtifactRef"] as const) id(result.data[key], `productSource.data.${key}`);
  timestamp(result.data.observedAt, "productSource.data.observedAt"); timestampOrNull(result.data.validUntil, "productSource.data.validUntil");
  return result;
}

export function parseProductCandidateV1(value: unknown, source?: ProductSourceV1, prior?: ProductCandidateV1): ProductCandidateV1 {
  const result = parseResource(value, DESCRIPTORS.productCandidate, prior) as ProductCandidateV1;
  id(result.data.productSourceId, "productCandidate.data.productSourceId"); id(result.data.title, "productCandidate.data.title");
  idOrNull(result.data.sku, "productCandidate.data.sku"); idOrNull(result.data.vendorId, "productCandidate.data.vendorId");
  enumeration(result.data.lane, ["APPROVED_VENDOR", "LUZIONE_MADE_TO_ORDER", "LUZIONE_QUICK_SHIP", "OUTSIDE_PRODUCT"], "productCandidate.data.lane");
  if (result.data.price) parseMoney(result.data.price, "productCandidate.data.price");
  if (result.data.leadTimeDays !== null) nonNegativeInteger(result.data.leadTimeDays, "productCandidate.data.leadTimeDays");
  parseConfidence(result.data.confidence, "productCandidate.data.confidence");
  if (source) relate(result, result.data.productSourceId, source, "Product Candidate source");
  return result;
}

export function parseProposalTemplateV1(value: unknown, prior?: ProposalTemplateV1): ProposalTemplateV1 {
  const result = parseResource(value, DESCRIPTORS.proposalTemplate, prior) as ProposalTemplateV1;
  digest(result.data.contentDigest, "proposalTemplate.data.contentDigest");
  enumeration(result.data.format, ["DOCX", "HTML", "PDF_ACROFORM", "PDF_OVERLAY"], "proposalTemplate.data.format");
  for (const key of ["name", "storageObjectRef"] as const) id(result.data[key], `proposalTemplate.data.${key}`);
  strings(result.data.mergeTokens, false, "proposalTemplate.data.mergeTokens"); strings(result.data.validationIssues, false, "proposalTemplate.data.validationIssues");
  if (result.resource.status === "ACTIVE" && result.data.validationIssues.length > 0) finality("An active Proposal Template cannot retain validation issues.");
  return result;
}

export function parseProposalVersionV1(value: unknown, project?: ProjectV1, template?: ProposalTemplateV1, prior?: ProposalVersionV1): ProposalVersionV1 {
  const result = parseResource(value, DESCRIPTORS.proposalVersion, prior) as ProposalVersionV1;
  for (const key of ["currency", "projectId", "templateId"] as const) id(result.data[key], `proposalVersion.data.${key}`);
  positiveInteger(result.data.revision, "proposalVersion.data.revision"); nonNegativeInteger(result.data.totalMinor, "proposalVersion.data.totalMinor");
  strings(result.data.lineIds, true, "proposalVersion.data.lineIds"); idOrNull(result.data.pdfArtifactRef, "proposalVersion.data.pdfArtifactRef"); idOrNull(result.data.webViewRef, "proposalVersion.data.webViewRef");
  if (project) relate(result, result.data.projectId, project, "Proposal Version project");
  if (template) relate(result, result.data.templateId, template, "Proposal Version template");
  return result;
}

export function parseProposalLineV1(value: unknown, proposal?: ProposalVersionV1, prior?: ProposalLineV1): ProposalLineV1 {
  const result = parseResource(value, DESCRIPTORS.proposalLine, prior) as ProposalLineV1;
  for (const key of ["description", "proposalVersionId", "sourceRef"] as const) id(result.data[key], `proposalLine.data.${key}`);
  idOrNull(result.data.optionGroupId, "proposalLine.data.optionGroupId"); positiveNumber(result.data.quantity, "proposalLine.data.quantity");
  for (const key of ["costMinor", "landedCostMinor", "totalMinor", "unitPriceMinor"] as const) nonNegativeInteger(result.data[key], `proposalLine.data.${key}`);
  if (result.data.landedCostMinor < result.data.costMinor) invalid("Proposal Line landed cost cannot be below supplier cost.");
  parseConfidence(result.data.confidence, "proposalLine.data.confidence");
  if (proposal) relate(result, result.data.proposalVersionId, proposal, "Proposal Line proposal version");
  return result;
}

export function parseApprovalDecisionV1(value: unknown, proposal?: ProposalVersionV1, prior?: ApprovalDecisionV1): ApprovalDecisionV1 {
  const result = parseResource(value, DESCRIPTORS.approvalDecision, prior) as ApprovalDecisionV1;
  for (const key of ["decidedBy", "proposalVersion", "proposalVersionId", "targetId"] as const) id(result.data[key], `approvalDecision.data.${key}`);
  timestamp(result.data.decidedAt, "approvalDecision.data.decidedAt"); strings(result.data.evidenceRefs, true, "approvalDecision.data.evidenceRefs");
  if (proposal) {
    relate(result, result.data.proposalVersionId, proposal, "Approval Decision proposal version");
    if (result.data.proposalVersion !== proposal.resource.version) expired("Approval Decision must pin the exact Proposal Version.");
  }
  return result;
}

export function parseRFQV1(value: unknown, project?: ProjectV1, specification?: SpecificationV1, lines: readonly SpecificationLineV1[] = [], prior?: RFQV1): RFQV1 {
  const result = parseResource(value, DESCRIPTORS.rfq, prior) as RFQV1;
  for (const key of ["projectId", "specificationId", "supplierId"] as const) id(result.data[key], `rfq.data.${key}`);
  timestamp(result.data.dueAt, "rfq.data.dueAt"); strings(result.data.requestedFields, true, "rfq.data.requestedFields"); strings(result.data.specificationLineIds, true, "rfq.data.specificationLineIds");
  if (project) relate(result, result.data.projectId, project, "RFQ project");
  if (specification) relate(result, result.data.specificationId, specification, "RFQ specification");
  for (const line of lines) {
    if (!result.data.specificationLineIds.includes(line.resource.id)) mismatch("RFQ line set does not include a supplied Specification Line.");
    sameTenant(result, line, "RFQ line");
  }
  return result;
}

export function parseSupplierQuoteV1(value: unknown, rfq?: RFQV1, evidence?: EvidenceArtifactV1, prior?: SupplierQuoteV1): SupplierQuoteV1 {
  const result = parseResource(value, DESCRIPTORS.supplierQuote, prior) as SupplierQuoteV1;
  for (const key of ["evidenceArtifactId", "rfqId", "supplierId"] as const) id(result.data[key], `supplierQuote.data.${key}`);
  timestampOrNull(result.data.validUntil, "supplierQuote.data.validUntil");
  if (!Array.isArray(result.data.lines) || result.data.lines.length === 0) invalid("Supplier Quote requires normalized lines.");
  for (const [index, lineValue] of result.data.lines.entries()) {
    const line = exact(lineValue, ["incoterm", "leadTimeDays", "packageFacts", "paymentTerms", "quantity", "rfqLineId", "unitPrice", "warranty"], `supplierQuote.data.lines[${index}]`);
    id(line.rfqLineId, `supplierQuote.data.lines[${index}].rfqLineId`); positiveNumber(line.quantity, `supplierQuote.data.lines[${index}].quantity`); parseMoney(line.unitPrice, `supplierQuote.data.lines[${index}].unitPrice`);
  }
  if (rfq) {
    relate(result, result.data.rfqId, rfq, "Supplier Quote RFQ");
    if (result.data.supplierId !== rfq.data.supplierId) mismatch("Supplier Quote supplier must match the RFQ supplier.");
    for (const line of result.data.lines) if (!rfq.data.specificationLineIds.includes(line.rfqLineId)) mismatch("Supplier Quote line must bind an exact RFQ line.");
  }
  if (evidence) relate(result, result.data.evidenceArtifactId, evidence, "Supplier Quote evidence");
  return result;
}

export function parseBidComparisonV1(value: unknown, rfqs: readonly RFQV1[] = [], quotes: readonly SupplierQuoteV1[] = [], prior?: BidComparisonV1): BidComparisonV1 {
  const result = parseResource(value, DESCRIPTORS.bidComparison, prior) as BidComparisonV1;
  id(result.data.basisCurrency, "bidComparison.data.basisCurrency"); strings(result.data.rfqIds, true, "bidComparison.data.rfqIds"); strings(result.data.supplierQuoteIds, true, "bidComparison.data.supplierQuoteIds");
  strings(result.data.recommendationEvidenceRefs, false, "bidComparison.data.recommendationEvidenceRefs"); idOrNull(result.data.recommendedSupplierQuoteId, "bidComparison.data.recommendedSupplierQuoteId"); idOrNull(result.data.selectedByHumanApprovalRef, "bidComparison.data.selectedByHumanApprovalRef");
  if (result.data.recommendedSupplierQuoteId && !result.data.supplierQuoteIds.includes(result.data.recommendedSupplierQuoteId)) mismatch("Bid recommendation must reference a compared Supplier Quote.");
  if (result.resource.status === "APPROVED" && result.data.selectedByHumanApprovalRef === null) authority("An approved Bid Comparison requires human selection evidence.");
  for (const rfq of rfqs) { if (!result.data.rfqIds.includes(rfq.resource.id)) mismatch("Bid Comparison does not include supplied RFQ."); sameTenant(result, rfq, "Bid Comparison RFQ"); }
  for (const quote of quotes) { if (!result.data.supplierQuoteIds.includes(quote.resource.id)) mismatch("Bid Comparison does not include supplied Supplier Quote."); sameTenant(result, quote, "Bid Comparison quote"); }
  return result;
}

export function parsePurchaseOrderV1(value: unknown, bid?: BidComparisonV1, quote?: SupplierQuoteV1, proposal?: ProposalVersionV1, prior?: PurchaseOrderV1): PurchaseOrderV1 {
  const result = parseResource(value, DESCRIPTORS.purchaseOrder, prior) as PurchaseOrderV1;
  for (const key of ["bidComparisonId", "currency", "proposalVersionId", "supplierId", "supplierQuoteId"] as const) id(result.data[key], `purchaseOrder.data.${key}`);
  idOrNull(result.data.releaseApprovalRef, "purchaseOrder.data.releaseApprovalRef"); nonNegativeInteger(result.data.totalMinor, "purchaseOrder.data.totalMinor"); refArray(result.data.lineRefs, result.tenantId, "purchaseOrder.data.lineRefs");
  if (result.resource.status === "RELEASED" && result.data.releaseApprovalRef === null) authority("A released Purchase Order requires exact human approval evidence.");
  if (bid) relate(result, result.data.bidComparisonId, bid, "Purchase Order bid");
  if (quote) { relate(result, result.data.supplierQuoteId, quote, "Purchase Order supplier quote"); if (result.data.supplierId !== quote.data.supplierId) mismatch("Purchase Order supplier must match selected quote."); }
  if (proposal) relate(result, result.data.proposalVersionId, proposal, "Purchase Order proposal version");
  return result;
}

export function parsePurchaseOrderAcknowledgementV1(value: unknown, purchaseOrder?: PurchaseOrderV1, prior?: PurchaseOrderAcknowledgementV1): PurchaseOrderAcknowledgementV1 {
  const result = parseResource(value, DESCRIPTORS.purchaseOrderAcknowledgement, prior) as PurchaseOrderAcknowledgementV1;
  for (const key of ["acknowledgedPurchaseOrderVersion", "purchaseOrderId", "supplierId"] as const) id(result.data[key], `purchaseOrderAcknowledgement.data.${key}`);
  timestampOrNull(result.data.expectedReadyAt, "purchaseOrderAcknowledgement.data.expectedReadyAt");
  if (purchaseOrder) {
    relate(result, result.data.purchaseOrderId, purchaseOrder, "Purchase Order acknowledgement");
    if (result.data.acknowledgedPurchaseOrderVersion !== purchaseOrder.resource.version) expired("Purchase Order acknowledgement must pin the exact released version.");
    if (result.data.supplierId !== purchaseOrder.data.supplierId) mismatch("Purchase Order acknowledgement supplier mismatch.");
  }
  if (result.resource.status === "SOURCE_CONFIRMED" && result.receipt.finality !== "SOURCE_CONFIRMED") finality("Source-confirmed Purchase Order acknowledgement requires source readback.");
  return result;
}

export function parseShipmentV1(value: unknown, purchaseOrders: readonly PurchaseOrderV1[] = [], prior?: ShipmentV1): ShipmentV1 {
  const result = parseResource(value, DESCRIPTORS.shipment, prior) as ShipmentV1;
  id(result.data.supplierId, "shipment.data.supplierId"); strings(result.data.purchaseOrderIds, true, "shipment.data.purchaseOrderIds");
  idOrNull(result.data.carrier, "shipment.data.carrier"); idOrNull(result.data.trackingNumber, "shipment.data.trackingNumber"); timestampOrNull(result.data.expectedDeliveryAt, "shipment.data.expectedDeliveryAt");
  for (const order of purchaseOrders) { if (!result.data.purchaseOrderIds.includes(order.resource.id)) mismatch("Shipment does not include supplied Purchase Order."); sameTenant(result, order, "Shipment order"); }
  return result;
}

export function parsePackageV1(value: unknown, shipment?: ShipmentV1, prior?: PackageV1): PackageV1 {
  const result = parseResource(value, DESCRIPTORS.package, prior) as PackageV1;
  id(result.data.label, "package.data.label"); id(result.data.shipmentId, "package.data.shipmentId"); positiveNumber(result.data.quantity, "package.data.quantity"); idOrNull(result.data.trackingNumber, "package.data.trackingNumber");
  if (shipment) relate(result, result.data.shipmentId, shipment, "Package shipment");
  return result;
}

export function parseReceivingRecordV1(value: unknown, shipment?: ShipmentV1, packages: readonly PackageV1[] = [], prior?: ReceivingRecordV1): ReceivingRecordV1 {
  const result = parseResource(value, DESCRIPTORS.receivingRecord, prior) as ReceivingRecordV1;
  id(result.data.shipmentId, "receivingRecord.data.shipmentId"); id(result.data.receivedBy, "receivingRecord.data.receivedBy"); timestamp(result.data.receivedAt, "receivingRecord.data.receivedAt"); strings(result.data.packageIds, true, "receivingRecord.data.packageIds"); strings(result.data.discrepancyEvidenceRefs, false, "receivingRecord.data.discrepancyEvidenceRefs");
  const counts = exact(result.data.counts, ["damaged", "expected", "missing", "received"], "receivingRecord.data.counts"); for (const item of Object.values(counts)) nonNegativeInteger(item, "receivingRecord.data.counts[]");
  if (Number(counts.received) + Number(counts.missing) !== counts.expected) invalid("Receiving counts must reconcile expected quantity.");
  if ((Number(counts.damaged) > 0 || Number(counts.missing) > 0) && result.data.discrepancyEvidenceRefs.length === 0) finality("Receiving discrepancies require evidence.");
  if (shipment) relate(result, result.data.shipmentId, shipment, "Receiving shipment");
  for (const item of packages) { if (!result.data.packageIds.includes(item.resource.id)) mismatch("Receiving record does not include supplied Package."); sameTenant(result, item, "Receiving package"); }
  return result;
}

export function parseInstallationRecordV1(value: unknown, project?: ProjectV1, spaces: readonly SpaceV1[] = [], prior?: InstallationRecordV1): InstallationRecordV1 {
  const result = parseResource(value, DESCRIPTORS.installationRecord, prior) as InstallationRecordV1;
  for (const key of ["installerId", "projectId"] as const) id(result.data[key], `installationRecord.data.${key}`);
  timestamp(result.data.scheduledAt, "installationRecord.data.scheduledAt"); timestampOrNull(result.data.startedAt, "installationRecord.data.startedAt"); timestampOrNull(result.data.completedAt, "installationRecord.data.completedAt"); strings(result.data.spaceIds, true, "installationRecord.data.spaceIds"); strings(result.data.issueEvidenceRefs, false, "installationRecord.data.issueEvidenceRefs");
  if (result.resource.status === "COMPLETE" && result.data.completedAt === null) finality("Completed Installation requires completedAt evidence.");
  if (project) relate(result, result.data.projectId, project, "Installation project");
  for (const space of spaces) { if (!result.data.spaceIds.includes(space.resource.id)) mismatch("Installation does not include supplied Space."); sameTenant(result, space, "Installation Space"); }
  return result;
}

export function parseTimelineEventV1(value: unknown, prior?: TimelineEventV1): TimelineEventV1 {
  const result = parseResource(value, DESCRIPTORS.timelineEvent, prior) as TimelineEventV1;
  for (const key of ["actorId", "eventType", "summary"] as const) id(result.data[key], `timelineEvent.data.${key}`);
  timestamp(result.data.occurredAt, "timelineEvent.data.occurredAt"); timestamp(result.data.recordedAt, "timelineEvent.data.recordedAt"); strings(result.data.evidenceRefs, false, "timelineEvent.data.evidenceRefs"); refArray(result.data.aggregateRefs, result.tenantId, "timelineEvent.data.aggregateRefs");
  return result;
}

export function parseEvidenceArtifactV1(value: unknown, prior?: EvidenceArtifactV1): EvidenceArtifactV1 {
  const result = parseResource(value, DESCRIPTORS.evidenceArtifact, prior) as EvidenceArtifactV1;
  timestamp(result.data.capturedAt, "evidenceArtifact.data.capturedAt"); confidence(result.data.confidence, "evidenceArtifact.data.confidence"); digest(result.data.contentDigest, "evidenceArtifact.data.contentDigest");
  for (const key of ["mimeType", "provider", "sourceRecordRef", "storageRef"] as const) id(result.data[key], `evidenceArtifact.data.${key}`);
  if (result.data.promptInjectionState === "DETECTED" && result.resource.status !== "QUARANTINED") authority("Detected prompt injection must quarantine the Evidence Artifact.");
  return result;
}

export function parseFieldChangeProposalV1(value: unknown, evidence: readonly EvidenceArtifactV1[] = [], prior?: FieldChangeProposalV1): FieldChangeProposalV1 {
  const result = parseResource(value, DESCRIPTORS.fieldChangeProposal, prior) as FieldChangeProposalV1;
  for (const key of ["fieldPath", "targetId", "targetType", "targetVersion"] as const) id(result.data[key], `fieldChangeProposal.data.${key}`);
  confidence(result.data.confidence, "fieldChangeProposal.data.confidence"); idOrNull(result.data.conflictVersion, "fieldChangeProposal.data.conflictVersion"); strings(result.data.evidenceRefs, true, "fieldChangeProposal.data.evidenceRefs");
  if (result.resource.status === "CONFLICT" && result.data.conflictVersion === null) mismatch("Conflicting field change requires observed conflict version.");
  for (const artifact of evidence) { if (!result.data.evidenceRefs.includes(artifact.resource.id)) mismatch("Field change does not include supplied evidence."); sameTenant(result, artifact, "Field change evidence"); }
  return result;
}

export function parseSultanReviewItemV1(value: unknown, policy?: AuthorityPolicyV1, outcome?: OutcomeReceiptV1, prior?: SultanReviewItemV1): SultanReviewItemV1 {
  const result = parseResource(value, DESCRIPTORS.sultanReviewItem, prior) as SultanReviewItemV1;
  id(result.data.authorityPolicyId, "sultanReviewItem.data.authorityPolicyId"); idOrNull(result.data.outcomeReceiptId, "sultanReviewItem.data.outcomeReceiptId");
  for (const key of ["recommendation", "summary"] as const) id(result.data[key], `sultanReviewItem.data.${key}`);
  confidence(result.data.uncertainty, "sultanReviewItem.data.uncertainty"); strings(result.data.evidenceRefs, true, "sultanReviewItem.data.evidenceRefs"); refArray(result.data.subjectRefs, result.tenantId, "sultanReviewItem.data.subjectRefs");
  if (policy) relate(result, result.data.authorityPolicyId, policy, "Sultan Review authority policy");
  if (outcome) relate(result, result.data.outcomeReceiptId ?? "", outcome, "Sultan Review outcome");
  if (result.resource.status === "APPLIED" && result.data.outcomeReceiptId === null) finality("Applied Sultan Review requires an Outcome Receipt.");
  return result;
}

export function parseAuthorityPolicyV1(value: unknown, prior?: AuthorityPolicyV1): AuthorityPolicyV1 {
  const result = parseResource(value, DESCRIPTORS.authorityPolicy, prior) as AuthorityPolicyV1;
  id(result.data.scopeRef, "authorityPolicy.data.scopeRef"); boolean(result.data.killSwitchActive, "authorityPolicy.data.killSwitchActive");
  if (!Array.isArray(result.data.capabilityRules) || result.data.capabilityRules.length === 0) invalid("Authority Policy requires capability rules.");
  if (!Array.isArray(result.data.fieldRules)) invalid("Authority Policy field rules must be an array.");
  if (result.data.killSwitchActive && result.resource.status === "ACTIVE") authority("A kill-switched Authority Policy cannot remain active.");
  return result;
}

export function parseOutcomeReceiptV1(value: unknown, prior?: OutcomeReceiptV1): OutcomeReceiptV1 {
  const result = parseResource(value, DESCRIPTORS.outcomeReceipt, prior) as OutcomeReceiptV1;
  id(result.data.actionType, "outcomeReceipt.data.actionType"); id(result.data.operationId, "outcomeReceipt.data.operationId"); refs(result.data.subjectRef, result.tenantId, "outcomeReceipt.data.subjectRef");
  if (result.data.actualEffect === "SOURCE_CONFIRMED" && result.receipt.finality !== "SOURCE_CONFIRMED") finality("Source-confirmed Outcome Receipt requires authoritative readback.");
  if (result.data.result === "SUCCEEDED" && result.resource.status === "FAILED") finality("A failed Outcome Receipt cannot claim success.");
  return result;
}

export function parseLuzioneSeedProductContractDocument(value: unknown): LuzioneSeedProductContractDocument {
  const version = object(value, "seedProductContract").contractVersion;
  const parser = Object.entries(SEED_PRODUCT_CONTRACT_VERSIONS).find(([, item]) => item === version)?.[0] as keyof typeof SEED_PRODUCT_CONTRACT_VERSIONS | undefined;
  if (!parser) wrongVersion("seedProductContract.contractVersion", Object.values(SEED_PRODUCT_CONTRACT_VERSIONS).join(" | "));
  return parseResource(value, DESCRIPTORS[parser]) as LuzioneSeedProductContractDocument;
}

function descriptor(version: SeedProductContractVersion, resourceType: string, statuses: readonly string[], dataKeys: readonly string[]): Descriptor {
  return { dataKeys, resourceType, statuses, version };
}

function parseResource(value: unknown, descriptorValue: Descriptor, prior?: AnySeedResource): AnySeedResource {
  const result = exact(value, ["authority", "contractVersion", "createdAt", "data", "mutation", "receipt", "resource", "sourceRefs", "tenantId", "updatedAt"], descriptorValue.resourceType);
  if (result.contractVersion !== descriptorValue.version) wrongVersion(`${descriptorValue.resourceType}.contractVersion`, descriptorValue.version);
  const tenantId = id(result.tenantId, `${descriptorValue.resourceType}.tenantId`);
  const resource = exact(result.resource, ["archivedAt", "id", "status", "type", "version"], `${descriptorValue.resourceType}.resource`);
  id(resource.id, `${descriptorValue.resourceType}.resource.id`); id(resource.version, `${descriptorValue.resourceType}.resource.version`);
  if (resource.type !== descriptorValue.resourceType) mismatch(`${descriptorValue.version} resource.type must be ${descriptorValue.resourceType}.`);
  const status = enumeration(resource.status, descriptorValue.statuses, `${descriptorValue.resourceType}.resource.status`);
  timestampOrNull(resource.archivedAt, `${descriptorValue.resourceType}.resource.archivedAt`);
  if (status === "ARCHIVED" && resource.archivedAt === null) finality("Archived resources require archivedAt evidence.");
  if (status !== "ARCHIVED" && resource.archivedAt !== null) finality("Only archived resources may carry archivedAt evidence.");
  const createdAt = timestamp(result.createdAt, `${descriptorValue.resourceType}.createdAt`);
  const updatedAt = timestamp(result.updatedAt, `${descriptorValue.resourceType}.updatedAt`);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) invalid("updatedAt cannot precede createdAt.");
  const sourceRefs = refArray(result.sourceRefs, tenantId, `${descriptorValue.resourceType}.sourceRefs`);
  if (sourceRefs.length === 0) invalid("Seed product resources require at least one provenance source reference.");
  const mutation = exact(result.mutation, ["expectedVersion", "idempotencyKey", "payloadHash"], `${descriptorValue.resourceType}.mutation`);
  idOrNull(mutation.expectedVersion, `${descriptorValue.resourceType}.mutation.expectedVersion`); id(mutation.idempotencyKey, `${descriptorValue.resourceType}.mutation.idempotencyKey`); digest(mutation.payloadHash, `${descriptorValue.resourceType}.mutation.payloadHash`);
  const authorityBoundary = exact(result.authority, ["actorId", "actorType", "approvalRef", "capability", "decision", "effectClass", "policyVersion", "serverDerivedIdentityRef"], `${descriptorValue.resourceType}.authority`);
  for (const key of ["actorId", "capability", "policyVersion", "serverDerivedIdentityRef"] as const) id(authorityBoundary[key], `${descriptorValue.resourceType}.authority.${key}`);
  idOrNull(authorityBoundary.approvalRef, `${descriptorValue.resourceType}.authority.approvalRef`);
  const effectClass = enumeration(authorityBoundary.effectClass, ["A0", "A1", "A2", "A3", "A4"], `${descriptorValue.resourceType}.authority.effectClass`);
  const decision = enumeration(authorityBoundary.decision, ["ALLOW", "DENY", "REQUIRE_HUMAN"], `${descriptorValue.resourceType}.authority.decision`);
  if (effectClass === "A4" && decision !== "DENY") authority("A4 capabilities are prohibited.");
  if ((effectClass === "A2" || effectClass === "A3") && (decision !== "REQUIRE_HUMAN" || authorityBoundary.approvalRef === null)) authority("A2/A3 resources require exact human approval evidence.");
  if (decision === "REQUIRE_HUMAN" && authorityBoundary.approvalRef === null) authority("REQUIRE_HUMAN needs named approval evidence.");
  const receipt = exact(result.receipt, ["committedVersion", "finality", "observedAt", "observedVersion", "providerAcknowledgementRef", "receiptId", "sourceReadbackRef"], `${descriptorValue.resourceType}.receipt`);
  for (const key of ["committedVersion", "receiptId"] as const) id(receipt[key], `${descriptorValue.resourceType}.receipt.${key}`);
  if (receipt.committedVersion !== resource.version) mismatch("Receipt committedVersion must equal the resource version.");
  idOrNull(receipt.observedVersion, `${descriptorValue.resourceType}.receipt.observedVersion`); timestampOrNull(receipt.observedAt, `${descriptorValue.resourceType}.receipt.observedAt`); idOrNull(receipt.providerAcknowledgementRef, `${descriptorValue.resourceType}.receipt.providerAcknowledgementRef`); idOrNull(receipt.sourceReadbackRef, `${descriptorValue.resourceType}.receipt.sourceReadbackRef`);
  const receiptFinality = enumeration(receipt.finality, ["DOMAIN_COMMITTED", "PROVIDER_ACKNOWLEDGED", "RECONCILING", "SOURCE_CONFIRMED"], `${descriptorValue.resourceType}.receipt.finality`);
  if (receiptFinality === "SOURCE_CONFIRMED" && (receipt.observedAt === null || receipt.observedVersion === null || receipt.sourceReadbackRef === null)) finality("SOURCE_CONFIRMED requires observed version, time, and source readback.");
  if (receiptFinality === "PROVIDER_ACKNOWLEDGED" && receipt.providerAcknowledgementRef === null) finality("PROVIDER_ACKNOWLEDGED requires provider evidence.");
  if (receiptFinality === "PROVIDER_ACKNOWLEDGED" && receipt.sourceReadbackRef !== null) finality("Provider acknowledgement cannot masquerade as source readback.");
  exact(result.data, descriptorValue.dataKeys, `${descriptorValue.resourceType}.data`);
  if (prior && mutation.idempotencyKey === prior.mutation.idempotencyKey) {
    if (mutation.payloadHash !== prior.mutation.payloadHash) replay("Changed payload reused a seed resource idempotency key.");
    if (resource.id !== prior.resource.id || tenantId !== prior.tenantId) replay("Exact replay must retain resource and tenant identity.");
  } else if (prior && mutation.expectedVersion !== prior.resource.version) {
    expired("A new seed resource mutation must expect the exact prior resource version.");
  }
  return result as unknown as AnySeedResource;
}

function relate(source: AnySeedResource, expectedId: string, target: AnySeedResource, label: string) {
  sameTenant(source, target, label);
  if (expectedId !== target.resource.id) mismatch(`${label} must reference the exact resource ID.`);
}
function sameTenant(source: AnySeedResource, target: AnySeedResource, label: string) { if (source.tenantId !== target.tenantId) tenantMismatch(`${label} must remain tenant-bound.`); }
function refArray(value: unknown, tenantId: string, path: string) { if (!Array.isArray(value)) invalid(`${path} must be an array.`); return value.map((item, index) => refs(item, tenantId, `${path}[${index}]`)); }
function refs(value: unknown, tenantId: string, path: string) { const ref = exact(value, ["objectId", "objectType", "ownerProject", "tenantId", "version"], path); for (const key of ["objectId", "objectType", "ownerProject", "version"] as const) id(ref[key], `${path}.${key}`); if (ref.tenantId !== tenantId) tenantMismatch(`${path} must match the resource tenant.`); return ref; }
function parseMoney(value: unknown, path: string) { const money = exact(value, ["amountMinor", "currency"], path); nonNegativeInteger(money.amountMinor, `${path}.amountMinor`); id(money.currency, `${path}.currency`); }
function parseConfidence(value: unknown, path: string) { const item = exact(value, ["score", "sourceFreshAt"], path); confidence(item.score, `${path}.score`); timestampOrNull(item.sourceFreshAt, `${path}.sourceFreshAt`); }
function exact(value: unknown, keys: readonly string[], path: string): JsonObject { const result = object(value, path); const expected = [...keys].sort(); const actual = Object.keys(result).sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("CORE_FIELD_SET_MISMATCH", `${path} fields must be exactly ${expected.join(", ")}; received ${actual.join(", ")}.`); return result; }
function object(value: unknown, path: string): JsonObject { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} must be an object.`); return value as JsonObject; }
function id(value: unknown, path: string): string { if (typeof value !== "string" || value.length < 2 || value.length > 512) invalid(`${path} must be a bounded identifier.`); return value; }
function idOrNull(value: unknown, path: string) { if (value !== null) id(value, path); }
function stringOrNull(value: unknown, path: string) { if (value !== null && (typeof value !== "string" || value.length > 512)) invalid(`${path} must be a bounded string or null.`); }
function timestamp(value: unknown, path: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(`${path} must be an ISO timestamp.`); return value; }
function timestampOrNull(value: unknown, path: string) { if (value !== null) timestamp(value, path); }
function digest(value: unknown, path: string) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid(`${path} must be a lowercase SHA-256 digest.`); }
function boolean(value: unknown, path: string) { if (typeof value !== "boolean") invalid(`${path} must be boolean.`); }
function confidence(value: unknown, path: string) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) invalid(`${path} must be between zero and one.`); }
function nonNegativeInteger(value: unknown, path: string) { if (!Number.isInteger(value) || Number(value) < 0) invalid(`${path} must be a non-negative integer.`); }
function positiveInteger(value: unknown, path: string) { if (!Number.isInteger(value) || Number(value) <= 0) invalid(`${path} must be a positive integer.`); }
function positiveNumber(value: unknown, path: string) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) invalid(`${path} must be positive.`); }
function strings(value: unknown, requireOne: boolean, path: string): string[] { if (!Array.isArray(value) || (requireOne && value.length === 0)) invalid(`${path} must be a string array${requireOne ? " with at least one item" : ""}.`); const result = value.map((item, index) => id(item, `${path}[${index}]`)); if (new Set(result).size !== result.length) invalid(`${path} values must be unique.`); return result; }
function enumeration<T extends string>(value: unknown, allowed: readonly T[], path: string): T { if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${path} is not an allowed value.`); return value as T; }
function invalid(message: string): never { return fail("CORE_VALUE_INVALID", message); }
function authority(message: string): never { return fail("CORE_AUTHORITY_DENIED", message); }
function expired(message: string): never { return fail("CORE_EXPIRED", message); }
function finality(message: string): never { return fail("CORE_FINALITY_INVALID", message); }
function mismatch(message: string): never { return fail("CORE_REFERENCE_MISMATCH", message); }
function replay(message: string): never { return fail("CORE_REPLAY_CONFLICT", message); }
function tenantMismatch(message: string): never { return fail("CORE_TENANT_MISMATCH", message); }
function wrongVersion(path: string, expected: string): never { return fail("CORE_WRONG_VERSION", `${path} must be ${expected}.`); }
function fail(code: LuzioneCoreCompatibilityErrorCode, message: string): never { throw new LuzioneCoreCompatibilityError(code, message); }
