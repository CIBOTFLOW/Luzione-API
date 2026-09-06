import {
  parseApprovalDecisionV1,
  parseProposalLineV1,
  parseProposalTemplateV1,
  parseProposalVersionV1,
} from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import type {
  ApprovalDecisionV1,
  ProposalLineV1,
  ProposalTemplateV1,
  ProposalVersionV1,
  SeedSourceRefV1,
} from "@/modules/luzione-core-contracts/seedProductContracts";
import { releaseIdentityViolations, type ReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { API_HTTP_RESPONSE_VERSION, PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA, SEED_PRODUCT_CONTRACT_PRODUCER_SHA } from "@/modules/seed-project-publication/readModel";
import { SEED_PROCUREMENT_CORRECTION_CONTRACT_PRODUCER_SHA, SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA } from "@/modules/seed-procurement/readModel";
import { SEED_PROPOSAL_READ_MODEL_VERSION, type ProposalEconomics } from "@/modules/seed-proposal-owner/contracts";

export const SEED_PROPOSAL_CONTRACT_PRODUCER_SHA = "ac5ab1dd448514ff310f0fe0155fc821f2eb7408";

export const SEED_PROPOSAL_HTTP_ROUTES = Object.freeze({
  commandCollection: "/api/v1/proposals/commands",
  projectProposalCollection: "/api/v1/projects/:projectId/proposals",
  proposalRead: "/api/v1/proposals/:proposalId",
});

export type ProposalRenderPreparationReadback = {
  artifactRef: null;
  createdAt: string;
  evidenceRefs: string[];
  externalEffectAuthorized: false;
  objectVersion: string;
  preparationId: string;
  proposalId: string;
  proposalVersion: string;
  providerAcknowledgementRef: null;
  renderInputHash: string;
  requestedArtifact: "PDF" | "WEB";
  sourceReadbackRef: null;
  status: "PREPARED";
  templateId: string;
  templateVersion: string;
};

export type SeedProposalReadback = {
  decisions: ApprovalDecisionV1[];
  economics: ProposalEconomics;
  identityMap: {
    caseId: string;
    proposalContextVersionId: string;
    proposalDocumentVersionId: string;
    quoteEconomicsVersionId: string;
    quoteId: string;
  };
  lines: Array<{
    economics: { dutyMinor: number; freightMinor: number; reserveMinor: number; sectionId: string; supplierCostTotalMinor: number };
    resource: ProposalLineV1;
    specificationLineRef: SeedSourceRefV1 | null;
  }>;
  proposal: ProposalVersionV1;
  renderPreparations: ProposalRenderPreparationReadback[];
  template: ProposalTemplateV1;
};

export type SeedProposalReadModelV1 = {
  contractVersion: typeof SEED_PROPOSAL_READ_MODEL_VERSION;
  metadata: {
    apiResponseContractVersion: typeof API_HTTP_RESPONSE_VERSION;
    observedAt: string;
    producerRepository: "CIBOTFLOW/Luzione-API";
    projectId: string;
    proposalContractProducerSha: typeof SEED_PROPOSAL_CONTRACT_PRODUCER_SHA;
    procurementCorrectionContractProducerSha: typeof SEED_PROCUREMENT_CORRECTION_CONTRACT_PRODUCER_SHA;
    releaseIdentity: ReleaseIdentity;
    scheduleContractProducerSha: typeof PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA;
    seedProductContractProducerSha: typeof SEED_PRODUCT_CONTRACT_PRODUCER_SHA;
    supplierIdentityContractProducerSha: typeof SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA;
    tenantId: string;
  };
  projectVersion: string;
  proposals: SeedProposalReadback[];
};

export class SeedProposalReadModelError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "SeedProposalReadModelError"; }
}

