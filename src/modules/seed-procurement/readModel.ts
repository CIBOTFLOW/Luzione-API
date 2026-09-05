import {
  parseBidComparisonV1,
  parseEvidenceArtifactV1,
  parseProductCandidateV1,
  parseProductSourceV1,
  parsePurchaseOrderAcknowledgementV1,
  parsePurchaseOrderV1,
  parseRFQV1,
  parseSupplierQuoteV1,
  parseTimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import type {
  BidComparisonV1,
  EvidenceArtifactV1,
  ProductCandidateV1,
  ProductSourceV1,
  PurchaseOrderAcknowledgementV1,
  PurchaseOrderV1,
  RFQV1,
  SupplierQuoteV1,
  TimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductContracts";
import { releaseIdentityViolations, type ReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import {
  SEED_PROCUREMENT_READ_MODEL_VERSION,
  type ObjectiveFit,
} from "@/modules/seed-procurement/contracts";
import { objectiveScore, type NormalizedQuoteEconomics } from "@/modules/seed-procurement/model";
import { API_HTTP_RESPONSE_VERSION, PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA, SEED_PRODUCT_CONTRACT_PRODUCER_SHA } from "@/modules/seed-project-publication/readModel";

export const SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA = "d6d1c98e42ddc168e3b2eac629e74214f3102ba0";
export const PROCUREMENT_SELECTION_DECISION_VERSION = "ProcurementSelectionDecision/v1";

export const SEED_PROCUREMENT_HTTP_ROUTES = Object.freeze({
  commandCollection: "/api/v1/procurement/commands",
  projectProcurement: "/api/v1/projects/:projectId/procurement",
});

export type ProcurementSelectionDecisionV1 = {
  actor: { actorId: string; actorType: "HUMAN"; serverDerivedIdentityRef: string };
  bidComparisonId: string;
  contractVersion: typeof PROCUREMENT_SELECTION_DECISION_VERSION;
  createdAt: string;
  decision: "SELECT";
  evidenceRefs: string[];
  mutation: { expectedVersion: string; idempotencyKey: string; payloadHash: string };
  projectId: string;
  rationale: string;
  receipt: { committedVersion: string; finality: "DOMAIN_COMMITTED"; receiptId: string };
  resource: { id: string; status: "ACTIVE"; version: string };
  selectedSupplierQuoteId: string;
  tenantId: string;
};

export type SeedProcurementReadModelData = {
  acknowledgements: PurchaseOrderAcknowledgementV1[];
  bidComparisons: BidComparisonV1[];
  blockedDependencies: Array<{ affectedCapabilities: string[]; code: string; requiredContract: string; summary: string }>;
  evidenceArtifacts: Array<{ projectId: string | null; resource: EvidenceArtifactV1 }>;
  productCandidates: Array<{ conflictRefs: string[]; duplicateOfCandidateId: string | null; extractionProvenance: string[]; fit: ObjectiveFit & { score: number }; projectId: string | null; resource: ProductCandidateV1 }>;
  productSources: Array<{ conflictRefs: string[]; duplicateOfSourceId: string | null; extractionProvenance: string[]; ingestionFormat: string; projectId: string | null; resource: ProductSourceV1 }>;
  purchaseOrders: PurchaseOrderV1[];
  rfqs: RFQV1[];
  selectionDecisions: ProcurementSelectionDecisionV1[];
  supplierQuotes: Array<{ economics: NormalizedQuoteEconomics; resource: SupplierQuoteV1 }>;
  timeline: TimelineEventV1[];
};

export type SeedProcurementReadModelV1 = SeedProcurementReadModelData & {
  contractVersion: typeof SEED_PROCUREMENT_READ_MODEL_VERSION;
  metadata: {
    apiResponseContractVersion: typeof API_HTTP_RESPONSE_VERSION;
    observedAt: string;
    procurementContractProducerSha: typeof SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA;
    producerRepository: "CIBOTFLOW/Luzione-API";
    projectId: string;
    releaseIdentity: ReleaseIdentity;
    scheduleContractProducerSha: typeof PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA;
    seedProductContractProducerSha: typeof SEED_PRODUCT_CONTRACT_PRODUCER_SHA;
    tenantId: string;
  };
};

export class SeedProcurementReadModelError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SeedProcurementReadModelError";
  }
}

type JsonObject = Record<string, unknown>;
function fail(code: string, message: string): never { throw new SeedProcurementReadModelError(code, message); }
function object(value: unknown, path: string): JsonObject { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_VALUE", `${path} must be an object.`); return value as JsonObject; }
function exact(value: unknown, keys: readonly string[], path: string) { const parsed = object(value, path); const expected = [...keys].sort(); const actual = Object.keys(parsed).sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("FIELD_SET_MISMATCH", `${path} fields must be exactly ${expected.join(", ")}.`); return parsed; }
function array(value: unknown, path: string) { if (!Array.isArray(value)) fail("INVALID_VALUE", `${path} must be an array.`); return value; }
function bounded(value: unknown, path: string) { if (typeof value !== "string" || value.length < 2 || value.length > 512) fail("INVALID_VALUE", `${path} must be bounded text.`); return value; }
function nullableId(value: unknown, path: string) { return value === null ? null : bounded(value, path); }
function strings(value: unknown, path: string) { return array(value, path).map((item, index) => bounded(item, `${path}[${index}]`)); }
function timestamp(value: unknown, path: string) { const parsed = bounded(value, path); if (!Number.isFinite(Date.parse(parsed))) fail("INVALID_VALUE", `${path} must be an ISO timestamp.`); return parsed; }
function sameTenant(tenantId: string, resource: { tenantId: string }, path: string) { if (resource.tenantId !== tenantId) fail("TENANT_MISMATCH", `${path} crosses the authenticated tenant.`); }
function unitInterval(value: unknown, path: string) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail("INVALID_VALUE", `${path} must be a finite number from zero through one.`); return value; }

function parseFit(value: unknown, path: string) {
  const parsed = exact(value, ["inputs", "score", "weights"], path);
  const keys = ["leadTime", "margin", "price", "sourceFreshness", "specificationMatch", "supplierReliability"] as const;
  const rawInputs = exact(parsed.inputs, keys, `${path}.inputs`);
  const rawWeights = exact(parsed.weights, keys, `${path}.weights`);
  const inputs = Object.fromEntries(keys.map((key) => [key, unitInterval(rawInputs[key], `${path}.inputs.${key}`)])) as ObjectiveFit["inputs"];
  const weights = Object.fromEntries(keys.map((key) => [key, unitInterval(rawWeights[key], `${path}.weights.${key}`)])) as ObjectiveFit["weights"];
  if (Object.values(weights).reduce((sum, weight) => sum + weight, 0) <= 0) fail("INVALID_VALUE", `${path}.weights must have positive total weight.`);
  const score = unitInterval(parsed.score, `${path}.score`);
  if (objectiveScore({ inputs, weights }) !== score) fail("OBJECTIVE_SCORE_MISMATCH", `${path}.score does not reconcile to disclosed inputs and weights.`);
  return { inputs, score, weights };
}

function parseEconomics(value: unknown, path: string): NormalizedQuoteEconomics {
  const parsed = exact(value, ["basisCurrency", "clientPriceTotalMinor", "landedTotalMinor", "lines", "marginMinor", "objectiveFitScore", "supplierCostTotalMinor"], path);
  const lines = array(parsed.lines, `${path}.lines`).map((value, index) => {
    const line = exact(value, ["clientPriceTotalMinor", "dutyMinor", "freightMinor", "landedTotalMinor", "marginMinor", "objectiveFitScore", "quantity", "reserveMinor", "rfqLineId", "supplierCostTotalMinor"], `${path}.lines[${index}]`);
    return line as NormalizedQuoteEconomics["lines"][number];
  });
  const economics = { ...parsed, lines } as unknown as NormalizedQuoteEconomics;
  const supplierTotal = lines.reduce((sum, line) => sum + Number(line.supplierCostTotalMinor), 0);
  const landedTotal = lines.reduce((sum, line) => sum + Number(line.landedTotalMinor), 0);
  const clientTotal = lines.reduce((sum, line) => sum + Number(line.clientPriceTotalMinor), 0);
  if (supplierTotal !== Number(economics.supplierCostTotalMinor) || landedTotal !== Number(economics.landedTotalMinor) || clientTotal !== Number(economics.clientPriceTotalMinor) || clientTotal - landedTotal !== Number(economics.marginMinor) || landedTotal < supplierTotal) {
    fail("ECONOMICS_MISMATCH", `${path} totals do not reconcile.`);
  }
  return economics;
}

function parseSelection(value: unknown, tenantId: string, projectId: string): ProcurementSelectionDecisionV1 {
  const input = exact(value, ["actor", "bidComparisonId", "contractVersion", "createdAt", "decision", "evidenceRefs", "mutation", "projectId", "rationale", "receipt", "resource", "selectedSupplierQuoteId", "tenantId"], "selectionDecision");
  if (input.contractVersion !== PROCUREMENT_SELECTION_DECISION_VERSION) fail("UNSUPPORTED_CONTRACT_VERSION", "Unexpected procurement selection decision version.");
  if (input.tenantId !== tenantId || input.projectId !== projectId) fail("TENANT_MISMATCH", "Selection decision crosses its Project boundary.");
  const actor = exact(input.actor, ["actorId", "actorType", "serverDerivedIdentityRef"], "selectionDecision.actor");
  if (actor.actorType !== "HUMAN") fail("AUTHORITY_DENIED", "Procurement selection requires a credential-bound human actor.");
  const mutation = exact(input.mutation, ["expectedVersion", "idempotencyKey", "payloadHash"], "selectionDecision.mutation");
  const receipt = exact(input.receipt, ["committedVersion", "finality", "receiptId"], "selectionDecision.receipt");
  const resource = exact(input.resource, ["id", "status", "version"], "selectionDecision.resource");
  if (input.decision !== "SELECT" || resource.status !== "ACTIVE" || receipt.finality !== "DOMAIN_COMMITTED" || receipt.committedVersion !== resource.version) fail("FINALITY_MISMATCH", "Selection decision receipt is invalid.");
  return { actor: { actorId: bounded(actor.actorId, "actorId"), actorType: "HUMAN", serverDerivedIdentityRef: bounded(actor.serverDerivedIdentityRef, "identityRef") }, bidComparisonId: bounded(input.bidComparisonId, "bidComparisonId"), contractVersion: PROCUREMENT_SELECTION_DECISION_VERSION, createdAt: timestamp(input.createdAt, "createdAt"), decision: "SELECT", evidenceRefs: strings(input.evidenceRefs, "evidenceRefs"), mutation: { expectedVersion: bounded(mutation.expectedVersion, "expectedVersion"), idempotencyKey: bounded(mutation.idempotencyKey, "idempotencyKey"), payloadHash: bounded(mutation.payloadHash, "payloadHash") }, projectId, rationale: bounded(input.rationale, "rationale"), receipt: { committedVersion: bounded(receipt.committedVersion, "committedVersion"), finality: "DOMAIN_COMMITTED", receiptId: bounded(receipt.receiptId, "receiptId") }, resource: { id: bounded(resource.id, "resource.id"), status: "ACTIVE", version: bounded(resource.version, "resource.version") }, selectedSupplierQuoteId: bounded(input.selectedSupplierQuoteId, "selectedSupplierQuoteId"), tenantId };
}

export function parseSeedProcurementReadModel(value: unknown): SeedProcurementReadModelV1 {
  const input = exact(value, ["acknowledgements", "bidComparisons", "blockedDependencies", "contractVersion", "evidenceArtifacts", "metadata", "productCandidates", "productSources", "purchaseOrders", "rfqs", "selectionDecisions", "supplierQuotes", "timeline"], "procurement");
  if (input.contractVersion !== SEED_PROCUREMENT_READ_MODEL_VERSION) fail("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${SEED_PROCUREMENT_READ_MODEL_VERSION}.`);
  const metadata = exact(input.metadata, ["apiResponseContractVersion", "observedAt", "procurementContractProducerSha", "producerRepository", "projectId", "releaseIdentity", "scheduleContractProducerSha", "seedProductContractProducerSha", "tenantId"], "procurement.metadata");
  if (metadata.apiResponseContractVersion !== API_HTTP_RESPONSE_VERSION || metadata.producerRepository !== "CIBOTFLOW/Luzione-API") fail("PRODUCER_MISMATCH", "Unexpected API response producer.");
  if (metadata.seedProductContractProducerSha !== SEED_PRODUCT_CONTRACT_PRODUCER_SHA || metadata.scheduleContractProducerSha !== PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA || metadata.procurementContractProducerSha !== SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA) fail("PRODUCER_MISMATCH", "Procurement read model has an unadmitted producer SHA.");
  const tenantId = bounded(metadata.tenantId, "metadata.tenantId");
  const projectId = bounded(metadata.projectId, "metadata.projectId");
  const releaseIdentity = metadata.releaseIdentity as ReleaseIdentity;
  const violations = releaseIdentityViolations(releaseIdentity);
  if (violations.length) fail("DEPLOYMENT_IDENTITY_INVALID", violations.join(", "));
  const evidenceArtifacts = array(input.evidenceArtifacts, "evidenceArtifacts").map((item, index) => {
    const record = exact(item, ["projectId", "resource"], `evidenceArtifacts[${index}]`);
    const recordProjectId = nullableId(record.projectId, `evidenceArtifacts[${index}].projectId`);
    if (recordProjectId !== projectId) fail("REFERENCE_MISMATCH", "Evidence Artifact crosses the Project read boundary.");
    const resource = parseEvidenceArtifactV1(record.resource);
    sameTenant(tenantId, resource, `evidenceArtifacts[${index}]`);
    return { projectId: recordProjectId, resource };
  });
  const productSources = array(input.productSources, "productSources").map((item, index) => {
    const record = exact(item, ["conflictRefs", "duplicateOfSourceId", "extractionProvenance", "ingestionFormat", "projectId", "resource"], `productSources[${index}]`);
    const recordProjectId = nullableId(record.projectId, `productSources[${index}].projectId`);
    if (recordProjectId !== projectId) fail("REFERENCE_MISMATCH", "Product Source crosses the Project read boundary.");
    const resource = parseProductSourceV1(record.resource);
    sameTenant(tenantId, resource, `productSources[${index}]`);
    const evidence = evidenceArtifacts.find((item) => item.resource.resource.id === resource.data.sourceArtifactRef);
    if (!evidence || evidence.projectId !== recordProjectId || evidence.resource.data.contentDigest !== resource.data.contentDigest) fail("REFERENCE_MISMATCH", "Product Source must bind an exact same-Project Evidence Artifact and content digest.");
    if (evidence.resource.resource.status !== "ACTIVE" && resource.resource.status === "ACTIVE") fail("FINALITY_MISMATCH", "Product Source cannot promote review or quarantined evidence to ACTIVE.");
    return { conflictRefs: strings(record.conflictRefs, "conflictRefs"), duplicateOfSourceId: nullableId(record.duplicateOfSourceId, "duplicateOfSourceId"), extractionProvenance: strings(record.extractionProvenance, "extractionProvenance"), ingestionFormat: bounded(record.ingestionFormat, "ingestionFormat"), projectId: recordProjectId, resource };
  });
  for (const source of productSources) {
    if (source.duplicateOfSourceId === null) continue;
    const duplicate = productSources.find((candidate) => candidate.resource.resource.id === source.duplicateOfSourceId && candidate.resource.resource.id !== source.resource.resource.id);
    if (!duplicate || duplicate.projectId !== source.projectId) fail("REFERENCE_MISMATCH", "Duplicate Product Source must resolve inside the same Project graph.");
    if (source.resource.resource.status !== "REVIEW_REQUIRED") fail("FINALITY_MISMATCH", "Duplicate Product Source must remain REVIEW_REQUIRED.");
  }
  const productCandidates = array(input.productCandidates, "productCandidates").map((item, index) => {
    const record = exact(item, ["conflictRefs", "duplicateOfCandidateId", "extractionProvenance", "fit", "projectId", "resource"], `productCandidates[${index}]`);
    const recordProjectId = nullableId(record.projectId, `productCandidates[${index}].projectId`);
    if (recordProjectId !== projectId) fail("REFERENCE_MISMATCH", "Product Candidate crosses the Project read boundary.");
    const rawResource = object(record.resource, `productCandidates[${index}].resource`);
    const rawData = object(rawResource.data, `productCandidates[${index}].resource.data`);
    const source = productSources.find((item) => item.resource.resource.id === rawData.productSourceId);
    if (!source || source.projectId !== recordProjectId) fail("REFERENCE_MISMATCH", "Product Candidate must bind an exact Product Source inside the same Project graph.");
    const resource = parseProductCandidateV1(record.resource, source.resource);
    sameTenant(tenantId, resource, `productCandidates[${index}]`);
    if (resource.data.lane === "APPROVED_VENDOR" && resource.data.vendorId === null) fail("REFERENCE_MISMATCH", "APPROVED_VENDOR Product Candidate requires vendorId.");
    if (source.resource.resource.status !== "ACTIVE" && ["ELIGIBLE", "SELECTED"].includes(resource.resource.status)) fail("FINALITY_MISMATCH", "Product Candidate cannot become eligible from a non-active Product Source.");
    return { conflictRefs: strings(record.conflictRefs, "conflictRefs"), duplicateOfCandidateId: nullableId(record.duplicateOfCandidateId, "duplicateOfCandidateId"), extractionProvenance: strings(record.extractionProvenance, "extractionProvenance"), fit: parseFit(record.fit, "fit"), projectId: recordProjectId, resource };
  });
  for (const candidate of productCandidates) {
    if (candidate.duplicateOfCandidateId === null) continue;
    const duplicate = productCandidates.find((item) => item.resource.resource.id === candidate.duplicateOfCandidateId && item.resource.resource.id !== candidate.resource.resource.id);
    if (!duplicate || duplicate.projectId !== candidate.projectId) fail("REFERENCE_MISMATCH", "Duplicate Product Candidate must resolve inside the same Project graph.");
    if (candidate.resource.resource.status !== "REVIEW_REQUIRED") fail("FINALITY_MISMATCH", "Duplicate Product Candidate must remain REVIEW_REQUIRED.");
  }
  const rfqs = array(input.rfqs, "rfqs").map((item, index) => { const parsed = parseRFQV1(item); sameTenant(tenantId, parsed, `rfqs[${index}]`); if (parsed.data.projectId !== projectId || parsed.resource.status !== "DRAFT") fail("REFERENCE_MISMATCH", "Only this Project's RFQ drafts belong in A3 readback."); return parsed; });
  const supplierQuotes = array(input.supplierQuotes, "supplierQuotes").map((item, index) => { const record = exact(item, ["economics", "resource"], `supplierQuotes[${index}]`); const resource = parseSupplierQuoteV1(record.resource); sameTenant(tenantId, resource, `supplierQuotes[${index}]`); if (!rfqs.some((rfq) => rfq.resource.id === resource.data.rfqId)) fail("REFERENCE_MISMATCH", "Supplier Quote must reference an exact RFQ in the graph."); return { economics: parseEconomics(record.economics, "economics"), resource }; });
  const bidComparisons = array(input.bidComparisons, "bidComparisons").map((item, index) => { const parsed = parseBidComparisonV1(item); sameTenant(tenantId, parsed, `bidComparisons[${index}]`); return parsed; });
  const blockedDependencies = array(input.blockedDependencies, "blockedDependencies").map((item, index) => { const blocked = exact(item, ["affectedCapabilities", "code", "requiredContract", "summary"], `blockedDependencies[${index}]`); return { affectedCapabilities: strings(blocked.affectedCapabilities, "affectedCapabilities"), code: bounded(blocked.code, "code"), requiredContract: bounded(blocked.requiredContract, "requiredContract"), summary: bounded(blocked.summary, "summary") }; });
  const selectionDecisions = array(input.selectionDecisions, "selectionDecisions").map((item) => parseSelection(item, tenantId, projectId));
  for (const bid of bidComparisons.filter((item) => item.resource.status === "APPROVED")) {
    const selection = selectionDecisions.find((item) => item.resource.id === bid.data.selectedByHumanApprovalRef);
    if (!selection || selection.bidComparisonId !== bid.resource.id || selection.selectedSupplierQuoteId !== bid.data.supplierQuoteIds.find((quoteId) => quoteId === selection.selectedSupplierQuoteId)) fail("AUTHORITY_DENIED", "Approved Bid Comparison lacks its exact human selection fact.");
  }
  const purchaseOrders = array(input.purchaseOrders, "purchaseOrders").map((item, index) => { const parsed = parsePurchaseOrderV1(item); sameTenant(tenantId, parsed, `purchaseOrders[${index}]`); if (parsed.resource.status !== "DRAFT" || parsed.data.releaseApprovalRef !== null) fail("EFFECT_NOT_ALLOWED", "A3 may expose PO drafts only."); return parsed; });
  const acknowledgements = array(input.acknowledgements, "acknowledgements").map((item, index) => { const parsed = parsePurchaseOrderAcknowledgementV1(item); sameTenant(tenantId, parsed, `acknowledgements[${index}]`); if (parsed.resource.status === "SOURCE_CONFIRMED" || parsed.receipt.finality === "SOURCE_CONFIRMED") fail("FALSE_FINALITY", "A3 acknowledgements cannot be source-confirmed."); return parsed; });
  const timeline = array(input.timeline, "timeline").map((item, index) => { const parsed = parseTimelineEventV1(item); sameTenant(tenantId, parsed, `timeline[${index}]`); return parsed; });
  return { acknowledgements, bidComparisons, blockedDependencies, contractVersion: SEED_PROCUREMENT_READ_MODEL_VERSION, evidenceArtifacts, metadata: { apiResponseContractVersion: API_HTTP_RESPONSE_VERSION, observedAt: timestamp(metadata.observedAt, "metadata.observedAt"), procurementContractProducerSha: SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA, producerRepository: "CIBOTFLOW/Luzione-API", projectId, releaseIdentity, scheduleContractProducerSha: PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA, seedProductContractProducerSha: SEED_PRODUCT_CONTRACT_PRODUCER_SHA, tenantId }, productCandidates, productSources, purchaseOrders, rfqs, selectionDecisions, supplierQuotes, timeline };
}

export function createSeedProcurementReadModel(data: SeedProcurementReadModelData, metadata: { observedAt: string; projectId: string; releaseIdentity: ReleaseIdentity; tenantId: string }) {
  return parseSeedProcurementReadModel({ ...data, contractVersion: SEED_PROCUREMENT_READ_MODEL_VERSION, metadata: { apiResponseContractVersion: API_HTTP_RESPONSE_VERSION, observedAt: metadata.observedAt, procurementContractProducerSha: SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA, producerRepository: "CIBOTFLOW/Luzione-API", projectId: metadata.projectId, releaseIdentity: metadata.releaseIdentity, scheduleContractProducerSha: PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA, seedProductContractProducerSha: SEED_PRODUCT_CONTRACT_PRODUCER_SHA, tenantId: metadata.tenantId } });
}
