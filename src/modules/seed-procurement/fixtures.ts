import {
  evidenceArtifactFixture,
  productCandidateFixture,
  productSourceFixture,
} from "@/modules/luzione-core-contracts/seedProductFixtures";
import { REQUEST_IDENTITY_CONTRACT_VERSION } from "@/modules/platform-contracts/requestIdentity";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import {
  SEED_PROCUREMENT_COMMAND_VERSION,
  type ObjectiveFit,
} from "@/modules/seed-procurement/contracts";
import { createSeedProcurementReadModel } from "@/modules/seed-procurement/readModel";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const objectiveFitFixture: ObjectiveFit = {
  inputs: { leadTime: 0.7, margin: 0.8, price: 0.9, sourceFreshness: 1, specificationMatch: 0.95, supplierReliability: 0.75 },
  weights: { leadTime: 0.15, margin: 0.15, price: 0.2, sourceFreshness: 0.1, specificationMatch: 0.3, supplierReliability: 0.1 },
};

const common = (commandId: string, commandType: string) => ({ commandId, commandType, contractVersion: SEED_PROCUREMENT_COMMAND_VERSION, expectedVersion: "ABSENT", idempotencyKey: `idempotency-${commandId}` });
export const projectRefFixture = { projectId: "project-1", projectVersion: "project:project-1:v1" };

export const evidenceRegisterCommandFixture = {
  ...common("evidence-product-1", "evidence_artifact.register"),
  artifact: { capturedAt: "2026-09-05T09:30:00.000Z", confidence: 0.95, contentDigest: "a".repeat(64), kind: "UPLOAD", mimeType: "text/csv", promptInjectionState: "NOT_ASSESSED", provider: "OPERATOR_UPLOAD", sourceRecordRef: "upload-product-1", storageRef: "private-object:upload-product-1" },
  projectRef: projectRefFixture,
};

export const productSourceCommandFixture = {
  ...common("product-source-1", "product_source.record"),
  artifactId: "evidence-artifact-1",
  artifactVersion: "evidence-artifact:evidence-artifact-1:v1",
  conflictRefs: [],
  duplicateOfSourceId: null,
  extractionProvenance: ["fixture-parser:csv-v1"],
  ingestionFormat: "CSV",
  projectRef: projectRefFixture,
  source: { contentDigest: "a".repeat(64), kind: "XLSX", locator: "private-object:upload-product-1", observedAt: "2026-09-05T09:30:00.000Z", validUntil: "2026-10-05T09:30:00.000Z" },
};

export const productCandidateCommandFixture = {
  ...common("product-candidate-1", "product_candidate.record"),
  candidate: { attributes: { material: "oak", width: "220cm" }, confidence: { score: 0.92, sourceFreshAt: "2026-09-05T09:30:00.000Z" }, lane: "OUTSIDE_PRODUCT", leadTimeDays: 42, price: { amountMinor: 300000, currency: "USD" }, sku: "SOFA-220-OAK", title: "Oak Frame Sofa", vendorId: null },
  conflictRefs: [],
  duplicateOfCandidateId: null,
  extractionProvenance: ["fixture-parser:csv-v1:row-2"],
  fit: objectiveFitFixture,
  productIdentityRef: "product-identity:sofa-220-oak",
  productSourceId: "product-source-1",
  productSourceVersion: "product-source:product-source-1:v1",
  projectRef: projectRefFixture,
};

export const rfqDraftCommandFixture = {
  ...common("rfq-1", "rfq.create_draft"),
  ...projectRefFixture,
  dueAt: "2026-09-12T00:00:00.000Z",
  evidenceRefs: ["evidence:specification-1"],
  requestedFields: ["unit_price", "lead_time", "incoterm"],
  specificationId: "specification-1",
  specificationLines: [{ specificationLineId: "specification-line-1", specificationLineVersion: "specification-line:specification-line-1:v1" }],
  specificationVersion: "specification:specification-1:v1",
  supplierId: "supplier-account-1",
};

