import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveSultanRuntimeStatus,
  type SultanRuntimeAggregate,
} from "../../modules/sultan-runtime/runtimeStatus";
import {
  SULTAN_RUNTIME_READBACK_FAILURE_CODES,
  classifySultanRuntimeReadbackError,
} from "../../modules/sultan-runtime/readbackFailure";

function aggregate(overrides: Partial<SultanRuntimeAggregate> = {}): SultanRuntimeAggregate {
  return {
    agentRunCount: 0,
    agreementCount: 0,
    airtableConnectionCount: 0,
    chatMessageCount: 0,
    chatSessionCount: 0,
    completedRunCount: 0,
    completedShopifySyncCount: 0,
    crmAiProposalCount: 0,
    disagreementCount: 0,
    evaluationCount: 0,
    gmailConnectionCount: 0,
    googleDriveConnectionCount: 0,
    latestAgentRunAt: null,
    latestEvaluationAt: null,
    latestModelCallAt: null,
    latestShopifySyncAt: null,
    latestShopifySyncStatus: null,
    lessonMemoryCount: 0,
    lunaCallCount: 0,
    modelCallCount: 0,
    needsReviewMemoryCount: 0,
    openReviewCandidateCount: 0,
    pendingFeedbackCount: 0,
    proposalDocumentCount: 0,
    proposalGateCount: 0,
    proposalReviewCount: 0,
    shopifyProductCount: 0,
    shopifySyncCount: 0,
    solCallCount: 0,
    successfulModelCallCount: 0,
    terraCallCount: 0,
    ...overrides,
  };
}

test("reports unavailable without runtime evidence", () => {
  const result = deriveSultanRuntimeStatus(aggregate(), "2026-08-26T18:00:00.000Z");
  assert.equal(result.overallStatus, "NOT_AVAILABLE");
  assert.equal(result.cognition.status, "NOT_AVAILABLE");
  assert.equal(result.learning.status, "NOT_AVAILABLE");
  assert.equal(result.boundaries.rawConversationContentExposed, false);
  assert.equal(result.boundaries.mutationAuthority, "DISABLED_FAIL_CLOSED");
});

test("separates active learning from partial ledgers and historical routing debt", () => {
  const result = deriveSultanRuntimeStatus(aggregate({
    agentRunCount: 3,
    completedRunCount: 3,
    evaluationCount: 2,
    pendingFeedbackCount: 1,
    agreementCount: 1,
    chatSessionCount: 6,
    chatMessageCount: 41,
    modelCallCount: 17,
    successfulModelCallCount: 12,
    lunaCallCount: 1,
    terraCallCount: 14,
    solCallCount: 2,
  }), "2026-08-26T18:00:00.000Z");
  assert.equal(result.cognition.status, "DEGRADED_PARTIAL_LEDGER");
  assert.equal(result.cognition.evaluationCoverage, 0.6667);
  assert.equal(result.learning.status, "ACTIVE_WITH_PENDING_FEEDBACK");
  assert.equal(result.modelRouting.status, "DEGRADED_FAILURE_RATE");
  assert.deepEqual(result.modelRouting.tiers, { luna: 1, terra: 14, sol: 2 });
});

test("marks connected providers honestly and detects a stale Shopify sync", () => {
  const result = deriveSultanRuntimeStatus(aggregate({
    agentRunCount: 1,
    completedRunCount: 1,
    evaluationCount: 1,
    agreementCount: 1,
    googleDriveConnectionCount: 1,
    gmailConnectionCount: 1,
    airtableConnectionCount: 1,
    shopifyProductCount: 50,
    shopifySyncCount: 22,
    completedShopifySyncCount: 1,
    latestShopifySyncStatus: "running",
    latestShopifySyncAt: "2026-07-12T03:23:12.312Z",
  }), "2026-08-26T18:00:00.000Z");
  assert.equal(result.connectors.googleDocs.status, "CONNECTED");
  assert.equal(result.connectors.googleDocs.generationVerified, false);
  assert.equal(result.connectors.email.sendAuthority, "APPROVAL_REQUIRED");
  assert.equal(result.connectors.airtable.role, "TRANSITIONAL_WORKSPACE_ONLY");
  assert.equal(result.connectors.shopify.status, "DEGRADED_STALE_SYNC");
});

test("public route exposes aggregate evidence only and fails closed", () => {
  const route = readFileSync("src/app/api/v1/sultan/runtime-status/route.ts", "utf8");
  const service = readFileSync("src/lib/sultan-runtime/readService.ts", "utf8");
  assert.match(route, /readSultanRuntimeStatus/);
  assert.match(route, /runtime readback failed closed/i);
  assert.doesNotMatch(route, /DATABASE_URL|LUZIONE_API_SERVICE_TOKEN/);
  assert.doesNotMatch(service, /select\s+content|select\s+object_id|select\s+target_id/i);
});

test("database failures are reduced to bounded operational codes", () => {
  assert.deepEqual(classifySultanRuntimeReadbackError({ code: "42501", message: "sensitive detail" }), {
    failureCode: SULTAN_RUNTIME_READBACK_FAILURE_CODES.permissionDenied,
    providerCode: "42501",
  });
  assert.deepEqual(classifySultanRuntimeReadbackError({ code: "42P01" }), {
    failureCode: SULTAN_RUNTIME_READBACK_FAILURE_CODES.relationMissing,
    providerCode: "42P01",
  });
  assert.equal(
    classifySultanRuntimeReadbackError(new Error("unclassified secret detail")).failureCode,
    SULTAN_RUNTIME_READBACK_FAILURE_CODES.unavailable,
  );
});
