import { canonicalJson, sha256 } from "@/modules/platform-guarantees/eventContract";
import type { ProposalEconomics, ProposalVersionLineInput } from "@/modules/seed-proposal-owner/contracts";

function stableId(prefix: string, value: unknown) { return `${prefix}_${sha256(value).slice(0, 40)}`; }

export function proposalTemplateVersion(id: string, revision: number) { return `proposal-template:${id}:v${revision}`; }
export function proposalVersion(id: string, revision: number) { return `proposal-version:${id}:v${revision}`; }
export function approvalDecisionVersion(id: string) { return `approval-decision:${id}:v1`; }
export function renderPreparationVersion(id: string) { return `proposal-render-preparation:${id}:v1`; }
export function proposalDocumentVersionIdFor(tenantId: string, proposalId: string, revision: number) { return stableId("proposal_document", { proposalId, revision, tenantId }); }
export function proposalContextVersionIdFor(tenantId: string, proposalId: string, revision: number) { return stableId("proposal_context", { proposalId, revision, tenantId }); }
export function quoteExternalIdFor(tenantId: string, proposalId: string, revision: number) { return stableId("proposal_quote", { proposalId, revision, tenantId }); }
export function approvalDecisionIdFor(tenantId: string, input: { actorId: string; proposalId: string; proposalVersion: string; scope: string; targetId: string }) { return stableId("approval_decision", { ...input, tenantId }); }
export function proposalReviewVersionIdFor(decisionId: string) { return stableId("proposal_review", { decisionId }); }
export function renderPreparationIdFor(tenantId: string, input: { proposalId: string; proposalVersion: string; renderInputHash: string; requestedArtifact: string }) { return stableId("proposal_render_preparation", { ...input, tenantId }); }

export function sourceRefString(ref: ProposalVersionLineInput["sourceRef"]) { return `${ref.ownerProject}:${ref.objectType}:${ref.objectId}@${ref.version}`; }

export function deriveProposalEconomics(lines: readonly ProposalVersionLineInput[]): ProposalEconomics {
  let clientPriceBeforeTaxMinor = 0; let discountTotalMinor = 0; let dutyTotalMinor = 0; let freightTotalMinor = 0;
  let landedCostTotalMinor = 0; let reserveTotalMinor = 0; let supplierCostTotalMinor = 0; let taxTotalMinor = 0;
  for (const line of lines) {
    supplierCostTotalMinor += line.supplierCostMinor * line.quantity;
    freightTotalMinor += line.freightMinor;
    dutyTotalMinor += line.dutyMinor;
    reserveTotalMinor += line.reserveMinor;
    landedCostTotalMinor += line.landedCostMinor;
    if (line.lineType === "DISCOUNT") discountTotalMinor += line.totalMinor;
    else if (line.lineType === "TAX") taxTotalMinor += line.totalMinor;
    else clientPriceBeforeTaxMinor += line.totalMinor;
  }
  const totalMinor = clientPriceBeforeTaxMinor - discountTotalMinor + taxTotalMinor;
  const grossMarginMinor = clientPriceBeforeTaxMinor - discountTotalMinor - landedCostTotalMinor;
  return { clientPriceBeforeTaxMinor, discountTotalMinor, dutyTotalMinor, freightTotalMinor, grossMarginMinor, landedCostTotalMinor, reserveTotalMinor, supplierCostTotalMinor, taxTotalMinor, totalMinor };
}

export function proposalEconomicsDefects(lines: readonly ProposalVersionLineInput[], claimed: ProposalEconomics) {
  const defects: string[] = [];
  for (const line of lines) {
    const expectedTotal = line.unitPriceMinor * line.quantity;
    const expectedLanded = line.supplierCostMinor * line.quantity + line.freightMinor + line.dutyMinor + line.reserveMinor;
    if (!Number.isSafeInteger(expectedTotal) || line.totalMinor !== expectedTotal) defects.push(`LINE_TOTAL_MISMATCH:${line.lineId}`);
    if (!Number.isSafeInteger(expectedLanded) || line.landedCostMinor !== expectedLanded) defects.push(`LINE_LANDED_COST_MISMATCH:${line.lineId}`);
    if (["DISCOUNT", "TAX"].includes(line.lineType) && expectedLanded !== 0) defects.push(`NON_COST_LINE_HAS_LANDED_COST:${line.lineId}`);
  }
  const derived = deriveProposalEconomics(lines);
  for (const key of Object.keys(derived).sort() as Array<keyof ProposalEconomics>) if (derived[key] !== claimed[key]) defects.push(`PROPOSAL_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}_MISMATCH`);
  if (claimed.totalMinor < 0) defects.push("PROPOSAL_TOTAL_NEGATIVE");
  return defects;
}

const MERGE_TOKENS = new Set([
  "client.address", "client.name", "project.account_name", "project.name", "proposal.currency",
  "proposal.lines", "proposal.number", "proposal.subtotal", "proposal.tax", "proposal.total",
]);

export function templateValidationIssues(input: {
  format: string;
  mergeTokens: readonly string[];
  pdf: null | { acroFormFields: readonly string[]; mode: string; overlayMapDigest: string | null; overlayMapVersion: string | null };
}) {
  const issues: string[] = [];
  for (const token of input.mergeTokens) if (!MERGE_TOKENS.has(token)) issues.push(`UNSUPPORTED_MERGE_TOKEN:${token}`);
  if (["DOCX", "HTML"].includes(input.format) && input.mergeTokens.length === 0) issues.push("MERGE_TOKENS_REQUIRED");
  if (input.format === "PDF_ACROFORM" && input.pdf?.acroFormFields.length === 0) issues.push("ACROFORM_FIELDS_REQUIRED");
  if (input.format === "PDF_OVERLAY" && input.pdf?.mode === "UNSUPPORTED") issues.push("PDF_REQUIRES_ACROFORM_OR_VERSIONED_OVERLAY");
  if (input.format === "PDF_OVERLAY" && input.pdf?.mode === "OVERLAY" && (!input.pdf.overlayMapDigest || !input.pdf.overlayMapVersion)) issues.push("VERSIONED_OVERLAY_MAP_REQUIRED");
  return [...new Set(issues)].sort();
}

export function expectedRenderInputHash(input: unknown) { return sha256(JSON.parse(canonicalJson(input))); }
