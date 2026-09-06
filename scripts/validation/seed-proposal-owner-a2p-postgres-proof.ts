import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { HUMAN_APPROVAL_SUBJECT_VERSION } from "@/modules/onboard-core/humanApproval";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import {
  ROOM_PLANNER_OWNER,
  SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
  canonicalProjectPackageHash,
  parseProjectCreationCommand,
  parseProjectPackageCommand,
  type ProjectPackagePayload,
} from "@/modules/seed-project-publication/contracts";
import { SeedProjectPublicationStore } from "@/modules/seed-project-publication/store";
import {
  SEED_PROCUREMENT_COMMAND_VERSION,
  parseSeedProcurementCommand,
  type BidComparisonCreateCommand,
  type EvidenceArtifactRegisterCommand,
  type ObjectiveFit,
  type ProcurementSelectionRecordCommand,
  type ProductCandidateRecordCommand,
  type ProductSourceRecordCommand,
  type PurchaseOrderAcknowledgementRecordCommand,
  type PurchaseOrderDraftCreateCommand,
  type RFQDraftCreateCommand,
  type SupplierQuoteNormalizeCommand,
} from "@/modules/seed-procurement/contracts";
import { SeedProcurementDomainError, SeedProcurementStore } from "@/modules/seed-procurement/store";
import { parseSeedSupplierIdentityCommand, SUPPLIER_PROFILE_COMMAND_VERSION, type SupplierProfileFacts } from "@/modules/seed-supplier-identity/contracts";
import { SeedSupplierIdentityStore } from "@/modules/seed-supplier-identity/store";
import {
  SEED_PROPOSAL_COMMAND_VERSION,
  parseSeedProposalCommand,
  type ProposalApprovalDecisionCommand,
  type ProposalRenderPrepareCommand,
  type ProposalTemplateSaveVersionCommand,
  type ProposalVersionLineInput,
  type ProposalVersionWriteCommand,
} from "@/modules/seed-proposal-owner/contracts";
import {
  deriveProposalEconomics,
  expectedRenderInputHash,
  proposalTemplateVersion,
  proposalVersion,
} from "@/modules/seed-proposal-owner/model";
import { createSeedProposalReadModel, parseSeedProposalReadModel } from "@/modules/seed-proposal-owner/readModel";
import {
  requireAcceptedCanonicalProposalVersion,
  SeedProposalDomainError,
  SeedProposalStore,
  type VerifiedProposalClientGrant,
} from "@/modules/seed-proposal-owner/store";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString, max: 12 });
const tenantId = "tenant-proof-a";
const requestedAt = "2026-09-05T10:00:00.000Z";
const actor: ApiActor = {
  actorId: "service:proposal-owner-proof",
  actorType: "service",
  capabilities: ["project.command", "project.read", "procurement.command", "procurement.read", "proposal.command", "proposal.read", "supplier.profile.command"],
  source: "service-token",
  tenantId,
};
const otherTenant: ApiActor = { ...actor, tenantId: "tenant-proof-b" };
const fit: ObjectiveFit = {
  inputs: { leadTime: 0.8, margin: 0.9, price: 0.7, sourceFreshness: 1, specificationMatch: 0.95, supplierReliability: 0.75 },
  weights: { leadTime: 0.15, margin: 0.15, price: 0.2, sourceFreshness: 0.1, specificationMatch: 0.3, supplierReliability: 0.1 },
};

function projectCommand() {
  return parseProjectCreationCommand({
    commandId: "command-a2p-project",
    commandType: "project.create_from_opportunity",
    contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
    expectedVersion: "ABSENT",
    idempotencyKey: "idempotency-a2p-project",
    opportunityRef: { objectId: "opportunity-primary", version: "opportunity:opportunity-primary:v4" },
    project: {
      accountId: "account-primary",
      briefRefs: ["brief:a2p"],
      budget: { amountMinor: 9_000_000, currency: "USD" },
      decisionRefs: [], evidenceRefs: ["evidence:a2p-discovery"], name: "A2P Proof Project",
      ownerId: actor.actorId, spaceBriefs: [{ floor: "1", kind: "ROOM", name: "Living Room", sequence: 1 }],
      stakeholderRefs: [], targetEndAt: "2027-01-01T00:00:00.000Z", targetStartAt: "2026-10-01T00:00:00.000Z", taskRefs: [],
    },
  });
}

function packagePayload(): ProjectPackagePayload {
  const value: ProjectPackagePayload = {
    assetRefs: [], packageHash: "0".repeat(64),
    plannerProjectRef: { objectId: "planner-project-a2p", objectType: "PLANNER_PROJECT", ownerProject: ROOM_PLANNER_OWNER, version: "planner-project-a2p:v1" },
    provenanceRefs: ["evidence:a2p-planner"], sourceVersionHash: "b".repeat(64),
    spaces: [{ floor: "1", kind: "ROOM", name: "Living Room", plannerRef: { objectId: "planner-space-a2p", objectType: "PLANNER_SPACE", ownerProject: ROOM_PLANNER_OWNER, version: "planner-space-a2p:v1" }, sequence: 1 }],
    specifications: [{
      lines: [{ approvalState: "APPROVED", deliveryRisk: "MEDIUM", description: "Sofa", plannerRef: { objectId: "planner-line-a2p", objectType: "PLANNER_SPECIFICATION_LINE", ownerProject: ROOM_PLANNER_OWNER, version: "planner-line-a2p:v1" }, productCandidateIds: [], quantity: 2, selectedCandidateId: null, sourcingState: "NOT_STARTED", spacePlannerObjectId: "planner-space-a2p", unit: "each" }],
      plannerRef: { objectId: "planner-spec-a2p", objectType: "PLANNER_SPECIFICATION", ownerProject: ROOM_PLANNER_OWNER, version: "planner-spec-a2p:v1" },
      spacePlannerObjectIds: ["planner-space-a2p"], title: "Living Room FF&E",
    }],
    uncertainty: [],
  };
  value.packageHash = canonicalProjectPackageHash(value);
  return value;
}

