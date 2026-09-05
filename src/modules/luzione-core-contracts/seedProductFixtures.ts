import {
  SEED_PRODUCT_CONTRACT_VERSIONS,
  type ApprovalDecisionV1,
  type AuthorityPolicyV1,
  type BidComparisonV1,
  type EvidenceArtifactV1,
  type FieldChangeProposalV1,
  type InstallationRecordV1,
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

const tenantId = "tenant-luzione";
const createdAt = "2026-09-05T08:00:00.000Z";
const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const sourceRef = (objectId: string, objectType: string, version: string) => ({
  objectId, objectType, ownerProject: "LUZIONE_SEED_FIXTURE", tenantId, version,
});

function seed<ContractVersion extends SeedProductContractVersion, ResourceType extends string, Status extends string, Data>(
  contractVersion: ContractVersion,
  type: ResourceType,
  status: Status,
  id: string,
  data: Data,
): SeedResourceV1<ContractVersion, ResourceType, Status, Data> {
  const version = `${id}:v1`;
  return {
    authority: {
      actorId: "operator-fixture", actorType: "HUMAN", approvalRef: null,
      capability: `seed.${type.toLowerCase()}.write`, decision: "ALLOW", effectClass: "A0",
      policyVersion: "seed-authority:v1", serverDerivedIdentityRef: "request-fixture-1",
    },
    contractVersion,
    createdAt,
    data,
    mutation: { expectedVersion: `${id}:v0`, idempotencyKey: `seed:${id}:1`, payloadHash: sha },
    receipt: {
      committedVersion: version, finality: "DOMAIN_COMMITTED", observedAt: null,
      observedVersion: null, providerAcknowledgementRef: null, receiptId: `receipt:${id}:v1`,
      sourceReadbackRef: null,
    },
    resource: { archivedAt: null, id, status, type, version },
    sourceRefs: [sourceRef(`source:${id}`, "SEED_SOURCE", `source:${id}:v1`)],
    tenantId,
    updatedAt: createdAt,
  };
}

export const projectFixture: ProjectV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.project, "PROJECT", "ACTIVE", "project-1", {
  accountId: "account-1", budget: { amountMinor: 50000000, currency: "USD" }, name: "Pacific Residence",
  opportunityId: "opportunity-1", ownerId: "operator-1", targetEndAt: "2027-06-30T00:00:00.000Z",
  targetStartAt: "2026-10-01T00:00:00.000Z",
});

export const spaceFixture: SpaceV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.space, "SPACE", "ACTIVE", "space-1", {
  floor: "1", kind: "ROOM", name: "Living Room", projectId: projectFixture.resource.id, sequence: 1,
});

export const projectPackageFixture: ProjectPackageV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.projectPackage, "PROJECT_PACKAGE", "PUBLISHED", "project-package-1", {
  assetRefs: ["asset-floor-plan-1"], canonicalProjectId: projectFixture.resource.id,
  plannerProjectRef: sourceRef("planner-project-1", "PLANNER_PROJECT", "planner-project-1:v7"),
  provenanceRefs: ["evidence:planner-publication-1"], publishedAt: createdAt, sourceVersionHash: sha,
  spaceRefs: [sourceRef(spaceFixture.resource.id, spaceFixture.resource.type, spaceFixture.resource.version)],
  specificationRefs: [sourceRef("specification-1", "SPECIFICATION", "specification-1:v1")], uncertainty: [],
});

export const specificationFixture: SpecificationV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.specification, "SPECIFICATION", "ACTIVE_PROCUREMENT", "specification-1", {
  activatedAt: createdAt, plannerPackageId: projectPackageFixture.resource.id, projectId: projectFixture.resource.id,
  publishedPackageVersion: projectPackageFixture.resource.version, revisionOfVersion: null,
  spaceIds: [spaceFixture.resource.id], title: "Living Room FF&E",
});

export const productSourceFixture: ProductSourceV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.productSource, "PRODUCT_SOURCE", "ACTIVE", "product-source-1", {
  contentDigest: sha, kind: "PDF", locator: "private-object:supplier-catalog-1", observedAt: createdAt,
  sourceArtifactRef: "evidence-artifact-1", validUntil: "2026-12-31T00:00:00.000Z",
});

