import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { proposalTemplateVersion, proposalVersion } from "@/modules/seed-proposal-owner/model";
import { SEED_PROPOSAL_COMMAND_VERSION, type ProposalApprovalDecisionCommand, type ProposalRenderPrepareCommand, type ProposalTemplateSaveVersionCommand, type ProposalVersionWriteCommand } from "@/modules/seed-proposal-owner/contracts";

export const A2P_FIXTURE = Object.freeze({
  artifactId: "evidence-artifact-proposal-a2p",
  candidateId: "product-candidate-proposal-a2p",
  caseId: "case-proposal-a2p",
  projectId: "project-proposal-a2p",
  projectVersion: "project:project-proposal-a2p:v1",
  proposalId: "proposal-a2p",
  specificationId: "specification-proposal-a2p",
  specificationLineId: "specification-line-proposal-a2p",
  templateId: "proposal-template-a2p",
});

export const proposalTemplateCommandFixture: ProposalTemplateSaveVersionCommand = {
  commandId: "command-proposal-template-a2p",
  commandType: "proposal_template.save_version",
  contractVersion: SEED_PROPOSAL_COMMAND_VERSION,
  evidenceRefs: ["evidence:template-scan-a2p"],
  expectedVersion: "ABSENT",
  idempotencyKey: "idem-proposal-template-a2p",
  template: {
    contentDigest: sha256("proposal-template-a2p"),
    format: "DOCX",
    malwareScanEvidenceRef: { objectId: A2P_FIXTURE.artifactId, objectType: "EVIDENCE_ARTIFACT", ownerProject: "LUZIONE_PROCUREMENT", version: `evidence-artifact:${A2P_FIXTURE.artifactId}:v1` },
    malwareScanState: "CLEAN",
    mergeTokens: ["project.name", "proposal.lines", "proposal.total"],
    name: "Residential Proposal",
    pdf: null,
    storageObjectRef: "private-object:tenant-proposal-a2p:templates.residential-v1.docx",
    tokenSchemaVersion: "ProposalMergeTokens/v1",
  },
  templateId: A2P_FIXTURE.templateId,
};

