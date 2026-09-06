import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { createLifecycleCommandRequest, IdempotencyConflictError, LifecycleCommandKernel, type AcceptedCommandWrite } from "@/modules/platform-guarantees/commandKernel";
import {
  parseEvidenceArtifactV1,
  parseBidComparisonV1,
  parseProductCandidateV1,
  parseProductSourceV1,
  parsePurchaseOrderV1,
  parseRFQV1,
  parseSupplierQuoteV1,
  parseTimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import {
  SEED_PRODUCT_CONTRACT_VERSIONS,
  type EvidenceArtifactV1,
  type BidComparisonV1,
  type RFQV1,
  type PurchaseOrderV1,
  type SeedAuthorityBoundaryV1,
  type SeedMutationBoundaryV1,
  type SeedReceiptReadbackV1,
  type SeedSourceRefV1,
  type SupplierQuoteV1,
  type TimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductContracts";
import {
  SEED_PROCUREMENT_OWNER,
  SEED_PROCUREMENT_POLICY_VERSION,
  canonicalSeedProcurementPayloadHash,
  type EvidenceArtifactRegisterCommand,
  type BidComparisonCreateCommand,
  type ProcurementSelectionRecordCommand,
  type ProductCandidateRecordCommand,
  type ProductSourceRecordCommand,
  type PurchaseOrderDraftCreateCommand,
  type RFQDraftCreateCommand,
  type SeedProcurementCommand,
  type SupplierQuoteNormalizeCommand,
} from "@/modules/seed-procurement/contracts";
import {
  evidenceArtifactIdFor,
  bidComparisonIdFor,
  normalizeQuoteEconomics,
  objectiveScore,
  productCandidateReadbackDefects,
  productCandidateIdFor,
  productSourceReadbackDefects,
  productSourceIdFor,
  purchaseOrderIdFor,
  procurementVersions,
  rfqIdFor,
  selectionDecisionIdFor,
  supplierQuoteIdFor,
  timelineProjectVersion,
} from "@/modules/seed-procurement/model";
import type { SeedProcurementReadModelData } from "@/modules/seed-procurement/readModel";
import { projectVersion, specificationLineVersion, specificationVersion } from "@/modules/seed-project-publication/model";
import { requireEligibleSupplier } from "@/modules/seed-supplier-identity/store";
import { SUPPLIER_PROFILE_OWNER } from "@/modules/seed-supplier-identity/contracts";
import { createUniversalEventEnvelope, sha256 } from "@/modules/platform-guarantees/eventContract";
import type { LifecycleCommandRequest } from "@/modules/platform-guarantees/types";
import { requireAcceptedCanonicalProposalVersion, SeedProposalDomainError as CanonicalProposalDomainError } from "@/modules/seed-proposal-owner/store";

type Row = Record<string, unknown>;
type Hooks = { afterOwnerWrites?: (point: "BID_COMPARISON" | "EVIDENCE" | "PRODUCT_CANDIDATE" | "PRODUCT_SOURCE" | "PURCHASE_ORDER" | "RFQ" | "SELECTION" | "SUPPLIER_QUOTE", client: PoolClient) => Promise<void> };

const RECEIPT_COLUMNS = `r.receipt_id, r.idempotency_key, r.payload_hash,
  r.expected_object_version, r.policy_version, r.actor_id, r.actor_type,
  r.correlation_id, r.committed_at, r.committed_object_version,
  r.command_id, r.command_type, r.target_owner_project, r.target_object_type,
  r.target_object_id, r.requested_at, r.state receipt_state`;

class ProcurementAtomicCommandStore extends PostgresAtomicCommandStore {
  async insertAccepted(transaction: CommandTransaction, write: AcceptedCommandWrite, request: LifecycleCommandRequest) {
    write.receipt.state = "DOMAIN_COMMITTED";
    await super.insertAccepted(transaction, write, request);
  }
}

export class SeedProcurementDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly recovery?: { committedObjectVersion: string; receiptId: string; retry: "RECONCILE_FIRST" },
  ) {
    super(message);
    this.name = "SeedProcurementDomainError";
  }
}

function json<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }
function iso(value: unknown) { const raw = String(value); const parsed = Date.parse(raw); const normalized = Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""; if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) throw new Error("Canonical procurement row has an invalid timestamp."); return normalized; }
function nullableText(value: unknown) { return value === null || value === undefined ? null : String(value); }
function requireSameProjectScope(actual: unknown, expected: string | null, label: string) {
  if (nullableText(actual) !== expected) throw new SeedProcurementDomainError("OBJECT_ISOLATION_DENIED", `${label} must inherit the exact Project scope.`, 404);
}
function actorType(value: unknown): SeedAuthorityBoundaryV1["actorType"] { return value === "user" ? "HUMAN" : value === "agent" ? "SULTAN_AGENT" : "SERVICE"; }
function sourceRef(tenantId: string, input: Omit<SeedSourceRefV1, "tenantId">): SeedSourceRefV1 { return { ...input, tenantId }; }
function assertOwnerReceipt(row: Row, input: { commandType: string; id: string; objectType: string; version: string }) {
  if (String(row.receipt_state) !== "DOMAIN_COMMITTED"
    || String(row.committed_object_version) !== input.version
    || String(row.command_type) !== input.commandType
    || String(row.target_owner_project) !== SEED_PROCUREMENT_OWNER
    || String(row.target_object_type) !== input.objectType
    || String(row.target_object_id) !== input.id
    || String(row.policy_version) !== SEED_PROCUREMENT_POLICY_VERSION
    || row.committed_at === null
    || iso(row.requested_at) !== iso(row.created_at ?? row.decided_at)) {
    throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", `${input.objectType} readback is not bound to its exact DOMAIN_COMMITTED P110 receipt.`, 500);
  }
}
function boundaries(
  row: Row,
  committedVersion: string,
  capability: string,
  approvalRef: string | null = null,
  authority: { decision: SeedAuthorityBoundaryV1["decision"]; effectClass: SeedAuthorityBoundaryV1["effectClass"] } = { decision: "ALLOW", effectClass: "A1" },
) {
  const mutation: SeedMutationBoundaryV1 = { expectedVersion: String(row.expected_object_version), idempotencyKey: String(row.idempotency_key), payloadHash: String(row.payload_hash) };
  const authorityBoundary: SeedAuthorityBoundaryV1 = { actorId: String(row.actor_id), actorType: actorType(row.actor_type), approvalRef, capability, decision: authority.decision, effectClass: authority.effectClass, policyVersion: String(row.policy_version), serverDerivedIdentityRef: `correlation:${String(row.correlation_id)}` };
  const receipt: SeedReceiptReadbackV1 = { committedVersion, finality: "DOMAIN_COMMITTED", observedAt: null, observedVersion: null, providerAcknowledgementRef: null, receiptId: String(row.receipt_id), sourceReadbackRef: null };
  return { authority: authorityBoundary, mutation, receipt };
}

function evidenceFromRow(row: Row): EvidenceArtifactV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.artifact_id);
  const version = String(row.object_version);
  assertOwnerReceipt(row, { commandType: "evidence_artifact.register", id, objectType: "evidence_artifact", version });
  const data = json<EvidenceArtifactRegisterCommand["artifact"]>(row.canonical_payload);
  return parseEvidenceArtifactV1({
    ...boundaries(row, version, "procurement.evidence.register"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.evidenceArtifact,
    createdAt: iso(row.created_at),
    data,
    resource: { archivedAt: null, id, status: row.status, type: "EVIDENCE_ARTIFACT", version },
    sourceRefs: [sourceRef(tenantId, { objectId: data.sourceRecordRef, objectType: "SOURCE_RECORD", ownerProject: data.provider, version: data.contentDigest })],
    tenantId,
    updatedAt: iso(row.created_at),
  });
}

function sourceFromRow(row: Row) {
  const tenantId = String(row.tenant_id);
  const id = String(row.product_source_id);
  const version = String(row.object_version);
  assertOwnerReceipt(row, { commandType: "product_source.record", id, objectType: "product_source", version });
  const data = json<ProductSourceRecordCommand["source"] & { sourceArtifactRef: string }>(row.canonical_payload);
  const projectId = nullableText(row.project_id);
  const defects = productSourceReadbackDefects({
    artifactContentDigest: String(row.artifact_content_digest),
    artifactId: String(row.artifact_id),
    artifactProjectId: nullableText(row.artifact_project_id),
    artifactStatus: String(row.artifact_status),
    artifactVersion: String(row.artifact_version),
    payloadContentDigest: data.contentDigest,
    payloadSourceArtifactRef: data.sourceArtifactRef,
    rowContentDigest: String(row.content_digest),
    sourceProjectId: projectId,
    sourceStatus: String(row.status),
  });
  if (defects.length) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", `Product Source readback failed lineage checks: ${defects.join(", ")}.`, 500);
  const upstreamRows = json<Array<{ artifactId: string; artifactProjectId: string | null; artifactStatus: string; artifactVersion: string }>>(row.upstream_artifact_rows ?? []);
  const storedUpstream = json<Array<{ artifactId: string; artifactVersion: string }>>(row.upstream_artifact_refs ?? []);
  if (upstreamRows.length !== storedUpstream.length || new Set(storedUpstream.map((ref) => ref.artifactId)).size !== storedUpstream.length || storedUpstream.some((ref) => ref.artifactId === String(row.artifact_id))) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "Product Source upstream Evidence Artifact lineage is duplicated or incomplete.", 500);
  const upstreamArtifactRefs = storedUpstream.map((stored, index) => {
    const actual = upstreamRows[index];
    if (!actual || actual.artifactId !== stored.artifactId || actual.artifactVersion !== stored.artifactVersion || actual.artifactProjectId !== projectId || actual.artifactStatus !== "ACTIVE") throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "Product Source upstream Evidence Artifact lineage is stale, dangling, unreviewed, or crosses Project scope.", 500);
    return sourceRef(tenantId, { objectId: stored.artifactId, objectType: "EVIDENCE_ARTIFACT", ownerProject: SEED_PROCUREMENT_OWNER, version: stored.artifactVersion });
  });
  const directRef = sourceRef(tenantId, { objectId: String(row.artifact_id), objectType: "EVIDENCE_ARTIFACT", ownerProject: SEED_PROCUREMENT_OWNER, version: String(row.artifact_version) });
  const resource = parseProductSourceV1({
    ...boundaries(row, version, "procurement.product_source.record"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.productSource,
    createdAt: iso(row.created_at),
    data,
    resource: { archivedAt: null, id, status: row.status, type: "PRODUCT_SOURCE", version },
    sourceRefs: [directRef, ...upstreamArtifactRefs],
    tenantId,
    updatedAt: iso(row.created_at),
  });
  return { conflictRefs: json<string[]>(row.conflict_refs), duplicateOfSourceId: row.duplicate_of_source_id === null ? null : String(row.duplicate_of_source_id), extractionProvenance: json<string[]>(row.extraction_provenance), ingestionFormat: String(row.ingestion_format), projectId, resource, upstreamArtifactRefs };
}

