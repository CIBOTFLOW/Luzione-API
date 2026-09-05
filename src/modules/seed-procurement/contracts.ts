import { canonicalJson, sha256 } from "@/modules/platform-guarantees/eventContract";

export const SEED_PROCUREMENT_COMMAND_VERSION = "SeedProcurementCommand/v1";
export const SEED_PROCUREMENT_READ_MODEL_VERSION = "SeedProcurementReadModel/v1";
export const SEED_PROCUREMENT_POLICY_VERSION = "2026-09-05.seed-procurement.no-effect.v1";
export const SEED_PROCUREMENT_OWNER = "LUZIONE_PROCUREMENT";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CURRENCIES = /^[A-Z]{3}$/;

export type ExactProjectRef = { projectId: string; projectVersion: string };
export type ExactSpecificationRef = ExactProjectRef & { specificationId: string; specificationVersion: string };
export type ObjectiveComponent = "leadTime" | "margin" | "price" | "sourceFreshness" | "specificationMatch" | "supplierReliability";
export type ObjectiveFit = {
  inputs: Record<ObjectiveComponent, number>;
  weights: Record<ObjectiveComponent, number>;
};

type CommonCommand = {
  commandId: string;
  contractVersion: typeof SEED_PROCUREMENT_COMMAND_VERSION;
  expectedVersion: string;
  idempotencyKey: string;
};

export type EvidenceArtifactRegisterCommand = CommonCommand & {
  commandType: "evidence_artifact.register";
  expectedVersion: "ABSENT";
  projectRef: ExactProjectRef | null;
  artifact: {
    capturedAt: string;
    confidence: number;
    contentDigest: string;
    kind: "CALENDAR" | "DOCUMENT" | "EMAIL" | "MEETING_TRANSCRIPT" | "PORTAL_FORM" | "UPLOAD";
    mimeType: string;
    promptInjectionState: "CLEAR" | "DETECTED" | "NOT_ASSESSED";
    provider: string;
    sourceRecordRef: string;
    storageRef: string;
  };
};

export type ProductSourceRecordCommand = CommonCommand & {
  commandType: "product_source.record";
  expectedVersion: "ABSENT";
  projectRef: ExactProjectRef | null;
  artifactId: string;
  artifactVersion: string;
  conflictRefs: string[];
  duplicateOfSourceId: string | null;
  extractionProvenance: string[];
  ingestionFormat: "CSV" | "MANUAL" | "PDF" | "ROOM_PLANNER" | "SHOPIFY" | "URL" | "XLSX";
  source: {
    contentDigest: string;
    kind: "MANUAL" | "PDF" | "ROOM_PLANNER" | "SHOPIFY" | "URL" | "XLSX";
    locator: string;
    observedAt: string;
    validUntil: string | null;
  };
};

export type ProductCandidateRecordCommand = CommonCommand & {
  commandType: "product_candidate.record";
  expectedVersion: "ABSENT";
  projectRef: ExactProjectRef | null;
  conflictRefs: string[];
  duplicateOfCandidateId: string | null;
  extractionProvenance: string[];
  fit: ObjectiveFit;
  productIdentityRef: string;
  productSourceId: string;
  productSourceVersion: string;
  candidate: {
    attributes: Record<string, string>;
    confidence: { score: number; sourceFreshAt: string | null };
    lane: "APPROVED_VENDOR" | "LUZIONE_MADE_TO_ORDER" | "LUZIONE_QUICK_SHIP" | "OUTSIDE_PRODUCT";
    leadTimeDays: number | null;
    price: { amountMinor: number; currency: string } | null;
    sku: string | null;
    title: string;
    vendorId: string | null;
  };
};

export type RFQDraftCreateCommand = CommonCommand & ExactSpecificationRef & {
  commandType: "rfq.create_draft";
  expectedVersion: "ABSENT";
  dueAt: string;
  evidenceRefs: string[];
  requestedFields: string[];
  specificationLines: Array<{ specificationLineId: string; specificationLineVersion: string }>;
  supplierId: string;
};