function procurementCommon(commandId: string, commandType: string) {
  return { commandId, commandType, contractVersion: SEED_PROCUREMENT_COMMAND_VERSION, expectedVersion: "ABSENT", idempotencyKey: `idempotency-${commandId}` };
}

function human(): HumanApprovalSubject {
  return { actorId: "user:client-a2p", actorType: "user", authenticationRef: "supabase-session:client-a2p:verified", authenticatedAt: "2026-09-05T09:58:00.000Z", capabilities: ["proposal.client_decision.record"], contractVersion: HUMAN_APPROVAL_SUBJECT_VERSION, source: "supabase-user-jwt", tenantId };
}

function authorityHuman(actorId: string, capability: string, authenticatedAt = "2026-09-05T09:58:00.000Z"): HumanApprovalSubject {
  return { actorId, actorType: "user", authenticationRef: `supabase-session:${actorId}:${capability}`, authenticatedAt, capabilities: [capability], contractVersion: HUMAN_APPROVAL_SUBJECT_VERSION, source: "supabase-user-jwt", tenantId };
}

async function activateSupplier(accountId: string, suffix: string, evidence: { id: string; version: string }) {
  const store = new SeedSupplierIdentityStore(pool);
  const facts: SupplierProfileFacts = {
    approvedCategories: ["FURNITURE"], approvedRegions: ["USA"], capabilities: ["CATALOG_SOURCE", "QUOTE_SUBMISSION", "RFQ_RESPONSE"], contactRefs: [],
    evidenceRefs: [{ objectId: evidence.id, objectType: "EVIDENCE_ARTIFACT", ownerProject: "LUZIONE_PROCUREMENT", version: evidence.version }],
    identityReview: { conflictRefs: [], duplicateAccountRefs: [] }, provenanceRefs: [`proof:${suffix}`], validFrom: "2026-09-05T09:00:00.000Z", validUntil: "2026-10-05T09:00:00.000Z",
  };
  const proposed = await store.execute({ actor, command: parseSeedSupplierIdentityCommand({ accountId, accountVersion: `account:${accountId}:v1`, commandId: `supplier-propose-${suffix}`, commandType: "supplier_profile.propose", contractVersion: SUPPLIER_PROFILE_COMMAND_VERSION, expectedVersion: "ABSENT", idempotencyKey: `supplier-propose-${suffix}`, profile: facts }), correlationId: `correlation-supplier-propose-${suffix}`, human: authorityHuman(`user:supplier-proposer-${suffix}`, "supplier.profile.propose", "2026-09-05T09:50:00.000Z"), requestedAt: "2026-09-05T09:51:00.000Z" });
  return store.execute({ actor, command: parseSeedSupplierIdentityCommand({ action: "ACTIVATE", commandId: `supplier-activate-${suffix}`, commandType: "supplier_profile.transition", contractVersion: SUPPLIER_PROFILE_COMMAND_VERSION, evidenceRefs: facts.evidenceRefs, expectedVersion: proposed.readback.supplierProfile.resource.version, idempotencyKey: `supplier-activate-${suffix}`, reason: "A2P PO proof supplier activation.", supplierProfileId: proposed.readback.supplierProfile.resource.id }), correlationId: `correlation-supplier-activate-${suffix}`, human: authorityHuman(`user:supplier-approver-${suffix}`, "supplier.profile.activate", "2026-09-05T09:52:00.000Z"), requestedAt: "2026-09-05T09:53:00.000Z" });
}

function grant(proposalId: string, exactProposalVersion: string): VerifiedProposalClientGrant {
  return { accessLevel: "contribute", actorId: human().actorId, grantId: "portal-grant-client-a2p", observedAt: "2026-09-05T09:59:00.000Z", organizationId: "portal-org-client-a2p", proposalId, proposalVersion: exactProposalVersion, status: "ACTIVE", tenantId, validUntil: null, version: "portal-grant-client-a2p:v1" };
}

function proposalLines(input: { candidateId: string; candidateVersion: string; projectId: string; projectVersion: string; specificationLineId: string; specificationLineVersion: string }): ProposalVersionLineInput[] {
  const projectSource = { objectId: input.projectId, objectType: "PROJECT" as const, ownerProject: "LUZIONE_PROJECT" as const, version: input.projectVersion };
  const fee = (lineId: string, lineType: ProposalVersionLineInput["lineType"], unitPriceMinor: number, sectionId = "section-services-a2p"): ProposalVersionLineInput => ({ confidence: { score: 1, sourceFreshAt: requestedAt }, description: lineId, dutyMinor: 0, freightMinor: 0, landedCostMinor: 0, lineId, lineType, optionGroupId: null, quantity: 1, reserveMinor: 0, sectionId, sourceRef: projectSource, specificationLineRef: null, supplierCostMinor: 0, totalMinor: unitPriceMinor, unitPriceMinor });
  return [
    { confidence: { score: 0.92, sourceFreshAt: requestedAt }, description: "Oak frame sofa", dutyMinor: 500, freightMinor: 1_000, landedCostMinor: 22_000, lineId: "line-product-a2p", lineType: "PRODUCT", optionGroupId: "option-seating-a2p", quantity: 2, reserveMinor: 500, sectionId: "section-room-a2p", sourceRef: { objectId: input.candidateId, objectType: "PRODUCT_CANDIDATE", ownerProject: "LUZIONE_PROCUREMENT", version: input.candidateVersion }, specificationLineRef: { objectId: input.specificationLineId, objectType: "SPECIFICATION_LINE", ownerProject: "LUZIONE_PROJECT", version: input.specificationLineVersion }, supplierCostMinor: 10_000, totalMinor: 36_000, unitPriceMinor: 18_000 },
    fee("line-design-a2p", "DESIGN_FEE", 5_000),
    fee("line-service-a2p", "SERVICE_FEE", 3_000),
    fee("line-procurement-a2p", "PROCUREMENT_FEE", 2_500),
    fee("line-freight-a2p", "FREIGHT", 1_500),
    fee("line-installation-a2p", "DELIVERY_INSTALLATION", 4_000),
    fee("line-discount-a2p", "DISCOUNT", 2_000, "section-commercial-a2p"),
    fee("line-tax-a2p", "TAX", 4_125, "section-commercial-a2p"),
  ];
}

