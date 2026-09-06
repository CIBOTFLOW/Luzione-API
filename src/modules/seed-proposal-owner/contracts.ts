import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const SEED_PROPOSAL_COMMAND_VERSION = "SeedProposalCommand/v1";
export const SEED_PROPOSAL_READ_MODEL_VERSION = "SeedProposalReadModel/v1";
export const SEED_PROPOSAL_POLICY_VERSION = "2026-09-06.seed-proposal-owner.no-effect.v1";
export const SEED_PROPOSAL_OWNER = "LUZIONE_COMMERCIAL_CASE_PROPOSAL";

export const PROPOSAL_LINE_TYPES = Object.freeze([
  "DELIVERY_INSTALLATION",
  "DESIGN_FEE",
  "DISCOUNT",
  "FREIGHT",
  "PROCUREMENT_FEE",
  "PRODUCT",
  "SERVICE_FEE",
  "TAX",
] as const);

export type ProposalLineType = (typeof PROPOSAL_LINE_TYPES)[number];
export type ProposalDecisionScope = "ITEM" | "OPTION_GROUP" | "PROPOSAL" | "SECTION";
export type ProposalTemplateFormat = "DOCX" | "HTML" | "PDF_ACROFORM" | "PDF_OVERLAY";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;

export type ExactProposalSourceRef = {
  objectId: string;
  objectType: "EVIDENCE_ARTIFACT" | "PRODUCT_CANDIDATE" | "PROJECT" | "SPECIFICATION" | "SPECIFICATION_LINE";
  ownerProject: "LUZIONE_PROCUREMENT" | "LUZIONE_PROJECT";
  version: string;
};

type CommandBase = {
  commandId: string;
  contractVersion: typeof SEED_PROPOSAL_COMMAND_VERSION;
  expectedVersion: string;
  idempotencyKey: string;
};

export type ProposalTemplateSaveVersionCommand = CommandBase & {
  commandType: "proposal_template.save_version";
  evidenceRefs: string[];
  template: {
    contentDigest: string;
    format: ProposalTemplateFormat;
    malwareScanEvidenceRef: ExactProposalSourceRef;
    malwareScanState: "CLEAN";
    mergeTokens: string[];
    name: string;
    pdf: null | {
      acroFormFields: string[];
      mode: "ACROFORM" | "OVERLAY" | "UNSUPPORTED";
      overlayMapDigest: string | null;
      overlayMapVersion: string | null;
    };
    storageObjectRef: string;
    tokenSchemaVersion: "ProposalMergeTokens/v1";
  };
  templateId: string;
};

export type ProposalEconomics = {
  clientPriceBeforeTaxMinor: number;
  discountTotalMinor: number;
  dutyTotalMinor: number;
  freightTotalMinor: number;
  grossMarginMinor: number;
  landedCostTotalMinor: number;
  reserveTotalMinor: number;
  supplierCostTotalMinor: number;
  taxTotalMinor: number;
  totalMinor: number;
};

export type ProposalVersionLineInput = {
  confidence: { score: number; sourceFreshAt: string | null };
  description: string;
  dutyMinor: number;
  freightMinor: number;
  landedCostMinor: number;
  lineId: string;
  lineType: ProposalLineType;
  optionGroupId: string | null;
  quantity: number;
  reserveMinor: number;
  sectionId: string;
  sourceRef: ExactProposalSourceRef;
  specificationLineRef: ExactProposalSourceRef | null;
  supplierCostMinor: number;
  totalMinor: number;
  unitPriceMinor: number;
};

export type ProposalVersionWriteCommand = CommandBase & {
  caseId: string;
  commandType: "proposal_version.create" | "proposal_version.revise";
  currency: string;
  economics: ProposalEconomics;
  evidenceRefs: string[];
  lines: ProposalVersionLineInput[];
  projectRef: { projectId: string; projectVersion: string };
  proposalId: string;
  specificationRefs: ExactProposalSourceRef[];
  templateRef: { templateId: string; templateVersion: string };
};

export type ProposalApprovalDecisionCommand = CommandBase & {
  commandType: "approval_decision.record";
  comment: string | null;
  decision: "APPROVE" | "CHANGE_REQUESTED" | "REJECT";
  evidenceRefs: string[];
  proposalId: string;
  scope: ProposalDecisionScope;
  targetId: string;
};

export type ProposalRenderPrepareCommand = CommandBase & {
  commandType: "proposal_render.prepare";
  evidenceRefs: string[];
  proposalId: string;
  renderInputHash: string;
  requestedArtifact: "PDF" | "WEB";
};

