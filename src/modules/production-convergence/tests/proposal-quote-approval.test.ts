import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION,
  ProposalQuoteApprovalContractError,
  parseProposalReviewCommand,
  parseQuoteApprovalCommand,
  parseQuoteCreateCommand,
} from "@/modules/proposal-quote-approval/contracts";

function quote() {
  return {
    commandId: "command-quote-001",
    commandType: "quote.create",
    contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION,
    expectedObjectVersion: "ABSENT",
    idempotencyKey: "idempotency-quote-001",
    quoteId: "quote-001",
    quote: {
      commercialCaseId: "case-001",
      currency: "USD",
      customerId: "customer-001",
      customerName: "Example Customer",
      lines: [
        { description: "Installation", lineNumber: 2, quantity: 1, sku: null, unitCostCents: 5_000, unitPriceCents: 10_000 },
        { description: "Hardware", lineNumber: 1, quantity: 2, sku: "HW-1", unitCostCents: 3_000, unitPriceCents: 5_000 },
      ],
    },
  };
}

test("quote parser enforces integer cents, canonical currency and deterministic lines", () => {
  const parsed = parseQuoteCreateCommand(quote());
  assert.equal(parsed.quote.currency, "USD");
  assert.deepEqual(parsed.quote.lines.map((line) => line.lineNumber), [1, 2]);
  assert.throws(() => parseQuoteCreateCommand({ ...quote(), quote: { ...quote().quote, currency: "usd" } }), (error: unknown) => error instanceof ProposalQuoteApprovalContractError && error.code === "INVALID_CURRENCY");
  assert.throws(() => parseQuoteCreateCommand({ ...quote(), quote: { ...quote().quote, lines: [{ ...quote().quote.lines[0], unitPriceCents: 10.5 }] } }), (error: unknown) => error instanceof ProposalQuoteApprovalContractError && error.code === "INVALID_MONEY");
  assert.throws(() => parseQuoteCreateCommand({ ...quote(), tenantId: "forged" }), (error: unknown) => error instanceof ProposalQuoteApprovalContractError && error.code === "AUTHORITY_FORGED");
});

test("approval parsers bind exact versions and block approval with open blockers", () => {
  const approval = parseQuoteApprovalCommand({ commandId: "command-approval-001", commandType: "quote.margin_approval.decide", contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, decision: "approved", expectedEconomicsVersionId: "econ-001", expectedObjectVersion: "quote:quote-001:e1:sapproval_required", idempotencyKey: "idempotency-approval-001", quoteId: "quote-001", rationale: "Margin exception accepted." });
  assert.equal(approval.expectedEconomicsVersionId, "econ-001");
  const store = readFileSync("src/modules/proposal-quote-approval/store.ts", "utf8");
  assert.match(store, /replace\(\/\[\^a-z0-9\]\+\/g, "_"\)/);
  assert.throws(() => parseProposalReviewCommand({ commandId: "command-review-001", commandType: "proposal.review.decide", contractVersion: PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, caseId: "case-001", decision: "approved", expectedObjectVersion: "commercial-case:case-001:v1", expectedProposalDocumentVersionId: "proposal-doc-001", findings: [{ evidenceRef: "artifact:1", findingKey: "blocked-1", resolutionAction: "Resolve", severity: "blocker", status: "open", summary: "Blocking issue" }], idempotencyKey: "idempotency-review-001", reviewerNotes: "Review complete", typedConfirmation: "I approve" }), (error: unknown) => error instanceof ProposalQuoteApprovalContractError && error.code === "APPROVAL_BLOCKED");
});

test("API-PC-009 reuses canonical tables and P110 atomic evidence without body authority", () => {
  const migration = readFileSync("supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql", "utf8");
  assert.match(migration, /create table if not exists public\.quotes/);
  assert.match(migration, /create table if not exists public\.quote_economics_versions/);
  assert.match(migration, /create table if not exists public\.commercial_case_proposal_review_versions/);
  assert.match(migration, /currency ~ '\^\[A-Z\]\{3\}\$'/);
  assert.doesNotMatch(migration, /api_quotes|api_proposals|drop table|truncate|delete from/i);
  const store = readFileSync("src/modules/proposal-quote-approval/store.ts", "utf8");
  assert.match(store, /LifecycleCommandKernel/);
  assert.match(store, /PostgresAtomicCommandStore/);
  assert.match(store, /insert into public\.quote_economics_versions/);
  assert.match(store, /insert into public\.quote_margin_approval_records/);
  assert.match(store, /insert into public\.commercial_case_proposal_review_versions/);
  assert.match(store, /actor\.actorType !== "user"/);
  assert.match(store, /actor\.capabilities\.includes\(capability\)/);
});

test("all HTTP mutations are authenticated, capability-bound and tenant-default-off", () => {
  for (const path of ["src/app/api/v1/commands/quotes/route.ts", "src/app/api/v1/commands/quote-approvals/route.ts", "src/app/api/v1/commands/proposal-reviews/route.ts"]) {
    const route = readFileSync(path, "utf8");
    assert.match(route, /requireServiceActor\(request\.headers/);
    assert.match(route, /domainCommandsEnabledForTenant\(actor\.tenantId\)/);
    assert.match(route, /DOMAIN_MUTATIONS_DISABLED/);
    assert.doesNotMatch(route, /tenantId\s*:\s*(body|command)\./);
    assert.doesNotMatch(route, /actorId\s*:\s*(body|command)\./);
  }
});