function templateCommand(scanRef: ProposalTemplateSaveVersionCommand["template"]["malwareScanEvidenceRef"], overrides: Partial<ProposalTemplateSaveVersionCommand> = {}) {
  return parseSeedProposalCommand({
    commandId: "command-template-a2p", commandType: "proposal_template.save_version", contractVersion: SEED_PROPOSAL_COMMAND_VERSION,
    evidenceRefs: ["evidence:template-scan-a2p"], expectedVersion: "ABSENT", idempotencyKey: "idempotency-template-a2p",
    template: { contentDigest: sha256("template-a2p-v1"), format: "DOCX", malwareScanEvidenceRef: scanRef, malwareScanState: "CLEAN", mergeTokens: ["project.name", "proposal.lines", "proposal.total"], name: "A2P Residential Proposal", pdf: null, storageObjectRef: `private-object:${tenantId}:proposal-template-a2p-v1.docx`, tokenSchemaVersion: "ProposalMergeTokens/v1" },
    templateId: "template-a2p", ...overrides,
  }) as ProposalTemplateSaveVersionCommand;
}

function proposalCommand(input: { commandId: string; expectedVersion: string; lines: ProposalVersionLineInput[]; proposalId: string; projectId: string; projectVersion: string; specificationId: string; specificationVersion: string; templateId?: string; templateVersion?: string }) {
  return parseSeedProposalCommand({
    caseId: "case-proposal-a2p", commandId: input.commandId,
    commandType: input.expectedVersion === "ABSENT" ? "proposal_version.create" : "proposal_version.revise",
    contractVersion: SEED_PROPOSAL_COMMAND_VERSION, currency: "USD", economics: deriveProposalEconomics(input.lines), evidenceRefs: ["evidence:brief-a2p", "evidence:economics-a2p"], expectedVersion: input.expectedVersion,
    idempotencyKey: `idempotency-${input.commandId}`, lines: input.lines,
    projectRef: { projectId: input.projectId, projectVersion: input.projectVersion }, proposalId: input.proposalId,
    specificationRefs: [{ objectId: input.specificationId, objectType: "SPECIFICATION", ownerProject: "LUZIONE_PROJECT", version: input.specificationVersion }],
    templateRef: { templateId: input.templateId ?? "template-a2p", templateVersion: input.templateVersion ?? proposalTemplateVersion("template-a2p", 1) },
  }) as ProposalVersionWriteCommand;
}

function decisionCommand(input: { commandId: string; proposalId: string; proposalVersion: string; scope: ProposalApprovalDecisionCommand["scope"]; targetId: string }) {
  return parseSeedProposalCommand({ commandId: input.commandId, commandType: "approval_decision.record", comment: "Client proof decision", contractVersion: SEED_PROPOSAL_COMMAND_VERSION, decision: "APPROVE", evidenceRefs: [`evidence:${input.commandId}`], expectedVersion: input.proposalVersion, idempotencyKey: `idempotency-${input.commandId}`, proposalId: input.proposalId, scope: input.scope, targetId: input.targetId }) as ProposalApprovalDecisionCommand;
}

function proposalInput(command: ReturnType<typeof parseSeedProposalCommand>, correlationId: string, additions: { clientGrant?: VerifiedProposalClientGrant; human?: HumanApprovalSubject } = {}) {
  return { actor, command, correlationId, requestedAt, ...additions };
}

