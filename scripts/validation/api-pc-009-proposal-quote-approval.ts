import assert from "node:assert/strict";
import { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, parseProposalReviewCommand, parseQuoteApprovalCommand, parseQuoteCreateCommand } from "@/modules/proposal-quote-approval/contracts";
import { IdempotencyConflictError, ProposalQuoteApprovalDomainError, ProposalQuoteApprovalStore } from "@/modules/proposal-quote-approval/store";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const actor: ApiActor = { actorId: "user:api-pc-009-proof", actorType: "user", capabilities: ["quote.command", "quote.read", "quote.approval.command", "quote.approval.read", "quote.margin_approval.role.admin", "proposal.review.command", "proposal.review.read", "proposal.approval.role.admin"], source: "service-token", tenantId: "api-pc-009-a" };
const noRole: ApiActor = { ...actor, capabilities: actor.capabilities.filter((capability) => !capability.endsWith("role.admin")) };
const serviceActor: ApiActor = { ...actor, actorId: "service:proof", actorType: "service" };

async function main() {
  const pool = new Pool({ connectionString });
  const store = new ProposalQuoteApprovalStore(pool);
  try {
    await pool.query(`insert into public.commercial_case_identities (case_id, tenant_id, origin_type, origin_id, created_by, status) values ('case-pc009','api-pc-009-a','proof','origin-pc009','proof','active')`);
    await pool.query(`insert into public.commercial_cases (tenant_id, case_id, title, stage, status, created_by, updated_by, version) values ('api-pc-009-a','case-pc009','PC009 proof','proposal_review','active','proof','proof',1)`);
    await pool.query(`insert into public.commercial_policy_configurations (tenant_id, policy_key, version, status, configuration) values
      ('api-pc-009-a','quote_margin_approval',7,'active','{"automaticApprovalComparison":"strictly_greater_than","automaticApprovalThresholdPercent":33,"requiredApproverRole":"Admin"}'),
      ('api-pc-009-a','proposal_document_approval',4,'active','{"requiredRoles":["Admin"],"typedConfirmation":"I approve","exactVersionRequired":true}')`);
    await pool.query(`insert into public.commercial_case_proposal_context_versions (proposal_context_version_id,tenant_id,case_id,idempotency_key,payload_hash,author_id,author_type,expected_version,resulting_version,source_recommendation_version_id,source_supplier_inquiry_version_id,context_hash,proposal_id,economics_authority,economics,generator_type) values ('context-pc009','api-pc-009-a','case-pc009','context-idem','hash','proof','user','v1','v1','recommendation-1','inquiry-1','context-hash','proposal-1','LZ11A_PROPOSAL_ECONOMICS_REFERENCE','{}','deterministic_provider_free')`);
    await pool.query(`insert into public.commercial_case_proposal_document_versions (proposal_document_version_id,tenant_id,case_id,idempotency_key,payload_hash,author_id,author_type,expected_version,resulting_version,source_proposal_context_version_id,artifact_hash,artifact,completeness_gate,template,rendering_boundary,generator_type,google_generation_state) values ('document-pc009','api-pc-009-a','case-pc009','document-idem','hash','proof','user','v1','v1','context-pc009','artifact-hash-pc009','{}','{}','{}','canonical_postgres_artifact_google_rendering_only','deterministic_provider_free','readback_verified')`);

    const create = parseQuoteCreateCommand({ commandId: "command-quote-pc009", commandType: "quote.create", contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, expectedObjectVersion: "ABSENT", idempotencyKey: "idempotency-quote-pc009", quoteId: "quote-pc009", quote: { commercialCaseId: "case-pc009", currency: "USD", customerId: null, customerName: "Proof Customer", lines: [{ description: "Proof line", lineNumber: 1, quantity: 2, sku: "SKU-1", unitCostCents: 3750, unitPriceCents: 5000 }] } });
    const created = await store.executeQuoteCreate({ actor, command: create, correlationId: "correlation-quote-pc009", requestedAt: "2026-08-31T06:00:00.000Z" });
    assert.equal(created.readback.quote.subtotalCents, 10000);
    assert.equal(created.readback.quote.fullyLandedCostCents, 7500);
    assert.equal(created.readback.quote.grossMarginPercent, 25);
    assert.equal(created.readback.quote.approvalRequired, true);
    const replay = await store.executeQuoteCreate({ actor, command: create, correlationId: "correlation-quote-replay", requestedAt: "2026-08-31T06:01:00.000Z" });
    assert.equal(replay.receipt.idempotentReplay, true);
    await assert.rejects(() => store.executeQuoteCreate({ actor, command: parseQuoteCreateCommand({ ...create, quote: { ...create.quote, customerName: "Changed" } }), correlationId: "correlation-conflict", requestedAt: "2026-08-31T06:02:00.000Z" }), (error: unknown) => error instanceof IdempotencyConflictError);

    const decide = parseQuoteApprovalCommand({ commandId: "command-quote-approval-pc009", commandType: "quote.margin_approval.decide", contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, decision: "approved", expectedEconomicsVersionId: created.readback.quote.quoteEconomicsVersionId, expectedObjectVersion: created.readback.objectVersion, idempotencyKey: "idempotency-quote-approval-pc009", quoteId: "quote-pc009", rationale: "Human margin exception proof." });
    await assert.rejects(() => store.executeQuoteApproval({ actor: serviceActor, command: decide, correlationId: "service-denied", requestedAt: "2026-08-31T06:03:00.000Z" }), (error: unknown) => error instanceof ProposalQuoteApprovalDomainError && error.code === "HUMAN_APPROVAL_REQUIRED");
    await assert.rejects(() => store.executeQuoteApproval({ actor: noRole, command: decide, correlationId: "role-denied", requestedAt: "2026-08-31T06:03:00.000Z" }), (error: unknown) => error instanceof ProposalQuoteApprovalDomainError && error.code === "APPROVAL_AUTHORITY_DENIED");
    const approved = await store.executeQuoteApproval({ actor, command: decide, correlationId: "correlation-approval", requestedAt: "2026-08-31T06:04:00.000Z" });
    assert.equal(approved.readback.quote.status, "approved");
    assert.equal(approved.readback.quote.approval?.decision, "approved");

    const reviewShape = { commandId: "command-review-pc009", commandType: "proposal.review.decide", contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, caseId: "case-pc009", decision: "approved", expectedObjectVersion: "commercial-case:case-pc009:v1", expectedProposalDocumentVersionId: "document-pc009", findings: [], idempotencyKey: "idempotency-review-pc009", reviewerNotes: "Exact proposal approved.", typedConfirmation: "wrong" };
    await assert.rejects(() => store.executeProposalReview({ actor, command: parseProposalReviewCommand(reviewShape), correlationId: "typed-denied", requestedAt: "2026-08-31T06:05:00.000Z" }), (error: unknown) => error instanceof ProposalQuoteApprovalDomainError && error.code === "TYPED_CONFIRMATION_REQUIRED");
    const reviewed = await store.executeProposalReview({ actor, command: parseProposalReviewCommand({ ...reviewShape, typedConfirmation: "I approve" }), correlationId: "correlation-review", requestedAt: "2026-08-31T06:06:00.000Z" });
    assert.equal(reviewed.readback.proposalReview.approvalAuthorityState, "verified");
    assert.equal(reviewed.readback.proposalReview.proposalDocumentVersionId, "document-pc009");

    await pool.query(`alter table public.p110_command_receipts add constraint api_pc_009_force_rollback check (command_id <> 'command-rollback-pc009')`);
    try {
      const rollback = parseQuoteCreateCommand({ ...create, commandId: "command-rollback-pc009", idempotencyKey: "idempotency-rollback-pc009", quoteId: "quote-rollback-pc009" });
      await assert.rejects(() => store.executeQuoteCreate({ actor, command: rollback, correlationId: "correlation-rollback", requestedAt: "2026-08-31T06:07:00.000Z" }));
    } finally { await pool.query(`alter table public.p110_command_receipts drop constraint api_pc_009_force_rollback`); }
    assert.equal((await pool.query(`select count(*)::int as count from public.quotes where external_quote_id='quote-rollback-pc009'`)).rows[0].count, 0);
    const tenantB: ApiActor = { ...actor, tenantId: "api-pc-009-b" };
    assert.equal(await store.readQuote(tenantB, "quote-pc009"), null);
    assert.equal(await store.readProposalReview(tenantB, "case-pc009"), null);

    const evidence = (await pool.query(`select
      (select count(*)::int from public.quotes where tenant_id=$1) quotes,
      (select count(*)::int from public.quote_economics_versions where tenant_id=$1) economics,
      (select count(*)::int from public.quote_margin_approval_records where tenant_id=$1) approvals,
      (select count(*)::int from public.commercial_case_proposal_review_versions where tenant_id=$1) proposal_reviews,
      (select count(*)::int from public.p110_command_receipts where tenant_id=$1) receipts,
      (select count(*)::int from public.p110_event_envelopes where tenant_id=$1) events,
      (select count(*)::int from public.p110_outbox_messages where tenant_id=$1) outbox,
      (select count(*)::int from public.p110_idempotency_conflicts where tenant_id=$1) conflicts`, [actor.tenantId])).rows[0];
    assert.deepEqual(evidence, { approvals: 1, conflicts: 1, economics: 1, events: 3, outbox: 3, proposal_reviews: 1, quotes: 1, receipts: 3 });
    process.stdout.write(`${JSON.stringify({ contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, evidence, result: "PASS" })}\n`);
  } finally { await pool.end(); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