export type SupplierQuoteNormalizeCommand = CommonCommand & ExactProjectRef & {
  commandType: "supplier_quote.normalize";
  expectedVersion: "ABSENT";
  evidenceArtifactId: string;
  evidenceArtifactVersion: string;
  responseSource: "EMAIL" | "MANUAL" | "PORTAL";
  reviewReasons: string[];
  rfqId: string;
  rfqVersion: string;
  supplierId: string;
  validUntil: string | null;
  lines: Array<{
    clientUnitPriceMinor: number;
    dutyMinor: number;
    freightMinor: number;
    incoterm: string | null;
    leadTimeDays: number | null;
    objectiveFit: ObjectiveFit;
    packageFacts: string | null;
    paymentTerms: string | null;
    quantity: number;
    reserveMinor: number;
    rfqLineId: string;
    unitPrice: { amountMinor: number; currency: string };
    warranty: string | null;
  }>;
};

export type BidComparisonCreateCommand = CommonCommand & ExactSpecificationRef & {
  commandType: "bid_comparison.create";
  expectedVersion: "ABSENT";
  basisCurrency: string;
  criticDissent: string | null;
  recommendationEvidenceRefs: string[];
  recommendedSupplierQuoteId: string | null;
  rfqs: Array<{ rfqId: string; rfqVersion: string }>;
  supplierQuotes: Array<{ supplierQuoteId: string; supplierQuoteVersion: string }>;
};

export type ProcurementSelectionRecordCommand = CommonCommand & ExactProjectRef & {
  commandType: "procurement_selection.record";
  bidComparisonId: string;
  decision: "SELECT";
  evidenceRefs: string[];
  rationale: string;
  selectedSupplierQuoteId: string;
};

export type PurchaseOrderDraftCreateCommand = CommonCommand & ExactProjectRef & {
  commandType: "purchase_order.create_draft";
  bidComparisonId: string;
  lineRefs: Array<{ objectId: string; objectType: "SPECIFICATION_LINE"; ownerProject: "LUZIONE_PROJECT"; version: string }>;
  proposalVersionId: string;
  proposalVersion: string;
  selectionDecisionId: string;
  selectionDecisionVersion: string;
};

export type PurchaseOrderAcknowledgementRecordCommand = CommonCommand & ExactProjectRef & {
  commandType: "purchase_order_acknowledgement.record";
  evidenceArtifactId: string;
  evidenceArtifactVersion: string;
  expectedReadyAt: string | null;
  purchaseOrderId: string;
  supplierId: string;
  variances: Array<{ fieldPath: string; proposedValue: null | boolean | number | string }>;
  acknowledgementState: "CONFLICT" | "PROVIDER_ACKNOWLEDGED";
};

export type SeedProcurementCommand =
  | EvidenceArtifactRegisterCommand
  | ProductSourceRecordCommand
  | ProductCandidateRecordCommand
  | RFQDraftCreateCommand
  | SupplierQuoteNormalizeCommand
  | BidComparisonCreateCommand
  | ProcurementSelectionRecordCommand
  | PurchaseOrderDraftCreateCommand
  | PurchaseOrderAcknowledgementRecordCommand;

export class SeedProcurementContractError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "SeedProcurementContractError";
  }
}

type JsonObject = Record<string, unknown>;