export const proposalVersionCommandFixture: ProposalVersionWriteCommand = {
  caseId: A2P_FIXTURE.caseId,
  commandId: "command-proposal-version-a2p",
  commandType: "proposal_version.create",
  contractVersion: SEED_PROPOSAL_COMMAND_VERSION,
  currency: "USD",
  economics: {
    clientPriceBeforeTaxMinor: 700_000,
    discountTotalMinor: 25_000,
    dutyTotalMinor: 15_000,
    freightTotalMinor: 30_000,
    grossMarginMinor: 230_000,
    landedCostTotalMinor: 445_000,
    reserveTotalMinor: 10_000,
    supplierCostTotalMinor: 390_000,
    taxTotalMinor: 54_000,
    totalMinor: 729_000,
  },
  evidenceRefs: ["evidence:brief-a2p", "evidence:economics-a2p"],
  expectedVersion: "ABSENT",
  idempotencyKey: "idem-proposal-version-a2p",
  lines: [
    {
      confidence: { score: 0.92, sourceFreshAt: "2026-09-06T00:00:00.000Z" },
      description: "Oak frame sofa",
      dutyMinor: 15_000,
      freightMinor: 30_000,
      landedCostMinor: 445_000,
      lineId: "proposal-line-product-a2p",
      lineType: "PRODUCT",
      optionGroupId: "option-group-seating-a2p",
      quantity: 1,
      reserveMinor: 10_000,
      sectionId: "section-living-room-a2p",
      sourceRef: { objectId: A2P_FIXTURE.candidateId, objectType: "PRODUCT_CANDIDATE", ownerProject: "LUZIONE_PROCUREMENT", version: `product-candidate:${A2P_FIXTURE.candidateId}:v1` },
      specificationLineRef: { objectId: A2P_FIXTURE.specificationLineId, objectType: "SPECIFICATION_LINE", ownerProject: "LUZIONE_PROJECT", version: `specification-line:${A2P_FIXTURE.specificationLineId}:v1` },
      supplierCostMinor: 390_000,
      totalMinor: 600_000,
      unitPriceMinor: 600_000,
    },
    {
      confidence: { score: 1, sourceFreshAt: "2026-09-06T00:00:00.000Z" }, description: "Design fee", dutyMinor: 0, freightMinor: 0, landedCostMinor: 0,
      lineId: "proposal-line-design-a2p", lineType: "DESIGN_FEE", optionGroupId: null, quantity: 1, reserveMinor: 0, sectionId: "section-services-a2p",
      sourceRef: { objectId: A2P_FIXTURE.projectId, objectType: "PROJECT", ownerProject: "LUZIONE_PROJECT", version: A2P_FIXTURE.projectVersion }, specificationLineRef: null, supplierCostMinor: 0, totalMinor: 100_000, unitPriceMinor: 100_000,
    },
    {
      confidence: { score: 1, sourceFreshAt: "2026-09-06T00:00:00.000Z" }, description: "Project discount", dutyMinor: 0, freightMinor: 0, landedCostMinor: 0,
      lineId: "proposal-line-discount-a2p", lineType: "DISCOUNT", optionGroupId: null, quantity: 1, reserveMinor: 0, sectionId: "section-commercial-a2p",
      sourceRef: { objectId: A2P_FIXTURE.projectId, objectType: "PROJECT", ownerProject: "LUZIONE_PROJECT", version: A2P_FIXTURE.projectVersion }, specificationLineRef: null, supplierCostMinor: 0, totalMinor: 25_000, unitPriceMinor: 25_000,
    },
    {
      confidence: { score: 1, sourceFreshAt: "2026-09-06T00:00:00.000Z" }, description: "Sales tax", dutyMinor: 0, freightMinor: 0, landedCostMinor: 0,
      lineId: "proposal-line-tax-a2p", lineType: "TAX", optionGroupId: null, quantity: 1, reserveMinor: 0, sectionId: "section-commercial-a2p",
      sourceRef: { objectId: A2P_FIXTURE.projectId, objectType: "PROJECT", ownerProject: "LUZIONE_PROJECT", version: A2P_FIXTURE.projectVersion }, specificationLineRef: null, supplierCostMinor: 0, totalMinor: 54_000, unitPriceMinor: 54_000,
    },
  ],
  projectRef: { projectId: A2P_FIXTURE.projectId, projectVersion: A2P_FIXTURE.projectVersion },
  proposalId: A2P_FIXTURE.proposalId,
  specificationRefs: [{ objectId: A2P_FIXTURE.specificationId, objectType: "SPECIFICATION", ownerProject: "LUZIONE_PROJECT", version: `specification:${A2P_FIXTURE.specificationId}:v1` }],
  templateRef: { templateId: A2P_FIXTURE.templateId, templateVersion: proposalTemplateVersion(A2P_FIXTURE.templateId, 1) },
};

export const proposalDecisionCommandFixture: ProposalApprovalDecisionCommand = {
  commandId: "command-proposal-decision-a2p", commandType: "approval_decision.record", comment: "Approved for procurement", contractVersion: SEED_PROPOSAL_COMMAND_VERSION,
  decision: "APPROVE", evidenceRefs: ["evidence:client-approval-a2p"], expectedVersion: proposalVersion(A2P_FIXTURE.proposalId, 1), idempotencyKey: "idem-proposal-decision-a2p", proposalId: A2P_FIXTURE.proposalId, scope: "PROPOSAL", targetId: A2P_FIXTURE.proposalId,
};

export function proposalRenderCommandFixture(renderInputHash: string): ProposalRenderPrepareCommand {
  return { commandId: "command-proposal-render-a2p", commandType: "proposal_render.prepare", contractVersion: SEED_PROPOSAL_COMMAND_VERSION, evidenceRefs: ["evidence:render-request-a2p"], expectedVersion: proposalVersion(A2P_FIXTURE.proposalId, 1), idempotencyKey: "idem-proposal-render-a2p", proposalId: A2P_FIXTURE.proposalId, renderInputHash, requestedArtifact: "PDF" };
}