export type SeedProposalCommand =
  | ProposalTemplateSaveVersionCommand
  | ProposalVersionWriteCommand
  | ProposalApprovalDecisionCommand
  | ProposalRenderPrepareCommand;

export class SeedProposalContractError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "SeedProposalContractError";
  }
}

type JsonObject = Record<string, unknown>;
function fail(code: string, message: string, status = 400): never { throw new SeedProposalContractError(code, message, status); }
function object(value: unknown, path: string): JsonObject { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_COMMAND", `${path} must be an object.`); return value as JsonObject; }
function exact(value: unknown, keys: readonly string[], path: string) {
  const parsed = object(value, path); const expected = [...keys].sort(); const actual = Object.keys(parsed).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("FIELD_SET_MISMATCH", `${path} fields must be exactly ${expected.join(", ")}; received ${actual.join(", ")}.`);
  return parsed;
}
function text(value: unknown, path: string, max = 1_000) { if (typeof value !== "string" || value !== value.trim() || !value || value.length > max) fail("INVALID_COMMAND", `${path} must be unpadded bounded text.`); return value; }
function nullableText(value: unknown, path: string, max = 1_000) { return value === null ? null : text(value, path, max); }
function id(value: unknown, path: string) { const parsed = text(value, path, 512); if (!ID.test(parsed)) fail("INVALID_COMMAND", `${path} must be a stable canonical identifier.`); return parsed; }
function idOrNull(value: unknown, path: string) { return value === null ? null : id(value, path); }
function digest(value: unknown, path: string) { if (typeof value !== "string" || !DIGEST.test(value)) fail("INVALID_COMMAND", `${path} must be a lowercase SHA-256 digest.`); return value; }
function money(value: unknown, path: string) { if (!Number.isSafeInteger(value) || Number(value) < 0) fail("INVALID_MONEY", `${path} must be a non-negative safe integer minor-unit amount.`); return Number(value); }
function signedMoney(value: unknown, path: string) { if (!Number.isSafeInteger(value)) fail("INVALID_MONEY", `${path} must be a safe integer minor-unit amount.`); return Number(value); }
function positiveInteger(value: unknown, path: string) { if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 1_000_000) fail("INVALID_COMMAND", `${path} must be a positive safe integer.`); return Number(value); }
function score(value: unknown, path: string) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail("INVALID_COMMAND", `${path} must be between zero and one.`); return value; }
function timestampOrNull(value: unknown, path: string) { if (value === null) return null; const parsed = text(value, path, 100); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) || !Number.isFinite(Date.parse(parsed)) || new Date(Date.parse(parsed)).toISOString() !== parsed) fail("INVALID_COMMAND", `${path} must be canonical RFC3339 UTC.`); return parsed; }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T { if (typeof value !== "string" || !allowed.includes(value as T)) fail("INVALID_COMMAND", `${path} is not allowed.`); return value as T; }
function strings(value: unknown, path: string, requireOne = false) { if (!Array.isArray(value) || (requireOne && value.length === 0)) fail("INVALID_COMMAND", `${path} must be ${requireOne ? "a non-empty" : "an"} array.`); const parsed = value.map((item, index) => id(item, `${path}[${index}]`)); if (new Set(parsed).size !== parsed.length) fail("INVALID_COMMAND", `${path} must not contain duplicates.`); return parsed; }