function fail(code: string, message: string, status = 400): never {
  throw new SeedProcurementContractError(code, message, status);
}
function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_COMMAND", `${path} must be an object.`);
  return value as JsonObject;
}
function exact(value: unknown, keys: readonly string[], path: string) {
  const parsed = object(value, path);
  const expected = [...keys].sort();
  const actual = Object.keys(parsed).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("FIELD_SET_MISMATCH", `${path} fields must be exactly ${expected.join(", ")}; received ${actual.join(", ")}.`);
  }
  return parsed;
}
function text(value: unknown, path: string, max = 1_000) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail("INVALID_COMMAND", `${path} must be bounded text.`);
  return value.trim();
}
function nullableText(value: unknown, path: string, max = 1_000) {
  return value === null ? null : text(value, path, max);
}
function id(value: unknown, path: string) {
  const parsed = text(value, path, 512);
  if (!ID.test(parsed)) fail("INVALID_COMMAND", `${path} must be a stable canonical identifier.`);
  return parsed;
}
function idOrNull(value: unknown, path: string) { return value === null ? null : id(value, path); }
function digest(value: unknown, path: string) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("INVALID_COMMAND", `${path} must be a lowercase SHA-256 digest.`);
  return value;
}
function timestamp(value: unknown, path: string) {
  const parsed = text(value, path, 100);
  if (!Number.isFinite(Date.parse(parsed))) fail("INVALID_COMMAND", `${path} must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}
function timestampOrNull(value: unknown, path: string) { return value === null ? null : timestamp(value, path); }
function score(value: unknown, path: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail("INVALID_COMMAND", `${path} must be from zero through one.`);
  return value;
}
function nonNegative(value: unknown, path: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail("INVALID_COMMAND", `${path} must be a non-negative safe integer.`);
  return Number(value);
}
function positive(value: unknown, path: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail("INVALID_COMMAND", `${path} must be positive.`);
  return value;
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail("INVALID_COMMAND", `${path} is not allowed.`);
  return value as T;
}
function strings(value: unknown, path: string, requireOne = false) {
  if (!Array.isArray(value) || (requireOne && value.length === 0)) fail("INVALID_COMMAND", `${path} must be ${requireOne ? "a non-empty" : "an"} array.`);
  const parsed = value.map((item, index) => id(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail("INVALID_COMMAND", `${path} must not contain duplicates.`);
  return parsed;
}
function currency(value: unknown, path: string) {
  const parsed = text(value, path, 3).toUpperCase();
  if (!CURRENCIES.test(parsed)) fail("INVALID_COMMAND", `${path} must be a three-letter currency.`);
  return parsed;
}
function common(input: JsonObject) {
  if (input.contractVersion !== SEED_PROCUREMENT_COMMAND_VERSION) fail("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${SEED_PROCUREMENT_COMMAND_VERSION}.`);
  return {
    commandId: id(input.commandId, "command.commandId"),
    contractVersion: SEED_PROCUREMENT_COMMAND_VERSION,
    expectedVersion: id(input.expectedVersion, "command.expectedVersion"),
    idempotencyKey: id(input.idempotencyKey, "command.idempotencyKey"),
  } as const;
}
function absent(input: JsonObject) {
  if (input.expectedVersion !== "ABSENT") fail("VERSION_CONFLICT", "Create commands must expect ABSENT.", 409);
  return "ABSENT" as const;
}
function projectRef(value: unknown, path: string): ExactProjectRef {
  const parsed = exact(value, ["projectId", "projectVersion"], path);
  return { projectId: id(parsed.projectId, `${path}.projectId`), projectVersion: id(parsed.projectVersion, `${path}.projectVersion`) };
}
function optionalProjectRef(value: unknown) { return value === null ? null : projectRef(value, "command.projectRef"); }
function fit(value: unknown, path: string): ObjectiveFit {
  const parsed = exact(value, ["inputs", "weights"], path);
  const keys: ObjectiveComponent[] = ["leadTime", "margin", "price", "sourceFreshness", "specificationMatch", "supplierReliability"];
  const inputs = exact(parsed.inputs, keys, `${path}.inputs`);
  const weights = exact(parsed.weights, keys, `${path}.weights`);
  const parsedInputs = Object.fromEntries(keys.map((key) => [key, score(inputs[key], `${path}.inputs.${key}`)])) as Record<ObjectiveComponent, number>;
  const parsedWeights = Object.fromEntries(keys.map((key) => [key, score(weights[key], `${path}.weights.${key}`)])) as Record<ObjectiveComponent, number>;
  if (Object.values(parsedWeights).reduce((sum, item) => sum + item, 0) <= 0) fail("INVALID_COMMAND", `${path}.weights must have positive total weight.`);
  return { inputs: parsedInputs, weights: parsedWeights };
}
function exactSpec(input: JsonObject): ExactSpecificationRef {
  return {
    projectId: id(input.projectId, "command.projectId"),
    projectVersion: id(input.projectVersion, "command.projectVersion"),
    specificationId: id(input.specificationId, "command.specificationId"),
    specificationVersion: id(input.specificationVersion, "command.specificationVersion"),
  };
}
function normalizeAttributes(value: unknown) {
  const parsed = object(value, "command.candidate.attributes");
  return Object.fromEntries(Object.entries(parsed).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [id(key, "attribute key"), text(item, `attribute.${key}`, 2_000)]));
}
function parseEvidence(input: JsonObject): EvidenceArtifactRegisterCommand {
  exact(input, ["artifact", "commandId", "commandType", "contractVersion", "expectedVersion", "idempotencyKey", "projectRef"], "command");
  const artifact = exact(input.artifact, ["capturedAt", "confidence", "contentDigest", "kind", "mimeType", "promptInjectionState", "provider", "sourceRecordRef", "storageRef"], "command.artifact");
  return { ...common(input), commandType: "evidence_artifact.register", expectedVersion: absent(input), projectRef: optionalProjectRef(input.projectRef), artifact: {
    capturedAt: timestamp(artifact.capturedAt, "command.artifact.capturedAt"), confidence: score(artifact.confidence, "command.artifact.confidence"), contentDigest: digest(artifact.contentDigest, "command.artifact.contentDigest"),
    kind: enumValue(artifact.kind, ["CALENDAR", "DOCUMENT", "EMAIL", "MEETING_TRANSCRIPT", "PORTAL_FORM", "UPLOAD"], "command.artifact.kind"), mimeType: text(artifact.mimeType, "command.artifact.mimeType", 255),
    promptInjectionState: enumValue(artifact.promptInjectionState, ["CLEAR", "DETECTED", "NOT_ASSESSED"], "command.artifact.promptInjectionState"), provider: id(artifact.provider, "command.artifact.provider"),
    sourceRecordRef: id(artifact.sourceRecordRef, "command.artifact.sourceRecordRef"), storageRef: id(artifact.storageRef, "command.artifact.storageRef"),
  } };
}
function parseProductSource(input: JsonObject): ProductSourceRecordCommand {
  exact(input, ["artifactId", "artifactVersion", "commandId", "commandType", "conflictRefs", "contractVersion", "duplicateOfSourceId", "expectedVersion", "extractionProvenance", "idempotencyKey", "ingestionFormat", "projectRef", "source"], "command");
  const source = exact(input.source, ["contentDigest", "kind", "locator", "observedAt", "validUntil"], "command.source");
  const ingestionFormat = enumValue(input.ingestionFormat, ["CSV", "MANUAL", "PDF", "ROOM_PLANNER", "SHOPIFY", "URL", "XLSX"], "command.ingestionFormat");
  const kind = enumValue(source.kind, ["MANUAL", "PDF", "ROOM_PLANNER", "SHOPIFY", "URL", "XLSX"], "command.source.kind");
  if (ingestionFormat === "CSV" && kind !== "XLSX") fail("SOURCE_KIND_MISMATCH", "CSV uses the ProductSource/v1 spreadsheet lane and therefore requires source.kind XLSX.");
  if (ingestionFormat !== "CSV" && ingestionFormat !== kind) fail("SOURCE_KIND_MISMATCH", "ingestionFormat and ProductSource/v1 kind must agree.");
  return { ...common(input), commandType: "product_source.record", expectedVersion: absent(input), projectRef: optionalProjectRef(input.projectRef), artifactId: id(input.artifactId, "command.artifactId"), artifactVersion: id(input.artifactVersion, "command.artifactVersion"), conflictRefs: strings(input.conflictRefs, "command.conflictRefs"), duplicateOfSourceId: idOrNull(input.duplicateOfSourceId, "command.duplicateOfSourceId"), extractionProvenance: strings(input.extractionProvenance, "command.extractionProvenance", true), ingestionFormat, source: { contentDigest: digest(source.contentDigest, "command.source.contentDigest"), kind, locator: text(source.locator, "command.source.locator", 2_000), observedAt: timestamp(source.observedAt, "command.source.observedAt"), validUntil: timestampOrNull(source.validUntil, "command.source.validUntil") } };
}
function parseCandidate(input: JsonObject): ProductCandidateRecordCommand {
  exact(input, ["candidate", "commandId", "commandType", "conflictRefs", "contractVersion", "duplicateOfCandidateId", "expectedVersion", "extractionProvenance", "fit", "idempotencyKey", "productIdentityRef", "productSourceId", "productSourceVersion", "projectRef"], "command");
  const candidate = exact(input.candidate, ["attributes", "confidence", "lane", "leadTimeDays", "price", "sku", "title", "vendorId"], "command.candidate");
  const confidence = exact(candidate.confidence, ["score", "sourceFreshAt"], "command.candidate.confidence");
  const price = candidate.price === null ? null : exact(candidate.price, ["amountMinor", "currency"], "command.candidate.price");
  const lane = enumValue(candidate.lane, ["APPROVED_VENDOR", "LUZIONE_MADE_TO_ORDER", "LUZIONE_QUICK_SHIP", "OUTSIDE_PRODUCT"], "command.candidate.lane");
  const vendorId = idOrNull(candidate.vendorId, "command.candidate.vendorId");
  if (candidate.leadTimeDays !== null && (!Number.isSafeInteger(candidate.leadTimeDays) || Number(candidate.leadTimeDays) < 0)) fail("INVALID_COMMAND", "candidate.leadTimeDays must be a non-negative integer or null.");
  if (lane === "APPROVED_VENDOR" && vendorId === null) fail("INVALID_COMMAND", "APPROVED_VENDOR candidates require a canonical vendorId.");
  return { ...common(input), commandType: "product_candidate.record", expectedVersion: absent(input), projectRef: optionalProjectRef(input.projectRef), conflictRefs: strings(input.conflictRefs, "command.conflictRefs"), duplicateOfCandidateId: idOrNull(input.duplicateOfCandidateId, "command.duplicateOfCandidateId"), extractionProvenance: strings(input.extractionProvenance, "command.extractionProvenance", true), fit: fit(input.fit, "command.fit"), productIdentityRef: id(input.productIdentityRef, "command.productIdentityRef"), productSourceId: id(input.productSourceId, "command.productSourceId"), productSourceVersion: id(input.productSourceVersion, "command.productSourceVersion"), candidate: { attributes: normalizeAttributes(candidate.attributes), confidence: { score: score(confidence.score, "command.candidate.confidence.score"), sourceFreshAt: timestampOrNull(confidence.sourceFreshAt, "command.candidate.confidence.sourceFreshAt") }, lane, leadTimeDays: candidate.leadTimeDays === null ? null : Number(candidate.leadTimeDays), price: price === null ? null : { amountMinor: nonNegative(price.amountMinor, "command.candidate.price.amountMinor"), currency: currency(price.currency, "command.candidate.price.currency") }, sku: idOrNull(candidate.sku, "command.candidate.sku"), title: text(candidate.title, "command.candidate.title", 1_000), vendorId } };
}
function parseRfq(input: JsonObject): RFQDraftCreateCommand {
  exact(input, ["commandId", "commandType", "contractVersion", "dueAt", "evidenceRefs", "expectedVersion", "idempotencyKey", "projectId", "projectVersion", "requestedFields", "specificationId", "specificationLines", "specificationVersion", "supplierId"], "command");
  if (!Array.isArray(input.specificationLines) || input.specificationLines.length === 0) fail("INVALID_COMMAND", "specificationLines must be non-empty.");
  const lines = input.specificationLines.map((value, index) => { const item = exact(value, ["specificationLineId", "specificationLineVersion"], `command.specificationLines[${index}]`); return { specificationLineId: id(item.specificationLineId, "specificationLineId"), specificationLineVersion: id(item.specificationLineVersion, "specificationLineVersion") }; });
  if (new Set(lines.map((line) => line.specificationLineId)).size !== lines.length) fail("INVALID_COMMAND", "specificationLines must not repeat a line.");
  return { ...common(input), ...exactSpec(input), commandType: "rfq.create_draft", expectedVersion: absent(input), dueAt: timestamp(input.dueAt, "command.dueAt"), evidenceRefs: strings(input.evidenceRefs, "command.evidenceRefs", true), requestedFields: strings(input.requestedFields, "command.requestedFields", true), specificationLines: lines, supplierId: id(input.supplierId, "command.supplierId") };
}
function parseQuote(input: JsonObject): SupplierQuoteNormalizeCommand {
  exact(input, ["commandId", "commandType", "contractVersion", "evidenceArtifactId", "evidenceArtifactVersion", "expectedVersion", "idempotencyKey", "lines", "projectId", "projectVersion", "responseSource", "reviewReasons", "rfqId", "rfqVersion", "supplierId", "validUntil"], "command");
  if (!Array.isArray(input.lines) || input.lines.length === 0) fail("INVALID_COMMAND", "lines must be non-empty.");
  const lines = input.lines.map((value, index) => {
    const line = exact(value, ["clientUnitPriceMinor", "dutyMinor", "freightMinor", "incoterm", "leadTimeDays", "objectiveFit", "packageFacts", "paymentTerms", "quantity", "reserveMinor", "rfqLineId", "unitPrice", "warranty"], `command.lines[${index}]`);
    const money = exact(line.unitPrice, ["amountMinor", "currency"], `command.lines[${index}].unitPrice`);
    if (line.leadTimeDays !== null && (!Number.isSafeInteger(line.leadTimeDays) || Number(line.leadTimeDays) < 0)) fail("INVALID_COMMAND", "leadTimeDays must be a non-negative integer or null.");
    return { clientUnitPriceMinor: nonNegative(line.clientUnitPriceMinor, "clientUnitPriceMinor"), dutyMinor: nonNegative(line.dutyMinor, "dutyMinor"), freightMinor: nonNegative(line.freightMinor, "freightMinor"), incoterm: nullableText(line.incoterm, "incoterm", 100), leadTimeDays: line.leadTimeDays === null ? null : Number(line.leadTimeDays), objectiveFit: fit(line.objectiveFit, `command.lines[${index}].objectiveFit`), packageFacts: nullableText(line.packageFacts, "packageFacts", 1_000), paymentTerms: nullableText(line.paymentTerms, "paymentTerms", 1_000), quantity: positive(line.quantity, "quantity"), reserveMinor: nonNegative(line.reserveMinor, "reserveMinor"), rfqLineId: id(line.rfqLineId, "rfqLineId"), unitPrice: { amountMinor: nonNegative(money.amountMinor, "unitPrice.amountMinor"), currency: currency(money.currency, "unitPrice.currency") }, warranty: nullableText(line.warranty, "warranty", 1_000) };
  });
  return { ...common(input), commandType: "supplier_quote.normalize", expectedVersion: absent(input), projectId: id(input.projectId, "command.projectId"), projectVersion: id(input.projectVersion, "command.projectVersion"), evidenceArtifactId: id(input.evidenceArtifactId, "command.evidenceArtifactId"), evidenceArtifactVersion: id(input.evidenceArtifactVersion, "command.evidenceArtifactVersion"), responseSource: enumValue(input.responseSource, ["EMAIL", "MANUAL", "PORTAL"], "command.responseSource"), reviewReasons: strings(input.reviewReasons, "command.reviewReasons"), rfqId: id(input.rfqId, "command.rfqId"), rfqVersion: id(input.rfqVersion, "command.rfqVersion"), supplierId: id(input.supplierId, "command.supplierId"), validUntil: timestampOrNull(input.validUntil, "command.validUntil"), lines };
}
function parseBid(input: JsonObject): BidComparisonCreateCommand {
  exact(input, ["basisCurrency", "commandId", "commandType", "contractVersion", "criticDissent", "expectedVersion", "idempotencyKey", "projectId", "projectVersion", "recommendationEvidenceRefs", "recommendedSupplierQuoteId", "rfqs", "specificationId", "specificationVersion", "supplierQuotes"], "command");
  if (!Array.isArray(input.rfqs) || !Array.isArray(input.supplierQuotes) || input.rfqs.length === 0 || input.supplierQuotes.length < 2) fail("INVALID_COMMAND", "Bid comparison requires at least one RFQ and two Supplier Quotes.");
  const rfqs = input.rfqs.map((value, index) => { const item = exact(value, ["rfqId", "rfqVersion"], `command.rfqs[${index}]`); return { rfqId: id(item.rfqId, "rfqId"), rfqVersion: id(item.rfqVersion, "rfqVersion") }; });
  const supplierQuotes = input.supplierQuotes.map((value, index) => { const item = exact(value, ["supplierQuoteId", "supplierQuoteVersion"], `command.supplierQuotes[${index}]`); return { supplierQuoteId: id(item.supplierQuoteId, "supplierQuoteId"), supplierQuoteVersion: id(item.supplierQuoteVersion, "supplierQuoteVersion") }; });
  const recommended = idOrNull(input.recommendedSupplierQuoteId, "command.recommendedSupplierQuoteId");
  if (recommended && !supplierQuotes.some((quote) => quote.supplierQuoteId === recommended)) fail("REFERENCE_MISMATCH", "Recommended quote must be included in supplierQuotes.");
  return { ...common(input), ...exactSpec(input), commandType: "bid_comparison.create", expectedVersion: absent(input), basisCurrency: currency(input.basisCurrency, "command.basisCurrency"), criticDissent: nullableText(input.criticDissent, "command.criticDissent", 2_000), recommendationEvidenceRefs: strings(input.recommendationEvidenceRefs, "command.recommendationEvidenceRefs"), recommendedSupplierQuoteId: recommended, rfqs, supplierQuotes };
}
function parseSelection(input: JsonObject): ProcurementSelectionRecordCommand {
  exact(input, ["bidComparisonId", "commandId", "commandType", "contractVersion", "decision", "evidenceRefs", "expectedVersion", "idempotencyKey", "projectId", "projectVersion", "rationale", "selectedSupplierQuoteId"], "command");
  const parsed = common(input);
  const bidComparisonId = id(input.bidComparisonId, "command.bidComparisonId");
  if (parsed.expectedVersion !== `bid-comparison:${bidComparisonId}:v1`) fail("VERSION_CONFLICT", "Procurement selection must bind exact BidComparison v1.", 409);
  return { ...parsed, commandType: "procurement_selection.record", projectId: id(input.projectId, "command.projectId"), projectVersion: id(input.projectVersion, "command.projectVersion"), bidComparisonId, decision: enumValue(input.decision, ["SELECT"], "command.decision"), evidenceRefs: strings(input.evidenceRefs, "command.evidenceRefs", true), rationale: text(input.rationale, "command.rationale", 2_000), selectedSupplierQuoteId: id(input.selectedSupplierQuoteId, "command.selectedSupplierQuoteId") };
}
function parsePo(input: JsonObject): PurchaseOrderDraftCreateCommand {
  exact(input, ["bidComparisonId", "commandId", "commandType", "contractVersion", "expectedVersion", "idempotencyKey", "lineRefs", "projectId", "projectVersion", "proposalVersion", "proposalVersionId", "selectionDecisionId", "selectionDecisionVersion"], "command");
  if (!Array.isArray(input.lineRefs) || input.lineRefs.length === 0) fail("INVALID_COMMAND", "lineRefs must be non-empty.");
  const lineRefs = input.lineRefs.map((value, index) => { const ref = exact(value, ["objectId", "objectType", "ownerProject", "version"], `command.lineRefs[${index}]`); if (ref.objectType !== "SPECIFICATION_LINE" || ref.ownerProject !== "LUZIONE_PROJECT") fail("REFERENCE_MISMATCH", "PO lines must be exact LUZIONE_PROJECT Specification Lines."); return { objectId: id(ref.objectId, "lineRef.objectId"), objectType: "SPECIFICATION_LINE" as const, ownerProject: "LUZIONE_PROJECT" as const, version: id(ref.version, "lineRef.version") }; });
  const parsed = common(input);
  const bidComparisonId = id(input.bidComparisonId, "command.bidComparisonId");
  const selectionDecisionId = id(input.selectionDecisionId, "command.selectionDecisionId");
  const selectionDecisionVersion = id(input.selectionDecisionVersion, "command.selectionDecisionVersion");
  if (parsed.expectedVersion !== `bid-comparison:${bidComparisonId}:v2`) fail("VERSION_CONFLICT", "PO preparation must bind exact approved BidComparison v2.", 409);
  if (selectionDecisionVersion !== `procurement-selection:${selectionDecisionId}:v1`) fail("VERSION_CONFLICT", "PO preparation must bind the exact immutable procurement selection decision.", 409);
  return { ...parsed, commandType: "purchase_order.create_draft", projectId: id(input.projectId, "command.projectId"), projectVersion: id(input.projectVersion, "command.projectVersion"), bidComparisonId, lineRefs, proposalVersionId: id(input.proposalVersionId, "command.proposalVersionId"), proposalVersion: id(input.proposalVersion, "command.proposalVersion"), selectionDecisionId, selectionDecisionVersion };
}
function parseAck(input: JsonObject): PurchaseOrderAcknowledgementRecordCommand {
  exact(input, ["acknowledgementState", "commandId", "commandType", "contractVersion", "evidenceArtifactId", "evidenceArtifactVersion", "expectedReadyAt", "expectedVersion", "idempotencyKey", "projectId", "projectVersion", "purchaseOrderId", "supplierId", "variances"], "command");
  if (!Array.isArray(input.variances)) fail("INVALID_COMMAND", "variances must be an array.");
  const variances = input.variances.map((value, index) => { const item = exact(value, ["fieldPath", "proposedValue"], `command.variances[${index}]`); if (!["string", "number", "boolean"].includes(typeof item.proposedValue) && item.proposedValue !== null) fail("INVALID_COMMAND", "A3 variances permit scalar values only."); return { fieldPath: id(item.fieldPath, "variance.fieldPath"), proposedValue: item.proposedValue as null | boolean | number | string }; });
  const parsed = common(input);
  const purchaseOrderId = id(input.purchaseOrderId, "command.purchaseOrderId");
  if (parsed.expectedVersion !== `purchase-order:${purchaseOrderId}:v1`) fail("VERSION_CONFLICT", "PO acknowledgement must bind exact PO draft v1.", 409);
  return { ...parsed, commandType: "purchase_order_acknowledgement.record", projectId: id(input.projectId, "command.projectId"), projectVersion: id(input.projectVersion, "command.projectVersion"), acknowledgementState: enumValue(input.acknowledgementState, ["CONFLICT", "PROVIDER_ACKNOWLEDGED"], "command.acknowledgementState"), evidenceArtifactId: id(input.evidenceArtifactId, "command.evidenceArtifactId"), evidenceArtifactVersion: id(input.evidenceArtifactVersion, "command.evidenceArtifactVersion"), expectedReadyAt: timestampOrNull(input.expectedReadyAt, "command.expectedReadyAt"), purchaseOrderId, supplierId: id(input.supplierId, "command.supplierId"), variances };
}

export function parseSeedProcurementCommand(value: unknown): SeedProcurementCommand {
  const input = object(value, "command");
  switch (input.commandType) {
    case "evidence_artifact.register": return parseEvidence(input);
    case "product_source.record": return parseProductSource(input);
    case "product_candidate.record": return parseCandidate(input);
    case "rfq.create_draft": return parseRfq(input);
    case "supplier_quote.normalize": return parseQuote(input);
    case "bid_comparison.create": return parseBid(input);
    case "procurement_selection.record": return parseSelection(input);
    case "purchase_order.create_draft": return parsePo(input);
    case "purchase_order_acknowledgement.record": return parseAck(input);
    default: fail("UNSUPPORTED_COMMAND", "Unsupported seed procurement commandType.");
  }
}

export function canonicalSeedProcurementPayloadHash(command: SeedProcurementCommand) {
  return sha256(JSON.parse(canonicalJson(command)));
}
