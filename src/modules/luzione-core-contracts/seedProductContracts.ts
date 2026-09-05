export const SEED_PRODUCT_CONTRACT_BUNDLE_VERSION = "LuzioneSeedProductContracts/v1";

export const SEED_PRODUCT_CONTRACT_VERSIONS = Object.freeze({
  approvalDecision: "ApprovalDecision/v1",
  authorityPolicy: "AuthorityPolicy/v1",
  bidComparison: "BidComparison/v1",
  evidenceArtifact: "EvidenceArtifact/v1",
  fieldChangeProposal: "FieldChangeProposal/v1",
  installationRecord: "InstallationRecord/v1",
  outcomeReceipt: "OutcomeReceipt/v1",
  package: "Package/v1",
  productCandidate: "ProductCandidate/v1",
  productSource: "ProductSource/v1",
  project: "Project/v1",
  projectPackage: "ProjectPackage/v1",
  proposalLine: "ProposalLine/v1",
  proposalTemplate: "ProposalTemplate/v1",
  proposalVersion: "ProposalVersion/v1",
  purchaseOrder: "PurchaseOrder/v1",
  purchaseOrderAcknowledgement: "PurchaseOrderAcknowledgement/v1",
  receivingRecord: "ReceivingRecord/v1",
  rfq: "RFQ/v1",
  shipment: "Shipment/v1",
  space: "Space/v1",
  specification: "Specification/v1",
  specificationLine: "SpecificationLine/v1",
  supplierQuote: "SupplierQuote/v1",
  sultanReviewItem: "SultanReviewItem/v1",
  timelineEvent: "TimelineEvent/v1",
} as const);

export type SeedProductContractVersion =
  (typeof SEED_PRODUCT_CONTRACT_VERSIONS)[keyof typeof SEED_PRODUCT_CONTRACT_VERSIONS];

export type SeedJsonValue = string | number | boolean | null | SeedJsonValue[] | { [key: string]: SeedJsonValue };

export type SeedSourceRefV1 = {
  objectId: string;
  objectType: string;
  ownerProject: string;
  tenantId: string;
  version: string;
};

export type SeedMutationBoundaryV1 = {
  expectedVersion: string | null;
  idempotencyKey: string;
  payloadHash: string;
};

export type SeedAuthorityBoundaryV1 = {
  actorId: string;
  actorType: "HUMAN" | "SERVICE" | "SULTAN_AGENT";
  approvalRef: string | null;
  capability: string;
  decision: "ALLOW" | "DENY" | "REQUIRE_HUMAN";
  effectClass: "A0" | "A1" | "A2" | "A3" | "A4";
  policyVersion: string;
  serverDerivedIdentityRef: string;
};

export type SeedReceiptReadbackV1 = {
  committedVersion: string;
  finality: "DOMAIN_COMMITTED" | "PROVIDER_ACKNOWLEDGED" | "RECONCILING" | "SOURCE_CONFIRMED";
  observedAt: string | null;
  observedVersion: string | null;
  providerAcknowledgementRef: string | null;
  receiptId: string;
  sourceReadbackRef: string | null;
};

export type SeedResourceV1<
  ContractVersion extends SeedProductContractVersion,
  ResourceType extends string,
  Status extends string,
  Data,
> = {
  authority: SeedAuthorityBoundaryV1;
  contractVersion: ContractVersion;
  createdAt: string;
  data: Data;
  mutation: SeedMutationBoundaryV1;
  receipt: SeedReceiptReadbackV1;
  resource: {
    archivedAt: string | null;
    id: string;
    status: Status;
    type: ResourceType;
    version: string;
  };
  sourceRefs: readonly SeedSourceRefV1[];
  tenantId: string;
  updatedAt: string;
};

export type MoneyV1 = { amountMinor: number; currency: string };
export type ConfidenceV1 = { score: number; sourceFreshAt: string | null };

export type ProjectV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.project, "PROJECT", "ACTIVE" | "ARCHIVED" | "DRAFT" | "ON_HOLD", {
  accountId: string;
  budget: MoneyV1 | null;
  name: string;
  opportunityId: string | null;
  ownerId: string;
  targetEndAt: string | null;
  targetStartAt: string | null;
}>;

export type SpaceV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.space, "SPACE", "ACTIVE" | "ARCHIVED" | "DRAFT", {
  floor: string | null;
  kind: "AREA" | "EXTERIOR" | "ROOM" | "WHOLE_HOME";
  name: string;
  projectId: string;
  sequence: number;
}>;