function common(input: JsonObject) {
  if (input.contractVersion !== SEED_PROPOSAL_COMMAND_VERSION) fail("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${SEED_PROPOSAL_COMMAND_VERSION}.`);
  for (const forged of ["actor", "actorId", "actorType", "tenant", "tenantId", "roles", "capabilities", "authority", "clientGrant", "humanAuthenticationRef"]) if (forged in input) fail("AUTHORITY_FORGED", `${forged} is server-derived.`);
  return { commandId: id(input.commandId, "command.commandId"), contractVersion: SEED_PROPOSAL_COMMAND_VERSION, expectedVersion: id(input.expectedVersion, "command.expectedVersion"), idempotencyKey: id(input.idempotencyKey, "command.idempotencyKey") } as const;
}

function sourceRef(value: unknown, path: string): ExactProposalSourceRef {
  const parsed = exact(value, ["objectId", "objectType", "ownerProject", "version"], path);
  const objectType = enumValue(parsed.objectType, ["EVIDENCE_ARTIFACT", "PRODUCT_CANDIDATE", "PROJECT", "SPECIFICATION", "SPECIFICATION_LINE"], `${path}.objectType`);
  const ownerProject = enumValue(parsed.ownerProject, ["LUZIONE_PROCUREMENT", "LUZIONE_PROJECT"], `${path}.ownerProject`);
  const projectOwned = ["PROJECT", "SPECIFICATION", "SPECIFICATION_LINE"].includes(objectType);
  if ((projectOwned && ownerProject !== "LUZIONE_PROJECT") || (!projectOwned && ownerProject !== "LUZIONE_PROCUREMENT")) fail("REFERENCE_MISMATCH", `${path} object type and owner disagree.`, 409);
  return { objectId: id(parsed.objectId, `${path}.objectId`), objectType, ownerProject, version: id(parsed.version, `${path}.version`) };
}

function parseTemplate(input: JsonObject): ProposalTemplateSaveVersionCommand {
  exact(input, ["commandId", "commandType", "contractVersion", "evidenceRefs", "expectedVersion", "idempotencyKey", "template", "templateId"], "command");
  const raw = exact(input.template, ["contentDigest", "format", "malwareScanEvidenceRef", "malwareScanState", "mergeTokens", "name", "pdf", "storageObjectRef", "tokenSchemaVersion"], "command.template");
  if (raw.malwareScanState !== "CLEAN") fail("TEMPLATE_SCAN_REQUIRED", "Template metadata requires a clean malware scan before persistence.", 409);
  if (raw.tokenSchemaVersion !== "ProposalMergeTokens/v1") fail("UNSUPPORTED_TOKEN_SCHEMA", "Template token schema is not supported.");
  const format = enumValue(raw.format, ["DOCX", "HTML", "PDF_ACROFORM", "PDF_OVERLAY"], "command.template.format");
  let pdf: ProposalTemplateSaveVersionCommand["template"]["pdf"] = null;
  if (raw.pdf !== null) {
    const item = exact(raw.pdf, ["acroFormFields", "mode", "overlayMapDigest", "overlayMapVersion"], "command.template.pdf");
    pdf = { acroFormFields: strings(item.acroFormFields, "command.template.pdf.acroFormFields"), mode: enumValue(item.mode, ["ACROFORM", "OVERLAY", "UNSUPPORTED"], "command.template.pdf.mode"), overlayMapDigest: item.overlayMapDigest === null ? null : digest(item.overlayMapDigest, "command.template.pdf.overlayMapDigest"), overlayMapVersion: idOrNull(item.overlayMapVersion, "command.template.pdf.overlayMapVersion") };
  }
  if (["DOCX", "HTML"].includes(format) && pdf !== null) fail("TEMPLATE_FORMAT_MISMATCH", "DOCX and HTML templates cannot include PDF mapping metadata.");
  if (format === "PDF_ACROFORM" && (pdf?.mode !== "ACROFORM" || pdf.acroFormFields.length === 0 || pdf.overlayMapDigest !== null || pdf.overlayMapVersion !== null)) fail("TEMPLATE_FORMAT_MISMATCH", "PDF_ACROFORM requires declared AcroForm fields only.");
  if (format === "PDF_OVERLAY" && pdf === null) fail("TEMPLATE_FORMAT_MISMATCH", "PDF_OVERLAY requires overlay or unsupported-PDF metadata.");
  if (pdf?.mode === "OVERLAY" && (!pdf.overlayMapDigest || !pdf.overlayMapVersion)) fail("TEMPLATE_FORMAT_MISMATCH", "PDF overlay mode requires an immutable overlay map version and digest.");
  const malwareScanEvidenceRef = sourceRef(raw.malwareScanEvidenceRef, "command.template.malwareScanEvidenceRef");
  if (malwareScanEvidenceRef.objectType !== "EVIDENCE_ARTIFACT") fail("REFERENCE_MISMATCH", "Template malware scan evidence must be an exact EvidenceArtifact/v1 ref.", 409);
  return { ...common(input), commandType: "proposal_template.save_version", evidenceRefs: strings(input.evidenceRefs, "command.evidenceRefs", true), template: { contentDigest: digest(raw.contentDigest, "command.template.contentDigest"), format, malwareScanEvidenceRef, malwareScanState: "CLEAN", mergeTokens: strings(raw.mergeTokens, "command.template.mergeTokens"), name: text(raw.name, "command.template.name", 240), pdf, storageObjectRef: id(raw.storageObjectRef, "command.template.storageObjectRef"), tokenSchemaVersion: "ProposalMergeTokens/v1" }, templateId: id(input.templateId, "command.templateId") };
}

function parseEconomics(value: unknown): ProposalEconomics {
  const input = exact(value, ["clientPriceBeforeTaxMinor", "discountTotalMinor", "dutyTotalMinor", "freightTotalMinor", "grossMarginMinor", "landedCostTotalMinor", "reserveTotalMinor", "supplierCostTotalMinor", "taxTotalMinor", "totalMinor"], "command.economics");
  return { clientPriceBeforeTaxMinor: money(input.clientPriceBeforeTaxMinor, "command.economics.clientPriceBeforeTaxMinor"), discountTotalMinor: money(input.discountTotalMinor, "command.economics.discountTotalMinor"), dutyTotalMinor: money(input.dutyTotalMinor, "command.economics.dutyTotalMinor"), freightTotalMinor: money(input.freightTotalMinor, "command.economics.freightTotalMinor"), grossMarginMinor: signedMoney(input.grossMarginMinor, "command.economics.grossMarginMinor"), landedCostTotalMinor: money(input.landedCostTotalMinor, "command.economics.landedCostTotalMinor"), reserveTotalMinor: money(input.reserveTotalMinor, "command.economics.reserveTotalMinor"), supplierCostTotalMinor: money(input.supplierCostTotalMinor, "command.economics.supplierCostTotalMinor"), taxTotalMinor: money(input.taxTotalMinor, "command.economics.taxTotalMinor"), totalMinor: money(input.totalMinor, "command.economics.totalMinor") };
}

function parseLine(value: unknown, index: number): ProposalVersionLineInput {
  const path = `command.lines[${index}]`;
  const input = exact(value, ["confidence", "description", "dutyMinor", "freightMinor", "landedCostMinor", "lineId", "lineType", "optionGroupId", "quantity", "reserveMinor", "sectionId", "sourceRef", "specificationLineRef", "supplierCostMinor", "totalMinor", "unitPriceMinor"], path);
  const confidence = exact(input.confidence, ["score", "sourceFreshAt"], `${path}.confidence`);
  const lineType = enumValue(input.lineType, PROPOSAL_LINE_TYPES, `${path}.lineType`);
  const parsedSource = sourceRef(input.sourceRef, `${path}.sourceRef`);
  const specificationLineRef = input.specificationLineRef === null ? null : sourceRef(input.specificationLineRef, `${path}.specificationLineRef`);
  if (lineType === "PRODUCT" && (parsedSource.objectType !== "PRODUCT_CANDIDATE" || specificationLineRef?.objectType !== "SPECIFICATION_LINE")) fail("REFERENCE_MISMATCH", "Product lines require exact Product Candidate and Specification Line refs.", 409);
  if (lineType !== "PRODUCT" && specificationLineRef !== null) fail("REFERENCE_MISMATCH", "Only product lines may bind a Specification Line.", 409);
  return { confidence: { score: score(confidence.score, `${path}.confidence.score`), sourceFreshAt: timestampOrNull(confidence.sourceFreshAt, `${path}.confidence.sourceFreshAt`) }, description: text(input.description, `${path}.description`, 1_000), dutyMinor: money(input.dutyMinor, `${path}.dutyMinor`), freightMinor: money(input.freightMinor, `${path}.freightMinor`), landedCostMinor: money(input.landedCostMinor, `${path}.landedCostMinor`), lineId: id(input.lineId, `${path}.lineId`), lineType, optionGroupId: idOrNull(input.optionGroupId, `${path}.optionGroupId`), quantity: positiveInteger(input.quantity, `${path}.quantity`), reserveMinor: money(input.reserveMinor, `${path}.reserveMinor`), sectionId: id(input.sectionId, `${path}.sectionId`), sourceRef: parsedSource, specificationLineRef, supplierCostMinor: money(input.supplierCostMinor, `${path}.supplierCostMinor`), totalMinor: money(input.totalMinor, `${path}.totalMinor`), unitPriceMinor: money(input.unitPriceMinor, `${path}.unitPriceMinor`) };
}

function parseProposalVersion(input: JsonObject): ProposalVersionWriteCommand {
  exact(input, ["caseId", "commandId", "commandType", "contractVersion", "currency", "economics", "evidenceRefs", "expectedVersion", "idempotencyKey", "lines", "projectRef", "proposalId", "specificationRefs", "templateRef"], "command");
  const commandType = enumValue(input.commandType, ["proposal_version.create", "proposal_version.revise"], "command.commandType");
  const base = common(input);
  if (commandType === "proposal_version.create" && base.expectedVersion !== "ABSENT") fail("VERSION_CONFLICT", "Proposal creation must expect ABSENT.", 409);
  if (commandType === "proposal_version.revise" && base.expectedVersion === "ABSENT") fail("VERSION_CONFLICT", "Proposal revision must name the exact current version.", 409);
  const project = exact(input.projectRef, ["projectId", "projectVersion"], "command.projectRef");
  const template = exact(input.templateRef, ["templateId", "templateVersion"], "command.templateRef");
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 500) fail("INVALID_COMMAND", "command.lines must contain 1 through 500 typed lines.");
  const lines = input.lines.map(parseLine).sort((left, right) => left.lineId.localeCompare(right.lineId));
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length) fail("INVALID_COMMAND", "Proposal line IDs must be unique.");
  if (!Array.isArray(input.specificationRefs) || input.specificationRefs.length === 0) fail("INVALID_COMMAND", "Proposal Version requires exact Specification refs.");
  const specificationRefs = input.specificationRefs.map((value, index) => sourceRef(value, `command.specificationRefs[${index}]`));
  if (specificationRefs.some((ref) => ref.objectType !== "SPECIFICATION")) fail("REFERENCE_MISMATCH", "specificationRefs may contain only canonical Specification refs.", 409);
  const parsedCurrency = text(input.currency, "command.currency", 3);
  if (!CURRENCY.test(parsedCurrency)) fail("INVALID_CURRENCY", "command.currency must be exactly three uppercase letters.");
  return { ...base, caseId: id(input.caseId, "command.caseId"), commandType, currency: parsedCurrency, economics: parseEconomics(input.economics), evidenceRefs: strings(input.evidenceRefs, "command.evidenceRefs", true), lines, projectRef: { projectId: id(project.projectId, "command.projectRef.projectId"), projectVersion: id(project.projectVersion, "command.projectRef.projectVersion") }, proposalId: id(input.proposalId, "command.proposalId"), specificationRefs, templateRef: { templateId: id(template.templateId, "command.templateRef.templateId"), templateVersion: id(template.templateVersion, "command.templateRef.templateVersion") } };
}