export const productCandidateFixture: ProductCandidateV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.productCandidate, "PRODUCT_CANDIDATE", "ELIGIBLE", "product-candidate-1", {
  attributes: { finish: "oak", width: "220cm" }, confidence: { score: 0.92, sourceFreshAt: createdAt },
  lane: "APPROVED_VENDOR", leadTimeDays: 42, price: { amountMinor: 425000, currency: "USD" },
  productSourceId: productSourceFixture.resource.id, sku: "SOFA-220-OAK", title: "Oak Frame Sofa", vendorId: "supplier-1",
});

export const specificationLineFixture: SpecificationLineV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.specificationLine, "SPECIFICATION_LINE", "SOURCING", "specification-line-1", {
  approvalState: "PENDING", deliveryRisk: "MEDIUM", description: "Three-seat sofa",
  productCandidateIds: [productCandidateFixture.resource.id], quantity: 1,
  selectedCandidateId: productCandidateFixture.resource.id, sourcingState: "RFQ_OPEN",
  spaceId: spaceFixture.resource.id, specificationId: specificationFixture.resource.id, unit: "each",
});

export const proposalTemplateFixture: ProposalTemplateV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.proposalTemplate, "PROPOSAL_TEMPLATE", "ACTIVE", "proposal-template-1", {
  contentDigest: sha, format: "DOCX", mergeTokens: ["project.name", "proposal.total"],
  name: "Luzione Residential", storageObjectRef: "private-object:proposal-template-1", validationIssues: [],
});

export const proposalVersionFixture: ProposalVersionV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.proposalVersion, "PROPOSAL_VERSION", "DRAFT", "proposal-version-1", {
  currency: "USD", decisionState: "PENDING", lineIds: ["proposal-line-1"], pdfArtifactRef: null,
  projectId: projectFixture.resource.id, revision: 1, templateId: proposalTemplateFixture.resource.id,
  totalMinor: 575000, webViewRef: null,
});

export const proposalLineFixture: ProposalLineV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.proposalLine, "PROPOSAL_LINE", "ACTIVE", "proposal-line-1", {
  confidence: { score: 0.9, sourceFreshAt: createdAt }, costMinor: 300000, description: "Oak Frame Sofa",
  landedCostMinor: 350000, lineType: "PRODUCT", optionGroupId: null,
  proposalVersionId: proposalVersionFixture.resource.id, quantity: 1, sourceRef: productCandidateFixture.resource.id,
  totalMinor: 575000, unitPriceMinor: 575000,
});

export const approvalDecisionFixture: ApprovalDecisionV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.approvalDecision, "APPROVAL_DECISION", "ACTIVE", "approval-decision-1", {
  comment: "Approved for procurement", decidedAt: createdAt, decidedBy: "client-1", decision: "APPROVE",
  evidenceRefs: ["evidence:client-approval-1"], proposalVersion: proposalVersionFixture.resource.version,
  proposalVersionId: proposalVersionFixture.resource.id, scope: "PROPOSAL", targetId: proposalVersionFixture.resource.id,
});

export const rfqFixture: RFQV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.rfq, "RFQ", "OPEN", "rfq-1", {
  dueAt: "2026-09-12T00:00:00.000Z", projectId: projectFixture.resource.id,
  requestedFields: ["unit_price", "lead_time", "incoterm", "payment_terms", "warranty"],
  specificationId: specificationFixture.resource.id, specificationLineIds: [specificationLineFixture.resource.id],
  supplierId: "supplier-1",
});

export const evidenceArtifactFixture: EvidenceArtifactV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.evidenceArtifact, "EVIDENCE_ARTIFACT", "ACTIVE", "evidence-artifact-1", {
  capturedAt: createdAt, confidence: 0.95, contentDigest: sha, kind: "EMAIL", mimeType: "message/rfc822",
  promptInjectionState: "CLEAR", provider: "GMAIL", sourceRecordRef: "gmail-message-1",
  storageRef: "private-object:gmail-message-1",
});

export const supplierQuoteFixture: SupplierQuoteV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.supplierQuote, "SUPPLIER_QUOTE", "NORMALIZED", "supplier-quote-1", {
  evidenceArtifactId: evidenceArtifactFixture.resource.id,
  lines: [{ incoterm: "FOB", leadTimeDays: 42, packageFacts: "1 carton", paymentTerms: "50/50", quantity: 1, rfqLineId: specificationLineFixture.resource.id, unitPrice: { amountMinor: 300000, currency: "USD" }, warranty: "2 years" }],
  responseSource: "EMAIL", rfqId: rfqFixture.resource.id, supplierId: "supplier-1",
  validUntil: "2026-10-05T00:00:00.000Z",
});