export type SpecificationV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.specification, "SPECIFICATION", "ACTIVE_PROCUREMENT" | "APPROVED" | "ARCHIVED" | "DRAFT" | "REVISION_PROPOSED", {
  activatedAt: string | null;
  plannerPackageId: string;
  projectId: string;
  publishedPackageVersion: string;
  revisionOfVersion: string | null;
  spaceIds: readonly string[];
  title: string;
}>;

export type SpecificationLineV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.specificationLine, "SPECIFICATION_LINE", "APPROVED" | "ARCHIVED" | "DRAFT" | "SOURCING" | "SUBSTITUTION_PROPOSED", {
  approvalState: "APPROVED" | "PENDING" | "REJECTED";
  deliveryRisk: "HIGH" | "LOW" | "MEDIUM" | "UNKNOWN";
  description: string;
  productCandidateIds: readonly string[];
  quantity: number;
  selectedCandidateId: string | null;
  sourcingState: "AWARDED" | "NOT_STARTED" | "QUOTED" | "RFQ_OPEN";
  spaceId: string;
  specificationId: string;
  unit: string;
}>;

export type ProjectPackageV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.projectPackage, "PROJECT_PACKAGE", "ARCHIVED" | "PUBLISHED" | "SUPERSEDED", {
  assetRefs: readonly string[];
  canonicalProjectId: string | null;
  plannerProjectRef: SeedSourceRefV1;
  provenanceRefs: readonly string[];
  publishedAt: string;
  sourceVersionHash: string;
  spaceRefs: readonly SeedSourceRefV1[];
  specificationRefs: readonly SeedSourceRefV1[];
  uncertainty: readonly { fieldPath: string; reason: string; score: number }[];
}>;

export type ProductCandidateV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.productCandidate, "PRODUCT_CANDIDATE", "ARCHIVED" | "ELIGIBLE" | "REJECTED" | "REVIEW_REQUIRED" | "SELECTED", {
  attributes: Readonly<Record<string, string>>;
  confidence: ConfidenceV1;
  lane: "APPROVED_VENDOR" | "LUZIONE_MADE_TO_ORDER" | "LUZIONE_QUICK_SHIP" | "OUTSIDE_PRODUCT";
  leadTimeDays: number | null;
  price: MoneyV1 | null;
  productSourceId: string;
  sku: string | null;
  title: string;
  vendorId: string | null;
}>;

export type ProductSourceV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.productSource, "PRODUCT_SOURCE", "ACTIVE" | "ARCHIVED" | "CONFLICT" | "REVIEW_REQUIRED", {
  contentDigest: string;
  kind: "MANUAL" | "PDF" | "ROOM_PLANNER" | "SHOPIFY" | "URL" | "XLSX";
  locator: string;
  observedAt: string;
  sourceArtifactRef: string;
  validUntil: string | null;
}>;

export type ProposalTemplateV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.proposalTemplate, "PROPOSAL_TEMPLATE", "ACTIVE" | "ARCHIVED" | "INVALID" | "VALIDATING", {
  contentDigest: string;
  format: "DOCX" | "HTML" | "PDF_ACROFORM" | "PDF_OVERLAY";
  mergeTokens: readonly string[];
  name: string;
  storageObjectRef: string;
  validationIssues: readonly string[];
}>;

export type ProposalVersionV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.proposalVersion, "PROPOSAL_VERSION", "ACCEPTED" | "ARCHIVED" | "DRAFT" | "REJECTED" | "SENT" | "SUPERSEDED", {
  currency: string;
  decisionState: "ACCEPTED" | "MIXED" | "PENDING" | "REJECTED";
  lineIds: readonly string[];
  pdfArtifactRef: string | null;
  projectId: string;
  revision: number;
  templateId: string;
  totalMinor: number;
  webViewRef: string | null;
}>;

export type ProposalLineV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.proposalLine, "PROPOSAL_LINE", "ACTIVE" | "ARCHIVED" | "OPTIONAL" | "REMOVED", {
  confidence: ConfidenceV1;
  costMinor: number;
  description: string;
  landedCostMinor: number;
  lineType: "DELIVERY_INSTALLATION" | "DESIGN_FEE" | "DISCOUNT" | "FREIGHT" | "PROCUREMENT_FEE" | "PRODUCT" | "SERVICE_FEE" | "TAX";
  optionGroupId: string | null;
  proposalVersionId: string;
  quantity: number;
  sourceRef: string;
  totalMinor: number;
  unitPriceMinor: number;
}>;

