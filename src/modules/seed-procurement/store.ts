import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { createLifecycleCommandRequest, IdempotencyConflictError, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import {
  parseEvidenceArtifactV1,
  parseProductCandidateV1,
  parseProductSourceV1,
  parseTimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import {
  SEED_PRODUCT_CONTRACT_VERSIONS,
  type EvidenceArtifactV1,
  type SeedAuthorityBoundaryV1,
  type SeedMutationBoundaryV1,
  type SeedReceiptReadbackV1,
  type SeedSourceRefV1,
  type TimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductContracts";
import {
  SEED_PROCUREMENT_OWNER,
  SEED_PROCUREMENT_POLICY_VERSION,
  type EvidenceArtifactRegisterCommand,
  type ProductCandidateRecordCommand,
  type ProductSourceRecordCommand,
  type SeedProcurementCommand,
} from "@/modules/seed-procurement/contracts";
import {
  evidenceArtifactIdFor,
  objectiveScore,
  productCandidateIdFor,
  productSourceIdFor,
  procurementVersions,
  timelineProjectVersion,
} from "@/modules/seed-procurement/model";
import type { SeedProcurementReadModelData } from "@/modules/seed-procurement/readModel";
import { projectVersion, specificationLineVersion, specificationVersion } from "@/modules/seed-project-publication/model";

type Row = Record<string, unknown>;
type Hooks = { afterOwnerWrites?: (point: "EVIDENCE" | "PRODUCT_CANDIDATE" | "PRODUCT_SOURCE", client: PoolClient) => Promise<void> };

const RECEIPT_COLUMNS = `r.receipt_id, r.idempotency_key, r.payload_hash,
  r.expected_object_version, r.policy_version, r.actor_id, r.actor_type,
  r.correlation_id, r.committed_at`;

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
function iso(value: unknown) { const parsed = Date.parse(String(value)); if (!Number.isFinite(parsed)) throw new Error("Canonical procurement row has an invalid timestamp."); return new Date(parsed).toISOString(); }
function nullableText(value: unknown) { return value === null || value === undefined ? null : String(value); }
function requireSameProjectScope(actual: unknown, expected: string | null, label: string) {
  if (nullableText(actual) !== expected) throw new SeedProcurementDomainError("OBJECT_ISOLATION_DENIED", `${label} must inherit the exact Project scope.`, 404);
}
function actorType(value: unknown): SeedAuthorityBoundaryV1["actorType"] { return value === "user" ? "HUMAN" : value === "agent" ? "SULTAN_AGENT" : "SERVICE"; }
function sourceRef(tenantId: string, input: Omit<SeedSourceRefV1, "tenantId">): SeedSourceRefV1 { return { ...input, tenantId }; }
function boundaries(row: Row, committedVersion: string, capability: string, approvalRef: string | null = null) {
  const mutation: SeedMutationBoundaryV1 = { expectedVersion: String(row.expected_object_version), idempotencyKey: String(row.idempotency_key), payloadHash: String(row.payload_hash) };
  const authority: SeedAuthorityBoundaryV1 = { actorId: String(row.actor_id), actorType: actorType(row.actor_type), approvalRef, capability, decision: "ALLOW", effectClass: "A1", policyVersion: String(row.policy_version), serverDerivedIdentityRef: `correlation:${String(row.correlation_id)}` };
  const receipt: SeedReceiptReadbackV1 = { committedVersion, finality: "DOMAIN_COMMITTED", observedAt: null, observedVersion: null, providerAcknowledgementRef: null, receiptId: String(row.receipt_id), sourceReadbackRef: null };
  return { authority, mutation, receipt };
}

function evidenceFromRow(row: Row): EvidenceArtifactV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.artifact_id);
  const version = String(row.object_version);
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
  const data = json<ProductSourceRecordCommand["source"] & { sourceArtifactRef: string }>(row.canonical_payload);
  const resource = parseProductSourceV1({
    ...boundaries(row, version, "procurement.product_source.record"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.productSource,
    createdAt: iso(row.created_at),
    data,
    resource: { archivedAt: null, id, status: row.status, type: "PRODUCT_SOURCE", version },
    sourceRefs: [sourceRef(tenantId, { objectId: String(row.artifact_id), objectType: "EVIDENCE_ARTIFACT", ownerProject: SEED_PROCUREMENT_OWNER, version: String(row.artifact_version) })],
    tenantId,
    updatedAt: iso(row.created_at),
  });
  return { conflictRefs: json<string[]>(row.conflict_refs), duplicateOfSourceId: row.duplicate_of_source_id === null ? null : String(row.duplicate_of_source_id), extractionProvenance: json<string[]>(row.extraction_provenance), ingestionFormat: String(row.ingestion_format), projectId: nullableText(row.project_id), resource };
}

function candidateFromRow(row: Row) {
  const tenantId = String(row.tenant_id);
  const id = String(row.product_candidate_id);
  const version = String(row.object_version);
  const data = json<ProductCandidateRecordCommand["candidate"] & { productSourceId: string }>(row.canonical_payload);
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
  return { conflictRefs: json<string[]>(row.conflict_refs), duplicateOfCandidateId: row.duplicate_of_candidate_id === null ? null : String(row.duplicate_of_candidate_id), extractionProvenance: json<string[]>(row.extraction_provenance), fit: { inputs: json<ProductCandidateRecordCommand["fit"]["inputs"]>(row.fit_inputs), score: Number(row.objective_fit_score), weights: json<ProductCandidateRecordCommand["fit"]["weights"]>(row.fit_weights) }, projectId: nullableText(row.project_id), resource };
}

async function bindRead(client: PoolClient, tenantId: string) { await client.query("begin read only"); await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]); }
async function advisory(client: PoolClient, tenantId: string, key: string) { await client.query("select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [tenantId, key]); }

export class SeedProcurementStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(private readonly pool: Pool = databasePool(), private readonly hooks: Hooks = {}) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
  }

  async execute(input: { actor: ApiActor; command: SeedProcurementCommand; correlationId: string; requestedAt: string }) {
    switch (input.command.commandType) {
      case "evidence_artifact.register": return this.executeEvidence({ ...input, command: input.command });
      case "product_source.record": return this.executeProductSource({ ...input, command: input.command });
      case "product_candidate.record": return this.executeProductCandidate({ ...input, command: input.command });
      case "rfq.create_draft": return this.rejectRfq(input.actor, input.command);
      case "supplier_quote.normalize": return this.rejectUnverifiedSupplier(input.actor, input.command.supplierId);
      case "bid_comparison.create": throw new SeedProcurementDomainError("SUPPLIER_ELIGIBILITY_UNVERIFIED", "Bid comparison is held until every Supplier Quote binds to an admitted canonical Supplier eligibility record.", 409);
      case "procurement_selection.record": throw new SeedProcurementDomainError("SUPPLIER_ELIGIBILITY_UNVERIFIED", "Procurement selection is held until canonical Supplier eligibility is admitted.", 409);
      case "purchase_order.create_draft": throw new SeedProcurementDomainError("PROPOSAL_CANONICAL_READER_UNAVAILABLE", "PO preparation is blocked because no API-owned tenant/project/version-matched ProposalVersion reader is admitted.", 409);
      case "purchase_order_acknowledgement.record": throw new SeedProcurementDomainError("PURCHASE_ORDER_NOT_AVAILABLE", "PO acknowledgement requires an exact canonical PO draft, which A3 cannot create until ProposalVersion readback is admitted.", 409);
    }
  }

  async readProjectProcurement(actor: ApiActor, projectId: string): Promise<SeedProcurementReadModelData | null> {
    return this.readTransaction(actor.tenantId, async (client) => {
      const project = await client.query("select project_id,version from public.seed_projects where tenant_id = $1 and project_id = $2 limit 1", [actor.tenantId, projectId]);
      if (!project.rows[0]) return null;
      const evidence = await client.query(`select a.*, ${RECEIPT_COLUMNS} from public.seed_procurement_evidence_artifacts a join public.p110_command_receipts r on r.tenant_id=a.tenant_id and r.command_id=a.created_command_id where a.tenant_id=$1 and a.project_id=$2 order by a.captured_at,a.artifact_id`, [actor.tenantId, projectId]);
      const sources = await client.query(`select s.*, ${RECEIPT_COLUMNS}, a.object_version artifact_version from public.seed_product_sources s join public.seed_procurement_evidence_artifacts a on a.tenant_id=s.tenant_id and a.artifact_id=s.artifact_id join public.p110_command_receipts r on r.tenant_id=s.tenant_id and r.command_id=s.created_command_id where s.tenant_id=$1 and s.project_id=$2 order by s.observed_at,s.product_source_id`, [actor.tenantId, projectId]);
      const candidates = await client.query(`select c.*, ${RECEIPT_COLUMNS}, s.object_version product_source_version from public.seed_product_candidates c join public.seed_product_sources s on s.tenant_id=c.tenant_id and s.product_source_id=c.product_source_id join public.p110_command_receipts r on r.tenant_id=c.tenant_id and r.command_id=c.created_command_id where c.tenant_id=$1 and c.project_id=$2 order by c.objective_fit_score desc,c.product_candidate_id`, [actor.tenantId, projectId]);
      const heldRows = await client.query(`select
        (select count(*) from public.seed_rfq_drafts where tenant_id=$1 and project_id=$2) rfqs,
        (select count(*) from public.seed_supplier_quotes where tenant_id=$1 and project_id=$2) quotes,
        (select count(*) from public.seed_bid_comparisons where tenant_id=$1 and project_id=$2) bids,
        (select count(*) from public.seed_procurement_selection_decisions where tenant_id=$1 and project_id=$2) selections,
        (select count(*) from public.seed_purchase_order_drafts where tenant_id=$1 and project_id=$2) pos,
        (select count(*) from public.seed_purchase_order_acknowledgements where tenant_id=$1 and project_id=$2) acks`, [actor.tenantId, projectId]);
      if (Object.values(heldRows.rows[0] as Row).some((value) => Number(value) !== 0)) throw new Error("Dependency-held A3 downstream tables unexpectedly contain canonical rows.");
      const timelineRows = await client.query(`select e.*, r.receipt_id, r.expected_object_version, r.committed_object_version, r.policy_version, r.actor_id, r.actor_type, r.idempotency_key, r.payload_hash, r.command_type
        from public.p110_event_envelopes e join public.p110_command_receipts r on r.tenant_id=e.tenant_id and r.event_id=e.event_id
        where e.tenant_id=$1 and r.command_id in (
          select created_command_id from public.seed_procurement_evidence_artifacts where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_product_sources where tenant_id=$1 and project_id=$2
          union select created_command_id from public.seed_product_candidates where tenant_id=$1 and project_id=$2
        ) order by e.recorded_at,e.event_id`, [actor.tenantId, projectId]);
      return { acknowledgements: [], bidComparisons: [], blockedDependencies: [
        { affectedCapabilities: ["rfq.create_draft", "supplier_quote.normalize", "bid_comparison.create", "procurement_selection.record"], code: "SUPPLIER_ELIGIBILITY_UNVERIFIED", requiredContract: "SupplierProfile/v1", summary: "The existing tenant Account projection proves identity but has no supplier eligibility fact." },
        { affectedCapabilities: ["purchase_order.create_draft", "purchase_order_acknowledgement.record"], code: "PROPOSAL_CANONICAL_READER_UNAVAILABLE", requiredContract: "ProposalVersion/v1 canonical API readback", summary: "The API publishes a ProposalVersion contract but does not yet own a tenant/project/version-matched Proposal runtime reader." },
      ], evidenceArtifacts: evidence.rows.map((row) => ({ projectId: String(row.project_id), resource: evidenceFromRow(row as Row) })), productCandidates: candidates.rows.map((row) => candidateFromRow(row as Row)), productSources: sources.rows.map((row) => sourceFromRow(row as Row)), purchaseOrders: [], rfqs: [], selectionDecisions: [], supplierQuotes: [], timeline: timelineRows.rows.map((row) => timelineFromRow(row as Row, projectId, timelineProjectVersion(projectId, project.rows[0].version))) };
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
      const result = await client.query(`select s.*, ${RECEIPT_COLUMNS}, a.object_version artifact_version from public.seed_product_sources s join public.seed_procurement_evidence_artifacts a on a.tenant_id=s.tenant_id and a.artifact_id=s.artifact_id join public.p110_command_receipts r on r.tenant_id=s.tenant_id and r.command_id=s.created_command_id where s.tenant_id=$1 and s.product_source_id=$2 limit 1`, [actor.tenantId, sourceId]);
      return result.rows[0] ? sourceFromRow(result.rows[0] as Row) : null;
    });
  }

  async readProductCandidate(actor: ApiActor, candidateId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(`select c.*, ${RECEIPT_COLUMNS}, s.object_version product_source_version from public.seed_product_candidates c join public.seed_product_sources s on s.tenant_id=c.tenant_id and s.product_source_id=c.product_source_id join public.p110_command_receipts r on r.tenant_id=c.tenant_id and r.command_id=c.created_command_id where c.tenant_id=$1 and c.product_candidate_id=$2 limit 1`, [actor.tenantId, candidateId]);
      return result.rows[0] ? candidateFromRow(result.rows[0] as Row) : null;
    });
  }

  async executeEvidence(input: { actor: ApiActor; command: EvidenceArtifactRegisterCommand; correlationId: string; requestedAt: string }) {
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
    const id = productSourceIdFor(input.actor.tenantId, { artifactId: input.command.artifactId, locator: input.command.source.locator, observedAt: input.command.source.observedAt });
    const version = procurementVersions.productSource(id);
    const receipt = await this.executeKernel(input, { id, objectType: "product_source", sourceRefs: [`postgres:public.seed_procurement_evidence_artifacts/${input.command.artifactId}@${input.command.artifactVersion}`] }, async (transaction) => {
      if (input.command.projectRef) await this.requireProject(transaction.client, input.actor.tenantId, input.command.projectRef.projectId, input.command.projectRef.projectVersion);
      const artifact = await this.requireArtifact(transaction.client, input.actor.tenantId, input.command.artifactId, input.command.artifactVersion);
      const projectId = input.command.projectRef?.projectId ?? null;
      requireSameProjectScope(artifact.project_id, projectId, "Product Source evidence");
      if (String(artifact.content_digest) !== input.command.source.contentDigest) throw new SeedProcurementDomainError("SOURCE_REFERENCE_CONFLICT", "Product Source digest does not match the immutable Evidence Artifact.", 409);
      const duplicate = input.command.duplicateOfSourceId ? await this.requireProductSourceRow(transaction.client, input.actor.tenantId, input.command.duplicateOfSourceId, null) : null;
      if (duplicate) requireSameProjectScope(duplicate.project_id, projectId, "Duplicate Product Source");
      await advisory(transaction.client, input.actor.tenantId, `product-source:${id}`);
      const status = String(artifact.status) !== "ACTIVE" || duplicate ? "REVIEW_REQUIRED" : input.command.conflictRefs.length ? "CONFLICT" : input.command.source.validUntil && Date.parse(input.command.source.validUntil) <= Date.parse(input.requestedAt) ? "REVIEW_REQUIRED" : "ACTIVE";
      const payload = { ...input.command.source, sourceArtifactRef: input.command.artifactId };
      await transaction.client.query(`insert into public.seed_product_sources (tenant_id,product_source_id,project_id,artifact_id,source_kind,ingestion_format,status,content_digest,duplicate_of_source_id,extraction_provenance,conflict_refs,canonical_payload,object_version,created_command_id,created_by,created_by_type,observed_at,valid_until,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)`, [input.actor.tenantId, id, input.command.projectRef?.projectId ?? null, input.command.artifactId, input.command.source.kind, input.command.ingestionFormat, status, input.command.source.contentDigest, input.command.duplicateOfSourceId, JSON.stringify(input.command.extractionProvenance), JSON.stringify(input.command.conflictRefs), JSON.stringify(payload), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.command.source.observedAt, input.command.source.validUntil, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("PRODUCT_SOURCE", transaction.client);
      return { evidenceRefs: [input.command.artifactId, ...input.command.extractionProvenance], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readProductSource(input.actor, id), (readback) => readback.resource.resource.version);
  }

  async executeProductCandidate(input: { actor: ApiActor; command: ProductCandidateRecordCommand; correlationId: string; requestedAt: string }) {
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
      if (input.command.candidate.vendorId) {
        await this.requireAccountIdentity(transaction.client, input.actor.tenantId, input.command.candidate.vendorId);
        unresolved.push(`unresolved:supplier-eligibility:${input.command.candidate.vendorId}`);
      }
      const status = duplicate || unresolved.length || input.command.candidate.confidence.score < 0.8 ? "REVIEW_REQUIRED" : "ELIGIBLE";
      const score = objectiveScore(input.command.fit);
      await advisory(transaction.client, input.actor.tenantId, `product-candidate:${id}`);
      const payload = { ...input.command.candidate, productSourceId: input.command.productSourceId };
      await transaction.client.query(`insert into public.seed_product_candidates (tenant_id,product_candidate_id,project_id,product_source_id,product_identity_ref,lane,status,duplicate_of_candidate_id,conflict_refs,extraction_provenance,fit_inputs,fit_weights,objective_fit_score,canonical_payload,object_version,created_command_id,created_by,created_by_type,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18,$19)`, [input.actor.tenantId, id, input.command.projectRef?.projectId ?? null, input.command.productSourceId, input.command.productIdentityRef, input.command.candidate.lane, status, input.command.duplicateOfCandidateId, JSON.stringify(unresolved), JSON.stringify(input.command.extractionProvenance), JSON.stringify(input.command.fit.inputs), JSON.stringify(input.command.fit.weights), score, JSON.stringify(payload), version, input.command.commandId, input.actor.actorId, input.actor.actorType, input.requestedAt]);
      await this.hooks.afterOwnerWrites?.("PRODUCT_CANDIDATE", transaction.client);
      return { evidenceRefs: [input.command.productSourceId, ...input.command.extractionProvenance], objectVersion: version };
    });
    return this.confirmReadback(receipt, await this.readProductCandidate(input.actor, id), (readback) => readback.resource.resource.version);
  }

  private executeKernel(
    input: { actor: ApiActor; command: SeedProcurementCommand; correlationId: string; requestedAt: string },
    target: { id: string; objectType: string; sourceRefs: string[] },
    mutation: (transaction: CommandTransaction) => Promise<{ evidenceRefs?: string[]; objectVersion: string }>,
  ) {
    const request = createLifecycleCommandRequest({ actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] }, causationId: null, commandId: input.command.commandId, commandType: input.command.commandType, correlationId: input.correlationId, expectedObjectVersion: input.command.expectedVersion, idempotencyKey: input.command.idempotencyKey, payload: input.command, policyVersion: SEED_PROCUREMENT_POLICY_VERSION, requestedAt: input.requestedAt, stepId: null, target: { objectId: target.id, objectType: target.objectType, objectVersion: input.command.expectedVersion, ownerProject: SEED_PROCUREMENT_OWNER, sourceRefs: target.sourceRefs }, tenantId: input.actor.tenantId, workflowId: null });
    return this.kernel.execute(request, mutation);
  }

  private async rejectUnverifiedSupplier(actor: ApiActor, supplierId: string): Promise<never> {
    const client = await this.pool.connect();
    try {
      await bindRead(client, actor.tenantId);
      await this.requireAccountIdentity(client, actor.tenantId, supplierId);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    throw new SeedProcurementDomainError("SUPPLIER_ELIGIBILITY_UNVERIFIED", "The canonical Account shape proves tenant identity but not Supplier eligibility; RFQ creation remains blocked.", 409);
  }

  private async rejectRfq(actor: ApiActor, command: Extract<SeedProcurementCommand, { commandType: "rfq.create_draft" }>): Promise<never> {
    const client = await this.pool.connect();
    try {
      await bindRead(client, actor.tenantId);
      await this.requireProject(client, actor.tenantId, command.projectId, command.projectVersion);
      await this.requireSpecification(client, actor.tenantId, command.projectId, command.specificationId, command.specificationVersion);
      for (const line of command.specificationLines) {
        const result = await client.query("select version from public.seed_specification_lines where tenant_id=$1 and project_id=$2 and specification_id=$3 and specification_line_id=$4 limit 1", [actor.tenantId, command.projectId, command.specificationId, line.specificationLineId]);
        if (!result.rows[0]) throw new SeedProcurementDomainError("SPECIFICATION_LINE_NOT_FOUND", "Canonical Specification Line not found.", 404);
        if (specificationLineVersion(line.specificationLineId, Number(result.rows[0].version)) !== line.specificationLineVersion) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical Specification Line version is stale.", 409);
      }
      await this.requireAccountIdentity(client, actor.tenantId, command.supplierId);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    throw new SeedProcurementDomainError("SUPPLIER_ELIGIBILITY_UNVERIFIED", "The canonical Account shape proves tenant identity but not Supplier eligibility; RFQ creation remains blocked.", 409);
  }

  private async requireProject(client: PoolClient, tenantId: string, projectId: string, expectedVersion: string) {
    const result = await client.query("select version from public.seed_projects where tenant_id=$1 and project_id=$2 limit 1", [tenantId, projectId]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("PROJECT_NOT_FOUND", "Canonical Project not found for this tenant.", 404);
    if (projectVersion(projectId, Number(result.rows[0].version)) !== expectedVersion) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical Project version is stale.", 409);
  }
  private async requireArtifact(client: PoolClient, tenantId: string, id: string, version: string) {
    const result = await client.query("select artifact_id,object_version,content_digest,project_id,status from public.seed_procurement_evidence_artifacts where tenant_id=$1 and artifact_id=$2 limit 1", [tenantId, id]);
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
  private async requireAccountIdentity(client: PoolClient, tenantId: string, accountId: string) {
    try {
      const result = await client.query("select id::text,status,version from public.accounts where tenant_id=$1 and id::text=$2 limit 1", [tenantId, accountId]);
      if (!result.rows[0]) throw new SeedProcurementDomainError("SUPPLIER_IDENTITY_NOT_FOUND", "Claimed vendor/supplier is not a tenant-visible canonical Account.", 404);
      return result.rows[0] as Row;
    } catch (error) {
      if (error instanceof SeedProcurementDomainError) throw error;
      if (error instanceof Error && /relation .*accounts.* does not exist/i.test(error.message)) throw new SeedProcurementDomainError("SUPPLIER_IDENTITY_SOURCE_UNAVAILABLE", "Canonical Account identity source is unavailable; supplier-bound commands fail closed.", 503);
      throw error;
    }
  }
  private async requireSpecification(client: PoolClient, tenantId: string, projectId: string, specificationId: string, expectedVersion: string) {
    const result = await client.query("select version from public.seed_specifications where tenant_id=$1 and project_id=$2 and specification_id=$3 limit 1", [tenantId, projectId, specificationId]);
    if (!result.rows[0]) throw new SeedProcurementDomainError("SPECIFICATION_NOT_FOUND", "Canonical Specification not found.", 404);
    if (specificationVersion(specificationId, Number(result.rows[0].version)) !== expectedVersion) throw new SeedProcurementDomainError("VERSION_CONFLICT", "Canonical Specification version is stale.", 409);
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