type JsonObject = Record<string, unknown>;
function fail(code: string, message: string): never { throw new SeedProposalReadModelError(code, message); }
function object(value: unknown, path: string): JsonObject { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_VALUE", `${path} must be an object.`); return value as JsonObject; }
function exact(value: unknown, keys: readonly string[], path: string) { const parsed = object(value, path); const expected = [...keys].sort(); const actual = Object.keys(parsed).sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("FIELD_SET_MISMATCH", `${path} fields must be exactly ${expected.join(", ")}.`); return parsed; }
function array(value: unknown, path: string) { if (!Array.isArray(value)) fail("INVALID_VALUE", `${path} must be an array.`); return value; }
function id(value: unknown, path: string) { if (typeof value !== "string" || value !== value.trim() || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/.test(value)) fail("INVALID_VALUE", `${path} must be a stable identifier.`); return value; }
function timestamp(value: unknown, path: string) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) fail("INVALID_VALUE", `${path} must be canonical RFC3339 UTC.`); return value; }
function money(value: unknown, path: string) { if (!Number.isSafeInteger(value) || Number(value) < 0) fail("ECONOMICS_MISMATCH", `${path} must be non-negative integer minor units.`); return Number(value); }
function signedMoney(value: unknown, path: string) { if (!Number.isSafeInteger(value)) fail("ECONOMICS_MISMATCH", `${path} must be integer minor units.`); return Number(value); }
function sameTenant(tenantId: string, value: { tenantId: string }, path: string) { if (value.tenantId !== tenantId) fail("TENANT_MISMATCH", `${path} crosses the authenticated tenant.`); }
function parseRelease(value: unknown) { const parsed = value as ReleaseIdentity; const defects = releaseIdentityViolations(parsed); if (defects.length) fail("DEPLOYMENT_IDENTITY_INVALID", defects.join(", ")); return parsed; }

function parseEconomics(value: unknown): ProposalEconomics {
  const parsed = exact(value, ["clientPriceBeforeTaxMinor", "discountTotalMinor", "dutyTotalMinor", "freightTotalMinor", "grossMarginMinor", "landedCostTotalMinor", "reserveTotalMinor", "supplierCostTotalMinor", "taxTotalMinor", "totalMinor"], "proposal.economics");
  return { clientPriceBeforeTaxMinor: money(parsed.clientPriceBeforeTaxMinor, "clientPriceBeforeTaxMinor"), discountTotalMinor: money(parsed.discountTotalMinor, "discountTotalMinor"), dutyTotalMinor: money(parsed.dutyTotalMinor, "dutyTotalMinor"), freightTotalMinor: money(parsed.freightTotalMinor, "freightTotalMinor"), grossMarginMinor: signedMoney(parsed.grossMarginMinor, "grossMarginMinor"), landedCostTotalMinor: money(parsed.landedCostTotalMinor, "landedCostTotalMinor"), reserveTotalMinor: money(parsed.reserveTotalMinor, "reserveTotalMinor"), supplierCostTotalMinor: money(parsed.supplierCostTotalMinor, "supplierCostTotalMinor"), taxTotalMinor: money(parsed.taxTotalMinor, "taxTotalMinor"), totalMinor: money(parsed.totalMinor, "totalMinor") };
}