const quoteLine = { clientUnitPriceMinor: 575000, dutyMinor: 12000, freightMinor: 28000, incoterm: "FOB", leadTimeDays: 42, objectiveFit: objectiveFitFixture, packageFacts: "1 carton", paymentTerms: "50/50", quantity: 1, reserveMinor: 10000, rfqLineId: "specification-line-1", unitPrice: { amountMinor: 300000, currency: "USD" }, warranty: "2 years" };
export const supplierQuoteCommandFixture = { ...common("supplier-quote-1", "supplier_quote.normalize"), ...projectRefFixture, evidenceArtifactId: "evidence-artifact-quote-1", evidenceArtifactVersion: "evidence-artifact:evidence-artifact-quote-1:v1", lines: [quoteLine], responseSource: "EMAIL", reviewReasons: [], rfqId: "rfq-1", rfqVersion: "rfq:rfq-1:v1", supplierId: "supplier-account-1", validUntil: "2026-10-05T00:00:00.000Z" };
export const bidComparisonCommandFixture = { ...common("bid-1", "bid_comparison.create"), ...projectRefFixture, basisCurrency: "USD", criticDissent: "Lead-time evidence is supplier-provided only.", recommendationEvidenceRefs: ["evidence:bid-score-1"], recommendedSupplierQuoteId: "supplier-quote-1", rfqs: [{ rfqId: "rfq-1", rfqVersion: "rfq:rfq-1:v1" }], specificationId: "specification-1", specificationVersion: "specification:specification-1:v1", supplierQuotes: [{ supplierQuoteId: "supplier-quote-1", supplierQuoteVersion: "supplier-quote:supplier-quote-1:v1" }, { supplierQuoteId: "supplier-quote-2", supplierQuoteVersion: "supplier-quote:supplier-quote-2:v1" }] };
export const procurementSelectionCommandFixture = { ...common("selection-1", "procurement_selection.record"), ...projectRefFixture, bidComparisonId: "bid-comparison-1", decision: "SELECT", evidenceRefs: ["evidence:operator-selection-1"], expectedVersion: "bid-comparison:bid-comparison-1:v1", rationale: "Best combined landed cost and lead time.", selectedSupplierQuoteId: "supplier-quote-1" };
export const purchaseOrderDraftCommandFixture = { ...common("po-1", "purchase_order.create_draft"), ...projectRefFixture, bidComparisonId: "bid-comparison-1", expectedVersion: "bid-comparison:bid-comparison-1:v2", lineRefs: [{ objectId: "specification-line-1", objectType: "SPECIFICATION_LINE", ownerProject: "LUZIONE_PROJECT", version: "specification-line:specification-line-1:v1" }], proposalVersion: "proposal-version:proposal-1:v3", proposalVersionId: "proposal-1", selectionDecisionId: "selection-1", selectionDecisionVersion: "procurement-selection:selection-1:v1" };
export const purchaseOrderAcknowledgementCommandFixture = { ...common("po-ack-1", "purchase_order_acknowledgement.record"), ...projectRefFixture, acknowledgementState: "PROVIDER_ACKNOWLEDGED", evidenceArtifactId: "evidence-artifact-ack-1", evidenceArtifactVersion: "evidence-artifact:evidence-artifact-ack-1:v1", expectedReadyAt: "2026-10-20T00:00:00.000Z", expectedVersion: "purchase-order:purchase-order-1:v1", purchaseOrderId: "purchase-order-1", supplierId: "supplier-account-1", variances: [] };

export const seedProcurementPositiveFixture = createSeedProcurementReadModel({
  acknowledgements: [],
  bidComparisons: [],
  blockedDependencies: [
    { affectedCapabilities: ["rfq.create_draft", "supplier_quote.normalize"], code: "SUPPLIER_ELIGIBILITY_UNVERIFIED", requiredContract: "SupplierProfile/v1", summary: "Tenant Account identity does not attest supplier eligibility." },
    { affectedCapabilities: ["purchase_order.create_draft", "purchase_order_acknowledgement.record"], code: "PROPOSAL_CANONICAL_READER_UNAVAILABLE", requiredContract: "ProposalVersion/v1 canonical API readback", summary: "A canonical tenant and project-bound ProposalVersion reader is not admitted." },
  ],
  evidenceArtifacts: [{ projectId: "project-1", resource: evidenceArtifactFixture }],
  productCandidates: [{ conflictRefs: [], duplicateOfCandidateId: null, extractionProvenance: ["fixture-parser:row-1"], fit: { ...objectiveFitFixture, score: 0.865 }, projectId: "project-1", resource: productCandidateFixture }],
  productSources: [{ conflictRefs: [], duplicateOfSourceId: null, extractionProvenance: ["fixture-parser:v1"], ingestionFormat: "URL", projectId: "project-1", resource: productSourceFixture }],
  purchaseOrders: [], rfqs: [], selectionDecisions: [], supplierQuotes: [], timeline: [],
}, { observedAt: "2026-09-05T09:30:00.000Z", projectId: "project-1", releaseIdentity: createReleaseIdentity({ environment: { LUZIONE_BUILD_TIME: "2026-09-05T09:29:00.000Z", VERCEL_GIT_COMMIT_SHA: "1111111111111111111111111111111111111111" }, mutationsEnabled: false }), tenantId: productSourceFixture.tenantId });

export const seedProcurementHttpResponsePositiveFixture = {
  correlationId: "correlation-seed-procurement-fixture",
  ok: true,
  requestId: "request-seed-procurement-fixture",
  requestIdentityContractVersion: REQUEST_IDENTITY_CONTRACT_VERSION,
  responseContractVersion: API_HTTP_RESPONSE_VERSION,
  result: seedProcurementPositiveFixture,
  traceId: "1234567890abcdef1234567890abcdef",
} as const;
