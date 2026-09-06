import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { createLifecycleCommandRequest, IdempotencyConflictError, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  parseApprovalDecisionV1,
  parseProposalLineV1,
  parseProposalTemplateV1,
  parseProposalVersionV1,
} from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import {
  SEED_PRODUCT_CONTRACT_VERSIONS,
  type ApprovalDecisionV1,
  type ProposalLineV1,
  type ProposalTemplateV1,
  type ProposalVersionV1,
  type SeedAuthorityBoundaryV1,
  type SeedMutationBoundaryV1,
  type SeedReceiptReadbackV1,
  type SeedSourceRefV1,
} from "@/modules/luzione-core-contracts/seedProductContracts";
import {
  SEED_PROPOSAL_OWNER,
  SEED_PROPOSAL_POLICY_VERSION,
  canonicalSeedProposalPayloadHash,
  type ExactProposalSourceRef,
  type ProposalApprovalDecisionCommand,
  type ProposalRenderPrepareCommand,
  type ProposalTemplateSaveVersionCommand,
  type ProposalVersionWriteCommand,
  type SeedProposalCommand,
} from "@/modules/seed-proposal-owner/contracts";
import {
  approvalDecisionIdFor,
  approvalDecisionVersion,
  expectedRenderInputHash,
  proposalContextVersionIdFor,
  proposalDocumentVersionIdFor,
  proposalEconomicsDefects,
  proposalReviewVersionIdFor,
  proposalTemplateVersion,
  proposalVersion,
  quoteExternalIdFor,
  renderPreparationIdFor,
  renderPreparationVersion,
  sourceRefString,
  templateValidationIssues,
} from "@/modules/seed-proposal-owner/model";
import { projectVersion as canonicalProjectVersion, specificationLineVersion, specificationVersion } from "@/modules/seed-project-publication/model";
import { procurementVersions } from "@/modules/seed-procurement/model";

const RECEIPT_COLUMNS = `r.receipt_id,r.idempotency_key,r.payload_hash,r.expected_object_version,
  r.committed_object_version,r.policy_version,r.actor_id,r.actor_type,r.correlation_id,r.committed_at`;

type Row = Record<string, unknown>;
type Hooks = { afterOwnerWrites?: (point: "TEMPLATE" | "PROPOSAL" | "DECISION" | "RENDER_PREPARATION", client: PoolClient) => Promise<void> };

export type VerifiedProposalClientGrant = {
  accessLevel: "contribute" | "manage";
  actorId: string;
  grantId: string;
  observedAt: string;
  organizationId: string;
  proposalId: string;
  proposalVersion: string;
  status: "ACTIVE";
  tenantId: string;
  validUntil: string | null;
  version: string;
};

export type CanonicalProposalVersionRead = {
  currency: string;
  decisionId: string;
  projectId: string;
  projectVersion: string;
  proposalId: string;
  proposalVersion: string;
  revision: number;
  totalMinor: number;
};

export class SeedProposalDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly recovery?: { committedObjectVersion: string; receiptId: string; retry: "RECONCILE_FIRST" },
  ) {
    super(message);
    this.name = "SeedProposalDomainError";
  }
}

function json<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }
function iso(value: unknown) { const parsed = Date.parse(String(value)); if (!Number.isFinite(parsed)) throw new Error("Canonical Proposal row has an invalid timestamp."); return new Date(parsed).toISOString(); }
function actorType(value: unknown): SeedAuthorityBoundaryV1["actorType"] { return value === "user" ? "HUMAN" : value === "agent" ? "SULTAN_AGENT" : "SERVICE"; }
function sourceRef(tenantId: string, ref: ExactProposalSourceRef | Omit<SeedSourceRefV1, "tenantId">): SeedSourceRefV1 { return { ...ref, tenantId }; }

function boundaries(row: Row, committedVersion: string, capability: string, input?: { approvalRef?: string | null; effectClass?: "A1" | "A2" }) {
  const mutation: SeedMutationBoundaryV1 = { expectedVersion: String(row.expected_object_version), idempotencyKey: String(row.idempotency_key), payloadHash: String(row.payload_hash) };
  const authority: SeedAuthorityBoundaryV1 = {
    actorId: String(row.actor_id), actorType: actorType(row.actor_type), approvalRef: input?.approvalRef ?? null,
    capability, decision: input?.effectClass === "A2" ? "REQUIRE_HUMAN" : "ALLOW", effectClass: input?.effectClass ?? "A1",
    policyVersion: String(row.policy_version), serverDerivedIdentityRef: `correlation:${String(row.correlation_id)}`,
  };
  const receipt: SeedReceiptReadbackV1 = { committedVersion, finality: "DOMAIN_COMMITTED", observedAt: null, observedVersion: null, providerAcknowledgementRef: null, receiptId: String(row.receipt_id), sourceReadbackRef: null };
  return { authority, mutation, receipt };
}

function templateFromRow(row: Row): ProposalTemplateV1 {
  const id = String(row.template_id); const version = String(row.object_version); const scanRef = json<ExactProposalSourceRef>(row.malware_scan_evidence_ref);
  return parseProposalTemplateV1({
    ...boundaries(row, version, "proposal.template.save_version"), contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.proposalTemplate,
    createdAt: iso(row.created_at), data: { contentDigest: String(row.content_digest), format: row.format, mergeTokens: json<string[]>(row.merge_tokens), name: String(row.name), storageObjectRef: String(row.storage_object_ref), validationIssues: json<string[]>(row.validation_issues) },
    resource: { archivedAt: null, id, status: row.status, type: "PROPOSAL_TEMPLATE", version }, sourceRefs: [sourceRef(String(row.tenant_id), scanRef)], tenantId: String(row.tenant_id), updatedAt: iso(row.created_at),
  });
}