function parseProposal(value: unknown, tenantId: string, projectId: string): SeedProposalReadback {
  const raw = exact(value, ["decisions", "economics", "identityMap", "lines", "proposal", "renderPreparations", "template"], "proposal");
  const template = parseProposalTemplateV1(raw.template); sameTenant(tenantId, template, "proposal.template");
  const proposal = parseProposalVersionV1(raw.proposal, undefined, template); sameTenant(tenantId, proposal, "proposal.resource"); if (proposal.data.projectId !== projectId) fail("REFERENCE_MISMATCH", "Proposal crosses its Project collection.");
  const lines = array(raw.lines, "proposal.lines").map((value, index) => {
    const line = exact(value, ["economics", "resource", "specificationLineRef"], `proposal.lines[${index}]`); const resource = parseProposalLineV1(line.resource, proposal); sameTenant(tenantId, resource, `proposal.lines[${index}]`);
    const economics = exact(line.economics, ["dutyMinor", "freightMinor", "reserveMinor", "sectionId", "supplierCostTotalMinor"], `proposal.lines[${index}].economics`);
    const specificationLineRef = line.specificationLineRef === null ? null : exact(line.specificationLineRef, ["objectId", "objectType", "ownerProject", "tenantId", "version"], `proposal.lines[${index}].specificationLineRef`) as unknown as SeedSourceRefV1;
    if (resource.data.lineType === "PRODUCT" && (specificationLineRef?.objectType !== "SPECIFICATION_LINE" || specificationLineRef.ownerProject !== "LUZIONE_PROJECT" || specificationLineRef.tenantId !== tenantId)) fail("REFERENCE_MISMATCH", "Product line lacks its exact Specification Line ref.");
    return { economics: { dutyMinor: money(economics.dutyMinor, "dutyMinor"), freightMinor: money(economics.freightMinor, "freightMinor"), reserveMinor: money(economics.reserveMinor, "reserveMinor"), sectionId: id(economics.sectionId, "sectionId"), supplierCostTotalMinor: money(economics.supplierCostTotalMinor, "supplierCostTotalMinor") }, resource, specificationLineRef };
  });
  if (lines.length === 0 || new Set(lines.map((line) => line.resource.resource.id)).size !== lines.length || proposal.data.lineIds.length !== lines.length || proposal.data.lineIds.some((idValue) => !lines.some((line) => line.resource.resource.id === idValue))) fail("REFERENCE_MISMATCH", "Proposal line set is incomplete or duplicated.");
  const economics = parseEconomics(raw.economics);
  const supplierCostTotal = lines.reduce((sum, line) => sum + line.economics.supplierCostTotalMinor, 0); const freightTotal = lines.reduce((sum, line) => sum + line.economics.freightMinor, 0); const dutyTotal = lines.reduce((sum, line) => sum + line.economics.dutyMinor, 0); const reserveTotal = lines.reduce((sum, line) => sum + line.economics.reserveMinor, 0); const landedTotal = lines.reduce((sum, line) => sum + line.resource.data.landedCostMinor, 0); const beforeTax = lines.filter((line) => !["DISCOUNT", "TAX"].includes(line.resource.data.lineType)).reduce((sum, line) => sum + line.resource.data.totalMinor, 0); const discounts = lines.filter((line) => line.resource.data.lineType === "DISCOUNT").reduce((sum, line) => sum + line.resource.data.totalMinor, 0); const tax = lines.filter((line) => line.resource.data.lineType === "TAX").reduce((sum, line) => sum + line.resource.data.totalMinor, 0);
  if (supplierCostTotal !== economics.supplierCostTotalMinor || freightTotal !== economics.freightTotalMinor || dutyTotal !== economics.dutyTotalMinor || reserveTotal !== economics.reserveTotalMinor || landedTotal !== economics.landedCostTotalMinor || beforeTax !== economics.clientPriceBeforeTaxMinor || discounts !== economics.discountTotalMinor || tax !== economics.taxTotalMinor || beforeTax - discounts + tax !== economics.totalMinor || beforeTax - discounts - landedTotal !== economics.grossMarginMinor || proposal.data.totalMinor !== economics.totalMinor) fail("ECONOMICS_MISMATCH", "Proposal line economics do not reconcile to the immutable Proposal Version.");
  const decisions = array(raw.decisions, "proposal.decisions").map((item, index) => { const decision = parseApprovalDecisionV1(item, proposal); sameTenant(tenantId, decision, `proposal.decisions[${index}]`); return decision; });
  const derivedDecisionState = decisions.some((item) => item.data.scope === "PROPOSAL" && item.data.decision === "APPROVE") ? "ACCEPTED" : decisions.some((item) => item.data.scope === "PROPOSAL" && item.data.decision === "REJECT") ? "REJECTED" : decisions.length ? "MIXED" : "PENDING";
  if (proposal.data.decisionState !== derivedDecisionState) fail("FINALITY_MISMATCH", "Proposal decision state does not derive from exact-version decisions.");
  const renders: ProposalRenderPreparationReadback[] = array(raw.renderPreparations, "proposal.renderPreparations").map((item, index) => { const render = exact(item, ["artifactRef", "createdAt", "evidenceRefs", "externalEffectAuthorized", "objectVersion", "preparationId", "proposalId", "proposalVersion", "providerAcknowledgementRef", "renderInputHash", "requestedArtifact", "sourceReadbackRef", "status", "templateId", "templateVersion"], `proposal.renderPreparations[${index}]`); if (render.status !== "PREPARED" || render.externalEffectAuthorized !== false || render.artifactRef !== null || render.providerAcknowledgementRef !== null || render.sourceReadbackRef !== null) fail("FALSE_FINALITY", "Render preparation cannot claim provider acknowledgement, artifact readback, delivery, or effect authority."); return { artifactRef: null, createdAt: timestamp(render.createdAt, "render.createdAt"), evidenceRefs: array(render.evidenceRefs, "render.evidenceRefs").map((entry, entryIndex) => id(entry, `render.evidenceRefs[${entryIndex}]`)), externalEffectAuthorized: false, objectVersion: id(render.objectVersion, "render.objectVersion"), preparationId: id(render.preparationId, "render.preparationId"), proposalId: id(render.proposalId, "render.proposalId"), proposalVersion: id(render.proposalVersion, "render.proposalVersion"), providerAcknowledgementRef: null, renderInputHash: id(render.renderInputHash, "render.renderInputHash"), requestedArtifact: render.requestedArtifact as "PDF" | "WEB", sourceReadbackRef: null, status: "PREPARED", templateId: id(render.templateId, "render.templateId"), templateVersion: id(render.templateVersion, "render.templateVersion") }; });
  const identity = exact(raw.identityMap, ["caseId", "proposalContextVersionId", "proposalDocumentVersionId", "quoteEconomicsVersionId", "quoteId"], "proposal.identityMap");
  return { decisions, economics, identityMap: { caseId: id(identity.caseId, "caseId"), proposalContextVersionId: id(identity.proposalContextVersionId, "proposalContextVersionId"), proposalDocumentVersionId: id(identity.proposalDocumentVersionId, "proposalDocumentVersionId"), quoteEconomicsVersionId: id(identity.quoteEconomicsVersionId, "quoteEconomicsVersionId"), quoteId: id(identity.quoteId, "quoteId") }, lines, proposal, renderPreparations: renders, template };
}