async function tenantQuery<T>(tenant: string, sql: string, values: unknown[] = []) {
  const client = await pool.connect();
  try { await client.query("begin read only"); await client.query("select set_config('app.tenant_id',$1,true)", [tenant]); const result = await client.query(sql, values); await client.query("commit"); return result.rows as T[]; }
  catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

async function withTenantClient<T>(tenant: string, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("begin read only"); await client.query("select set_config('app.tenant_id',$1,true)", [tenant]); const value = await operation(client); await client.query("commit"); return value; }
  catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

function proposalError(code: string) { return (error: unknown) => error instanceof SeedProposalDomainError && error.code === code; }

async function main() {
  try {
    const projectStore = new SeedProjectPublicationStore(pool);
    const createdProject = await projectStore.executeProjectCreate({ actor, command: projectCommand(), correlationId: "correlation-a2p-project", requestedAt });
    const projectId = createdProject.readback.resource.id;
    const projectVersion = createdProject.readback.resource.version;
    const publication = parseProjectPackageCommand({ commandId: "command-a2p-package", commandType: "project_package.publish", contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION, expectedVersion: "ABSENT", idempotencyKey: "idempotency-a2p-package", package: packagePayload(), projectId, projectVersion });
    if (publication.commandType !== "project_package.publish") throw new Error("Unexpected publication command.");
    const published = await projectStore.executePackagePublish({ actor, command: publication, correlationId: "correlation-a2p-package", requestedAt });
    const specificationId = published.canonicalIds.specificationIds[0];
    const specificationLineId = published.canonicalIds.specificationLineIds[0];
    const specificationVersion = `specification:${specificationId}:v1`;
    const specificationLineVersion = `specification-line:${specificationLineId}:v1`;

    const procurementStore = new SeedProcurementStore(pool);
    const scanEvidenceCommand = parseSeedProcurementCommand({ ...procurementCommon("evidence-template-scan-a2p", "evidence_artifact.register"), artifact: { capturedAt: "2026-09-05T09:45:00.000Z", confidence: 1, contentDigest: sha256("clean-template-scan-a2p"), kind: "DOCUMENT", mimeType: "application/json", promptInjectionState: "CLEAR", provider: "MALWARE_SCANNER", sourceRecordRef: "scan-template-a2p", storageRef: `private-object:${tenantId}:scan-template-a2p.json` }, projectRef: null }) as EvidenceArtifactRegisterCommand;
    const scanEvidence = await procurementStore.executeEvidence({ actor, command: scanEvidenceCommand, correlationId: "correlation-template-scan-a2p", requestedAt });
    const productEvidenceCommand = parseSeedProcurementCommand({ ...procurementCommon("evidence-product-a2p", "evidence_artifact.register"), artifact: { capturedAt: "2026-09-05T09:46:00.000Z", confidence: 0.95, contentDigest: sha256("product-source-a2p"), kind: "UPLOAD", mimeType: "text/csv", promptInjectionState: "CLEAR", provider: "OPERATOR_UPLOAD", sourceRecordRef: "product-upload-a2p", storageRef: `private-object:${tenantId}:product-upload-a2p.csv` }, projectRef: { projectId, projectVersion } }) as EvidenceArtifactRegisterCommand;
    const productEvidence = await procurementStore.executeEvidence({ actor, command: productEvidenceCommand, correlationId: "correlation-product-evidence-a2p", requestedAt });
    const sourceCommand = parseSeedProcurementCommand({ ...procurementCommon("source-product-a2p", "product_source.record"), artifactId: productEvidence.readback.resource.id, artifactVersion: productEvidence.readback.resource.version, conflictRefs: [], duplicateOfSourceId: null, extractionProvenance: ["parser:csv-a2p-v1"], ingestionFormat: "CSV", projectRef: { projectId, projectVersion }, source: { contentDigest: sha256("product-source-a2p"), kind: "XLSX", locator: `private-object:${tenantId}:product-upload-a2p.csv`, observedAt: "2026-09-05T09:46:00.000Z", validUntil: "2026-10-05T09:46:00.000Z" }, upstreamArtifactRefs: [] }) as ProductSourceRecordCommand;
    const source = await procurementStore.executeProductSource({ actor, command: sourceCommand, correlationId: "correlation-product-source-a2p", requestedAt });
    const candidateCommand = parseSeedProcurementCommand({ ...procurementCommon("candidate-product-a2p", "product_candidate.record"), candidate: { attributes: { material: "oak" }, confidence: { score: 0.92, sourceFreshAt: requestedAt }, lane: "OUTSIDE_PRODUCT", leadTimeDays: 42, price: { amountMinor: 10_000, currency: "USD" }, sku: "SOFA-A2P", title: "Oak Sofa", vendorId: null }, conflictRefs: [], duplicateOfCandidateId: null, extractionProvenance: ["parser:csv-a2p-v1:row-1"], fit, productIdentityRef: "product:sofa-a2p", productSourceId: source.readback.resource.resource.id, productSourceVersion: source.readback.resource.resource.version, projectRef: { projectId, projectVersion } }) as ProductCandidateRecordCommand;
    const candidate = await procurementStore.executeProductCandidate({ actor, command: candidateCommand, correlationId: "correlation-product-candidate-a2p", requestedAt });
    assert.equal(candidate.readback.resource.resource.status, "ELIGIBLE");

    await activateSupplier("supplier-account-a", "a2p-a", { id: productEvidence.readback.resource.id, version: productEvidence.readback.resource.version });
    await activateSupplier("supplier-account-a2", "a2p-a2", { id: productEvidence.readback.resource.id, version: productEvidence.readback.resource.version });
    const rfqBase = { dueAt: "2026-09-20T00:00:00.000Z", evidenceRefs: ["evidence:rfq-a2p"], projectId, projectVersion, requestedFields: ["unit_price", "lead_time"], specificationId, specificationLines: [{ specificationLineId, specificationLineVersion }], specificationVersion };
    const rfqACommand = parseSeedProcurementCommand({ ...procurementCommon("rfq-a2p-a", "rfq.create_draft"), ...rfqBase, supplierId: "supplier-account-a" }) as RFQDraftCreateCommand;
    const rfqA2Command = parseSeedProcurementCommand({ ...procurementCommon("rfq-a2p-a2", "rfq.create_draft"), ...rfqBase, supplierId: "supplier-account-a2" }) as RFQDraftCreateCommand;
    const [rfqA, rfqA2] = await Promise.all([
      procurementStore.executeRfq({ actor, command: rfqACommand, correlationId: "correlation-rfq-a2p-a", requestedAt }),
      procurementStore.executeRfq({ actor, command: rfqA2Command, correlationId: "correlation-rfq-a2p-a2", requestedAt }),
    ]);
    const quoteEvidence = async (suffix: string, digest: string) => {
      const command = parseSeedProcurementCommand({ ...procurementCommon(`evidence-quote-a2p-${suffix}`, "evidence_artifact.register"), artifact: { capturedAt: "2026-09-05T09:54:00.000Z", confidence: 0.95, contentDigest: digest, kind: "EMAIL", mimeType: "message/rfc822", promptInjectionState: "CLEAR", provider: "GMAIL", sourceRecordRef: `gmail-quote-a2p-${suffix}`, storageRef: `private-object:${tenantId}:gmail-quote-a2p-${suffix}.eml` }, projectRef: { projectId, projectVersion } }) as EvidenceArtifactRegisterCommand;
      return procurementStore.executeEvidence({ actor, command, correlationId: `correlation-evidence-quote-a2p-${suffix}`, requestedAt });
    };
    const [evidenceQuoteA, evidenceQuoteA2] = await Promise.all([quoteEvidence("a", "1".repeat(64)), quoteEvidence("a2", "2".repeat(64))]);
    const quoteLine = { clientUnitPriceMinor: 18_000, dutyMinor: 500, freightMinor: 1_000, incoterm: "FOB", leadTimeDays: 42, objectiveFit: fit, packageFacts: "one carton", paymentTerms: "50/50", quantity: 2, reserveMinor: 500, rfqLineId: specificationLineId, unitPrice: { amountMinor: 10_000, currency: "USD" }, warranty: "two years" };
    const quoteACommand = parseSeedProcurementCommand({ ...procurementCommon("quote-a2p-a", "supplier_quote.normalize"), evidenceArtifactId: evidenceQuoteA.readback.resource.id, evidenceArtifactVersion: evidenceQuoteA.readback.resource.version, lines: [quoteLine], projectId, projectVersion, responseSource: "EMAIL", reviewReasons: [], rfqId: rfqA.readback.resource.id, rfqVersion: rfqA.readback.resource.version, supplierId: "supplier-account-a", validUntil: "2026-10-01T00:00:00.000Z" }) as SupplierQuoteNormalizeCommand;
    const quoteA2Command = parseSeedProcurementCommand({ ...procurementCommon("quote-a2p-a2", "supplier_quote.normalize"), evidenceArtifactId: evidenceQuoteA2.readback.resource.id, evidenceArtifactVersion: evidenceQuoteA2.readback.resource.version, lines: [{ ...quoteLine, clientUnitPriceMinor: 17_000, unitPrice: { amountMinor: 9_000, currency: "USD" } }], projectId, projectVersion, responseSource: "EMAIL", reviewReasons: [], rfqId: rfqA2.readback.resource.id, rfqVersion: rfqA2.readback.resource.version, supplierId: "supplier-account-a2", validUntil: "2026-10-01T00:00:00.000Z" }) as SupplierQuoteNormalizeCommand;
    const [quoteA, quoteA2] = await Promise.all([
      procurementStore.executeSupplierQuote({ actor, command: quoteACommand, correlationId: "correlation-quote-a2p-a", requestedAt }),
      procurementStore.executeSupplierQuote({ actor, command: quoteA2Command, correlationId: "correlation-quote-a2p-a2", requestedAt }),
    ]);
    const bidCommand = parseSeedProcurementCommand({ ...procurementCommon("bid-a2p", "bid_comparison.create"), basisCurrency: "USD", criticDissent: null, projectId, projectVersion, recommendationEvidenceRefs: ["evidence:objective-fit-a2p"], recommendedSupplierQuoteId: quoteA2.readback.resource.resource.id, rfqs: [{ rfqId: rfqA.readback.resource.id, rfqVersion: rfqA.readback.resource.version }, { rfqId: rfqA2.readback.resource.id, rfqVersion: rfqA2.readback.resource.version }], specificationId, specificationVersion, supplierQuotes: [{ supplierQuoteId: quoteA.readback.resource.resource.id, supplierQuoteVersion: quoteA.readback.resource.resource.version }, { supplierQuoteId: quoteA2.readback.resource.resource.id, supplierQuoteVersion: quoteA2.readback.resource.resource.version }] }) as BidComparisonCreateCommand;
    const bid = await procurementStore.executeBidComparison({ actor, command: bidCommand, correlationId: "correlation-bid-a2p", requestedAt });
    const selectionCommand = parseSeedProcurementCommand({ ...procurementCommon("selection-a2p", "procurement_selection.record"), bidComparisonId: bid.readback.resource.id, decision: "SELECT", evidenceRefs: ["evidence:human-selection-a2p"], expectedVersion: bid.readback.resource.version, projectId, projectVersion, rationale: "Best reconciled landed economics.", selectedSupplierQuoteId: quoteA2.readback.resource.resource.id }) as ProcurementSelectionRecordCommand;
    const selection = await procurementStore.executeSelection({ actor, command: selectionCommand, correlationId: "correlation-selection-a2p", human: authorityHuman("user:procurement-selector-a2p", "procurement.selection.record", "2026-09-05T09:56:00.000Z"), requestedAt });

    const proposalStore = new SeedProposalStore(pool);
    const scanRef = { objectId: scanEvidence.readback.resource.id, objectType: "EVIDENCE_ARTIFACT" as const, ownerProject: "LUZIONE_PROCUREMENT" as const, version: scanEvidence.readback.resource.version };
    const template = templateCommand(scanRef);
    const [templateFirst, templateReplay] = await Promise.all([
      proposalStore.execute(proposalInput(template, "correlation-template-a2p")),
      new SeedProposalStore(pool).execute(proposalInput(template, "correlation-template-a2p-replay")),
    ]);
    assert.equal(templateFirst.receipt.receiptId, templateReplay.receipt.receiptId);
    assert.equal([templateFirst, templateReplay].filter((result) => result.receipt.idempotentReplay).length, 1);
    await assert.rejects(proposalStore.execute(proposalInput({ ...template, template: { ...template.template, name: "Changed replay" } }, "correlation-template-a2p-conflict")), IdempotencyConflictError);
    assert.equal(await proposalStore.readTemplate(otherTenant, template.templateId), null);

    const invalidTemplate = templateCommand(scanRef, { commandId: "command-template-invalid-a2p", idempotencyKey: "idempotency-template-invalid-a2p", templateId: "template-invalid-a2p", template: { ...template.template, format: "PDF_OVERLAY", mergeTokens: [], name: "Unsupported PDF", pdf: { acroFormFields: [], mode: "UNSUPPORTED", overlayMapDigest: null, overlayMapVersion: null }, storageObjectRef: `private-object:${tenantId}:unsupported-a2p.pdf` } });
    await proposalStore.execute(proposalInput(invalidTemplate, "correlation-template-invalid-a2p"));
    assert.equal((await proposalStore.readTemplate(actor, invalidTemplate.templateId))?.resource.status, "INVALID");

    const lines = proposalLines({ candidateId: candidate.readback.resource.resource.id, candidateVersion: candidate.readback.resource.resource.version, projectId, projectVersion, specificationLineId, specificationLineVersion });
    assert.equal(new Set(lines.map((line) => line.lineType)).size, 8);
    const createProposal = proposalCommand({ commandId: "command-proposal-a2p", expectedVersion: "ABSENT", lines, projectId, projectVersion, proposalId: "proposal-a2p", specificationId, specificationVersion });
    await assert.rejects(proposalStore.execute(proposalInput(proposalCommand({ commandId: "command-proposal-invalid-template-a2p", expectedVersion: "ABSENT", lines, projectId, projectVersion, proposalId: "proposal-invalid-template-a2p", specificationId, specificationVersion, templateId: invalidTemplate.templateId, templateVersion: proposalTemplateVersion(invalidTemplate.templateId, 1) }), "correlation-proposal-invalid-template-a2p")), proposalError("TEMPLATE_INVALID"));
    const createdProposal = await proposalStore.execute(proposalInput(createProposal, "correlation-proposal-a2p"));
    assert.equal(createdProposal.receipt.objectVersion, proposalVersion("proposal-a2p", 1));
    const replayedProposal = await new SeedProposalStore(pool).execute(proposalInput(createProposal, "correlation-proposal-a2p-replay"));
    assert.equal(replayedProposal.receipt.idempotentReplay, true);
    assert.equal(await proposalStore.readProposal(otherTenant, "proposal-a2p"), null);
    const proposalV1 = await proposalStore.readProposal(actor, "proposal-a2p");
    assert.ok(proposalV1);
    assert.equal(proposalV1.lines.length, 8);
    assert.deepEqual(proposalV1.economics, deriveProposalEconomics(lines));
    assert.equal(proposalV1.proposal.data.decisionState, "PENDING");

    const faultProposalId = "proposal-fault-a2p";
    const faultCommand = proposalCommand({ commandId: "command-proposal-fault-a2p", expectedVersion: "ABSENT", lines, projectId, projectVersion, proposalId: faultProposalId, specificationId, specificationVersion });
    const faultStore = new SeedProposalStore(pool, { afterOwnerWrites: async (point) => { if (point === "PROPOSAL") throw new Error("PROOF_FAULT_AFTER_PROPOSAL_WRITES"); } });
    await assert.rejects(faultStore.execute(proposalInput(faultCommand, "correlation-proposal-fault-a2p")), /PROOF_FAULT_AFTER_PROPOSAL_WRITES/);
    const faultCounts = await tenantQuery<{ documents: string; identities: string; quotes: string; receipts: string }>(tenantId, `select
      (select count(*)::text from public.commercial_case_proposal_v1_identity_map where proposal_id=$1) identities,
      (select count(*)::text from public.commercial_case_proposal_document_versions where seed_proposal_id=$1) documents,
      (select count(*)::text from public.quotes where source_record_id='command-proposal-fault-a2p') quotes,
      (select count(*)::text from public.p110_command_receipts where command_id='command-proposal-fault-a2p') receipts`, [faultProposalId]);
    assert.deepEqual(faultCounts[0], { documents: "0", identities: "0", quotes: "0", receipts: "0" });

    const documentRows = await tenantQuery<{ artifact_hash: string }>(tenantId, "select artifact_hash from public.commercial_case_proposal_document_versions where seed_proposal_id='proposal-a2p' and seed_proposal_revision=1");
    const renderHash = expectedRenderInputHash({ artifactHash: documentRows[0].artifact_hash, requestedArtifact: "PDF", templateContentDigest: template.template.contentDigest, templateVersion: proposalTemplateVersion(template.templateId, 1) });
    const wrongRender = parseSeedProposalCommand({ commandId: "command-render-wrong-a2p", commandType: "proposal_render.prepare", contractVersion: SEED_PROPOSAL_COMMAND_VERSION, evidenceRefs: ["evidence:render-a2p"], expectedVersion: proposalVersion("proposal-a2p", 1), idempotencyKey: "idempotency-render-wrong-a2p", proposalId: "proposal-a2p", renderInputHash: "0".repeat(64), requestedArtifact: "PDF" }) as ProposalRenderPrepareCommand;
    await assert.rejects(proposalStore.execute(proposalInput(wrongRender, "correlation-render-wrong-a2p")), proposalError("RENDER_INPUT_HASH_MISMATCH"));
    const render = parseSeedProposalCommand({ ...wrongRender, commandId: "command-render-a2p", idempotencyKey: "idempotency-render-a2p", renderInputHash: renderHash }) as ProposalRenderPrepareCommand;
    await proposalStore.execute(proposalInput(render, "correlation-render-a2p"));
    const afterRender = await proposalStore.readProposal(actor, "proposal-a2p");
    assert.deepEqual(afterRender?.renderPreparations.map((item) => ({ artifactRef: item.artifactRef, externalEffectAuthorized: item.externalEffectAuthorized, providerAcknowledgementRef: item.providerAcknowledgementRef, sourceReadbackRef: item.sourceReadbackRef, status: item.status })), [{ artifactRef: null, externalEffectAuthorized: false, providerAcknowledgementRef: null, sourceReadbackRef: null, status: "PREPARED" }]);

    const client = human();
    const exactGrant = grant("proposal-a2p", proposalVersion("proposal-a2p", 1));
    const proposalDecision = decisionCommand({ commandId: "decision-proposal-a2p", proposalId: "proposal-a2p", proposalVersion: proposalVersion("proposal-a2p", 1), scope: "PROPOSAL", targetId: "proposal-a2p" });
    await assert.rejects(proposalStore.execute(proposalInput(proposalDecision, "correlation-decision-no-grant-a2p", { human: client })), proposalError("CLIENT_OBJECT_GRANT_DENIED"));
    await assert.rejects(proposalStore.execute(proposalInput(proposalDecision, "correlation-decision-stale-grant-a2p", { clientGrant: { ...exactGrant, proposalVersion: "proposal-version:proposal-a2p:v0" }, human: client })), proposalError("CLIENT_OBJECT_GRANT_DENIED"));
    for (const decision of [
      decisionCommand({ commandId: "decision-item-a2p", proposalId: "proposal-a2p", proposalVersion: proposalVersion("proposal-a2p", 1), scope: "ITEM", targetId: "line-product-a2p" }),
      decisionCommand({ commandId: "decision-option-a2p", proposalId: "proposal-a2p", proposalVersion: proposalVersion("proposal-a2p", 1), scope: "OPTION_GROUP", targetId: "option-seating-a2p" }),
      decisionCommand({ commandId: "decision-section-a2p", proposalId: "proposal-a2p", proposalVersion: proposalVersion("proposal-a2p", 1), scope: "SECTION", targetId: "section-room-a2p" }),
      proposalDecision,
    ]) await proposalStore.execute(proposalInput(decision, `correlation-${decision.commandId}`, { clientGrant: exactGrant, human: client }));
    const accepted = await proposalStore.readProposal(actor, "proposal-a2p");
    assert.equal(accepted?.proposal.resource.status, "ACCEPTED");
    assert.equal(accepted?.decisions.length, 4);
    const canonicalAccepted = await withTenantClient(tenantId, (transaction) => requireAcceptedCanonicalProposalVersion(transaction, { projectId, projectVersion, proposalId: "proposal-a2p", proposalVersion: proposalVersion("proposal-a2p", 1), tenantId }));
    assert.equal(canonicalAccepted.decisionId, accepted?.decisions.find((item) => item.data.scope === "PROPOSAL")?.resource.id);
    const reviewCounts = await tenantQuery<{ decisions: string; reviews: string }>(tenantId, "select (select count(*)::text from public.commercial_case_proposal_client_decision_versions where proposal_id='proposal-a2p') decisions,(select count(*)::text from public.commercial_case_proposal_review_versions where seed_proposal_id='proposal-a2p') reviews");
    assert.deepEqual(reviewCounts[0], { decisions: "4", reviews: "4" });

    const revisedLinesA = lines.map((line) => line.lineId === "line-service-a2p" ? { ...line, totalMinor: 3_001, unitPriceMinor: 3_001 } : line);
    const revisedLinesB = lines.map((line) => line.lineId === "line-service-a2p" ? { ...line, totalMinor: 3_002, unitPriceMinor: 3_002 } : line);
    const revisionA = proposalCommand({ commandId: "command-proposal-revision-a2p-a", expectedVersion: proposalVersion("proposal-a2p", 1), lines: revisedLinesA, projectId, projectVersion, proposalId: "proposal-a2p", specificationId, specificationVersion });
    const revisionB = proposalCommand({ commandId: "command-proposal-revision-a2p-b", expectedVersion: proposalVersion("proposal-a2p", 1), lines: revisedLinesB, projectId, projectVersion, proposalId: "proposal-a2p", specificationId, specificationVersion });
    const revisions = await Promise.allSettled([proposalStore.execute(proposalInput(revisionA, "correlation-revision-a2p-a")), new SeedProposalStore(pool).execute(proposalInput(revisionB, "correlation-revision-a2p-b"))]);
    assert.equal(revisions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(revisions.filter((result) => result.status === "rejected" && proposalError("VERSION_CONFLICT")(result.reason)).length, 1);
    const latest = await proposalStore.readProposal(actor, "proposal-a2p");
    assert.equal(latest?.proposal.resource.version, proposalVersion("proposal-a2p", 2));
    assert.equal(latest?.proposal.data.decisionState, "PENDING");
    assert.equal(latest?.decisions.length, 0);
    const prior = await proposalStore.readProposal(actor, "proposal-a2p", proposalVersion("proposal-a2p", 1));
    assert.ok(prior?.decisions.every((decision) => decision.resource.status === "SUPERSEDED"));
    await assert.rejects(withTenantClient(tenantId, (transaction) => requireAcceptedCanonicalProposalVersion(transaction, { projectId, projectVersion, proposalId: "proposal-a2p", proposalVersion: proposalVersion("proposal-a2p", 1), tenantId })), proposalError("PROPOSAL_VERSION_NOT_ACCEPTED"));

    const proposalV2Decision = decisionCommand({ commandId: "decision-proposal-a2p-v2", proposalId: "proposal-a2p", proposalVersion: proposalVersion("proposal-a2p", 2), scope: "PROPOSAL", targetId: "proposal-a2p" });
    await proposalStore.execute(proposalInput(proposalV2Decision, "correlation-decision-proposal-a2p-v2", { clientGrant: grant("proposal-a2p", proposalVersion("proposal-a2p", 2)), human: client }));
    const acceptedV2 = await proposalStore.readProposal(actor, "proposal-a2p");
    assert.equal(acceptedV2?.proposal.resource.status, "ACCEPTED");
    const approvedBid = await procurementStore.readBidComparison(actor, bid.readback.resource.id);
    assert.equal(approvedBid?.resource.status, "APPROVED");
    const poBase = { bidComparisonId: bid.readback.resource.id, expectedVersion: approvedBid?.resource.version, lineRefs: [{ objectId: specificationLineId, objectType: "SPECIFICATION_LINE" as const, ownerProject: "LUZIONE_PROJECT" as const, version: specificationLineVersion }], projectId, projectVersion, proposalVersion: proposalVersion("proposal-a2p", 2), proposalVersionId: "proposal-a2p", selectionDecisionId: selection.readback.resource.id, selectionDecisionVersion: selection.readback.resource.version };
    const stalePo = parseSeedProcurementCommand({ ...procurementCommon("po-stale-proposal-a2p", "purchase_order.create_draft"), ...poBase, proposalVersion: proposalVersion("proposal-a2p", 1) }) as PurchaseOrderDraftCreateCommand;
    await assert.rejects(procurementStore.executePurchaseOrder({ actor, command: stalePo, correlationId: "correlation-po-stale-proposal-a2p", requestedAt }), (error: unknown) => error instanceof SeedProcurementDomainError && error.code === "PROPOSAL_VERSION_NOT_ACCEPTED");
    const faultPo = parseSeedProcurementCommand({ ...procurementCommon("po-fault-a2p", "purchase_order.create_draft"), ...poBase }) as PurchaseOrderDraftCreateCommand;
    const poFaultStore = new SeedProcurementStore(pool, { afterOwnerWrites: async (point) => { if (point === "PURCHASE_ORDER") throw new Error("PROOF_FAULT_AFTER_PO_WRITE"); } });
    await assert.rejects(poFaultStore.executePurchaseOrder({ actor, command: faultPo, correlationId: "correlation-po-fault-a2p", requestedAt }), /PROOF_FAULT_AFTER_PO_WRITE/);
    const poFaultCounts = await tenantQuery<{ owners: string; receipts: string }>(tenantId, "select (select count(*)::text from public.seed_purchase_order_drafts where bid_comparison_id=$1) owners,(select count(*)::text from public.p110_command_receipts where command_id='po-fault-a2p') receipts", [bid.readback.resource.id]);
    assert.deepEqual(poFaultCounts[0], { owners: "0", receipts: "0" });
    const poCommand = parseSeedProcurementCommand({ ...procurementCommon("po-a2p", "purchase_order.create_draft"), ...poBase }) as PurchaseOrderDraftCreateCommand;
    const po = await procurementStore.executePurchaseOrder({ actor, command: poCommand, correlationId: "correlation-po-a2p", requestedAt });
    assert.equal(po.readback.resource.status, "DRAFT");
    assert.equal(po.readback.data.releaseApprovalRef, null);
    assert.equal(po.readback.data.supplierQuoteId, quoteA2.readback.resource.resource.id);
    assert.equal(po.readback.data.totalMinor, quoteA2.readback.economics.supplierCostTotalMinor);
    const poReplay = await new SeedProcurementStore(pool).executePurchaseOrder({ actor, command: poCommand, correlationId: "correlation-po-a2p-replay", requestedAt });
    assert.equal(poReplay.receipt.idempotentReplay, true);
    assert.equal(await procurementStore.readPurchaseOrder(otherTenant, po.readback.resource.id), null);
    const acknowledgement = parseSeedProcurementCommand({ ...procurementCommon("po-ack-held-a2p", "purchase_order_acknowledgement.record"), acknowledgementState: "PROVIDER_ACKNOWLEDGED", evidenceArtifactId: evidenceQuoteA2.readback.resource.id, evidenceArtifactVersion: evidenceQuoteA2.readback.resource.version, expectedReadyAt: null, expectedVersion: po.readback.resource.version, projectId, projectVersion, purchaseOrderId: po.readback.resource.id, supplierId: po.readback.data.supplierId, variances: [] }) as PurchaseOrderAcknowledgementRecordCommand;
    await assert.rejects(procurementStore.execute({ actor, command: acknowledgement, correlationId: "correlation-po-ack-held-a2p", requestedAt }), (error: unknown) => error instanceof SeedProcurementDomainError && error.code === "PURCHASE_ORDER_NOT_AVAILABLE");

    const collection = await proposalStore.readProjectProposals(actor, projectId);
    assert.ok(collection);
    const readModel = parseSeedProposalReadModel(createSeedProposalReadModel(collection, { observedAt: requestedAt, projectId, releaseIdentity: createReleaseIdentity({ environment: { LUZIONE_BUILD_TIME: requestedAt, VERCEL_GIT_COMMIT_SHA: "8".repeat(40) }, mutationsEnabled: false }), tenantId }));
    assert.equal(readModel.proposals[0].proposal.resource.version, proposalVersion("proposal-a2p", 2));
    assert.equal(readModel.proposals[0].lines.length, 8);

    const procurementGraph = await procurementStore.readProjectProcurement(actor, projectId);
    assert.equal(procurementGraph?.purchaseOrders.length, 1);
    assert.deepEqual(procurementGraph?.blockedDependencies[0].affectedCapabilities, ["purchase_order_acknowledgement.record", "purchase_order.release", "purchase_order.send"]);
    const noEffects = await tenantQuery<{ count: string }>(tenantId, `select count(*)::text count from public.commercial_case_proposal_document_versions where proposal_contract_version='ProposalVersion/v1' and (customer_send_authorized or proposal_approval_authorized or google_generation_state<>'not_requested' or google_primary_document_id is not null or google_primary_url is not null)
      union all select count(*)::text from public.commercial_case_proposal_render_preparations where external_effect_authorized or provider_acknowledgement_ref is not null or source_readback_ref is not null or artifact_ref is not null
      union all select count(*)::text from public.seed_purchase_order_drafts where external_effect_authorized or release_approval_ref is not null or status<>'DRAFT'`);
    assert.deepEqual(noEffects, [{ count: "0" }, { count: "0" }, { count: "0" }]);

    const rlsClient = await pool.connect();
    try {
      await rlsClient.query("begin"); await rlsClient.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
      await assert.rejects(rlsClient.query("insert into public.commercial_case_proposal_template_versions (tenant_id) values ('tenant-proof-b')"), /row-level security/);
      await rlsClient.query("rollback");
    } finally { rlsClient.release(); }

    console.log(JSON.stringify({
      atomicRollback: true, clientDecisionScopes: 4, exactAcceptedRead: true, externalEffects: 0,
      lineTypes: 8, predecessorReviewRows: Number(reviewCounts[0].reviews), proposalVersions: 2,
      purchaseOrderDrafts: 1, readModelContract: readModel.contractVersion, tenantIsolation: true,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