export const bidComparisonFixture: BidComparisonV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.bidComparison, "BID_COMPARISON", "DRAFT", "bid-comparison-1", {
  basisCurrency: "USD", recommendationEvidenceRefs: ["evidence:bid-score-1"],
  recommendedSupplierQuoteId: supplierQuoteFixture.resource.id, rfqIds: [rfqFixture.resource.id],
  rows: [{ landedTotalMinor: 350000, marginMinor: 225000, score: 0.91, supplierQuoteId: supplierQuoteFixture.resource.id }],
  selectedByHumanApprovalRef: null, supplierQuoteIds: [supplierQuoteFixture.resource.id],
});

export const purchaseOrderFixture: PurchaseOrderV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.purchaseOrder, "PURCHASE_ORDER", "DRAFT", "purchase-order-1", {
  bidComparisonId: bidComparisonFixture.resource.id, currency: "USD",
  lineRefs: [sourceRef(specificationLineFixture.resource.id, specificationLineFixture.resource.type, specificationLineFixture.resource.version)],
  proposalVersionId: proposalVersionFixture.resource.id, releaseApprovalRef: null, supplierId: "supplier-1",
  supplierQuoteId: supplierQuoteFixture.resource.id, totalMinor: 300000,
});

export const purchaseOrderAcknowledgementFixture: PurchaseOrderAcknowledgementV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.purchaseOrderAcknowledgement, "PURCHASE_ORDER_ACKNOWLEDGEMENT", "PROVIDER_ACKNOWLEDGED", "purchase-order-ack-1", {
  acknowledgedPurchaseOrderVersion: purchaseOrderFixture.resource.version, expectedReadyAt: "2026-10-20T00:00:00.000Z",
  purchaseOrderId: purchaseOrderFixture.resource.id, supplierId: "supplier-1", variances: [],
});
purchaseOrderAcknowledgementFixture.receipt.finality = "PROVIDER_ACKNOWLEDGED";
purchaseOrderAcknowledgementFixture.receipt.providerAcknowledgementRef = "provider-ack:purchase-order-1";

export const shipmentFixture: ShipmentV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.shipment, "SHIPMENT", "PLANNED", "shipment-1", {
  carrier: null, expectedDeliveryAt: "2026-11-15T00:00:00.000Z",
  purchaseOrderIds: [purchaseOrderFixture.resource.id], risk: "MEDIUM", supplierId: "supplier-1", trackingNumber: null,
});

export const packageFixture: PackageV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.package, "PACKAGE", "PLANNED", "package-1", {
  dimensions: { height: 90, length: 230, unit: "cm", width: 100 }, label: "Sofa carton", quantity: 1,
  shipmentId: shipmentFixture.resource.id, trackingNumber: null, weight: { unit: "kg", value: 75 },
});

export const receivingRecordFixture: ReceivingRecordV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.receivingRecord, "RECEIVING_RECORD", "COMPLETE", "receiving-record-1", {
  counts: { damaged: 0, expected: 1, missing: 0, received: 1 }, discrepancyEvidenceRefs: [],
  packageIds: [packageFixture.resource.id], receivedAt: "2026-11-15T18:00:00.000Z",
  receivedBy: "warehouse-operator-1", shipmentId: shipmentFixture.resource.id,
});

export const installationRecordFixture: InstallationRecordV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.installationRecord, "INSTALLATION_RECORD", "SCHEDULED", "installation-record-1", {
  completedAt: null, installerId: "installer-1", issueEvidenceRefs: [], projectId: projectFixture.resource.id,
  scheduledAt: "2026-11-20T17:00:00.000Z", spaceIds: [spaceFixture.resource.id], startedAt: null,
});

export const timelineEventFixture: TimelineEventV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent, "TIMELINE_EVENT", "ACTIVE", "timeline-event-1", {
  actorId: "operator-1", aggregateRefs: [sourceRef(projectFixture.resource.id, projectFixture.resource.type, projectFixture.resource.version)],
  eventType: "SPECIFICATION_ACTIVATED", evidenceRefs: ["evidence:planner-publication-1"], occurredAt: createdAt,
  recordedAt: createdAt, summary: "Living Room specification activated", visibility: "INTERNAL",
});