export function parseSeedProposalReadModel(value: unknown): SeedProposalReadModelV1 {
  const input = exact(value, ["contractVersion", "metadata", "projectVersion", "proposals"], "proposalReadModel"); if (input.contractVersion !== SEED_PROPOSAL_READ_MODEL_VERSION) fail("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${SEED_PROPOSAL_READ_MODEL_VERSION}.`);
  const metadata = exact(input.metadata, ["apiResponseContractVersion", "observedAt", "producerRepository", "projectId", "proposalContractProducerSha", "procurementCorrectionContractProducerSha", "releaseIdentity", "scheduleContractProducerSha", "seedProductContractProducerSha", "supplierIdentityContractProducerSha", "tenantId"], "proposalReadModel.metadata");
  if (metadata.apiResponseContractVersion !== API_HTTP_RESPONSE_VERSION || metadata.producerRepository !== "CIBOTFLOW/Luzione-API" || metadata.proposalContractProducerSha !== SEED_PROPOSAL_CONTRACT_PRODUCER_SHA || metadata.procurementCorrectionContractProducerSha !== SEED_PROCUREMENT_CORRECTION_CONTRACT_PRODUCER_SHA || metadata.scheduleContractProducerSha !== PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA || metadata.seedProductContractProducerSha !== SEED_PRODUCT_CONTRACT_PRODUCER_SHA || metadata.supplierIdentityContractProducerSha !== SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA) fail("PRODUCER_MISMATCH", "Proposal read model has an unadmitted producer SHA.");
  const tenantId = id(metadata.tenantId, "metadata.tenantId"); const projectId = id(metadata.projectId, "metadata.projectId"); const proposals = array(input.proposals, "proposals").map((proposal) => parseProposal(proposal, tenantId, projectId));
  return { contractVersion: SEED_PROPOSAL_READ_MODEL_VERSION, metadata: { apiResponseContractVersion: API_HTTP_RESPONSE_VERSION, observedAt: timestamp(metadata.observedAt, "metadata.observedAt"), producerRepository: "CIBOTFLOW/Luzione-API", projectId, proposalContractProducerSha: SEED_PROPOSAL_CONTRACT_PRODUCER_SHA, procurementCorrectionContractProducerSha: SEED_PROCUREMENT_CORRECTION_CONTRACT_PRODUCER_SHA, releaseIdentity: parseRelease(metadata.releaseIdentity), scheduleContractProducerSha: PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA, seedProductContractProducerSha: SEED_PRODUCT_CONTRACT_PRODUCER_SHA, supplierIdentityContractProducerSha: SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA, tenantId }, projectVersion: id(input.projectVersion, "projectVersion"), proposals };
}

export function createSeedProposalReadModel(data: { projectVersion: string; proposals: SeedProposalReadback[] }, metadata: { observedAt: string; projectId: string; releaseIdentity: ReleaseIdentity; tenantId: string }) {
  return parseSeedProposalReadModel({ contractVersion: SEED_PROPOSAL_READ_MODEL_VERSION, metadata: { apiResponseContractVersion: API_HTTP_RESPONSE_VERSION, observedAt: metadata.observedAt, producerRepository: "CIBOTFLOW/Luzione-API", projectId: metadata.projectId, proposalContractProducerSha: SEED_PROPOSAL_CONTRACT_PRODUCER_SHA, procurementCorrectionContractProducerSha: SEED_PROCUREMENT_CORRECTION_CONTRACT_PRODUCER_SHA, releaseIdentity: metadata.releaseIdentity, scheduleContractProducerSha: PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA, seedProductContractProducerSha: SEED_PRODUCT_CONTRACT_PRODUCER_SHA, supplierIdentityContractProducerSha: SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA, tenantId: metadata.tenantId }, projectVersion: data.projectVersion, proposals: data.proposals });
}