function lineFromRow(row: Row, proposal: ProposalVersionV1): { economics: { dutyMinor: number; freightMinor: number; reserveMinor: number; sectionId: string; supplierCostTotalMinor: number }; resource: ProposalLineV1; specificationLineRef: SeedSourceRefV1 | null } {
  const id = String(row.line_id); const version = String(row.object_version); const rawSource = json<ExactProposalSourceRef>(row.source_ref); const specRef = row.specification_line_ref === null ? null : json<ExactProposalSourceRef>(row.specification_line_ref);
  const resource = parseProposalLineV1({
    ...boundaries(row, String(row.proposal_version), "proposal.version.write"), contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.proposalLine,
    createdAt: iso(row.created_at), data: { confidence: { score: Number(row.confidence_score), sourceFreshAt: row.source_fresh_at === null ? null : iso(row.source_fresh_at) }, costMinor: Number(row.supplier_cost_minor) * Number(row.quantity), description: String(row.description), landedCostMinor: Number(row.landed_cost_minor), lineType: row.line_type, optionGroupId: row.option_group_id === null ? null : String(row.option_group_id), proposalVersionId: String(row.proposal_id), quantity: Number(row.quantity), sourceRef: sourceRefString(rawSource), totalMinor: Number(row.total_minor), unitPriceMinor: Number(row.unit_price_minor) },
    resource: { archivedAt: null, id, status: "ACTIVE", type: "PROPOSAL_LINE", version }, sourceRefs: [sourceRef(String(row.tenant_id), rawSource), ...(specRef ? [sourceRef(String(row.tenant_id), specRef)] : [])], tenantId: String(row.tenant_id), updatedAt: iso(row.created_at),
  }, proposal);
  return { economics: { dutyMinor: Number(row.duty_minor), freightMinor: Number(row.freight_minor), reserveMinor: Number(row.reserve_minor), sectionId: String(row.section_id), supplierCostTotalMinor: Number(row.supplier_cost_minor) * Number(row.quantity) }, resource, specificationLineRef: specRef ? sourceRef(String(row.tenant_id), specRef) : null };
}

function decisionFromRow(row: Row, proposal: ProposalVersionV1, superseded: boolean): ApprovalDecisionV1 {
  const id = String(row.decision_id); const version = String(row.object_version); const grant = json<VerifiedProposalClientGrant>(row.portal_grant_ref);
  return parseApprovalDecisionV1({
    ...boundaries(row, version, "proposal.client_decision.record", { approvalRef: grant.grantId, effectClass: "A2" }), contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.approvalDecision,
    createdAt: iso(row.decided_at), data: { comment: row.comment === null ? null : String(row.comment), decidedAt: iso(row.decided_at), decidedBy: String(row.decided_by), decision: row.decision, evidenceRefs: json<string[]>(row.evidence_refs), proposalVersionId: String(row.proposal_id), proposalVersion: String(row.proposal_version), scope: row.scope, targetId: String(row.target_id) },
    resource: { archivedAt: null, id, status: superseded ? "SUPERSEDED" : "ACTIVE", type: "APPROVAL_DECISION", version }, sourceRefs: [sourceRef(String(row.tenant_id), { objectId: grant.grantId, objectType: "PORTAL_OBJECT_GRANT", ownerProject: "LUZIONE_PARTNER_PORTAL", version: grant.version })], tenantId: String(row.tenant_id), updatedAt: iso(row.decided_at),
  }, proposal);
}

function proposalFromRows(identity: Row, document: Row, template: ProposalTemplateV1, decisionRows: Row[]): ProposalVersionV1 {
  const id = String(identity.proposal_id); const version = String(identity.proposal_version); const whole = decisionRows.find((row) => row.scope === "PROPOSAL" && row.target_id === id);
  const decisionState = whole?.decision === "APPROVE" ? "ACCEPTED" : whole?.decision === "REJECT" ? "REJECTED" : decisionRows.length ? "MIXED" : "PENDING";
  const status = decisionState === "ACCEPTED" ? "ACCEPTED" : decisionState === "REJECTED" ? "REJECTED" : "DRAFT";
  const specs = json<ExactProposalSourceRef[]>(document.seed_specification_refs); const products = json<ExactProposalSourceRef[]>(document.seed_product_refs);
  return parseProposalVersionV1({
    ...boundaries(identity, version, "proposal.version.write"), contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.proposalVersion,
    createdAt: iso(identity.created_at), data: { currency: String(document.seed_currency), decisionState, lineIds: json<string[]>(document.seed_line_ids), pdfArtifactRef: null, projectId: String(identity.project_id), revision: Number(identity.revision), templateId: String(identity.template_id), totalMinor: Number(document.seed_total_minor), webViewRef: null },
    resource: { archivedAt: null, id, status, type: "PROPOSAL_VERSION", version }, sourceRefs: [sourceRef(String(identity.tenant_id), { objectId: String(identity.project_id), objectType: "PROJECT", ownerProject: "LUZIONE_PROJECT", version: String(identity.project_version) }), ...specs.map((ref) => sourceRef(String(identity.tenant_id), ref)), ...products.map((ref) => sourceRef(String(identity.tenant_id), ref))], tenantId: String(identity.tenant_id), updatedAt: iso(identity.created_at),
  }, undefined, template);
}

function renderFromRow(row: Row) {
  return {
    artifactRef: null, createdAt: iso(row.created_at), evidenceRefs: json<string[]>(row.evidence_refs),
    externalEffectAuthorized: false as const, objectVersion: String(row.object_version), preparationId: String(row.preparation_id),
    proposalId: String(row.proposal_id), proposalVersion: String(row.proposal_version), providerAcknowledgementRef: null,
    renderInputHash: String(row.render_input_hash), requestedArtifact: String(row.requested_artifact) as "PDF" | "WEB",
    sourceReadbackRef: null, status: "PREPARED" as const, templateId: String(row.template_id), templateVersion: String(row.template_version),
  };
}

async function beginRead(client: PoolClient, tenantId: string) { await client.query("begin read only"); await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]); }
async function advisory(client: PoolClient, tenantId: string, key: string) { await client.query("select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2,0))", [tenantId, key]); }

export async function requireAcceptedCanonicalProposalVersion(client: PoolClient, input: { projectId: string; projectVersion: string; proposalId: string; proposalVersion: string; tenantId: string }): Promise<CanonicalProposalVersionRead> {
  const result = await client.query(`select m.*,d.seed_currency,d.seed_total_minor,x.decision_id
    from public.commercial_case_proposal_v1_identity_map m
    join public.commercial_case_proposal_document_versions d on d.tenant_id=m.tenant_id and d.proposal_document_version_id=m.proposal_document_version_id
    join public.commercial_case_proposal_client_decision_versions x on x.tenant_id=m.tenant_id and x.proposal_id=m.proposal_id and x.proposal_revision=m.revision and x.proposal_version=m.proposal_version and x.scope='PROPOSAL' and x.target_id=m.proposal_id and x.decision='APPROVE' and x.status='ACTIVE'
    where m.tenant_id=$1 and m.proposal_id=$2 and m.proposal_version=$3 and m.project_id=$4 and m.project_version=$5
      and m.revision=(select max(revision) from public.commercial_case_proposal_v1_identity_map where tenant_id=$1 and proposal_id=$2)
    limit 1`, [input.tenantId, input.proposalId, input.proposalVersion, input.projectId, input.projectVersion]);
  const row = result.rows[0] as Row | undefined;
  if (!row) throw new SeedProposalDomainError("PROPOSAL_VERSION_NOT_ACCEPTED", "An exact latest accepted ProposalVersion/v1 was not found for this tenant and Project.", 409);
  return { currency: String(row.seed_currency), decisionId: String(row.decision_id), projectId: String(row.project_id), projectVersion: String(row.project_version), proposalId: String(row.proposal_id), proposalVersion: String(row.proposal_version), revision: Number(row.revision), totalMinor: Number(row.seed_total_minor) };
}