export type ApprovalDecisionV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.approvalDecision, "APPROVAL_DECISION", "ACTIVE" | "REVOKED" | "SUPERSEDED", {
  comment: string | null;
  decidedAt: string;
  decidedBy: string;
  decision: "APPROVE" | "CHANGE_REQUESTED" | "REJECT";
  evidenceRefs: readonly string[];
  proposalVersionId: string;
  proposalVersion: string;
  scope: "ITEM" | "OPTION_GROUP" | "PROPOSAL" | "SECTION";
  targetId: string;
}>;

export type RFQV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.rfq, "RFQ", "ARCHIVED" | "CANCELLED" | "DRAFT" | "OPEN" | "RESPONDED" | "SENT", {
  dueAt: string;
  projectId: string;
  requestedFields: readonly string[];
  specificationId: string;
  specificationLineIds: readonly string[];
  supplierId: string;
}>;

export type SupplierQuoteV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.supplierQuote, "SUPPLIER_QUOTE", "ARCHIVED" | "NORMALIZED" | "REJECTED" | "REVIEW_REQUIRED" | "SELECTED", {
  evidenceArtifactId: string;
  lines: readonly {
    incoterm: string | null;
    leadTimeDays: number | null;
    packageFacts: string | null;
    paymentTerms: string | null;
    quantity: number;
    rfqLineId: string;
    unitPrice: MoneyV1;
    warranty: string | null;
  }[];
  responseSource: "EMAIL" | "MANUAL" | "PORTAL";
  rfqId: string;
  supplierId: string;
  validUntil: string | null;
}>;

export type BidComparisonV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.bidComparison, "BID_COMPARISON", "APPROVED" | "ARCHIVED" | "DRAFT" | "REVIEW_REQUIRED", {
  basisCurrency: string;
  recommendationEvidenceRefs: readonly string[];
  recommendedSupplierQuoteId: string | null;
  rfqIds: readonly string[];
  rows: readonly { landedTotalMinor: number; marginMinor: number; score: number; supplierQuoteId: string }[];
  selectedByHumanApprovalRef: string | null;
  supplierQuoteIds: readonly string[];
}>;

export type PurchaseOrderV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.purchaseOrder, "PURCHASE_ORDER", "ACKNOWLEDGED" | "ARCHIVED" | "DRAFT" | "RELEASED" | "VOID", {
  bidComparisonId: string;
  currency: string;
  lineRefs: readonly SeedSourceRefV1[];
  proposalVersionId: string;
  releaseApprovalRef: string | null;
  supplierId: string;
  supplierQuoteId: string;
  totalMinor: number;
}>;

export type PurchaseOrderAcknowledgementV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.purchaseOrderAcknowledgement, "PURCHASE_ORDER_ACKNOWLEDGEMENT", "CONFLICT" | "PROVIDER_ACKNOWLEDGED" | "SOURCE_CONFIRMED", {
  acknowledgedPurchaseOrderVersion: string;
  expectedReadyAt: string | null;
  purchaseOrderId: string;
  supplierId: string;
  variances: readonly { fieldPath: string; proposedValue: SeedJsonValue }[];
}>;

export type ShipmentV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.shipment, "SHIPMENT", "CANCELLED" | "DELIVERED" | "EXCEPTION" | "IN_TRANSIT" | "PLANNED" | "READY", {
  carrier: string | null;
  expectedDeliveryAt: string | null;
  purchaseOrderIds: readonly string[];
  risk: "HIGH" | "LOW" | "MEDIUM" | "UNKNOWN";
  supplierId: string;
  trackingNumber: string | null;
}>;

export type PackageV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.package, "PACKAGE", "DAMAGED" | "DELIVERED" | "IN_TRANSIT" | "MISSING" | "PLANNED" | "RECEIVED", {
  dimensions: { height: number; length: number; unit: string; width: number } | null;
  label: string;
  quantity: number;
  shipmentId: string;
  trackingNumber: string | null;
  weight: { unit: string; value: number } | null;
}>;

export type ReceivingRecordV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.receivingRecord, "RECEIVING_RECORD", "COMPLETE" | "DISCREPANCY" | "DRAFT", {
  counts: { damaged: number; expected: number; missing: number; received: number };
  discrepancyEvidenceRefs: readonly string[];
  packageIds: readonly string[];
  receivedAt: string;
  receivedBy: string;
  shipmentId: string;
}>;

export type InstallationRecordV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.installationRecord, "INSTALLATION_RECORD", "CANCELLED" | "COMPLETE" | "IN_PROGRESS" | "ISSUE" | "SCHEDULED", {
  completedAt: string | null;
  installerId: string;
  issueEvidenceRefs: readonly string[];
  projectId: string;
  scheduledAt: string;
  spaceIds: readonly string[];
  startedAt: string | null;
}>;