function parseDecision(input: JsonObject): ProposalApprovalDecisionCommand {
  exact(input, ["commandId", "commandType", "comment", "contractVersion", "decision", "evidenceRefs", "expectedVersion", "idempotencyKey", "proposalId", "scope", "targetId"], "command");
  return { ...common(input), commandType: "approval_decision.record", comment: nullableText(input.comment, "command.comment", 2_000), decision: enumValue(input.decision, ["APPROVE", "CHANGE_REQUESTED", "REJECT"], "command.decision"), evidenceRefs: strings(input.evidenceRefs, "command.evidenceRefs", true), proposalId: id(input.proposalId, "command.proposalId"), scope: enumValue(input.scope, ["ITEM", "OPTION_GROUP", "PROPOSAL", "SECTION"], "command.scope"), targetId: id(input.targetId, "command.targetId") };
}

function parseRender(input: JsonObject): ProposalRenderPrepareCommand {
  exact(input, ["commandId", "commandType", "contractVersion", "evidenceRefs", "expectedVersion", "idempotencyKey", "proposalId", "renderInputHash", "requestedArtifact"], "command");
  return { ...common(input), commandType: "proposal_render.prepare", evidenceRefs: strings(input.evidenceRefs, "command.evidenceRefs", true), proposalId: id(input.proposalId, "command.proposalId"), renderInputHash: digest(input.renderInputHash, "command.renderInputHash"), requestedArtifact: enumValue(input.requestedArtifact, ["PDF", "WEB"], "command.requestedArtifact") };
}

export function parseSeedProposalCommand(value: unknown): SeedProposalCommand {
  const input = object(value, "command");
  if (input.commandType === "proposal_template.save_version") return parseTemplate(input);
  if (input.commandType === "proposal_version.create" || input.commandType === "proposal_version.revise") return parseProposalVersion(input);
  if (input.commandType === "approval_decision.record") return parseDecision(input);
  if (input.commandType === "proposal_render.prepare") return parseRender(input);
  fail("UNSUPPORTED_COMMAND", "Unsupported seed proposal command type.");
}

export function canonicalSeedProposalPayloadHash(command: SeedProposalCommand) { return sha256(command); }