export class SeedProposalStore {
  private readonly commandStore: PostgresAtomicCommandStore;
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(private readonly pool: Pool = databasePool(), private readonly hooks: Hooks = {}) { this.commandStore = new PostgresAtomicCommandStore(pool); this.kernel = new LifecycleCommandKernel(this.commandStore); }

  async execute(input: { actor: ApiActor; clientGrant?: VerifiedProposalClientGrant; command: SeedProposalCommand; correlationId: string; human?: HumanApprovalSubject; requestedAt: string }) {
    this.requireTransportActor(input.actor); this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    switch (input.command.commandType) {
      case "proposal_template.save_version": return this.executeTemplate({ ...input, command: input.command });
      case "proposal_version.create": case "proposal_version.revise": return this.executeProposalVersion({ ...input, command: input.command });
      case "approval_decision.record": return this.executeDecision({ ...input, command: input.command });
      case "proposal_render.prepare": return this.executeRenderPreparation({ ...input, command: input.command });
    }
  }

  async readTemplate(actor: ApiActor, templateId: string, objectVersion?: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select t.*,${RECEIPT_COLUMNS} from public.commercial_case_proposal_template_versions t join public.p110_command_receipts r on r.tenant_id=t.tenant_id and r.command_id=t.created_command_id where t.tenant_id=$1 and t.template_id=$2 and ($3::text is null or t.object_version=$3) order by t.revision desc limit 1`, [actor.tenantId, templateId, objectVersion ?? null]);
      return result.rows[0] ? templateFromRow(result.rows[0] as Row) : null;
    });
  }

  async readProposal(actor: ApiActor, proposalId: string, objectVersion?: string) {
    return this.readTransaction(actor.tenantId, async (client) => this.readProposalWithClient(client, actor.tenantId, proposalId, objectVersion));
  }

  async readProjectProposals(actor: ApiActor, projectId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const project = await client.query("select version from public.seed_projects where tenant_id=$1 and project_id=$2 limit 1", [actor.tenantId, projectId]);
      if (!project.rows[0]) return null;
      const ids = await client.query("select distinct proposal_id from public.commercial_case_proposal_v1_identity_map where tenant_id=$1 and project_id=$2 order by proposal_id", [actor.tenantId, projectId]);
      const proposals = [];
      for (const row of ids.rows) { const proposal = await this.readProposalWithClient(client, actor.tenantId, String(row.proposal_id)); if (proposal) proposals.push(proposal); }
      return { projectVersion: canonicalProjectVersion(projectId, Number(project.rows[0].version)), proposals };
    });
  }

  private async readProposalWithClient(client: PoolClient, tenantId: string, proposalId: string, objectVersion?: string) {
    const identityResult = await client.query(`select m.*,${RECEIPT_COLUMNS} from public.commercial_case_proposal_v1_identity_map m join public.p110_command_receipts r on r.tenant_id=m.tenant_id and r.command_id=m.created_command_id where m.tenant_id=$1 and m.proposal_id=$2 and ($3::text is null or m.proposal_version=$3) order by m.revision desc limit 1`, [tenantId, proposalId, objectVersion ?? null]);
    const identity = identityResult.rows[0] as Row | undefined; if (!identity) return null;
    const documentResult = await client.query("select * from public.commercial_case_proposal_document_versions where tenant_id=$1 and proposal_document_version_id=$2 limit 1", [tenantId, identity.proposal_document_version_id]);
    const templateResult = await client.query(`select t.*,${RECEIPT_COLUMNS} from public.commercial_case_proposal_template_versions t join public.p110_command_receipts r on r.tenant_id=t.tenant_id and r.command_id=t.created_command_id where t.tenant_id=$1 and t.template_id=$2 and t.object_version=$3 limit 1`, [tenantId, identity.template_id, identity.template_version]);
    if (!documentResult.rows[0] || !templateResult.rows[0]) throw new Error("Proposal identity map has a dangling exact document or template reference.");
    const decisionsResult = await client.query(`select d.*,${RECEIPT_COLUMNS} from public.commercial_case_proposal_client_decision_versions d join public.p110_command_receipts r on r.tenant_id=d.tenant_id and r.command_id=d.created_command_id where d.tenant_id=$1 and d.proposal_id=$2 and d.proposal_revision=$3 order by d.decided_at,d.decision_id`, [tenantId, proposalId, identity.revision]);
    const template = templateFromRow(templateResult.rows[0] as Row); const proposal = proposalFromRows(identity, documentResult.rows[0] as Row, template, decisionsResult.rows as Row[]);
    const linesResult = await client.query(`select l.*,${RECEIPT_COLUMNS} from public.commercial_case_proposal_line_versions l join public.p110_command_receipts r on r.tenant_id=l.tenant_id and r.command_id=l.created_command_id where l.tenant_id=$1 and l.proposal_id=$2 and l.proposal_revision=$3 order by l.line_id`, [tenantId, proposalId, identity.revision]);
    const rendersResult = await client.query("select * from public.commercial_case_proposal_render_preparations where tenant_id=$1 and proposal_id=$2 and proposal_revision=$3 order by created_at,preparation_id", [tenantId, proposalId, identity.revision]);
    const maxResult = await client.query("select max(revision)::int max_revision from public.commercial_case_proposal_v1_identity_map where tenant_id=$1 and proposal_id=$2", [tenantId, proposalId]);
    const superseded = Number(maxResult.rows[0]?.max_revision) > Number(identity.revision);
    return {
      economics: json<{ economics: ProposalVersionWriteCommand["economics"] }>(documentResult.rows[0].artifact).economics,
      identityMap: { caseId: String(identity.case_id), proposalContextVersionId: String(identity.proposal_context_version_id), proposalDocumentVersionId: String(identity.proposal_document_version_id), quoteEconomicsVersionId: String(identity.quote_economics_version_id), quoteId: String(identity.quote_id) },
      lines: linesResult.rows.map((row) => lineFromRow(row as Row, proposal)),
      decisions: decisionsResult.rows.map((row) => decisionFromRow(row as Row, proposal, superseded)),
      proposal, renderPreparations: rendersResult.rows.map((row) => renderFromRow(row as Row)), template,
    };
  }

  private async executeTemplate(input: { actor: ApiActor; command: ProposalTemplateSaveVersionCommand; correlationId: string; requestedAt: string }) {
    if (!input.command.template.storageObjectRef.startsWith(`private-object:${input.actor.tenantId}:`)) throw new SeedProposalDomainError("TEMPLATE_TENANT_SCOPE_MISMATCH", "Template object storage reference is not tenant-private.", 409);
    const revision = this.nextRevision(input.command.expectedVersion, input.command.templateId, "proposal-template"); const version = proposalTemplateVersion(input.command.templateId, revision); const issues = templateValidationIssues(input.command.template);
    const receipt = await this.executeKernel(input, { id: input.command.templateId, objectType: "proposal_template", sourceRefs: [input.command.template.storageObjectRef, input.command.template.malwareScanEvidenceRef.objectId] }, async (transaction) => {
      await advisory(transaction.client, input.actor.tenantId, `proposal-template:${input.command.templateId}`);
      await this.requireLatestVersion(transaction.client, { expectedVersion: input.command.expectedVersion, id: input.command.templateId, kind: "template", tenantId: input.actor.tenantId });
      await this.requireTenantGlobalEvidence(transaction.client, input.actor.tenantId, input.command.template.malwareScanEvidenceRef);
      await transaction.client.query(`insert into public.commercial_case_proposal_template_versions (tenant_id,template_id,revision,object_version,status,name,format,content_digest,storage_object_ref,malware_scan_state,malware_scan_evidence_ref,token_schema_version,merge_tokens,pdf_configuration,validation_issues,evidence_refs,command_payload,command_payload_hash,expected_object_version,created_command_id,created_by,created_by_type,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CLEAN',$10::jsonb,'ProposalMergeTokens/v1',$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21)`, [input.actor.tenantId, input.command.templateId, revision, version, issues.length ? "INVALID" : "ACTIVE", input.command.template.name, input.command.template.format, input.command.template.contentDigest, input.command.template.storageObjectRef, JSON.stringify(input.command.template.malwareScanEvidenceRef), JSON.stringify(input.command.template.mergeTokens), input.command.template.pdf === null ? null : JSON.stringify(input.command.template.pdf), JSON.stringify(issues), JSON.stringify(input.command.evidenceRefs), JSON.stringify(input.command), canonicalSeedProposalPayloadHash(input.command), input.command.expectedVersion, input.command.commandId, input.actor.actorId, input.actor.actorType, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("TEMPLATE", transaction.client); return { evidenceRefs: input.command.evidenceRefs, objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readTemplate(input.actor, input.command.templateId, version), (value) => value.resource.version);
  }

  private async executeProposalVersion(input: { actor: ApiActor; command: ProposalVersionWriteCommand; correlationId: string; requestedAt: string }) {
    const revision = this.nextRevision(input.command.expectedVersion, input.command.proposalId, "proposal-version"); const version = proposalVersion(input.command.proposalId, revision);
    const defects = proposalEconomicsDefects(input.command.lines, input.command.economics); if (defects.length) throw new SeedProposalDomainError("PROPOSAL_ECONOMICS_MISMATCH", `Proposal economics do not reconcile: ${defects.join(", ")}.`, 409);
    const documentId = proposalDocumentVersionIdFor(input.actor.tenantId, input.command.proposalId, revision); const contextId = proposalContextVersionIdFor(input.actor.tenantId, input.command.proposalId, revision); const quoteExternalId = quoteExternalIdFor(input.actor.tenantId, input.command.proposalId, revision); const payloadHash = canonicalSeedProposalPayloadHash(input.command);
    const receipt = await this.executeKernel(input, { id: input.command.proposalId, objectType: "proposal_version", sourceRefs: [input.command.projectRef.projectId, input.command.templateRef.templateId, ...input.command.specificationRefs.map((ref) => ref.objectId), ...input.command.evidenceRefs] }, async (transaction) => {
      await advisory(transaction.client, input.actor.tenantId, `proposal:${input.command.proposalId}`);
      await this.requireLatestVersion(transaction.client, { expectedVersion: input.command.expectedVersion, id: input.command.proposalId, kind: "proposal", tenantId: input.actor.tenantId });
      await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectRef.projectId, input.command.projectRef.projectVersion);
      const caseRow = await transaction.client.query("select case_id from public.commercial_cases where tenant_id=$1 and case_id=$2 limit 1", [input.actor.tenantId, input.command.caseId]); if (!caseRow.rows[0]) throw new SeedProposalDomainError("COMMERCIAL_CASE_NOT_FOUND", "Commercial Case not found for this tenant.", 404);
      const template = await this.requireTemplate(transaction.client, input.actor.tenantId, input.command.templateRef.templateId, input.command.templateRef.templateVersion);
      for (const ref of input.command.specificationRefs) await this.requireExactRef(transaction.client, input.actor.tenantId, input.command.projectRef.projectId, ref);
      const productRefs = new Map<string, ExactProposalSourceRef>();
      for (const line of input.command.lines) { await this.requireExactRef(transaction.client, input.actor.tenantId, input.command.projectRef.projectId, line.sourceRef); if (line.specificationLineRef) await this.requireExactRef(transaction.client, input.actor.tenantId, input.command.projectRef.projectId, line.specificationLineRef); if (line.sourceRef.objectType === "PRODUCT_CANDIDATE") productRefs.set(`${line.sourceRef.objectId}@${line.sourceRef.version}`, line.sourceRef); }
      const subtotal = input.command.economics.clientPriceBeforeTaxMinor - input.command.economics.discountTotalMinor + input.command.economics.taxTotalMinor;
      const grossMarginPercent = subtotal === 0 ? 0 : Number(((input.command.economics.grossMarginMinor / subtotal) * 100).toFixed(4));
      const quoteResult = await transaction.client.query(`insert into public.quotes (external_quote_id,tenant_id,commercial_case_id,customer_id,customer_name,status,currency,subtotal_cents,margin_cents,margin_percent,fully_landed_cost_cents,economics_version,source_system,source_record_id,created_by_type,created_by_id,created_at,updated_at) values ($1,$2,$3,null,$4,'draft',$5,$6,$7,$8,$9,1,'luzione_api_seed_proposal_a2p',$10,$11,$12,$13,$13) returning id`, [quoteExternalId, input.actor.tenantId, input.command.caseId, `Project ${input.command.projectRef.projectId}`, input.command.currency, input.command.economics.totalMinor, input.command.economics.grossMarginMinor, grossMarginPercent, input.command.economics.landedCostTotalMinor, input.command.commandId, input.actor.actorType, input.actor.actorId, input.requestedAt]);
      const quoteId = String(quoteResult.rows[0].id);
      for (const [index, line] of input.command.lines.entries()) await transaction.client.query(`insert into public.quote_lines (quote_id,line_number,sku,description,quantity,unit_price_cents,unit_cost_cents,margin_cents,supplier_id,source_system,source_record_id,created_at,updated_at) values ($1,$2,null,$3,$4,$5,$6,$7,null,'luzione_api_seed_proposal_a2p',$8,$9,$9)`, [quoteId, index + 1, line.description, line.quantity, line.unitPriceMinor, line.supplierCostMinor, line.totalMinor - line.landedCostMinor, input.command.commandId, input.requestedAt]);
      const economicsSnapshot = { contractVersion: "ProposalEconomics/v1", economics: input.command.economics, lines: input.command.lines, projectRef: input.command.projectRef, specificationRefs: input.command.specificationRefs, templateRef: input.command.templateRef };
      const economicsResult = await transaction.client.query(`insert into public.quote_economics_versions (tenant_id,quote_id,version,input_checksum,immutable_snapshot,gross_margin_percent,fully_landed_cost_cents,approval_required,required_approver_role,actor_id,created_at) values ($1,$2,1,$3,$4::jsonb,$5,$6,true,'proposal_commercial_reviewer',$7,$8) returning quote_economics_version_id`, [input.actor.tenantId, quoteId, sha256(economicsSnapshot), JSON.stringify(economicsSnapshot), grossMarginPercent, input.command.economics.landedCostTotalMinor, input.actor.actorId, input.requestedAt]);
      const economicsId = String(economicsResult.rows[0].quote_economics_version_id);
      await transaction.client.query(`insert into public.commercial_case_proposal_context_versions (proposal_context_version_id,tenant_id,case_id,idempotency_key,payload_hash,author_id,author_type,expected_version,resulting_version,source_recommendation_version_id,source_supplier_inquiry_version_id,context_hash,proposal_id,economics_authority,economics,lineage_refs,binding_quote_authorized,operational_authorization,human_commercial_review_required,generator_type,prohibited_effects,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'SEED_PROPOSAL_OWNER_A2P',$14::jsonb,$15::jsonb,false,false,true,'seed_proposal_owner_v1',$16::jsonb,$17)`, [contextId, input.actor.tenantId, input.command.caseId, `${input.command.idempotencyKey}:context`, payloadHash, input.actor.actorId, input.actor.actorType, input.command.expectedVersion, version, input.command.specificationRefs[0].version, `quote-economics:${economicsId}`, sha256({ economicsId, proposalId: input.command.proposalId, version }), input.command.proposalId, JSON.stringify(input.command.economics), JSON.stringify([...input.command.specificationRefs, ...productRefs.values()]), JSON.stringify(["no_customer_send", "no_binding_acceptance", "no_render", "no_payment"]), input.requestedAt]);
      const artifact = { contractVersion: "ProposalCanonicalSnapshot/v1", economics: input.command.economics, lines: input.command.lines, projectRef: input.command.projectRef, proposalId: input.command.proposalId, proposalVersion: version, specificationRefs: input.command.specificationRefs, templateRef: input.command.templateRef };
      await transaction.client.query(`insert into public.commercial_case_proposal_document_versions (proposal_document_version_id,tenant_id,case_id,idempotency_key,payload_hash,author_id,author_type,expected_version,resulting_version,source_proposal_context_version_id,artifact_hash,artifact,completeness_gate,template,rendering_boundary,google_doc_authoritative,customer_send_authorized,proposal_approval_authorized,generator_type,prohibited_effects,google_generation_state,immutable_input_snapshot,snapshot_checksum,proposal_contract_version,seed_project_id,seed_project_version,seed_proposal_id,seed_proposal_revision,seed_proposal_version,seed_template_id,seed_template_version,seed_quote_id,seed_quote_economics_version_id,seed_status,seed_currency,seed_total_minor,seed_decision_state,seed_specification_refs,seed_product_refs,seed_line_ids,seed_evidence_refs,seed_command_payload,seed_command_payload_hash,seed_created_command_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,'canonical_postgres_snapshot_render_not_requested',false,false,false,'seed_proposal_owner_v1',$15::jsonb,'not_requested',$12::jsonb,$11,'ProposalVersion/v1',$16,$17,$18,$19,$20,$21,$22,$23,$24,'DRAFT',$25,$26,'PENDING',$27::jsonb,$28::jsonb,$29::jsonb,$30::jsonb,$31::jsonb,$32,$33,$34)`, [documentId, input.actor.tenantId, input.command.caseId, `${input.command.idempotencyKey}:document`, payloadHash, input.actor.actorId, input.actor.actorType, input.command.expectedVersion, version, contextId, sha256(artifact), JSON.stringify(artifact), JSON.stringify({ economicsReconciled: true, exactReferencesVerified: true, lineCount: input.command.lines.length, templateActive: true }), JSON.stringify({ contentDigest: template.content_digest, format: template.format, templateId: input.command.templateRef.templateId, templateVersion: input.command.templateRef.templateVersion }), JSON.stringify(["no_customer_send", "no_binding_acceptance", "no_render", "no_payment"]), input.command.projectRef.projectId, input.command.projectRef.projectVersion, input.command.proposalId, revision, version, input.command.templateRef.templateId, input.command.templateRef.templateVersion, quoteId, economicsId, input.command.currency, input.command.economics.totalMinor, JSON.stringify(input.command.specificationRefs), JSON.stringify([...productRefs.values()]), JSON.stringify(input.command.lines.map((line) => line.lineId)), JSON.stringify(input.command.evidenceRefs), JSON.stringify(input.command), payloadHash, input.command.commandId, input.requestedAt]);
      await transaction.client.query(`insert into public.commercial_case_proposal_v1_identity_map (tenant_id,proposal_id,revision,proposal_version,project_id,project_version,case_id,proposal_context_version_id,proposal_document_version_id,template_id,template_version,quote_id,quote_economics_version_id,created_command_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [input.actor.tenantId, input.command.proposalId, revision, version, input.command.projectRef.projectId, input.command.projectRef.projectVersion, input.command.caseId, contextId, documentId, input.command.templateRef.templateId, input.command.templateRef.templateVersion, quoteId, economicsId, input.command.commandId, input.requestedAt]);
      // Each line is part of the atomic parent proposal commit, so it carries the
      // parent version. This preserves Core's resource/receipt version invariant.
      for (const line of input.command.lines) await transaction.client.query(`insert into public.commercial_case_proposal_line_versions (tenant_id,proposal_id,proposal_revision,proposal_version,line_id,object_version,project_id,line_type,description,quantity,section_id,option_group_id,supplier_cost_minor,freight_minor,duty_minor,reserve_minor,landed_cost_minor,unit_price_minor,total_minor,confidence_score,source_fresh_at,source_ref,specification_line_ref,canonical_payload,command_payload_hash,created_command_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25,$26,$27)`, [input.actor.tenantId, input.command.proposalId, revision, version, line.lineId, version, input.command.projectRef.projectId, line.lineType, line.description, line.quantity, line.sectionId, line.optionGroupId, line.supplierCostMinor, line.freightMinor, line.dutyMinor, line.reserveMinor, line.landedCostMinor, line.unitPriceMinor, line.totalMinor, line.confidence.score, line.confidence.sourceFreshAt, JSON.stringify(line.sourceRef), line.specificationLineRef === null ? null : JSON.stringify(line.specificationLineRef), JSON.stringify(line), payloadHash, input.command.commandId, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("PROPOSAL", transaction.client); return { evidenceRefs: input.command.evidenceRefs, objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readProposal(input.actor, input.command.proposalId, version), (value) => value.proposal.resource.version);
  }

  private async executeDecision(input: { actor: ApiActor; clientGrant?: VerifiedProposalClientGrant; command: ProposalApprovalDecisionCommand; correlationId: string; human?: HumanApprovalSubject; requestedAt: string }) {
    const human = input.human; const grant = input.clientGrant;
    if (!human || human.tenantId !== input.actor.tenantId || !human.capabilities.includes("proposal.client_decision.record")) throw new SeedProposalDomainError("HUMAN_CLIENT_IDENTITY_REQUIRED", "Client decision requires a signed same-tenant human subject.", 403);
    if (!grant || grant.tenantId !== input.actor.tenantId || grant.actorId !== human.actorId || grant.proposalId !== input.command.proposalId || grant.proposalVersion !== input.command.expectedVersion || grant.status !== "ACTIVE" || !["contribute", "manage"].includes(grant.accessLevel) || (grant.validUntil !== null && Date.parse(grant.validUntil) <= Date.parse(input.requestedAt))) throw new SeedProposalDomainError("CLIENT_OBJECT_GRANT_DENIED", "An exact active server-derived client object grant is required.", 403);
    const id = approvalDecisionIdFor(input.actor.tenantId, { actorId: human.actorId, proposalId: input.command.proposalId, proposalVersion: input.command.expectedVersion, scope: input.command.scope, targetId: input.command.targetId }); const version = approvalDecisionVersion(id);
    const authorityActor: ApiActor = { actorId: human.actorId, actorType: "user", capabilities: human.capabilities, source: input.actor.source, tenantId: human.tenantId };
    const receipt = await this.executeKernel(input, { id, objectType: "approval_decision", sourceRefs: [input.command.proposalId, input.command.targetId, `portal-grant:${grant.grantId}@${grant.version}`, ...input.command.evidenceRefs] }, async (transaction) => {
      await advisory(transaction.client, input.actor.tenantId, `proposal-decision:${input.command.proposalId}:${input.command.scope}:${input.command.targetId}`);
      const identity = await this.requireProposalIdentity(transaction.client, input.actor.tenantId, input.command.proposalId, input.command.expectedVersion, true);
      await this.requireDecisionTarget(transaction.client, identity, input.command.scope, input.command.targetId);
      const existing = await transaction.client.query("select decision_id from public.commercial_case_proposal_client_decision_versions where tenant_id=$1 and proposal_id=$2 and proposal_revision=$3 and scope=$4 and target_id=$5 limit 1", [input.actor.tenantId, input.command.proposalId, identity.revision, input.command.scope, input.command.targetId]); if (existing.rows[0]) throw new SeedProposalDomainError("DECISION_ALREADY_RECORDED", "This exact Proposal Version target already has an immutable client decision.", 409);
      const document = await transaction.client.query("select artifact_hash from public.commercial_case_proposal_document_versions where tenant_id=$1 and proposal_document_version_id=$2 limit 1", [input.actor.tenantId, identity.proposal_document_version_id]);
      if (!document.rows[0]) throw new SeedProposalDomainError("PROPOSAL_DOCUMENT_NOT_FOUND", "The exact immutable proposal document version is missing.", 409);
      const reviewId = proposalReviewVersionIdFor(id);
      const reviewDecision = input.command.decision === "APPROVE" ? "approved" : input.command.decision === "REJECT" ? "rejected" : "changes_requested";
      const reviewHash = sha256({ decisionId: id, decision: input.command.decision, evidenceRefs: input.command.evidenceRefs, grantVersion: grant.version, proposalVersion: input.command.expectedVersion, scope: input.command.scope, targetId: input.command.targetId });
      await transaction.client.query(`insert into public.commercial_case_proposal_review_versions (proposal_review_version_id,tenant_id,case_id,idempotency_key,payload_hash,reviewer_id,reviewer_type,expected_version,resulting_version,source_proposal_document_version_id,source_proposal_context_version_id,reviewed_artifact_hash,decision,reviewer_notes,findings,review_hash,exact_version_current,superseded_by_document_version_id,ai_approval_authorized,customer_send_authorized,binding_acceptance_authorized,generator_type,prohibited_effects,reviewer_role_snapshot,approval_authority_state,typed_confirmation_digest,proposal_contract_version,seed_proposal_id,seed_proposal_revision,seed_proposal_version,seed_scope,seed_target_id,seed_decision_id,seed_portal_grant_ref,seed_human_authentication_ref,seed_created_command_id,created_at) values ($1,$2,$3,$4,$5,$6,'user',$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,true,null,false,false,false,'human_exact_version_review',$16::jsonb,'portal_client','verified',$17,'ApprovalDecision/v1',$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27)`, [reviewId, input.actor.tenantId, identity.case_id, `${input.command.idempotencyKey}:review`, canonicalSeedProposalPayloadHash(input.command), human.actorId, input.command.expectedVersion, version, identity.proposal_document_version_id, identity.proposal_context_version_id, document.rows[0].artifact_hash, reviewDecision, input.command.comment ?? "", JSON.stringify([{ evidenceRefs: input.command.evidenceRefs, scope: input.command.scope, targetId: input.command.targetId }]), reviewHash, JSON.stringify(["no_customer_send", "no_binding_acceptance", "no_external_effect"]), sha256({ authenticationRef: human.authenticationRef, decisionId: id }), input.command.proposalId, identity.revision, input.command.expectedVersion, input.command.scope, input.command.targetId, id, JSON.stringify(grant), human.authenticationRef, input.command.commandId, input.requestedAt]);
      await transaction.client.query(`insert into public.commercial_case_proposal_client_decision_versions (tenant_id,decision_id,proposal_id,proposal_revision,proposal_version,scope,target_id,decision,comment,evidence_refs,portal_grant_ref,decided_by,human_authentication_ref,status,object_version,expected_object_version,command_payload,command_payload_hash,created_command_id,decided_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,'ACTIVE',$14,$15,$16::jsonb,$17,$18,$19)`, [input.actor.tenantId, id, input.command.proposalId, identity.revision, input.command.expectedVersion, input.command.scope, input.command.targetId, input.command.decision, input.command.comment, JSON.stringify(input.command.evidenceRefs), JSON.stringify(grant), human.actorId, human.authenticationRef, version, input.command.expectedVersion, JSON.stringify(input.command), canonicalSeedProposalPayloadHash(input.command), input.command.commandId, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("DECISION", transaction.client); return { evidenceRefs: [...input.command.evidenceRefs, `portal-grant:${grant.grantId}@${grant.version}`, `human:${human.authenticationRef}`], objectVersion: version };
    }, authorityActor);
    const proposal = await this.readProposal(input.actor, input.command.proposalId, input.command.expectedVersion); const decision = proposal?.decisions.find((item) => item.resource.id === id) ?? null; return this.confirmReadback(receipt, decision, (value) => value.resource.version);
  }

  private async executeRenderPreparation(input: { actor: ApiActor; command: ProposalRenderPrepareCommand; correlationId: string; requestedAt: string }) {
    const id = renderPreparationIdFor(input.actor.tenantId, { proposalId: input.command.proposalId, proposalVersion: input.command.expectedVersion, renderInputHash: input.command.renderInputHash, requestedArtifact: input.command.requestedArtifact }); const version = renderPreparationVersion(id);
    const receipt = await this.executeKernel(input, { id, objectType: "proposal_render_preparation", sourceRefs: [input.command.proposalId, ...input.command.evidenceRefs] }, async (transaction) => {
      const identity = await this.requireProposalIdentity(transaction.client, input.actor.tenantId, input.command.proposalId, input.command.expectedVersion, true);
      const document = await transaction.client.query("select artifact_hash,seed_template_id,seed_template_version from public.commercial_case_proposal_document_versions where tenant_id=$1 and proposal_document_version_id=$2 limit 1", [input.actor.tenantId, identity.proposal_document_version_id]);
      const template = await this.requireTemplate(transaction.client, input.actor.tenantId, String(document.rows[0].seed_template_id), String(document.rows[0].seed_template_version));
      const expected = expectedRenderInputHash({ artifactHash: document.rows[0].artifact_hash, requestedArtifact: input.command.requestedArtifact, templateContentDigest: template.content_digest, templateVersion: template.object_version });
      if (input.command.renderInputHash !== expected) throw new SeedProposalDomainError("RENDER_INPUT_HASH_MISMATCH", "Render preparation must bind the exact proposal snapshot and template digest.", 409);
      await transaction.client.query(`insert into public.commercial_case_proposal_render_preparations (tenant_id,preparation_id,proposal_id,proposal_revision,proposal_version,template_id,template_version,requested_artifact,render_input_hash,status,provider_acknowledgement_ref,source_readback_ref,artifact_ref,external_effect_authorized,evidence_refs,object_version,expected_object_version,command_payload,command_payload_hash,created_command_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PREPARED',null,null,null,false,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16)`, [input.actor.tenantId, id, input.command.proposalId, identity.revision, input.command.expectedVersion, identity.template_id, identity.template_version, input.command.requestedArtifact, input.command.renderInputHash, JSON.stringify(input.command.evidenceRefs), version, input.command.expectedVersion, JSON.stringify(input.command), canonicalSeedProposalPayloadHash(input.command), input.command.commandId, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("RENDER_PREPARATION", transaction.client); return { evidenceRefs: input.command.evidenceRefs, objectVersion: version };
    });
    const proposal = await this.readProposal(input.actor, input.command.proposalId, input.command.expectedVersion); const render = proposal?.renderPreparations.find((item) => item.preparationId === id) ?? null; return this.confirmReadback(receipt, render, (value) => value.objectVersion);
  }

  private executeKernel(input: { actor: ApiActor; command: SeedProposalCommand; correlationId: string; requestedAt: string }, target: { id: string; objectType: string; sourceRefs: string[] }, mutation: (transaction: CommandTransaction) => Promise<{ evidenceRefs?: string[]; objectVersion: string }>, authorityActor: ApiActor = input.actor) {
    const request = createLifecycleCommandRequest({ actor: { actorId: authorityActor.actorId, actorType: authorityActor.actorType, roles: [] }, causationId: null, commandId: input.command.commandId, commandType: input.command.commandType, correlationId: input.correlationId, expectedObjectVersion: input.command.expectedVersion, idempotencyKey: input.command.idempotencyKey, payload: input.command, policyVersion: SEED_PROPOSAL_POLICY_VERSION, requestedAt: input.requestedAt, stepId: null, target: { objectId: target.id, objectType: target.objectType, objectVersion: input.command.expectedVersion, ownerProject: SEED_PROPOSAL_OWNER, sourceRefs: target.sourceRefs }, tenantId: input.actor.tenantId, workflowId: null });
    return this.kernel.execute(request, mutation);
  }

  private requireTransportActor(actor: ApiActor) { if (actor.actorType !== "service" || !actor.capabilities.includes("proposal.command")) throw new SeedProposalDomainError("PROPOSAL_TRANSPORT_AUTHORITY_REQUIRED", "Proposal commands require credential-derived service transport authority.", 403); }
  private requireCanonicalInstant(value: string, label: string) { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw new SeedProposalDomainError("INVALID_TIMESTAMP", `${label} must be canonical RFC3339 UTC.`, 400); }
  private nextRevision(expectedVersion: string, id: string, prefix: "proposal-template" | "proposal-version") { if (expectedVersion === "ABSENT") return 1; const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const match = expectedVersion.match(new RegExp(`^${prefix}:${escaped}:v([1-9][0-9]*)$`)); if (!match) throw new SeedProposalDomainError("VERSION_CONFLICT", `Expected version does not identify ${prefix}:${id}.`, 409); return Number(match[1]) + 1; }

  private async requireLatestVersion(client: PoolClient, input: { expectedVersion: string; id: string; kind: "proposal" | "template"; tenantId: string }) {
    const result = input.kind === "template" ? await client.query("select object_version from public.commercial_case_proposal_template_versions where tenant_id=$1 and template_id=$2 order by revision desc limit 1", [input.tenantId, input.id]) : await client.query("select proposal_version object_version from public.commercial_case_proposal_v1_identity_map where tenant_id=$1 and proposal_id=$2 order by revision desc limit 1", [input.tenantId, input.id]);
    const actual = result.rows[0] ? String(result.rows[0].object_version) : "ABSENT"; if (actual !== input.expectedVersion) throw new SeedProposalDomainError("VERSION_CONFLICT", `Expected ${input.expectedVersion}, observed ${actual}.`, 409);
  }
  private async requireProject(client: PoolClient, tenantId: string, projectId: string, expectedVersion: string) { const result = await client.query("select version from public.seed_projects where tenant_id=$1 and project_id=$2 limit 1", [tenantId, projectId]); if (!result.rows[0]) throw new SeedProposalDomainError("PROJECT_NOT_FOUND", "Canonical Project not found for this tenant.", 404); if (canonicalProjectVersion(projectId, Number(result.rows[0].version)) !== expectedVersion) throw new SeedProposalDomainError("VERSION_CONFLICT", "Canonical Project version is stale.", 409); }
  private async requireTemplate(client: PoolClient, tenantId: string, templateId: string, version: string) { const result = await client.query("select * from public.commercial_case_proposal_template_versions where tenant_id=$1 and template_id=$2 and object_version=$3 limit 1", [tenantId, templateId, version]); if (!result.rows[0]) throw new SeedProposalDomainError("TEMPLATE_NOT_FOUND", "Exact Proposal Template version not found.", 404); if (result.rows[0].status !== "ACTIVE") throw new SeedProposalDomainError("TEMPLATE_INVALID", "Invalid Proposal Template cannot create or render a proposal.", 409); return result.rows[0] as Row; }
  private async requireTenantGlobalEvidence(client: PoolClient, tenantId: string, ref: ExactProposalSourceRef) { const result = await client.query("select object_version,status,project_id from public.seed_procurement_evidence_artifacts where tenant_id=$1 and artifact_id=$2 limit 1", [tenantId, ref.objectId]); if (!result.rows[0] || result.rows[0].project_id !== null || result.rows[0].status !== "ACTIVE" || String(result.rows[0].object_version) !== ref.version || ref.ownerProject !== "LUZIONE_PROCUREMENT" || ref.objectType !== "EVIDENCE_ARTIFACT") throw new SeedProposalDomainError("TEMPLATE_SCAN_EVIDENCE_INVALID", "Template malware scan evidence must be an exact active tenant-global EvidenceArtifact/v1.", 409); }
  private async requireProposalIdentity(client: PoolClient, tenantId: string, proposalId: string, version: string, requireLatest: boolean) { const result = await client.query(`select * from public.commercial_case_proposal_v1_identity_map where tenant_id=$1 and proposal_id=$2 and proposal_version=$3 ${requireLatest ? "and revision=(select max(revision) from public.commercial_case_proposal_v1_identity_map where tenant_id=$1 and proposal_id=$2)" : ""} limit 1`, [tenantId, proposalId, version]); if (!result.rows[0]) throw new SeedProposalDomainError("VERSION_CONFLICT", "Exact current Proposal Version was not found.", 409); return result.rows[0] as Row; }
  private async requireDecisionTarget(client: PoolClient, identity: Row, scope: string, targetId: string) { if (scope === "PROPOSAL" && targetId === identity.proposal_id) return; const column = scope === "ITEM" ? "line_id" : scope === "OPTION_GROUP" ? "option_group_id" : scope === "SECTION" ? "section_id" : null; if (!column) throw new SeedProposalDomainError("DECISION_TARGET_INVALID", "Decision target scope is invalid.", 409); const result = await client.query(`select 1 from public.commercial_case_proposal_line_versions where tenant_id=$1 and proposal_id=$2 and proposal_revision=$3 and ${column}=$4 limit 1`, [identity.tenant_id, identity.proposal_id, identity.revision, targetId]); if (!result.rows[0]) throw new SeedProposalDomainError("DECISION_TARGET_INVALID", "Decision target is outside the exact Proposal Version.", 409); }
  private async requireExactRef(client: PoolClient, tenantId: string, projectId: string, ref: ExactProposalSourceRef) {
    if (ref.objectType === "PROJECT") { await this.requireProject(client, tenantId, ref.objectId, ref.version); if (ref.objectId !== projectId) throw new SeedProposalDomainError("REFERENCE_MISMATCH", "Proposal source Project differs from its Project.", 409); return; }
    if (ref.objectType === "SPECIFICATION") { const row = await client.query("select version from public.seed_specifications where tenant_id=$1 and project_id=$2 and specification_id=$3 limit 1", [tenantId, projectId, ref.objectId]); if (!row.rows[0] || specificationVersion(ref.objectId, Number(row.rows[0].version)) !== ref.version) throw new SeedProposalDomainError("VERSION_CONFLICT", "Exact Specification ref is missing or stale.", 409); return; }
    if (ref.objectType === "SPECIFICATION_LINE") { const row = await client.query("select version from public.seed_specification_lines where tenant_id=$1 and project_id=$2 and specification_line_id=$3 limit 1", [tenantId, projectId, ref.objectId]); if (!row.rows[0] || specificationLineVersion(ref.objectId, Number(row.rows[0].version)) !== ref.version) throw new SeedProposalDomainError("VERSION_CONFLICT", "Exact Specification Line ref is missing or stale.", 409); return; }
    if (ref.objectType === "PRODUCT_CANDIDATE") { const row = await client.query("select object_version,project_id,status from public.seed_product_candidates where tenant_id=$1 and product_candidate_id=$2 limit 1", [tenantId, ref.objectId]); if (!row.rows[0] || String(row.rows[0].object_version) !== ref.version || row.rows[0].project_id !== projectId || !["ELIGIBLE","SELECTED"].includes(String(row.rows[0].status))) throw new SeedProposalDomainError("VERSION_CONFLICT", "Exact eligible Product Candidate ref is missing, stale, or outside the Project.", 409); return; }
    const row = await client.query("select object_version,project_id,status from public.seed_procurement_evidence_artifacts where tenant_id=$1 and artifact_id=$2 limit 1", [tenantId, ref.objectId]); if (!row.rows[0] || String(row.rows[0].object_version) !== ref.version || row.rows[0].project_id !== projectId || row.rows[0].status !== "ACTIVE" || ref.version !== procurementVersions.evidence(ref.objectId)) throw new SeedProposalDomainError("VERSION_CONFLICT", "Exact active Evidence Artifact ref is missing, stale, or outside the Project.", 409);
  }
  private confirmReadback<T>(receipt: Awaited<ReturnType<LifecycleCommandKernel<CommandTransaction>["execute"]>>, readback: T | null, versionOf: (value: T) => string) { if (!readback || versionOf(readback) !== receipt.objectVersion) throw new SeedProposalDomainError("READBACK_UNCONFIRMED", "Proposal owner commit readback could not be confirmed; reconcile the durable receipt before retrying.", 503, { committedObjectVersion: receipt.objectVersion, receiptId: receipt.receiptId, retry: "RECONCILE_FIRST" }); return { readback, readbackMatchesReceipt: true as const, receipt }; }
  private async readTransaction<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect(); try { await beginRead(client, tenantId); const result = await operation(client); await client.query("commit"); return result; } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); } }
}

export { IdempotencyConflictError };