function candidateFromRow(row: Row) {
  const tenantId = String(row.tenant_id);
  const id = String(row.product_candidate_id);
  const version = String(row.object_version);
  assertOwnerReceipt(row, { commandType: "product_candidate.record", id, objectType: "product_candidate", version });
  const data = json<ProductCandidateRecordCommand["candidate"] & { productSourceId: string }>(row.canonical_payload);
  const projectId = nullableText(row.project_id);
  const defects = productCandidateReadbackDefects({
    candidateProjectId: projectId,
    candidateStatus: String(row.status),
    payloadProductSourceId: data.productSourceId,
    productSourceId: String(row.product_source_id),
    productSourceProjectId: nullableText(row.product_source_project_id),
    productSourceStatus: String(row.product_source_status),
    productSourceVersion: String(row.product_source_version),
  });
  if (defects.length) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", `Product Candidate readback failed lineage checks: ${defects.join(", ")}.`, 500);
  if ((data.vendorId === null) !== (row.supplier_profile_id === null) || (data.vendorId !== null && (String(row.supplier_account_id) !== data.vendorId || String(row.supplier_profile_object_version) !== String(row.supplier_profile_version)))) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "Product Candidate vendor does not bind its exact Supplier Profile eligibility fact.", 500);
  const resource = parseProductCandidateV1({
    ...boundaries(row, version, "procurement.product_candidate.record"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.productCandidate,
    createdAt: iso(row.created_at),
    data,
    resource: { archivedAt: null, id, status: row.status, type: "PRODUCT_CANDIDATE", version },
    sourceRefs: [sourceRef(tenantId, { objectId: String(row.product_source_id), objectType: "PRODUCT_SOURCE", ownerProject: SEED_PROCUREMENT_OWNER, version: String(row.product_source_version) })],
    tenantId,
    updatedAt: iso(row.created_at),
  });
  return { conflictRefs: json<string[]>(row.conflict_refs), duplicateOfCandidateId: row.duplicate_of_candidate_id === null ? null : String(row.duplicate_of_candidate_id), extractionProvenance: json<string[]>(row.extraction_provenance), fit: { inputs: json<ProductCandidateRecordCommand["fit"]["inputs"]>(row.fit_inputs), score: Number(row.objective_fit_score), weights: json<ProductCandidateRecordCommand["fit"]["weights"]>(row.fit_weights) }, projectId, resource };
}

function supplierProfileRef(row: Row, tenantId: string) {
  const id = String(row.supplier_profile_id);
  const version = String(row.supplier_profile_version);
  if (!id || !version) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "Procurement row lacks exact Supplier Profile provenance.", 500);
  return sourceRef(tenantId, { objectId: id, objectType: "SUPPLIER_PROFILE", ownerProject: SUPPLIER_PROFILE_OWNER, version });
}

function rfqFromRow(row: Row): RFQV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.rfq_id);
  const version = String(row.object_version);
  assertOwnerReceipt(row, { commandType: "rfq.create_draft", id, objectType: "rfq", version });
  const data = json<RFQV1["data"]>(row.canonical_payload);
  if (data.projectId !== String(row.project_id) || data.specificationId !== String(row.specification_id) || data.supplierId !== String(row.supplier_id)) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "RFQ canonical payload does not match relational ownership fields.", 500);
  const lineVersions = json<Record<string, string>>(row.specification_line_versions);
  if (JSON.stringify(Object.keys(lineVersions).sort()) !== JSON.stringify([...data.specificationLineIds].sort())) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "RFQ Specification Line set does not reconcile.", 500);
  return parseRFQV1({ ...boundaries(row, version, "rfq.create_draft"), contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.rfq, createdAt: iso(row.created_at), data, resource: { archivedAt: null, id, status: "DRAFT", type: "RFQ", version }, sourceRefs: [sourceRef(tenantId, { objectId: data.projectId, objectType: "PROJECT", ownerProject: "LUZIONE_PROJECT", version: String(row.project_version) }), sourceRef(tenantId, { objectId: data.specificationId, objectType: "SPECIFICATION", ownerProject: "LUZIONE_PROJECT", version: String(row.specification_version) }), ...Object.entries(lineVersions).sort(([left], [right]) => left.localeCompare(right)).map(([objectId, refVersion]) => sourceRef(tenantId, { objectId, objectType: "SPECIFICATION_LINE", ownerProject: "LUZIONE_PROJECT", version: refVersion })), supplierProfileRef(row, tenantId)], tenantId, updatedAt: iso(row.created_at) });
}

function quoteFromRow(row: Row) {
  const tenantId = String(row.tenant_id);
  const id = String(row.supplier_quote_id);
  const version = String(row.object_version);
  assertOwnerReceipt(row, { commandType: "supplier_quote.normalize", id, objectType: "supplier_quote", version });
  const data = json<SupplierQuoteV1["data"]>(row.canonical_payload);
  if (data.rfqId !== String(row.rfq_id) || data.evidenceArtifactId !== String(row.evidence_artifact_id) || data.supplierId !== String(row.supplier_id)) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "Supplier Quote canonical payload does not match exact RFQ, evidence, or supplier fields.", 500);
  const resource = parseSupplierQuoteV1({ ...boundaries(row, version, "supplier_quote.normalize"), contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.supplierQuote, createdAt: iso(row.created_at), data, resource: { archivedAt: null, id, status: row.status, type: "SUPPLIER_QUOTE", version }, sourceRefs: [sourceRef(tenantId, { objectId: data.rfqId, objectType: "RFQ", ownerProject: SEED_PROCUREMENT_OWNER, version: String(row.rfq_version) }), sourceRef(tenantId, { objectId: data.evidenceArtifactId, objectType: "EVIDENCE_ARTIFACT", ownerProject: SEED_PROCUREMENT_OWNER, version: String(row.evidence_artifact_version) }), supplierProfileRef(row, tenantId)], tenantId, updatedAt: iso(row.created_at) });
  return { economics: json<ReturnType<typeof normalizeQuoteEconomics>>(row.economics_payload), resource };
}

function bidFromRow(row: Row): BidComparisonV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.bid_comparison_id);
  const version = String(row.object_version);
  assertOwnerReceipt(row, { commandType: Number(row.version) === 2 ? "bid_comparison.approve_from_selection" : "bid_comparison.create", id, objectType: "bid_comparison", version });
  const data = json<BidComparisonV1["data"]>(row.canonical_payload);
  const sourceRefs = json<SeedSourceRefV1[]>(row.source_refs);
  const approved = Number(row.version) === 2;
  if (data.basisCurrency !== String(row.basis_currency) || JSON.stringify([...data.rfqIds].sort()) !== JSON.stringify(json<string[]>(row.rfq_ids).sort()) || JSON.stringify([...data.supplierQuoteIds].sort()) !== JSON.stringify(json<string[]>(row.supplier_quote_ids).sort())) throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "Bid Comparison canonical payload does not reconcile to exact RFQ and quote sets.", 500);
  return parseBidComparisonV1({
    ...boundaries(
      row,
      version,
      approved ? "procurement.selection.record" : "bid_comparison.create",
      approved ? data.selectedByHumanApprovalRef : null,
      approved ? { decision: "REQUIRE_HUMAN", effectClass: "A2" } : undefined,
    ),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.bidComparison,
    createdAt: iso(row.created_at),
    data,
    resource: { archivedAt: null, id, status: row.status, type: "BID_COMPARISON", version },
    sourceRefs,
    tenantId,
    updatedAt: iso(row.created_at),
  });
}

function selectionFromRow(row: Row) {
  const id = String(row.selection_decision_id);
  const version = String(row.object_version);
  const tenantId = String(row.tenant_id);
  assertOwnerReceipt(row, { commandType: "procurement_selection.record", id, objectType: "procurement_selection", version });
  return {
    actor: { actorId: String(row.created_by), actorType: "HUMAN" as const, serverDerivedIdentityRef: `human:${String(row.human_authentication_ref)}` },
    bidComparisonId: String(row.bid_comparison_id), contractVersion: "ProcurementSelectionDecision/v1" as const, createdAt: iso(row.decided_at), decision: "SELECT" as const,
    evidenceRefs: json<string[]>(row.evidence_refs), mutation: { expectedVersion: String(row.expected_object_version), idempotencyKey: String(row.idempotency_key), payloadHash: String(row.payload_hash) },
    projectId: String(row.project_id), rationale: String(row.rationale), receipt: { committedVersion: version, finality: "DOMAIN_COMMITTED" as const, receiptId: String(row.receipt_id) },
    resource: { id, status: "ACTIVE" as const, version }, selectedSupplierQuoteId: String(row.selected_supplier_quote_id), tenantId,
  };
}

function purchaseOrderFromRow(row: Row): PurchaseOrderV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.purchase_order_id);
  const version = String(row.object_version);
  assertOwnerReceipt(row, { commandType: "purchase_order.create_draft", id, objectType: "purchase_order", version });
  const data = json<PurchaseOrderV1["data"]>(row.canonical_payload);
  if (data.bidComparisonId !== String(row.bid_comparison_id)
    || data.proposalVersionId !== String(row.proposal_version_id)
    || data.supplierQuoteId !== String(row.supplier_quote_id)
    || data.supplierId !== String(row.supplier_id)
    || data.currency !== String(row.currency)
    || data.totalMinor !== Number(row.total_minor)
    || data.releaseApprovalRef !== null
    || row.external_effect_authorized !== false) {
    throw new SeedProcurementDomainError("CANONICAL_READBACK_CORRUPT", "Purchase Order draft payload diverges from its relational no-effect owner facts.", 500);
  }
  return parsePurchaseOrderV1({
    ...boundaries(row, version, "purchase_order.create_draft"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.purchaseOrder,
    createdAt: iso(row.created_at), data,
    resource: { archivedAt: null, id, status: "DRAFT", type: "PURCHASE_ORDER", version },
    sourceRefs: json<SeedSourceRefV1[]>(row.source_refs), tenantId, updatedAt: iso(row.created_at),
  });
}