export type TimelineEventV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent, "TIMELINE_EVENT", "ACTIVE" | "ARCHIVED", {
  aggregateRefs: readonly SeedSourceRefV1[];
  actorId: string;
  eventType: string;
  evidenceRefs: readonly string[];
  occurredAt: string;
  recordedAt: string;
  summary: string;
  visibility: "CLIENT" | "INTERNAL" | "PARTNER" | "SUPPLIER";
}>;

export type EvidenceArtifactV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.evidenceArtifact, "EVIDENCE_ARTIFACT", "ACTIVE" | "ARCHIVED" | "QUARANTINED" | "REVIEW_REQUIRED", {
  capturedAt: string;
  confidence: number;
  contentDigest: string;
  kind: "CALENDAR" | "DOCUMENT" | "EMAIL" | "MEETING_TRANSCRIPT" | "PORTAL_FORM" | "UPLOAD";
  mimeType: string;
  promptInjectionState: "CLEAR" | "DETECTED" | "NOT_ASSESSED";
  provider: string;
  sourceRecordRef: string;
  storageRef: string;
}>;

export type FieldChangeProposalV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.fieldChangeProposal, "FIELD_CHANGE_PROPOSAL", "ACCEPTED" | "CONFLICT" | "EDITED" | "PENDING" | "REJECTED", {
  confidence: number;
  conflictVersion: string | null;
  evidenceRefs: readonly string[];
  fieldPath: string;
  newValue: SeedJsonValue;
  oldValue: SeedJsonValue;
  targetId: string;
  targetType: string;
  targetVersion: string;
}>;

export type SultanReviewItemV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.sultanReviewItem, "SULTAN_REVIEW_ITEM", "ACCEPTED" | "APPLIED" | "EDITED" | "PENDING" | "REJECTED", {
  authorityPolicyId: string;
  critic: { dissent: string | null; score: number };
  evidenceRefs: readonly string[];
  outcomeReceiptId: string | null;
  recommendation: string;
  reviewType: "CLIENT_COMMUNICATION" | "FIELD_CHANGE" | "PO_ACTION" | "PROPOSAL" | "RECOVERY" | "RFQ" | "SOURCING" | "SUPPLIER_UPDATE";
  subjectRefs: readonly SeedSourceRefV1[];
  summary: string;
  uncertainty: number;
}>;

export type AuthorityPolicyV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.authorityPolicy, "AUTHORITY_POLICY", "ACTIVE" | "ARCHIVED" | "DISABLED", {
  capabilityRules: readonly { capability: string; mode: "APPROVAL_REQUIRED" | "AUTO_APPLY_REVERSIBLE" | "OBSERVE" | "PREPARE" | "RECOMMEND" }[];
  effectCeiling: "A0" | "A1" | "A2" | "A3";
  fieldRules: readonly { fieldPath: string; mode: "APPROVAL_REQUIRED" | "AUTO_APPLY_REVERSIBLE" | "OBSERVE" | "PREPARE" | "RECOMMEND" }[];
  killSwitchActive: boolean;
  scopeRef: string;
}>;

export type OutcomeReceiptV1 = SeedResourceV1<typeof SEED_PRODUCT_CONTRACT_VERSIONS.outcomeReceipt, "OUTCOME_RECEIPT", "FAILED" | "INDETERMINATE" | "OWNER_COMMITTED" | "SOURCE_CONFIRMED", {
  actionType: string;
  actualEffect: "NONE" | "PROVIDER_ACKNOWLEDGED" | "REVERSIBLE_INTERNAL" | "SOURCE_CONFIRMED";
  operationId: string;
  result: "FAILED" | "INDETERMINATE" | "SUCCEEDED";
  subjectRef: SeedSourceRefV1;
  value: {
    cycleTimeSecondsSaved: number;
    marginProtectedMinor: number;
    opportunityCreatedMinor: number;
    riskAvoidedMinor: number;
    timeSavedSeconds: number;
  };
}>;

export type LuzioneSeedProductContractDocument =
  | ApprovalDecisionV1 | AuthorityPolicyV1 | BidComparisonV1 | EvidenceArtifactV1
  | FieldChangeProposalV1 | InstallationRecordV1 | OutcomeReceiptV1 | PackageV1
  | ProductCandidateV1 | ProductSourceV1 | ProjectPackageV1 | ProjectV1
  | ProposalLineV1 | ProposalTemplateV1 | ProposalVersionV1 | PurchaseOrderAcknowledgementV1
  | PurchaseOrderV1 | ReceivingRecordV1 | RFQV1 | ShipmentV1 | SpaceV1
  | SpecificationLineV1 | SpecificationV1 | SultanReviewItemV1 | SupplierQuoteV1
  | TimelineEventV1;
