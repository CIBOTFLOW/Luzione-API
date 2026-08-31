import "server-only";

import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { createLifecycleCommandRequest, IdempotencyConflictError, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import {
  PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION,
  PROPOSAL_REVIEW_OBJECT_OWNER,
  QUOTE_OBJECT_OWNER,
  type ProposalReviewCommand,
  type QuoteApprovalCommand,
  type QuoteCreateCommand,
} from "@/modules/proposal-quote-approval/contracts";

const POLICY_VERSION = "2026-08-31.api-pc-009.dark-path.v1";

export class ProposalQuoteApprovalDomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "ProposalQuoteApprovalDomainError";
  }
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error("Canonical row has an invalid timestamp.");
  return new Date(parsed).toISOString();
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function roleCapability(prefix: "proposal.approval" | "quote.margin_approval", role: string) {
  const normalized = role.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${prefix}.role.${normalized}`;
}

function requireHuman(actor: ApiActor) {
  if (actor.actorType !== "user") throw new ProposalQuoteApprovalDomainError("HUMAN_APPROVAL_REQUIRED", "Approval decisions require a server-derived human user actor.", 403);
}

function quoteVersion(row: Record<string, unknown>) {
  return `quote:${String(row.external_quote_id)}:e${Number(row.economics_version)}:s${String(row.status)}`;
}

function quoteReadback(row: Record<string, unknown>) {
  const lines = Array.isArray(row.lines) ? row.lines : [];
  return {
    contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION,
    objectVersion: quoteVersion(row),
    quote: {
      approval: row.approval_id ? {
        approvalId: String(row.approval_id),
        approverRole: String(row.approver_role),
        approverUserId: String(row.approver_user_id),
        decision: String(row.approval_decision),
        rationale: String(row.rationale ?? ""),
      } : null,
      approvalRequired: Boolean(row.approval_required),
      commercialCaseId: String(row.commercial_case_id),
      createdAt: iso(row.created_at),
      currency: String(row.currency),
      economicsInputChecksum: String(row.input_checksum),
      economicsVersion: Number(row.economics_version),
      fullyLandedCostCents: Number(row.fully_landed_cost_cents),
      grossMarginPercent: Number(row.gross_margin_percent),
      lines,
      marginCents: Number(row.margin_cents),
      quoteEconomicsVersionId: String(row.quote_economics_version_id),
      quoteId: String(row.external_quote_id),
      status: String(row.status),
      subtotalCents: Number(row.subtotal_cents),
      updatedAt: iso(row.updated_at),
    },
    sourceOfTruth: "quotes+quote_economics_versions",
    transferState: "UI_LEGACY_WRITER_API_DARK_PATH",
  } as const;
}

function proposalReviewReadback(row: Record<string, unknown>) {
  return {
    contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION,
    objectVersion: `proposal-review:${String(row.proposal_review_version_id)}`,
    proposalReview: {
      approvalAuthorityState: String(row.approval_authority_state),
      approvalPolicyVersion: row.approval_policy_version === null ? null : Number(row.approval_policy_version),
      caseId: String(row.case_id),
      createdAt: iso(row.created_at),
      decision: String(row.decision),
      exactVersionCurrent: Boolean(row.exact_version_current),
      findings: Array.isArray(row.findings) ? row.findings : [],
      proposalDocumentVersionId: String(row.source_proposal_document_version_id),
      proposalReviewVersionId: String(row.proposal_review_version_id),
      reviewedArtifactHash: String(row.reviewed_artifact_hash),
      reviewerId: String(row.reviewer_id),
      reviewerNotes: String(row.reviewer_notes),
      reviewerRole: row.reviewer_role_snapshot ? String(row.reviewer_role_snapshot) : null,
    },
    prohibitedEffects: ["customer_send", "binding_acceptance", "order", "payment", "production", "delivery", "support"],
    sourceOfTruth: "commercial_case_proposal_review_versions",
    transferState: "UI_LEGACY_WRITER_API_DARK_PATH",
  } as const;
}

async function tenantRead<T>(pool: Pool, tenantId: string, callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class ProposalQuoteApprovalStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(private readonly pool: Pool = databasePool()) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
  }

  async readQuote(actor: ApiActor, quoteId: string) {
    const result = await tenantRead(this.pool, actor.tenantId, (client) => client.query(
      `select q.*, e.quote_economics_version_id, e.input_checksum, e.gross_margin_percent,
              e.approval_required, e.required_approver_role,
              a.approval_id, a.decision as approval_decision, a.approver_role,
              a.approver_user_id, a.rationale,
              coalesce((select jsonb_agg(jsonb_build_object(
                'lineNumber', l.line_number, 'sku', l.sku, 'description', l.description,
                'quantity', l.quantity::int, 'unitPriceCents', l.unit_price_cents,
                'unitCostCents', l.unit_cost_cents, 'marginCents', l.margin_cents
              ) order by l.line_number) from public.quote_lines l where l.quote_id = q.id), '[]'::jsonb) as lines
         from public.quotes q
         join public.quote_economics_versions e on e.tenant_id = q.tenant_id and e.quote_id = q.id and e.version = q.economics_version
         left join public.quote_margin_approval_records a on a.tenant_id = q.tenant_id and a.quote_economics_version_id = e.quote_economics_version_id
        where q.tenant_id = $1 and q.external_quote_id = $2 limit 1`,
      [actor.tenantId, quoteId],
    ));
    return result.rows[0] ? quoteReadback(result.rows[0] as Record<string, unknown>) : null;
  }

  async readProposalReview(actor: ApiActor, caseId: string, reviewId?: string) {
    const result = await tenantRead(this.pool, actor.tenantId, (client) => client.query(
      `select * from public.commercial_case_proposal_review_versions
        where tenant_id = $1 and case_id = $2 and ($3::text is null or proposal_review_version_id = $3)
        order by created_at desc limit 1`,
      [actor.tenantId, caseId, reviewId ?? null],
    ));
    return result.rows[0] ? proposalReviewReadback(result.rows[0] as Record<string, unknown>) : null;
  }

  async executeQuoteCreate(input: { actor: ApiActor; command: QuoteCreateCommand; correlationId: string; requestedAt: string }) {
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] }, causationId: null,
      commandId: input.command.commandId, commandType: input.command.commandType, correlationId: input.correlationId,
      expectedObjectVersion: input.command.expectedObjectVersion, idempotencyKey: input.command.idempotencyKey,
      payload: input.command, policyVersion: POLICY_VERSION, requestedAt: input.requestedAt, stepId: null,
      target: { objectId: input.command.quoteId, objectType: "quote", objectVersion: "ABSENT", ownerProject: QUOTE_OBJECT_OWNER, sourceRefs: ["postgres:public.quotes", "postgres:public.quote_economics_versions"] },
      tenantId: input.actor.tenantId, workflowId: null,
    });
    const receipt = await this.kernel.execute(request, (transaction) => this.createQuote(transaction, input));
    const readback = await this.readQuote(input.actor, input.command.quoteId);
    if (!readback || (!receipt.idempotentReplay && readback.objectVersion !== receipt.objectVersion)) throw new ProposalQuoteApprovalDomainError("READBACK_UNCONFIRMED", "Quote commit readback was not confirmed; reconcile the durable receipt before retrying.", 503);
    return { readback, receipt };
  }

  private async createQuote(transaction: CommandTransaction, input: { actor: ApiActor; command: QuoteCreateCommand; requestedAt: string }) {
    const caseResult = await transaction.client.query(`select case_id from public.commercial_case_identities where tenant_id = $1 and case_id = $2 for share`, [input.actor.tenantId, input.command.quote.commercialCaseId]);
    if (!caseResult.rows[0]) throw new ProposalQuoteApprovalDomainError("CASE_NOT_FOUND", "Commercial Case not found.", 404);
    const policyResult = await transaction.client.query(`select version, configuration from public.commercial_policy_configurations where tenant_id = $1 and policy_key = 'quote_margin_approval' and status = 'active' for share`, [input.actor.tenantId]);
    const policyRow = policyResult.rows[0] as Record<string, unknown> | undefined;
    const config = policyRow?.configuration as Record<string, unknown> | undefined;
    const threshold = Number(config?.automaticApprovalThresholdPercent);
    const requiredRole = typeof config?.requiredApproverRole === "string" ? config.requiredApproverRole.trim() : "";
    if (!policyRow || !Number.isFinite(threshold) || config?.automaticApprovalComparison !== "strictly_greater_than" || !requiredRole) throw new ProposalQuoteApprovalDomainError("POLICY_NOT_CONFIGURED", "Quote margin policy is not safely configured.", 503);
    const subtotal = input.command.quote.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
    const cost = input.command.quote.lines.reduce((sum, line) => sum + line.quantity * line.unitCostCents, 0);
    const margin = subtotal - cost;
    const grossMarginPercent = subtotal === 0 ? 0 : Number(((margin / subtotal) * 100).toFixed(4));
    const approvalRequired = !(grossMarginPercent > threshold);
    const snapshot = { contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, currency: input.command.quote.currency, lines: input.command.quote.lines, policy: { automaticApprovalComparison: "strictly_greater_than", automaticApprovalThresholdPercent: threshold, requiredApproverRole: requiredRole, version: Number(policyRow.version) }, totals: { fullyLandedCostCents: cost, grossMarginPercent, marginCents: margin, subtotalCents: subtotal } };
    const checksum = digest(snapshot);
    const quoteResult = await transaction.client.query(
      `insert into public.quotes (external_quote_id, tenant_id, commercial_case_id, customer_id, customer_name, status, currency, subtotal_cents, margin_cents, margin_percent, fully_landed_cost_cents, economics_version, source_system, source_record_id, created_by_type, created_by_id, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,'luzione_api',$12,$13,$14,$15,$15) on conflict (external_quote_id) do nothing returning *`,
      [input.command.quoteId, input.actor.tenantId, input.command.quote.commercialCaseId, input.command.quote.customerId, input.command.quote.customerName, approvalRequired ? "approval_required" : "draft", input.command.quote.currency, subtotal, margin, grossMarginPercent, cost, input.command.commandId, input.actor.actorType, input.actor.actorId, input.requestedAt],
    );
    const quote = quoteResult.rows[0] as Record<string, unknown> | undefined;
    if (!quote) throw new ProposalQuoteApprovalDomainError("QUOTE_EXISTS", "Quote identity already exists.", 409);
    for (const line of input.command.quote.lines) {
      await transaction.client.query(`insert into public.quote_lines (quote_id, line_number, sku, description, quantity, unit_price_cents, unit_cost_cents, margin_cents, source_system, source_record_id, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,'luzione_api',$9,$10,$10)`, [quote.id, line.lineNumber, line.sku, line.description, line.quantity, line.unitPriceCents, line.unitCostCents, line.quantity * (line.unitPriceCents - line.unitCostCents), input.command.commandId, input.requestedAt]);
    }
    const economics = await transaction.client.query(`insert into public.quote_economics_versions (tenant_id, quote_id, version, input_checksum, immutable_snapshot, gross_margin_percent, fully_landed_cost_cents, approval_required, required_approver_role, actor_id, created_at) values ($1,$2,1,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) returning quote_economics_version_id`, [input.actor.tenantId, quote.id, checksum, JSON.stringify(snapshot), grossMarginPercent, cost, approvalRequired, approvalRequired ? requiredRole : null, input.actor.actorId, input.requestedAt]);
    return { evidenceRefs: [`postgres:public.quotes/${input.command.quoteId}`, `postgres:public.quote_economics_versions/${String(economics.rows[0].quote_economics_version_id)}`], objectVersion: quoteVersion(quote) };
  }

  async executeQuoteApproval(input: { actor: ApiActor; command: QuoteApprovalCommand; correlationId: string; requestedAt: string }) {
    requireHuman(input.actor);
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] }, causationId: null, commandId: input.command.commandId,
      commandType: input.command.commandType, correlationId: input.correlationId, expectedObjectVersion: input.command.expectedObjectVersion,
      idempotencyKey: input.command.idempotencyKey, payload: input.command, policyVersion: POLICY_VERSION, requestedAt: input.requestedAt, stepId: null,
      target: { objectId: input.command.quoteId, objectType: "quote", objectVersion: input.command.expectedObjectVersion, ownerProject: QUOTE_OBJECT_OWNER, sourceRefs: ["postgres:public.quotes", "postgres:public.quote_margin_approval_records"] }, tenantId: input.actor.tenantId, workflowId: null,
    });
    const receipt = await this.kernel.execute(request, (transaction) => this.decideQuote(transaction, input));
    const readback = await this.readQuote(input.actor, input.command.quoteId);
    if (!readback || (!receipt.idempotentReplay && readback.objectVersion !== receipt.objectVersion)) throw new ProposalQuoteApprovalDomainError("READBACK_UNCONFIRMED", "Quote approval readback was not confirmed.", 503);
    return { readback, receipt };
  }

  private async decideQuote(transaction: CommandTransaction, input: { actor: ApiActor; command: QuoteApprovalCommand; requestedAt: string }) {
    const result = await transaction.client.query(`select q.*, e.quote_economics_version_id, e.input_checksum, e.gross_margin_percent, e.approval_required, e.required_approver_role, p.version as policy_version from public.quotes q join public.quote_economics_versions e on e.tenant_id=q.tenant_id and e.quote_id=q.id and e.version=q.economics_version join public.commercial_policy_configurations p on p.tenant_id=q.tenant_id and p.policy_key='quote_margin_approval' and p.status='active' where q.tenant_id=$1 and q.external_quote_id=$2 for update of q`, [input.actor.tenantId, input.command.quoteId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new ProposalQuoteApprovalDomainError("QUOTE_NOT_FOUND", "Quote or current economics policy was not found.", 404);
    if (quoteVersion(row) !== input.command.expectedObjectVersion || String(row.quote_economics_version_id) !== input.command.expectedEconomicsVersionId) throw new ProposalQuoteApprovalDomainError("VERSION_CONFLICT", "Quote approval requires the exact current quote and economics version.", 409);
    if (!row.approval_required) throw new ProposalQuoteApprovalDomainError("APPROVAL_NOT_REQUIRED", "This quote does not require margin approval.", 409);
    const requiredRole = String(row.required_approver_role ?? "");
    const capability = roleCapability("quote.margin_approval", requiredRole);
    if (!requiredRole || !input.actor.capabilities.includes(capability)) throw new ProposalQuoteApprovalDomainError("APPROVAL_AUTHORITY_DENIED", `Quote margin decision requires credential capability ${capability}.`, 403);
    const inserted = await transaction.client.query(`insert into public.quote_margin_approval_records (tenant_id, quote_id, quote_economics_version_id, decision, required_role, approver_role, approver_user_id, rationale, idempotency_key, request_digest, approval_policy_version, economics_input_checksum, created_at) values ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12) returning approval_id`, [input.actor.tenantId, row.id, row.quote_economics_version_id, input.command.decision, requiredRole, input.actor.actorId, input.command.rationale, input.command.idempotencyKey, digest(input.command), Number(row.policy_version), String(row.input_checksum), input.requestedAt]).catch((error: unknown) => { if (error instanceof Error && /unique/i.test(error.message)) throw new ProposalQuoteApprovalDomainError("APPROVAL_ALREADY_DECIDED", "This exact economics version already has a decision.", 409); throw error; });
    const updated = await transaction.client.query(`update public.quotes set status=$3, approved_by_id=case when $3='approved' then $4 else approved_by_id end, approved_at=case when $3='approved' then $5::timestamptz else approved_at end, updated_at=$5 where tenant_id=$1 and id=$2 returning *`, [input.actor.tenantId, row.id, input.command.decision, input.actor.actorId, input.requestedAt]);
    return { evidenceRefs: [`postgres:public.quote_margin_approval_records/${String(inserted.rows[0].approval_id)}`], objectVersion: quoteVersion(updated.rows[0] as Record<string, unknown>) };
  }

  async executeProposalReview(input: { actor: ApiActor; command: ProposalReviewCommand; correlationId: string; requestedAt: string }) {
    requireHuman(input.actor);
    const reviewId = `ccrev_${digest({ actorId: input.actor.actorId, ...input.command }).slice(0, 24)}`;
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] }, causationId: null, commandId: input.command.commandId,
      commandType: input.command.commandType, correlationId: input.correlationId, expectedObjectVersion: input.command.expectedObjectVersion,
      idempotencyKey: input.command.idempotencyKey, payload: input.command, policyVersion: POLICY_VERSION, requestedAt: input.requestedAt, stepId: null,
      target: { objectId: reviewId, objectType: "proposal_review", objectVersion: input.command.expectedObjectVersion, ownerProject: PROPOSAL_REVIEW_OBJECT_OWNER, sourceRefs: ["postgres:public.commercial_case_proposal_review_versions"] }, tenantId: input.actor.tenantId, workflowId: null,
    });
    const receipt = await this.kernel.execute(request, (transaction) => this.decideProposal(transaction, input, reviewId));
    const readback = await this.readProposalReview(input.actor, input.command.caseId, reviewId);
    if (!readback) throw new ProposalQuoteApprovalDomainError("READBACK_UNCONFIRMED", "Proposal review readback was not confirmed.", 503);
    return { readback, receipt };
  }

  private async decideProposal(transaction: CommandTransaction, input: { actor: ApiActor; command: ProposalReviewCommand; requestedAt: string }, reviewId: string) {
    const result = await transaction.client.query(`select d.*, c.version as case_version from public.commercial_case_proposal_document_versions d join public.commercial_cases c on c.tenant_id=d.tenant_id and c.case_id=d.case_id where d.tenant_id=$1 and d.case_id=$2 order by d.created_at desc, d.proposal_document_version_id desc limit 1 for share of d`, [input.actor.tenantId, input.command.caseId]);
    const doc = result.rows[0] as Record<string, unknown> | undefined;
    if (!doc) throw new ProposalQuoteApprovalDomainError("PROPOSAL_NOT_FOUND", "Current proposal document was not found.", 404);
    if (`commercial-case:${input.command.caseId}:v${Number(doc.case_version)}` !== input.command.expectedObjectVersion || String(doc.proposal_document_version_id) !== input.command.expectedProposalDocumentVersionId) throw new ProposalQuoteApprovalDomainError("VERSION_CONFLICT", "Proposal review requires the exact current Commercial Case and proposal document versions.", 409);
    let role: string | null = null; let policyVersion: number | null = null; let authorityState = "not_required"; let confirmationDigest: string | null = null;
    if (input.command.decision === "approved") {
      if (String(doc.google_generation_state) !== "readback_verified") throw new ProposalQuoteApprovalDomainError("PROVIDER_READBACK_REQUIRED", "Proposal approval requires verified renderer readback for the exact artifact.", 409);
      const policyResult = await transaction.client.query(`select version, configuration from public.commercial_policy_configurations where tenant_id=$1 and policy_key='proposal_document_approval' and status='active' for share`, [input.actor.tenantId]);
      const policy = policyResult.rows[0] as Record<string, unknown> | undefined; const config = policy?.configuration as Record<string, unknown> | undefined;
      const roles = Array.isArray(config?.requiredRoles) ? config.requiredRoles.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
      const typed = typeof config?.typedConfirmation === "string" ? config.typedConfirmation.trim() : "";
      if (!policy || roles.length === 0 || !typed || config?.exactVersionRequired !== true) throw new ProposalQuoteApprovalDomainError("POLICY_NOT_CONFIGURED", "Proposal approval policy is not safely configured.", 503);
      role = roles.find((candidate) => input.actor.capabilities.includes(roleCapability("proposal.approval", candidate))) ?? null;
      if (!role) throw new ProposalQuoteApprovalDomainError("APPROVAL_AUTHORITY_DENIED", "Proposal approval requires an eligible credential-bound role capability.", 403);
      if ((input.command.typedConfirmation ?? "").trim().toLowerCase() !== typed.toLowerCase()) throw new ProposalQuoteApprovalDomainError("TYPED_CONFIRMATION_REQUIRED", `Type “${typed}” to approve this exact proposal version.`, 403);
      policyVersion = Number(policy.version); authorityState = "verified"; confirmationDigest = digest({ actorId: input.actor.actorId, confirmation: typed.toLowerCase(), proposalDocumentVersionId: doc.proposal_document_version_id, tenantId: input.actor.tenantId });
    }
    const reviewHash = digest({ caseId: input.command.caseId, decision: input.command.decision, findings: input.command.findings, proposalDocumentVersionId: doc.proposal_document_version_id, reviewedArtifactHash: doc.artifact_hash, reviewerNotes: input.command.reviewerNotes, tenantId: input.actor.tenantId });
    await transaction.client.query(`insert into public.commercial_case_proposal_review_versions (proposal_review_version_id, tenant_id, case_id, idempotency_key, payload_hash, reviewer_id, reviewer_type, expected_version, resulting_version, source_proposal_document_version_id, source_proposal_context_version_id, reviewed_artifact_hash, decision, reviewer_notes, findings, review_hash, exact_version_current, superseded_by_document_version_id, ai_approval_authorized, customer_send_authorized, binding_acceptance_authorized, generator_type, prohibited_effects, reviewer_role_snapshot, approval_policy_version, approval_authority_state, typed_confirmation_digest, created_at) values ($1,$2,$3,$4,$5,$6,'user',$7,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,true,null,false,false,false,'human_exact_version_review',$15::jsonb,$16,$17,$18,$19,$20)`, [reviewId, input.actor.tenantId, input.command.caseId, input.command.idempotencyKey, digest(input.command), input.actor.actorId, input.command.expectedObjectVersion, doc.proposal_document_version_id, doc.source_proposal_context_version_id, doc.artifact_hash, input.command.decision, input.command.reviewerNotes, JSON.stringify(input.command.findings), reviewHash, JSON.stringify(["no_ai_approval", "no_customer_send", "no_binding_acceptance"]), role, policyVersion, authorityState, confirmationDigest, input.requestedAt]);
    return { evidenceRefs: [`postgres:public.commercial_case_proposal_review_versions/${reviewId}`, `postgres:public.commercial_case_proposal_document_versions/${String(doc.proposal_document_version_id)}`], objectVersion: `proposal-review:${reviewId}` };
  }
}

export { IdempotencyConflictError, roleCapability };