async function bindRead(client: PoolClient, tenantId: string) { await client.query("begin read only"); await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]); }
async function advisory(client: PoolClient, tenantId: string, key: string) { await client.query("select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [tenantId, key]); }

export class SeedProcurementStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;
  private readonly commandStore: ProcurementAtomicCommandStore;

  constructor(private readonly pool: Pool = databasePool(), private readonly hooks: Hooks = {}) {
    this.commandStore = new ProcurementAtomicCommandStore(pool);
    this.kernel = new LifecycleCommandKernel(this.commandStore);
  }

  async execute(input: { actor: ApiActor; command: SeedProcurementCommand; correlationId: string; human?: HumanApprovalSubject; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    switch (input.command.commandType) {
      case "evidence_artifact.register": return this.executeEvidence({ ...input, command: input.command });
      case "product_source.record": return this.executeProductSource({ ...input, command: input.command });
      case "product_candidate.record": return this.executeProductCandidate({ ...input, command: input.command });
      case "rfq.create_draft": return this.executeRfq({ ...input, command: input.command });
      case "supplier_quote.normalize": return this.executeSupplierQuote({ ...input, command: input.command });
      case "bid_comparison.create": return this.executeBidComparison({ ...input, command: input.command });
      case "procurement_selection.record": return this.executeSelection({ ...input, command: input.command, human: input.human });
      case "purchase_order.create_draft": return this.executePurchaseOrder({ ...input, command: input.command });
      case "purchase_order_acknowledgement.record": throw new SeedProcurementDomainError("PURCHASE_ORDER_NOT_AVAILABLE", "PO acknowledgement, release, send, and provider finality remain held pending external-effect admission and authoritative readback.", 409);
    }
  }

  async readProjectProcurement(actor: ApiActor, projectId: string): Promise<SeedProcurementReadModelData | null> {
    return this.readTransaction(actor.tenantId, async (client) => {
      const project = await client.query("select project_id,version from public.seed_projects where tenant_id = $1 and project_id = $2 limit 1", [actor.tenantId, projectId]);
      if (!project.rows[0]) return null;
      const evidence = await client.query(`select a.*, ${RECEIPT_COLUMNS} from public.seed_procurement_evidence_artifacts a join public.p110_command_receipts r on r.tenant_id=a.tenant_id and r.command_id=a.created_command_id where a.tenant_id=$1 and a.project_id=$2 order by a.captured_at,a.artifact_id`, [actor.tenantId, projectId]);
      const sources = await client.query(`select s.*, ${RECEIPT_COLUMNS}, a.object_version artifact_version,a.content_digest artifact_content_digest,a.status artifact_status,a.project_id artifact_project_id,
        (select coalesce(jsonb_agg(jsonb_build_object('artifactId',u.ref->>'artifactId','artifactVersion',u.ref->>'artifactVersion','artifactProjectId',ua.project_id,'artifactStatus',ua.status) order by u.ordinality),'[]'::jsonb) from jsonb_array_elements(s.upstream_artifact_refs) with ordinality u(ref,ordinality) left join public.seed_procurement_evidence_artifacts ua on ua.tenant_id=s.tenant_id and ua.artifact_id=u.ref->>'artifactId') upstream_artifact_rows
        from public.seed_product_sources s join public.seed_procurement_evidence_artifacts a on a.tenant_id=s.tenant_id and a.artifact_id=s.artifact_id join public.p110_command_receipts r on r.tenant_id=s.tenant_id and r.command_id=s.created_command_id where s.tenant_id=$1 and s.project_id=$2 order by s.observed_at,s.product_source_id`, [actor.tenantId, projectId]);
      const candidates = await client.query(`select c.*, ${RECEIPT_COLUMNS}, s.object_version product_source_version,s.status product_source_status,s.project_id product_source_project_id,p.account_id supplier_account_id,p.object_version supplier_profile_object_version from public.seed_product_candidates c join public.seed_product_sources s on s.tenant_id=c.tenant_id and s.product_source_id=c.product_source_id left join public.seed_supplier_profile_versions p on p.tenant_id=c.tenant_id and p.supplier_profile_id=c.supplier_profile_id and p.object_version=c.supplier_profile_version join public.p110_command_receipts r on r.tenant_id=c.tenant_id and r.command_id=c.created_command_id where c.tenant_id=$1 and c.project_id=$2 order by c.objective_fit_score desc,c.product_candidate_id`, [actor.tenantId, projectId]);
      const rfqs = await client.query(`select q.*, ${RECEIPT_COLUMNS} from public.seed_rfq_drafts q join public.p110_command_receipts r on r.tenant_id=q.tenant_id and r.command_id=q.created_command_id where q.tenant_id=$1 and q.project_id=$2 order by q.created_at,q.rfq_id`, [actor.tenantId, projectId]);
      const quotes = await client.query(`select q.*, ${RECEIPT_COLUMNS} from public.seed_supplier_quotes q join public.p110_command_receipts r on r.tenant_id=q.tenant_id and r.command_id=q.created_command_id where q.tenant_id=$1 and q.project_id=$2 order by q.created_at,q.supplier_quote_id`, [actor.tenantId, projectId]);
      const bids = await client.query(`select b.*, ${RECEIPT_COLUMNS} from public.seed_bid_comparisons b join public.p110_command_receipts r on r.tenant_id=b.tenant_id and r.command_id=b.created_command_id where b.tenant_id=$1 and b.project_id=$2 order by b.created_at,b.bid_comparison_id,b.version`, [actor.tenantId, projectId]);
      const selections = await client.query(`select s.*, ${RECEIPT_COLUMNS} from public.seed_procurement_selection_decisions s join public.p110_command_receipts r on r.tenant_id=s.tenant_id and r.command_id=s.created_command_id where s.tenant_id=$1 and s.project_id=$2 order by s.decided_at,s.selection_decision_id`, [actor.tenantId, projectId]);
      const proposalOwnerAvailable = Boolean((await client.query("select to_regclass('public.commercial_case_proposal_v1_identity_map') is not null available")).rows[0].available);
      const purchaseOrders = await client.query(`select p.*, ${RECEIPT_COLUMNS} from public.seed_purchase_order_drafts p join public.p110_command_receipts r on r.tenant_id=p.tenant_id and r.command_id=p.created_command_id where p.tenant_id=$1 and p.project_id=$2 order by p.created_at,p.purchase_order_id`, [actor.tenantId, projectId]);
      const heldRows = await client.query("select count(*) acknowledgements from public.seed_purchase_order_acknowledgements where tenant_id=$1 and project_id=$2", [actor.tenantId, projectId]);
      if (Number(heldRows.rows[0].acknowledgements) !== 0) throw new Error("Dependency-held Purchase Order acknowledgement table unexpectedly contains canonical rows.");
      const timelineRows = await client.query(`select e.*, r.receipt_id, r.expected_object_version, r.committed_object_version, r.policy_version, r.actor_id, r.actor_type, r.idempotency_key, r.payload_hash, r.command_type, r.correlation_id
        from public.p110_event_envelopes e join public.p110_command_receipts r on r.tenant_id=e.tenant_id and r.event_id=e.event_id
        where e.tenant_id=$1 and r.command_id in (
          select created_command_id from public.seed_procurement_evidence_artifacts where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_product_sources where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_product_candidates where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_rfq_drafts where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_supplier_quotes where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_bid_comparisons where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_procurement_selection_decisions where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_purchase_order_drafts where tenant_id=$1 and project_id=$2
        ) order by e.recorded_at,e.event_id`, [actor.tenantId, projectId]);
      return { acknowledgements: [], bidComparisons: bids.rows.map((row) => bidFromRow(row as Row)), blockedDependencies: [proposalOwnerAvailable
        ? { affectedCapabilities: ["purchase_order_acknowledgement.record", "purchase_order.release", "purchase_order.send"], code: "PURCHASE_ORDER_EFFECT_ADMISSION_HELD", requiredContract: "approved external-effect admission plus provider readback", summary: "PO drafts are canonical, but acknowledgement, release, send, and provider finality remain held." }
        : { affectedCapabilities: ["purchase_order.create_draft", "purchase_order_acknowledgement.record"], code: "PROPOSAL_CANONICAL_READER_UNAVAILABLE", requiredContract: "ProposalVersion/v1 canonical API readback", summary: "The A2P canonical Proposal Version owner is not installed; PO preparation remains held." },
      ], evidenceArtifacts: evidence.rows.map((row) => ({ projectId: nullableText(row.project_id), resource: evidenceFromRow(row as Row) })), productCandidates: candidates.rows.map((row) => candidateFromRow(row as Row)), productSources: sources.rows.map((row) => sourceFromRow(row as Row)), purchaseOrders: purchaseOrders.rows.map((row) => purchaseOrderFromRow(row as Row)), rfqs: rfqs.rows.map((row) => rfqFromRow(row as Row)), selectionDecisions: selections.rows.map((row) => selectionFromRow(row as Row)), supplierQuotes: quotes.rows.map((row) => quoteFromRow(row as Row)), timeline: timelineRows.rows.map((row) => timelineFromRow(row as Row, projectId, timelineProjectVersion(projectId, project.rows[0].version))) };
    });
  }

  async readEvidence(actor: ApiActor, artifactId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select a.*, ${RECEIPT_COLUMNS} from public.seed_procurement_evidence_artifacts a join public.p110_command_receipts r on r.tenant_id=a.tenant_id and r.command_id=a.created_command_id where a.tenant_id=$1 and a.artifact_id=$2 limit 1`, [actor.tenantId, artifactId]);
      return result.rows[0] ? evidenceFromRow(result.rows[0] as Row) : null;
    });
  }

  async readProductSource(actor: ApiActor, sourceId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select s.*, ${RECEIPT_COLUMNS}, a.object_version artifact_version,a.content_digest artifact_content_digest,a.status artifact_status,a.project_id artifact_project_id,
        (select coalesce(jsonb_agg(jsonb_build_object('artifactId',u.ref->>'artifactId','artifactVersion',u.ref->>'artifactVersion','artifactProjectId',ua.project_id,'artifactStatus',ua.status) order by u.ordinality),'[]'::jsonb) from jsonb_array_elements(s.upstream_artifact_refs) with ordinality u(ref,ordinality) left join public.seed_procurement_evidence_artifacts ua on ua.tenant_id=s.tenant_id and ua.artifact_id=u.ref->>'artifactId') upstream_artifact_rows
        from public.seed_product_sources s join public.seed_procurement_evidence_artifacts a on a.tenant_id=s.tenant_id and a.artifact_id=s.artifact_id join public.p110_command_receipts r on r.tenant_id=s.tenant_id and r.command_id=s.created_command_id where s.tenant_id=$1 and s.product_source_id=$2 limit 1`, [actor.tenantId, sourceId]);
      return result.rows[0] ? sourceFromRow(result.rows[0] as Row) : null;
    });
  }

  async readProductCandidate(actor: ApiActor, candidateId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select c.*, ${RECEIPT_COLUMNS}, s.object_version product_source_version,s.status product_source_status,s.project_id product_source_project_id,p.account_id supplier_account_id,p.object_version supplier_profile_object_version from public.seed_product_candidates c join public.seed_product_sources s on s.tenant_id=c.tenant_id and s.product_source_id=c.product_source_id left join public.seed_supplier_profile_versions p on p.tenant_id=c.tenant_id and p.supplier_profile_id=c.supplier_profile_id and p.object_version=c.supplier_profile_version join public.p110_command_receipts r on r.tenant_id=c.tenant_id and r.command_id=c.created_command_id where c.tenant_id=$1 and c.product_candidate_id=$2 limit 1`, [actor.tenantId, candidateId]);
      return result.rows[0] ? candidateFromRow(result.rows[0] as Row) : null;
    });
  }

  async readRfq(actor: ApiActor, rfqId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select q.*, ${RECEIPT_COLUMNS} from public.seed_rfq_drafts q join public.p110_command_receipts r on r.tenant_id=q.tenant_id and r.command_id=q.created_command_id where q.tenant_id=$1 and q.rfq_id=$2 limit 1`, [actor.tenantId, rfqId]);
      return result.rows[0] ? rfqFromRow(result.rows[0] as Row) : null;
    });
  }

  async readSupplierQuote(actor: ApiActor, quoteId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select q.*, ${RECEIPT_COLUMNS} from public.seed_supplier_quotes q join public.p110_command_receipts r on r.tenant_id=q.tenant_id and r.command_id=q.created_command_id where q.tenant_id=$1 and q.supplier_quote_id=$2 limit 1`, [actor.tenantId, quoteId]);
      return result.rows[0] ? quoteFromRow(result.rows[0] as Row) : null;
    });
  }

  async readBidComparison(actor: ApiActor, bidId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select b.*, ${RECEIPT_COLUMNS} from public.seed_bid_comparisons b join public.p110_command_receipts r on r.tenant_id=b.tenant_id and r.command_id=b.created_command_id where b.tenant_id=$1 and b.bid_comparison_id=$2 order by b.version desc limit 1`, [actor.tenantId, bidId]);
      return result.rows[0] ? bidFromRow(result.rows[0] as Row) : null;
    });
  }

  async readSelection(actor: ApiActor, selectionId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select s.*, ${RECEIPT_COLUMNS} from public.seed_procurement_selection_decisions s join public.p110_command_receipts r on r.tenant_id=s.tenant_id and r.command_id=s.created_command_id where s.tenant_id=$1 and s.selection_decision_id=$2 limit 1`, [actor.tenantId, selectionId]);
      return result.rows[0] ? selectionFromRow(result.rows[0] as Row) : null;
    });
  }

  async readPurchaseOrder(actor: ApiActor, purchaseOrderId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select p.*, ${RECEIPT_COLUMNS} from public.seed_purchase_order_drafts p join public.p110_command_receipts r on r.tenant_id=p.tenant_id and r.command_id=p.created_command_id where p.tenant_id=$1 and p.purchase_order_id=$2 limit 1`, [actor.tenantId, purchaseOrderId]);
      return result.rows[0] ? purchaseOrderFromRow(result.rows[0] as Row) : null;
    });
  }

  async executeEvidence(input: { actor: ApiActor; command: EvidenceArtifactRegisterCommand; correlationId: string; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    if (Date.parse(input.command.artifact.capturedAt) > Date.parse(input.requestedAt)) throw new SeedProcurementDomainError("FUTURE_OBSERVATION", "Evidence Artifact capturedAt cannot be later than the server-derived request time.", 409);
    const id = evidenceArtifactIdFor(input.actor.tenantId, input.command.artifact);
    const version = procurementVersions.evidence(id);
    const receipt = await this.executeKernel(input, { id, objectType: "evidence_artifact", sourceRefs: [`${input.command.artifact.provider}:${input.command.artifact.sourceRecordRef}@${input.command.artifact.contentDigest}`] }, async (transaction) => {
      if (input.command.projectRef) await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectRef.projectId, input.command.projectRef.projectVersion);
      await advisory(transaction.client, input.actor.tenantId, `evidence:${id}`);
      const existing = await transaction.client.query("select artifact_id from public.seed_procurement_evidence_artifacts where tenant_id=$1 and provider=$2 and source_record_ref=$3 and content_digest=$4 limit 1", [input.actor.tenantId, input.command.artifact.provider, input.command.artifact.sourceRecordRef, input.command.artifact.contentDigest]);
      if (existing.rows[0]) throw new SeedProcurementDomainError("EVIDENCE_ALREADY_REGISTERED", "This exact evidence artifact is already registered; replay the original idempotency key.", 409);
      const status = input.command.artifact.promptInjectionState === "DETECTED" ? "QUARANTINED" : input.command.artifact.promptInjectionState === "NOT_ASSESSED" ? "REVIEW_REQUIRED" : "ACTIVE";
      await transaction.client.query(`insert into public.seed_procurement_evidence_artifacts (tenant_id,artifact_id,project_id,artifact_kind,status,content_digest,provider,source_record_ref,canonical_payload,object_version,created_command_id,created_by,created_by_type,captured_at,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)`, [input.actor.tenantId, id, input.command.projectRef?.projectId ?? null, input.command.artifact.kind, status, input.command.artifact.contentDigest, input.command.artifact.provider, input.command.artifact.sourceRecordRef, JSON.stringify(input.command.artifact), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.command.artifact.capturedAt, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("EVIDENCE", transaction.client);
      return { evidenceRefs: [input.command.artifact.storageRef], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readEvidence(input.actor, id));
  }

  async executeProductSource(input: { actor: ApiActor; command: ProductSourceRecordCommand; correlationId: string; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    if (Date.parse(input.command.source.observedAt) > Date.parse(input.requestedAt)) throw new SeedProcurementDomainError("FUTURE_OBSERVATION", "Product Source observedAt cannot be later than the server-derived request time.", 409);
    const id = productSourceIdFor(input.actor.tenantId, { artifactId: input.command.artifactId, locator: input.command.source.locator, observedAt: input.command.source.observedAt });
    const version = procurementVersions.productSource(id);
    const receipt = await this.executeKernel(input, { id, objectType: "product_source", sourceRefs: [`postgres:public.seed_procurement_evidence_artifacts/${input.command.artifactId}@${input.command.artifactVersion}`] }, async (transaction) => {
      if (input.command.projectRef) await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectRef.projectId, input.command.projectRef.projectVersion);
      const artifact = await this.requireArtifact(transaction.client, input.actor.tenantId, input.command.artifactId, input.command.artifactVersion);
      const projectId = input.command.projectRef?.projectId ?? null;
      requireSameProjectScope(artifact.project_id, projectId, "Product Source evidence");
      if (String(artifact.content_digest) !== input.command.source.contentDigest) throw new SeedProcurementDomainError("SOURCE_REFERENCE_CONFLICT", "Product Source digest does not match the immutable Evidence Artifact.", 409);
      this.requireIngestionArtifact(input.command, artifact);
      const upstreamArtifacts = [] as Row[];
      for (const ref of input.command.upstreamArtifactRefs) {
        const upstream = await this.requireArtifact(transaction.client, input.actor.tenantId, ref.artifactId, ref.artifactVersion);
        requireSameProjectScope(upstream.project_id, projectId, "Product Source upstream evidence");
        upstreamArtifacts.push(upstream);
      }
      if (input.command.source.kind === "PDF" && upstreamArtifacts.length > 0 && !upstreamArtifacts.some((upstream) => String(json<EvidenceArtifactRegisterCommand["artifact"]>(upstream.canonical_payload).mimeType) === "text/html")) throw new SeedProcurementDomainError("URL_PDF_PROVENANCE_INVALID", "A URL-resolved PDF must retain an exact text/html upstream Evidence Artifact.", 409);
      const duplicate = input.command.duplicateOfSourceId ? await this.requireProductSourceRow(transaction.client, input.actor.tenantId, input.command.duplicateOfSourceId, null) : null;
      if (duplicate) requireSameProjectScope(duplicate.project_id, projectId, "Duplicate Product Source");
      await advisory(transaction.client, input.actor.tenantId, `product-source:${id}`);
      const status = String(artifact.status) !== "ACTIVE" || upstreamArtifacts.some((upstream) => String(upstream.status) !== "ACTIVE") || duplicate ? "REVIEW_REQUIRED" : input.command.conflictRefs.length ? "CONFLICT" : input.command.source.validUntil && Date.parse(input.command.source.validUntil) <= Date.parse(input.requestedAt) ? "REVIEW_REQUIRED" : "ACTIVE";
      const payload = { ...input.command.source, sourceArtifactRef: input.command.artifactId };
      await transaction.client.query(`insert into public.seed_product_sources (tenant_id,product_source_id,project_id,artifact_id,source_kind,ingestion_format,status,content_digest,duplicate_of_source_id,extraction_provenance,conflict_refs,upstream_artifact_refs,canonical_payload,object_version,created_command_id,created_by,created_by_type,observed_at,valid_until,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20)`, [input.actor.tenantId, id, input.command.projectRef?.projectId ?? null, input.command.artifactId, input.command.source.kind, input.command.ingestionFormat, status, input.command.source.contentDigest, input.command.duplicateOfSourceId, JSON.stringify(input.command.extractionProvenance), JSON.stringify(input.command.conflictRefs), JSON.stringify(input.command.upstreamArtifactRefs), JSON.stringify(payload), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.command.source.observedAt, input.command.source.validUntil, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("PRODUCT_SOURCE", transaction.client);
      return { evidenceRefs: [input.command.artifactId, ...input.command.upstreamArtifactRefs.map((ref) => ref.artifactId), ...input.command.extractionProvenance], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readProductSource(input.actor, id), (readback) => readback.resource.resource.version);
  }

  async executeProductCandidate(input: { actor: ApiActor; command: ProductCandidateRecordCommand; correlationId: string; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    const id = productCandidateIdFor(input.actor.tenantId, { productIdentityRef: input.command.productIdentityRef, productSourceId: input.command.productSourceId });
    const version = procurementVersions.productCandidate(id);
    const receipt = await this.executeKernel(input, { id, objectType: "product_candidate", sourceRefs: [`postgres:public.seed_product_sources/${input.command.productSourceId}@${input.command.productSourceVersion}`] }, async (transaction) => {
      if (input.command.projectRef) await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectRef.projectId, input.command.projectRef.projectVersion);
      const projectId = input.command.projectRef?.projectId ?? null;
      const source = await this.requireProductSourceRow(transaction.client, input.actor.tenantId, input.command.productSourceId, input.command.productSourceVersion);
      requireSameProjectScope(source.project_id, projectId, "Product Candidate source");
      const duplicate = input.command.duplicateOfCandidateId ? await this.requireCandidateRow(transaction.client, input.actor.tenantId, input.command.duplicateOfCandidateId) : null;
      if (duplicate) requireSameProjectScope(duplicate.project_id, projectId, "Duplicate Product Candidate");
      const unresolved = [...input.command.conflictRefs];
      if (String(source.status) !== "ACTIVE") unresolved.push(`unresolved:product-source-status:${String(source.status)}`);
      const supplier = input.command.candidate.vendorId ? await requireEligibleSupplier(transaction.client, { accountId: input.command.candidate.vendorId, capability: "CATALOG_SOURCE", observedAt: input.requestedAt, tenantId: input.actor.tenantId }) : null;
      const status = duplicate || unresolved.length || input.command.candidate.confidence.score < 0.8 ? "REVIEW_REQUIRED" : "ELIGIBLE";
      const score = objectiveScore(input.command.fit);
      await advisory(transaction.client, input.actor.tenantId, `product-candidate:${id}`);
      const payload = { ...input.command.candidate, productSourceId: input.command.productSourceId };
      await transaction.client.query(`insert into public.seed_product_candidates (tenant_id,product_candidate_id,project_id,product_source_id,product_identity_ref,lane,status,duplicate_of_candidate_id,conflict_refs,extraction_provenance,fit_inputs,fit_weights,objective_fit_score,supplier_profile_id,supplier_profile_version,canonical_payload,object_version,created_command_id,created_by,created_by_type,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21)`, [input.actor.tenantId, id, input.command.projectRef?.projectId ?? null, input.command.productSourceId, input.command.productIdentityRef, input.command.candidate.lane, status, input.command.duplicateOfCandidateId, JSON.stringify(unresolved), JSON.stringify(input.command.extractionProvenance), JSON.stringify(input.command.fit.inputs), JSON.stringify(input.command.fit.weights), score, supplier?.resource.id ?? null, supplier?.resource.version ?? null, JSON.stringify(payload), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("PRODUCT_CANDIDATE", transaction.client);
      return { evidenceRefs: [input.command.productSourceId, ...input.command.extractionProvenance, ...(supplier ? [`supplier-profile:${supplier.resource.id}@${supplier.resource.version}`] : [])], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readProductCandidate(input.actor, id), (readback) => readback.resource.resource.version);
  }

  async executeRfq(input: { actor: ApiActor; command: RFQDraftCreateCommand; correlationId: string; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    const lineVersions = Object.fromEntries(input.command.specificationLines.map((line) => [line.specificationLineId, line.specificationLineVersion]));
    const id = rfqIdFor(input.actor.tenantId, { lineVersions, specificationId: input.command.specificationId, specificationVersion: input.command.specificationVersion, supplierId: input.command.supplierId });
    const version = procurementVersions.rfq(id);
    const receipt = await this.executeKernel(input, { id, objectType: "rfq", sourceRefs: [input.command.projectId, input.command.specificationId, ...Object.keys(lineVersions), input.command.supplierId] }, async (transaction) => {
      await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectId, input.command.projectVersion);
      await this.requireSpecification(transaction.client, input.actor.tenantId, input.command.projectId, input.command.specificationId, input.command.specificationVersion);
      for (const line of input.command.specificationLines) await this.requireSpecificationLine(transaction.client, input.actor.tenantId, input.command.projectId, input.command.specificationId, line.specificationLineId, line.specificationLineVersion);
      const supplier = await requireEligibleSupplier(transaction.client, { accountId: input.command.supplierId, capability: "RFQ_RESPONSE", observedAt: input.requestedAt, tenantId: input.actor.tenantId });
      if (Date.parse(input.command.dueAt) <= Date.parse(input.requestedAt)) throw new SeedProcurementDomainError("RFQ_DUE_AT_INVALID", "RFQ dueAt must be later than the server-derived request time.", 409);
      await advisory(transaction.client, input.actor.tenantId, `rfq:${id}`);
      const data: RFQV1["data"] = { dueAt: input.command.dueAt, projectId: input.command.projectId, requestedFields: input.command.requestedFields, specificationId: input.command.specificationId, specificationLineIds: input.command.specificationLines.map((line) => line.specificationLineId), supplierId: input.command.supplierId };
      await transaction.client.query(`insert into public.seed_rfq_drafts (tenant_id,rfq_id,project_id,project_version,specification_id,specification_version,supplier_id,supplier_profile_id,supplier_profile_version,status,specification_line_versions,canonical_payload,command_payload,command_payload_hash,object_version,created_command_id,created_by,created_by_type,due_at,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)`, [input.actor.tenantId, id, input.command.projectId, input.command.projectVersion, input.command.specificationId, input.command.specificationVersion, input.command.supplierId, supplier.resource.id, supplier.resource.version, JSON.stringify(lineVersions), JSON.stringify(data), JSON.stringify(input.command), canonicalSeedProcurementPayloadHash(input.command), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.command.dueAt, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("RFQ", transaction.client);
      return { evidenceRefs: [...input.command.evidenceRefs, `supplier-profile:${supplier.resource.id}@${supplier.resource.version}`], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readRfq(input.actor, id));
  }

  async executeSupplierQuote(input: { actor: ApiActor; command: SupplierQuoteNormalizeCommand; correlationId: string; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    const id = supplierQuoteIdFor(input.actor.tenantId, { evidenceArtifactId: input.command.evidenceArtifactId, rfqId: input.command.rfqId, supplierId: input.command.supplierId });
    const version = procurementVersions.supplierQuote(id);
    const receipt = await this.executeKernel(input, { id, objectType: "supplier_quote", sourceRefs: [input.command.rfqId, input.command.evidenceArtifactId, input.command.supplierId] }, async (transaction) => {
      await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectId, input.command.projectVersion);
      const rfq = await this.requireRfqRow(transaction.client, input.actor.tenantId, input.command.rfqId, input.command.rfqVersion);
      if (String(rfq.project_id) !== input.command.projectId || String(rfq.supplier_id) !== input.command.supplierId) throw new SeedProcurementDomainError("REFERENCE_MISMATCH", "Supplier Quote must match the exact RFQ Project and supplier.", 409);
      const evidence = await this.requireArtifact(transaction.client, input.actor.tenantId, input.command.evidenceArtifactId, input.command.evidenceArtifactVersion);
      requireSameProjectScope(evidence.project_id, input.command.projectId, "Supplier Quote evidence");
      const supplier = await requireEligibleSupplier(transaction.client, { accountId: input.command.supplierId, capability: "QUOTE_SUBMISSION", observedAt: input.requestedAt, tenantId: input.actor.tenantId });
      const rfqLines = json<Record<string, string>>(rfq.specification_line_versions);
      if (input.command.lines.some((line) => !rfqLines[line.rfqLineId])) throw new SeedProcurementDomainError("REFERENCE_MISMATCH", "Supplier Quote line must bind an exact RFQ line.", 409);
      if (input.command.validUntil && Date.parse(input.command.validUntil) <= Date.parse(input.requestedAt)) throw new SeedProcurementDomainError("QUOTE_VALIDITY_CLOSED", "Supplier Quote validUntil must be later than the request time.", 409);
      const artifact = json<EvidenceArtifactRegisterCommand["artifact"]>(evidence.canonical_payload);
      const sourceMatches = input.command.responseSource === "EMAIL" ? artifact.kind === "EMAIL" : input.command.responseSource === "PORTAL" ? artifact.kind === "PORTAL_FORM" : ["DOCUMENT", "UPLOAD"].includes(artifact.kind);
      if (!sourceMatches) throw new SeedProcurementDomainError("QUOTE_EVIDENCE_KIND_MISMATCH", "Supplier Quote responseSource must match its exact Evidence Artifact kind.", 409);
      const economics = normalizeQuoteEconomics(input.command);
      const status = String(evidence.status) === "ACTIVE" && input.command.reviewReasons.length === 0 ? "NORMALIZED" : "REVIEW_REQUIRED";
      const data: SupplierQuoteV1["data"] = { evidenceArtifactId: input.command.evidenceArtifactId, lines: input.command.lines.map((line) => ({ incoterm: line.incoterm, leadTimeDays: line.leadTimeDays, packageFacts: line.packageFacts, paymentTerms: line.paymentTerms, quantity: line.quantity, rfqLineId: line.rfqLineId, unitPrice: line.unitPrice, warranty: line.warranty })), responseSource: input.command.responseSource, rfqId: input.command.rfqId, supplierId: input.command.supplierId, validUntil: input.command.validUntil };
      await advisory(transaction.client, input.actor.tenantId, `supplier-quote:${id}`);
      await transaction.client.query(`insert into public.seed_supplier_quotes (tenant_id,supplier_quote_id,project_id,rfq_id,rfq_version,evidence_artifact_id,evidence_artifact_version,supplier_id,supplier_profile_id,supplier_profile_version,response_source,status,canonical_payload,economics_payload,objective_fit_inputs,objective_fit_weights,objective_fit_score,basis_currency,supplier_cost_total_minor,landed_total_minor,client_price_total_minor,margin_minor,valid_until,command_payload,command_payload_hash,object_version,created_command_id,created_by,created_by_type,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27,$28,$29,$30)`, [input.actor.tenantId, id, input.command.projectId, input.command.rfqId, input.command.rfqVersion, input.command.evidenceArtifactId, input.command.evidenceArtifactVersion, input.command.supplierId, supplier.resource.id, supplier.resource.version, input.command.responseSource, status, JSON.stringify(data), JSON.stringify(economics), JSON.stringify(input.command.lines.map((line) => line.objectiveFit.inputs)), JSON.stringify(input.command.lines.map((line) => line.objectiveFit.weights)), economics.objectiveFitScore, economics.basisCurrency, economics.supplierCostTotalMinor, economics.landedTotalMinor, economics.clientPriceTotalMinor, economics.marginMinor, input.command.validUntil, JSON.stringify(input.command), canonicalSeedProcurementPayloadHash(input.command), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("SUPPLIER_QUOTE", transaction.client);
      return { evidenceRefs: [input.command.evidenceArtifactId, `supplier-profile:${supplier.resource.id}@${supplier.resource.version}`], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readSupplierQuote(input.actor, id), (readback) => readback.resource.resource.version);
  }

  async executeBidComparison(input: { actor: ApiActor; command: BidComparisonCreateCommand; correlationId: string; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    const id = bidComparisonIdFor(input.actor.tenantId, { projectId: input.command.projectId, specificationId: input.command.specificationId, specificationVersion: input.command.specificationVersion, supplierQuoteIds: input.command.supplierQuotes.map((quote) => quote.supplierQuoteId) });
    const version = procurementVersions.bidComparison(id);
    const receipt = await this.executeKernel(input, { id, objectType: "bid_comparison", sourceRefs: [...input.command.rfqs.map((rfq) => rfq.rfqId), ...input.command.supplierQuotes.map((quote) => quote.supplierQuoteId)] }, async (transaction) => {
      await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectId, input.command.projectVersion);
      await this.requireSpecification(transaction.client, input.actor.tenantId, input.command.projectId, input.command.specificationId, input.command.specificationVersion);
      const rfqs = [] as Row[];
      for (const ref of input.command.rfqs) {
        const rfq = await this.requireRfqRow(transaction.client, input.actor.tenantId, ref.rfqId, ref.rfqVersion);
        if (String(rfq.project_id) !== input.command.projectId || String(rfq.specification_id) !== input.command.specificationId || String(rfq.specification_version) !== input.command.specificationVersion) throw new SeedProcurementDomainError("REFERENCE_MISMATCH", "Bid Comparison RFQs must share the exact Project and Specification.", 409);
        rfqs.push(rfq);
      }
      const quotes = [] as Row[];
      const supplierRefs = new Map<string, SeedSourceRefV1>();
      for (const ref of input.command.supplierQuotes) {
        const quote = await this.requireQuoteRow(transaction.client, input.actor.tenantId, ref.supplierQuoteId, ref.supplierQuoteVersion);
        if (String(quote.project_id) !== input.command.projectId || !input.command.rfqs.some((rfq) => rfq.rfqId === String(quote.rfq_id))) throw new SeedProcurementDomainError("REFERENCE_MISMATCH", "Bid Comparison Supplier Quotes must belong to its exact RFQ set.", 409);
        const supplier = await requireEligibleSupplier(transaction.client, { accountId: String(quote.supplier_id), capability: "QUOTE_SUBMISSION", observedAt: input.requestedAt, tenantId: input.actor.tenantId });
        supplierRefs.set(supplier.resource.id, sourceRef(input.actor.tenantId, { objectId: supplier.resource.id, objectType: "SUPPLIER_PROFILE", ownerProject: SUPPLIER_PROFILE_OWNER, version: supplier.resource.version }));
        if (String(quote.basis_currency) !== input.command.basisCurrency) throw new SeedProcurementDomainError("CURRENCY_MISMATCH", "Bid Comparison quotes must share the requested basis currency.", 409);
        quotes.push(quote);
      }
      const rows = quotes.map((quote) => ({ landedTotalMinor: Number(quote.landed_total_minor), marginMinor: Number(quote.margin_minor), score: Number(quote.objective_fit_score), supplierQuoteId: String(quote.supplier_quote_id) }));
      const status = quotes.some((quote) => String(quote.status) !== "NORMALIZED") || input.command.criticDissent !== null ? "REVIEW_REQUIRED" : "DRAFT";
      const data: BidComparisonV1["data"] = { basisCurrency: input.command.basisCurrency, recommendationEvidenceRefs: input.command.recommendationEvidenceRefs, recommendedSupplierQuoteId: input.command.recommendedSupplierQuoteId, rfqIds: input.command.rfqs.map((rfq) => rfq.rfqId), rows, selectedByHumanApprovalRef: null, supplierQuoteIds: input.command.supplierQuotes.map((quote) => quote.supplierQuoteId) };
      const sourceRefs = [sourceRef(input.actor.tenantId, { objectId: input.command.specificationId, objectType: "SPECIFICATION", ownerProject: "LUZIONE_PROJECT", version: input.command.specificationVersion }), ...input.command.rfqs.map((rfq) => sourceRef(input.actor.tenantId, { objectId: rfq.rfqId, objectType: "RFQ", ownerProject: SEED_PROCUREMENT_OWNER, version: rfq.rfqVersion })), ...input.command.supplierQuotes.map((quote) => sourceRef(input.actor.tenantId, { objectId: quote.supplierQuoteId, objectType: "SUPPLIER_QUOTE", ownerProject: SEED_PROCUREMENT_OWNER, version: quote.supplierQuoteVersion })), ...supplierRefs.values()];
      await advisory(transaction.client, input.actor.tenantId, `bid-comparison:${id}`);
      await transaction.client.query(`insert into public.seed_bid_comparisons (tenant_id,bid_comparison_id,version,project_id,project_version,specification_id,specification_version,status,basis_currency,rfq_ids,supplier_quote_ids,supplier_profile_refs,source_refs,selected_by_human_approval_ref,recommendation_payload,canonical_payload,command_payload,command_payload_hash,object_version,created_command_id,created_by,created_by_type,created_at) values ($1,$2,1,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,null,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21)`, [input.actor.tenantId, id, input.command.projectId, input.command.projectVersion, input.command.specificationId, input.command.specificationVersion, status, input.command.basisCurrency, JSON.stringify(data.rfqIds), JSON.stringify(data.supplierQuoteIds), JSON.stringify([...supplierRefs.values()]), JSON.stringify(sourceRefs), JSON.stringify({ criticDissent: input.command.criticDissent }), JSON.stringify(data), JSON.stringify(input.command), canonicalSeedProcurementPayloadHash(input.command), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("BID_COMPARISON", transaction.client);
      return { evidenceRefs: [...input.command.recommendationEvidenceRefs, ...[...supplierRefs.values()].map((ref) => `${ref.objectId}@${ref.version}`)], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readBidComparison(input.actor, id));
  }

  async executeSelection(input: { actor: ApiActor; command: ProcurementSelectionRecordCommand; correlationId: string; human?: HumanApprovalSubject; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    const human = input.human;
    if (!human || human.tenantId !== input.actor.tenantId || !human.capabilities.includes("procurement.selection.record")) throw new SeedProcurementDomainError("HUMAN_APPROVAL_REQUIRED", "Procurement selection requires a signed same-tenant human with procurement.selection.record.", 403);
    const id = selectionDecisionIdFor(input.actor.tenantId, { actorId: human.actorId, bidComparisonId: input.command.bidComparisonId, selectedSupplierQuoteId: input.command.selectedSupplierQuoteId });
    const version = procurementVersions.selectionDecision(id);
    const approvedBidVersion = procurementVersions.bidComparison(input.command.bidComparisonId, 2);
    const humanActor: ApiActor = { actorId: human.actorId, actorType: "user", capabilities: human.capabilities, source: input.actor.source, tenantId: human.tenantId };
    const receipt = await this.executeKernel(input, { id, objectType: "procurement_selection", sourceRefs: [input.command.bidComparisonId, input.command.selectedSupplierQuoteId, `human:${human.authenticationRef}`] }, async (transaction) => {
      await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectId, input.command.projectVersion);
      await advisory(transaction.client, input.actor.tenantId, `selection:${input.command.bidComparisonId}`);
      const bid = await this.requireBidRow(transaction.client, input.actor.tenantId, input.command.bidComparisonId, input.command.expectedVersion);
      if (String(bid.project_id) !== input.command.projectId || !json<string[]>(bid.supplier_quote_ids).includes(input.command.selectedSupplierQuoteId)) throw new SeedProcurementDomainError("REFERENCE_MISMATCH", "Procurement Selection must choose a quote from the exact Bid Comparison.", 409);
      const quote = await this.requireQuoteRow(transaction.client, input.actor.tenantId, input.command.selectedSupplierQuoteId, null);
      const supplier = await requireEligibleSupplier(transaction.client, { accountId: String(quote.supplier_id), capability: "QUOTE_SUBMISSION", observedAt: input.requestedAt, tenantId: input.actor.tenantId });
      const existing = await transaction.client.query("select selection_decision_id from public.seed_procurement_selection_decisions where tenant_id=$1 and bid_comparison_id=$2 limit 1", [input.actor.tenantId, input.command.bidComparisonId]);
      if (existing.rows[0]) throw new SeedProcurementDomainError("PROCUREMENT_SELECTION_EXISTS", "Bid Comparison already has an immutable human selection.", 409);
      await transaction.client.query(`insert into public.seed_procurement_selection_decisions (tenant_id,selection_decision_id,project_id,bid_comparison_id,bid_comparison_version,expected_bid_comparison_version,selected_supplier_quote_id,supplier_profile_id,supplier_profile_version,evidence_refs,rationale,decision,status,command_payload,command_payload_hash,object_version,created_command_id,created_by,created_by_type,human_authentication_ref,decided_at) values ($1,$2,$3,$4,1,$5,$6,$7,$8,$9::jsonb,$10,'SELECT','ACTIVE',$11::jsonb,$12,$13,$14,$15,'user',$16,$17)`, [input.actor.tenantId, id, input.command.projectId, input.command.bidComparisonId, input.command.expectedVersion, input.command.selectedSupplierQuoteId, supplier.resource.id, supplier.resource.version, JSON.stringify(input.command.evidenceRefs), input.command.rationale, JSON.stringify(input.command), canonicalSeedProcurementPayloadHash(input.command), version, input.command.commandId, human.actorId, human.authenticationRef, input.requestedAt]);
      const approvalPayload = {
        bidComparisonId: input.command.bidComparisonId,
        commandType: "bid_comparison.approve_from_selection",
        selectionDecisionId: id,
        selectedSupplierQuoteId: input.command.selectedSupplierQuoteId,
      };
      const approvalRequest = createLifecycleCommandRequest({
        actor: { actorId: human.actorId, actorType: "user", roles: [] },
        causationId: input.command.commandId,
        commandId: `${input.command.commandId}:bid-approval`,
        commandType: "bid_comparison.approve_from_selection",
        correlationId: input.correlationId,
        expectedObjectVersion: input.command.expectedVersion,
        idempotencyKey: `${input.command.idempotencyKey}:bid-approval`,
        payload: approvalPayload,
        policyVersion: SEED_PROCUREMENT_POLICY_VERSION,
        requestedAt: input.requestedAt,
        stepId: null,
        target: { objectId: input.command.bidComparisonId, objectType: "bid_comparison", objectVersion: input.command.expectedVersion, ownerProject: SEED_PROCUREMENT_OWNER, sourceRefs: [id, input.command.selectedSupplierQuoteId] },
        tenantId: input.actor.tenantId,
        workflowId: null,
      });
      const approvalEvent = createUniversalEventEnvelope({
        actor: approvalRequest.actor,
        authorityClass: "COMMAND_EVIDENCE",
        causationId: approvalRequest.causationId,
        commandId: approvalRequest.commandId,
        correlationId: approvalRequest.correlationId,
        eventId: `evt_${sha256({ commandId: approvalRequest.commandId, tenantId: approvalRequest.tenantId }).slice(0, 40)}`,
        eventType: "lifecycle.command.accepted",
        eventVersion: 1,
        evidenceRefs: [`human:${human.authenticationRef}`, `procurement-selection:${id}@${version}`],
        idempotencyKey: approvalRequest.idempotencyKey,
        occurredAt: approvalRequest.requestedAt,
        payload: { commandType: approvalRequest.commandType, expectedObjectVersion: approvalRequest.expectedObjectVersion, objectVersion: approvedBidVersion, payloadHash: approvalRequest.payloadHash, policyVersion: approvalRequest.policyVersion },
        producerProject: "LUZIONE_P110",
        recordedAt: approvalRequest.requestedAt,
        subject: { ...approvalRequest.target, objectVersion: approvedBidVersion },
        tenantId: approvalRequest.tenantId,
      });
      const approvalWrite: AcceptedCommandWrite = {
        event: approvalEvent,
        objectVersion: approvedBidVersion,
        outboxMessageId: `outbox_${sha256({ commandId: approvalRequest.commandId, tenantId: approvalRequest.tenantId }).slice(0, 40)}`,
        receipt: {
          commandId: approvalRequest.commandId,
          correlationId: approvalRequest.correlationId,
          eventId: approvalEvent.eventId,
          idempotentReplay: false,
          idempotencyKey: approvalRequest.idempotencyKey,
          objectVersion: approvedBidVersion,
          outboxMessageId: `outbox_${sha256({ commandId: approvalRequest.commandId, tenantId: approvalRequest.tenantId }).slice(0, 40)}`,
          payloadHash: approvalRequest.payloadHash,
          receiptId: `receipt_${sha256({ commandId: approvalRequest.commandId, tenantId: approvalRequest.tenantId }).slice(0, 40)}`,
          state: "DOMAIN_COMMITTED",
          tenantId: approvalRequest.tenantId,
        },
      };
      await this.commandStore.insertAccepted(transaction, approvalWrite, approvalRequest);
      const approvedData: BidComparisonV1["data"] = { ...json<BidComparisonV1["data"]>(bid.canonical_payload), selectedByHumanApprovalRef: id };
      const approvedSourceRefs = [...json<SeedSourceRefV1[]>(bid.source_refs), sourceRef(input.actor.tenantId, { objectId: id, objectType: "PROCUREMENT_SELECTION", ownerProject: SEED_PROCUREMENT_OWNER, version })];
      await transaction.client.query(`insert into public.seed_bid_comparisons (tenant_id,bid_comparison_id,version,project_id,project_version,specification_id,specification_version,status,basis_currency,rfq_ids,supplier_quote_ids,supplier_profile_refs,source_refs,selected_by_human_approval_ref,recommendation_payload,canonical_payload,command_payload,command_payload_hash,object_version,created_command_id,created_by,created_by_type,created_at) values ($1,$2,2,$3,$4,$5,$6,'APPROVED',$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,$19,'user',$20)`, [input.actor.tenantId, input.command.bidComparisonId, input.command.projectId, input.command.projectVersion, String(bid.specification_id), String(bid.specification_version), String(bid.basis_currency), JSON.stringify(json<string[]>(bid.rfq_ids)), JSON.stringify(json<string[]>(bid.supplier_quote_ids)), JSON.stringify(json<SeedSourceRefV1[]>(bid.supplier_profile_refs)), JSON.stringify(approvedSourceRefs), id, JSON.stringify(json(bid.recommendation_payload)), JSON.stringify(approvedData), JSON.stringify(approvalPayload), approvalRequest.payloadHash, approvedBidVersion, approvalRequest.commandId, human.actorId, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("SELECTION", transaction.client);
      return { evidenceRefs: [...input.command.evidenceRefs, `human:${human.authenticationRef}`, `supplier-profile:${supplier.resource.id}@${supplier.resource.version}`], objectVersion: version };
    }, humanActor);
    return this.confirmReadback(receipt, await this.readSelection(input.actor, id), (readback) => readback.resource.version);
  }

  async executePurchaseOrder(input: { actor: ApiActor; command: PurchaseOrderDraftCreateCommand; correlationId: string; requestedAt: string }) {
    this.requireTransportActor(input.actor);
    this.requireCanonicalInstant(input.requestedAt, "requestedAt");
    const id = purchaseOrderIdFor(input.actor.tenantId, { bidComparisonId: input.command.bidComparisonId, selectionDecisionId: input.command.selectionDecisionId });
    const receipt = await this.executeKernel(input, { id, objectType: "purchase_order", sourceRefs: [input.command.bidComparisonId, input.command.selectionDecisionId, input.command.proposalVersionId, ...input.command.lineRefs.map((ref) => ref.objectId)] }, async (transaction) => {
      const proposalOwner = await transaction.client.query("select to_regclass('public.commercial_case_proposal_v1_identity_map') is not null available");
      if (!proposalOwner.rows[0].available) throw new SeedProcurementDomainError("PROPOSAL_CANONICAL_READER_UNAVAILABLE", "PO preparation is blocked because the A2P API-owned tenant/project/version-matched ProposalVersion reader is not installed.", 409);
      await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectId, input.command.projectVersion);
      await advisory(transaction.client, input.actor.tenantId, `purchase-order:${input.command.bidComparisonId}`);
      const bid = await this.requireApprovedBidRow(transaction.client, input.actor.tenantId, input.command.bidComparisonId, input.command.expectedVersion);
      const selection = await this.requireSelectionRow(transaction.client, input.actor.tenantId, input.command.selectionDecisionId, input.command.selectionDecisionVersion);
      if (String(bid.project_id) !== input.command.projectId || String(selection.project_id) !== input.command.projectId
        || String(bid.selected_by_human_approval_ref) !== input.command.selectionDecisionId
        || String(selection.bid_comparison_id) !== input.command.bidComparisonId) {
        throw new SeedProcurementDomainError("REFERENCE_MISMATCH", "PO draft must bind the exact Project, approved Bid Comparison, and immutable human selection.", 409);
      }
      const quoteId = String(selection.selected_supplier_quote_id);
      const quote = await this.requireQuoteRow(transaction.client, input.actor.tenantId, quoteId, null);
      if (String(quote.project_id) !== input.command.projectId || !json<string[]>(bid.supplier_quote_ids).includes(quoteId)) throw new SeedProcurementDomainError("REFERENCE_MISMATCH", "PO draft selected Supplier Quote is outside its approved Bid Comparison.", 409);
      const supplier = await requireEligibleSupplier(transaction.client, { accountId: String(quote.supplier_id), capability: "QUOTE_SUBMISSION", observedAt: input.requestedAt, tenantId: input.actor.tenantId });
      let proposal;
      try {
        proposal = await requireAcceptedCanonicalProposalVersion(transaction.client, { projectId: input.command.projectId, projectVersion: input.command.projectVersion, proposalId: input.command.proposalVersionId, proposalVersion: input.command.proposalVersion, tenantId: input.actor.tenantId });
      } catch (error) {
        if (error instanceof CanonicalProposalDomainError) throw new SeedProcurementDomainError(error.code, error.message, error.status);
        throw error;
      }
      if (proposal.currency !== String(quote.basis_currency)) throw new SeedProcurementDomainError("CURRENCY_MISMATCH", "Accepted Proposal and selected Supplier Quote currencies must match.", 409);
      const quoteLineIds = new Set(json<SupplierQuoteV1["data"]>(quote.canonical_payload).lines.map((line) => line.rfqLineId));
      for (const ref of input.command.lineRefs) {
        const line = await transaction.client.query("select version from public.seed_specification_lines where tenant_id=$1 and project_id=$2 and specification_line_id=$3 limit 1", [input.actor.tenantId, input.command.projectId, ref.objectId]);
        if (!line.rows[0] || specificationLineVersion(ref.objectId, Number(line.rows[0].version)) !== ref.version || !quoteLineIds.has(ref.objectId)) throw new SeedProcurementDomainError("VERSION_CONFLICT", "PO line is stale, outside the selected quote, or outside the Project.", 409);
        const proposalLine = await transaction.client.query("select 1 from public.commercial_case_proposal_line_versions where tenant_id=$1 and proposal_id=$2 and proposal_revision=$3 and specification_line_ref->>'objectId'=$4 and specification_line_ref->>'version'=$5 limit 1", [input.actor.tenantId, input.command.proposalVersionId, proposal.revision, ref.objectId, ref.version]);
        if (!proposalLine.rows[0]) throw new SeedProcurementDomainError("REFERENCE_MISMATCH", "PO line is not included in the exact accepted Proposal Version.", 409);
      }
      const version = procurementVersions.purchaseOrder(id);
      const lineRefs = input.command.lineRefs.map((ref) => sourceRef(input.actor.tenantId, ref));
      const data: PurchaseOrderV1["data"] = { bidComparisonId: input.command.bidComparisonId, currency: String(quote.basis_currency), lineRefs, proposalVersionId: input.command.proposalVersionId, releaseApprovalRef: null, supplierId: String(quote.supplier_id), supplierQuoteId: quoteId, totalMinor: Number(quote.supplier_cost_total_minor) };
      const sourceRefs = [
        sourceRef(input.actor.tenantId, { objectId: input.command.bidComparisonId, objectType: "BID_COMPARISON", ownerProject: SEED_PROCUREMENT_OWNER, version: input.command.expectedVersion }),
        sourceRef(input.actor.tenantId, { objectId: input.command.selectionDecisionId, objectType: "PROCUREMENT_SELECTION", ownerProject: SEED_PROCUREMENT_OWNER, version: input.command.selectionDecisionVersion }),
        sourceRef(input.actor.tenantId, { objectId: quoteId, objectType: "SUPPLIER_QUOTE", ownerProject: SEED_PROCUREMENT_OWNER, version: String(quote.object_version) }),
        sourceRef(input.actor.tenantId, { objectId: input.command.proposalVersionId, objectType: "PROPOSAL_VERSION", ownerProject: "LUZIONE_COMMERCIAL_CASE_PROPOSAL", version: input.command.proposalVersion }),
        sourceRef(input.actor.tenantId, { objectId: proposal.decisionId, objectType: "APPROVAL_DECISION", ownerProject: "LUZIONE_COMMERCIAL_CASE_PROPOSAL", version: `approval-decision:${proposal.decisionId}:v1` }),
        sourceRef(input.actor.tenantId, { objectId: supplier.resource.id, objectType: "SUPPLIER_PROFILE", ownerProject: SUPPLIER_PROFILE_OWNER, version: supplier.resource.version }),
        ...lineRefs,
      ];
      await transaction.client.query(`insert into public.seed_purchase_order_drafts (tenant_id,purchase_order_id,project_id,project_version,bid_comparison_id,bid_comparison_version,selection_decision_id,selection_decision_version,supplier_quote_id,supplier_quote_version,supplier_id,proposal_version_id,proposal_version,proposal_decision_id,status,currency,total_minor,line_refs,source_refs,canonical_payload,command_payload,command_payload_hash,release_approval_ref,external_effect_authorized,object_version,created_command_id,created_by,created_by_type,created_at) values ($1,$2,$3,$4,$5,2,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT',$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,null,false,$21,$22,$23,$24,$25)`, [input.actor.tenantId, id, input.command.projectId, input.command.projectVersion, input.command.bidComparisonId, input.command.selectionDecisionId, input.command.selectionDecisionVersion, quoteId, String(quote.object_version), String(quote.supplier_id), input.command.proposalVersionId, input.command.proposalVersion, proposal.decisionId, data.currency, data.totalMinor, JSON.stringify(lineRefs), JSON.stringify(sourceRefs), JSON.stringify(data), JSON.stringify(input.command), canonicalSeedProcurementPayloadHash(input.command), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("PURCHASE_ORDER", transaction.client);
      return { evidenceRefs: [proposal.decisionId, input.command.selectionDecisionId, quoteId, ...input.command.lineRefs.map((ref) => ref.objectId)], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readPurchaseOrder(input.actor, id), (readback) => readback.resource.version);
  }

  private executeKernel(
    input: { actor: ApiActor; command: SeedProcurementCommand; correlationId: string; requestedAt: string },
    target: { id: string; objectType: string; sourceRefs: string[] },
    mutation: (transaction: CommandTransaction) => Promise<{ evidenceRefs?: string[]; objectVersion: string }>,
    authorityActor: ApiActor = input.actor,
  ) {
    const request = createLifecycleCommandRequest({ actor: { actorId: authorityActor.actorId, actorType: authorityActor.actorType, roles: [] }, causationId: null, commandId: input.command.commandId, commandType: input.command.commandType, correlationId: input.correlationId, expectedObjectVersion: input.command.expectedVersion, idempotencyKey: input.command.idempotencyKey, payload: input.command, policyVersion: SEED_PROCUREMENT_POLICY_VERSION, requestedAt: input.requestedAt, stepId: null, target: { objectId: target.id, objectType: target.objectType, objectVersion: input.command.expectedVersion, ownerProject: SEED_PROCUREMENT_OWNER, sourceRefs: target.sourceRefs }, tenantId: input.actor.tenantId, workflowId: null });
    return this.kernel.execute(request, mutation);
  }

  private requireTransportActor(actor: ApiActor) {
    if (actor.actorType !== "service" || !actor.capabilities.includes("procurement.command")) throw new SeedProcurementDomainError("PROCUREMENT_TRANSPORT_AUTHORITY_REQUIRED", "Procurement commands require a credential-derived service transport with procurement.command.", 403);
  }

  private requireCanonicalInstant(value: string, label: string) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw new SeedProcurementDomainError("INVALID_TIMESTAMP", `${label} must be a real canonical RFC3339 UTC instant.`, 400);
  }

  private requireIngestionArtifact(command: ProductSourceRecordCommand, artifactRow: Row) {
    const artifact = json<EvidenceArtifactRegisterCommand["artifact"]>(artifactRow.canonical_payload);
    const mime = artifact.mimeType.toLowerCase();
    const accepted = command.ingestionFormat === "CSV" ? mime === "text/csv"
      : command.ingestionFormat === "XLSX" ? ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(mime)
        : command.ingestionFormat === "PDF" ? mime === "application/pdf"
          : command.ingestionFormat === "URL" ? mime === "text/html"
            : command.ingestionFormat === "SHOPIFY" ? artifact.provider === "SHOPIFY"
              : command.ingestionFormat === "ROOM_PLANNER" ? artifact.provider === "ROOM_PLANNER"
                : ["DOCUMENT", "PORTAL_FORM", "UPLOAD"].includes(artifact.kind);
    if (!accepted) throw new SeedProcurementDomainError("INGESTION_ARTIFACT_MISMATCH", "Product Source ingestion format does not match its exact Evidence Artifact.", 409);
  }

  private async requireProject(client: PoolClient, tenantId: string, projectId: string, expectedVersion: string) {
    const result = await client.query("select version from public.seed_projects where tenant_id=$1 and project_id=$2 limit 1", [tenantId, projectId]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("PROJECT_NOT_FOUND", "Canonical Project not found for this tenant.", 404);
    if (projectVersion(projectId, Number(result.rows[0].version)) !== expectedVersion) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical Project version is stale.", 409);
  }
  private async requireArtifact(client: PoolClient, tenantId: string, id: string, version: string) {
    const result = await client.query("select artifact_id,object_version,content_digest,project_id,status,canonical_payload from public.seed_procurement_evidence_artifacts where tenant_id=$1 and artifact_id=$2 limit 1", [tenantId, id]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("EVIDENCE_NOT_FOUND", "Evidence Artifact not found for this tenant.", 404);
    if (String(result.rows[0].object_version) !== version) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Evidence Artifact version is stale.", 409);
    return result.rows[0] as Row;
  }
  private async requireProductSourceRow(client: PoolClient, tenantId: string, id: string, version: string | null) {
    const result = await client.query("select product_source_id,object_version,project_id,status from public.seed_product_sources where tenant_id=$1 and product_source_id=$2 limit 1", [tenantId, id]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("PRODUCT_SOURCE_NOT_FOUND", "Product Source not found for this tenant.", 404);
    if (version && String(result.rows[0].object_version) !== version) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Product Source version is stale.", 409);
    return result.rows[0] as Row;
  }
  private async requireCandidateRow(client: PoolClient, tenantId: string, id: string) {
    const result = await client.query("select product_candidate_id,project_id from public.seed_product_candidates where tenant_id=$1 and product_candidate_id=$2 limit 1", [tenantId, id]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("PRODUCT_CANDIDATE_NOT_FOUND", "Duplicate Product Candidate reference is not tenant-visible.", 404);
    return result.rows[0] as Row;
  }
  private async requireRfqRow(client: PoolClient, tenantId: string, id: string, version: string) {
    const result = await client.query("select * from public.seed_rfq_drafts where tenant_id=$1 and rfq_id=$2 limit 1", [tenantId, id]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("RFQ_NOT_FOUND", "Canonical RFQ draft not found for this tenant.", 404);
    if (String(result.rows[0].object_version) !== version) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical RFQ version is stale.", 409);
    return result.rows[0] as Row;
  }
  private async requireQuoteRow(client: PoolClient, tenantId: string, id: string, version: string | null) {
    const result = await client.query("select * from public.seed_supplier_quotes where tenant_id=$1 and supplier_quote_id=$2 limit 1", [tenantId, id]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("SUPPLIER_QUOTE_NOT_FOUND", "Canonical Supplier Quote not found for this tenant.", 404);
    if (version && String(result.rows[0].object_version) !== version) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical Supplier Quote version is stale.", 409);
    return result.rows[0] as Row;
  }
  private async requireBidRow(client: PoolClient, tenantId: string, id: string, version: string) {
    const result = await client.query("select * from public.seed_bid_comparisons where tenant_id=$1 and bid_comparison_id=$2 and version=1 limit 1", [tenantId, id]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("BID_COMPARISON_NOT_FOUND", "Canonical Bid Comparison v1 not found for this tenant.", 404);
    if (String(result.rows[0].object_version) !== version) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical Bid Comparison version is stale.", 409);
    return result.rows[0] as Row;
  }
  private async requireApprovedBidRow(client: PoolClient, tenantId: string, id: string, version: string) {
    const result = await client.query("select * from public.seed_bid_comparisons where tenant_id=$1 and bid_comparison_id=$2 and version=2 limit 1", [tenantId, id]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("BID_COMPARISON_NOT_APPROVED", "Canonical approved Bid Comparison v2 not found for this tenant.", 404);
    if (String(result.rows[0].object_version) !== version || result.rows[0].status !== "APPROVED") throw new SeedProcurementDomainError("VERSION_CONFLICT", "Approved Bid Comparison version is stale.", 409);
    return result.rows[0] as Row;
  }
  private async requireSelectionRow(client: PoolClient, tenantId: string, id: string, version: string) {
    const result = await client.query("select * from public.seed_procurement_selection_decisions where tenant_id=$1 and selection_decision_id=$2 limit 1", [tenantId, id]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("PROCUREMENT_SELECTION_NOT_FOUND", "Canonical procurement selection was not found for this tenant.", 404);
    if (String(result.rows[0].object_version) !== version || result.rows[0].status !== "ACTIVE") throw new SeedProcurementDomainError("VERSION_CONFLICT", "Procurement selection version is stale.", 409);
    return result.rows[0] as Row;
  }
  private async requireSpecification(client: PoolClient, tenantId: string, projectId: string, specificationId: string, expectedVersion: string) {
    const result = await client.query("select version from public.seed_specifications where tenant_id=$1 and project_id=$2 and specification_id=$3 limit 1", [tenantId, projectId, specificationId]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("SPECIFICATION_NOT_FOUND", "Canonical Specification not found.", 404);
    if (specificationVersion(specificationId, Number(result.rows[0].version)) !== expectedVersion) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical Specification version is stale.", 409);
  }
  private async requireSpecificationLine(client: PoolClient, tenantId: string, projectId: string, specificationId: string, lineId: string, expectedVersion: string) {
    const result = await client.query("select version from public.seed_specification_lines where tenant_id=$1 and project_id=$2 and specification_id=$3 and specification_line_id=$4 limit 1", [tenantId, projectId, specificationId, lineId]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("SPECIFICATION_LINE_NOT_FOUND", "Canonical Specification Line not found.", 404);
    if (specificationLineVersion(lineId, Number(result.rows[0].version)) !== expectedVersion) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical Specification Line version is stale.", 409);
  }
  private confirmReadback<T>(receipt: Awaited<ReturnType<LifecycleCommandKernel<CommandTransaction>["execute"]>>, readback: T | null, versionOf: (readback: T) => string = (value) => (value as { resource: { version: string } }).resource.version) {
    const readbackMatchesReceipt = readback === null ? false : versionOf(readback) === receipt.objectVersion;
    if (!readback || !readbackMatchesReceipt) throw new SeedProcurementDomainError("READBACK_UNCONFIRMED", "Owner commit readback could not be confirmed; reconcile the durable receipt before retrying.", 503, { committedObjectVersion: receipt.objectVersion, receiptId: receipt.receiptId, retry: "RECONCILE_FIRST" });
    return { readback, readbackMatchesReceipt, receipt };
  }
  private async readTransaction<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await bindRead(client, tenantId); const result = await operation(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}

function timelineFromRow(row: Row, projectId: string, projectVersionRef: string): TimelineEventV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.event_id);
  const version = `timeline-event:${id}:v1`;
  const subject = sourceRef(tenantId, { objectId: String(row.subject_object_id), objectType: String(row.subject_object_type).toUpperCase(), ownerProject: String(row.subject_owner_project), version: String(row.subject_object_version) });
  const project = sourceRef(tenantId, { objectId: projectId, objectType: "PROJECT", ownerProject: "LUZIONE_PROJECT", version: projectVersionRef });
  return parseTimelineEventV1({ ...boundaries(row, version, String(row.command_type)), contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent, createdAt: iso(row.recorded_at), data: { actorId: String(row.actor_id), aggregateRefs: [project, subject], eventType: String(row.command_type).toUpperCase().replaceAll(".", "_"), evidenceRefs: json<string[]>(row.evidence_refs), occurredAt: iso(row.occurred_at), recordedAt: iso(row.recorded_at), summary: `Accepted ${String(row.command_type)} with durable owner commit ${String(row.committed_object_version)}.`, visibility: "INTERNAL" }, resource: { archivedAt: null, id, status: "ACTIVE", type: "TIMELINE_EVENT", version }, sourceRefs: [subject], tenantId, updatedAt: iso(row.recorded_at) });
}

export { IdempotencyConflictError };