export const fieldChangeProposalFixture: FieldChangeProposalV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.fieldChangeProposal, "FIELD_CHANGE_PROPOSAL", "PENDING", "field-change-1", {
  confidence: 0.88, conflictVersion: null, evidenceRefs: [evidenceArtifactFixture.resource.id], fieldPath: "expectedReadyAt",
  newValue: "2026-10-20T00:00:00.000Z", oldValue: null, targetId: purchaseOrderFixture.resource.id,
  targetType: purchaseOrderFixture.resource.type, targetVersion: purchaseOrderFixture.resource.version,
});

export const authorityPolicyFixture: AuthorityPolicyV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.authorityPolicy, "AUTHORITY_POLICY", "ACTIVE", "authority-policy-1", {
  capabilityRules: [{ capability: "procurement.field-change.prepare", mode: "PREPARE" }], effectCeiling: "A2",
  fieldRules: [{ fieldPath: "purchaseOrder.expectedReadyAt", mode: "APPROVAL_REQUIRED" }],
  killSwitchActive: false, scopeRef: "tenant-luzione:procurement",
});

export const outcomeReceiptFixture: OutcomeReceiptV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.outcomeReceipt, "OUTCOME_RECEIPT", "SOURCE_CONFIRMED", "outcome-receipt-1", {
  actionType: "FIELD_CHANGE_APPLIED", actualEffect: "SOURCE_CONFIRMED", operationId: "operation-1", result: "SUCCEEDED",
  subjectRef: sourceRef(purchaseOrderFixture.resource.id, purchaseOrderFixture.resource.type, purchaseOrderFixture.resource.version),
  value: { cycleTimeSecondsSaved: 300, marginProtectedMinor: 0, opportunityCreatedMinor: 0, riskAvoidedMinor: 25000, timeSavedSeconds: 600 },
});
outcomeReceiptFixture.receipt.finality = "SOURCE_CONFIRMED";
outcomeReceiptFixture.receipt.observedAt = createdAt;
outcomeReceiptFixture.receipt.observedVersion = outcomeReceiptFixture.resource.version;
outcomeReceiptFixture.receipt.sourceReadbackRef = "postgres:outcome-receipt-1:v1";

export const sultanReviewItemFixture: SultanReviewItemV1 = seed(SEED_PRODUCT_CONTRACT_VERSIONS.sultanReviewItem, "SULTAN_REVIEW_ITEM", "APPLIED", "sultan-review-item-1", {
  authorityPolicyId: authorityPolicyFixture.resource.id, critic: { dissent: null, score: 0.94 },
  evidenceRefs: [evidenceArtifactFixture.resource.id], outcomeReceiptId: outcomeReceiptFixture.resource.id,
  recommendation: "Accept supplier ready-date update", reviewType: "SUPPLIER_UPDATE",
  subjectRefs: [sourceRef(purchaseOrderFixture.resource.id, purchaseOrderFixture.resource.type, purchaseOrderFixture.resource.version)],
  summary: "Supplier confirmed ready date", uncertainty: 0.08,
});

export const seedProductPositiveFixtures = Object.freeze({
  approvalDecision: approvalDecisionFixture,
  authorityPolicy: authorityPolicyFixture,
  bidComparison: bidComparisonFixture,
  evidenceArtifact: evidenceArtifactFixture,
  fieldChangeProposal: fieldChangeProposalFixture,
  installationRecord: installationRecordFixture,
  outcomeReceipt: outcomeReceiptFixture,
  package: packageFixture,
  productCandidate: productCandidateFixture,
  productSource: productSourceFixture,
  project: projectFixture,
  projectPackage: projectPackageFixture,
  proposalLine: proposalLineFixture,
  proposalTemplate: proposalTemplateFixture,
  proposalVersion: proposalVersionFixture,
  purchaseOrder: purchaseOrderFixture,
  purchaseOrderAcknowledgement: purchaseOrderAcknowledgementFixture,
  receivingRecord: receivingRecordFixture,
  rfq: rfqFixture,
  shipment: shipmentFixture,
  space: spaceFixture,
  specification: specificationFixture,
  specificationLine: specificationLineFixture,
  supplierQuote: supplierQuoteFixture,
  sultanReviewItem: sultanReviewItemFixture,
  timelineEvent: timelineEventFixture,
});
