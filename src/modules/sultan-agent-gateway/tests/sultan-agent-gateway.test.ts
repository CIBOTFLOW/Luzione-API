import assert from "node:assert/strict";
import test from "node:test";

import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  LUZIONE_SULTAN_COMMAND_EXECUTION_V1,
  LUZIONE_SULTAN_COMMAND_PREPARATION_V1,
  LUZIONE_SULTAN_EFFECT_RECEIPT_V1,
  LUZIONE_SULTAN_READBACK_V1,
  LUZIONE_SULTAN_TOOL_CALL_V1,
  SultanAgentGatewayError,
  type SultanApprovalAdmission,
  type SultanCommandExecution,
  type SultanCommandPreparation,
  type SultanEffectReceipt,
  type SultanToolCall,
} from "@/modules/sultan-agent-gateway/contracts";
import { GmailRfqCanaryAdapter } from "@/modules/sultan-agent-gateway/gmailRfqCanaryAdapter";
import { parseCommandExecutionEnvelope, parseToolCallEnvelope } from "@/modules/sultan-agent-gateway/parser";
import { SULTAN_RFQ_CANARY_DESTINATION, SULTAN_RFQ_CANARY_RECIPIENT } from "@/modules/sultan-agent-gateway/registry";
import {
  approvalSignature,
  SultanAgentGatewayService,
  type AuthoritativeCaseSnapshot,
  type CommercialCaseSnapshot,
  type SultanAgentGatewayStore,
} from "@/modules/sultan-agent-gateway/service";
import type { ProviderMessage } from "@/modules/provider-runtime/contracts";

const NOW = "2026-09-01T12:00:00.000Z";
const APPROVAL_SECRET = "test-approval-secret-that-is-longer-than-thirty-two-bytes";
const CASE_SOURCE = "postgres:public.commercial_cases/case-canary-001@commercial-case:case-canary-001:v7";

function actor(capabilities: string[] = [
  "sultan.tool.manifest.read", "sultan.tool.invoke", "sultan.effect.read", "sultan.case.read",
  "sultan.command.prepare", "sultan.command.execute", "sultan.internal.command", "sultan.rfq.canary.send",
]): ApiActor {
  return { actorId: "service:sultan-os", actorType: "service", capabilities, source: "vercel-oidc", tenantId: "luzione" };
}

function snapshot(): CommercialCaseSnapshot {
  return {
    commercialCase: {
      accountId: "account-synthetic-001", accountName: "Synthetic Canary Account", amount: 5000,
      caseId: "case-canary-001", contactName: null, nextAction: "request_supplier_quote",
      owner: "commercial-owner-synthetic", primaryContactId: null, stage: "QUALIFIED", status: "OPEN",
      title: "Synthetic RFQ canary case", updatedAt: NOW, version: 7,
    },
    objectVersion: "commercial-case:case-canary-001:v7",
    sourceOfTruth: "commercial_cases",
  };
}

function authoritativeSnapshot(): AuthoritativeCaseSnapshot {
  const value = snapshot();
  return {
    caseType: "COMMERCIAL",
    objectVersion: value.objectVersion,
    observedAt: value.commercialCase.updatedAt,
    sourceOfTruth: value.sourceOfTruth,
    sourceRefs: [CASE_SOURCE],
    snapshot: value as unknown as Record<string, unknown>,
  };
}

function call(toolId = "luzione.case_context.read", args: Record<string, unknown> = {}): SultanToolCall {
  const consequential = [
    "luzione.proposal_revision.create", "luzione.task.create", "luzione.note.append",
    "luzione.gmail_draft.create", "luzione.supplier_rfq_email.send",
  ].includes(toolId);
  return {
    contractVersion: LUZIONE_SULTAN_TOOL_CALL_V1,
    operationId: "operation.canary.001",
    runId: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    toolCallId: "call_tool_001",
    toolId,
    toolVersion: "v1",
    agent: { agentId: "agent.luzione.revenue-steward", agentVersion: "v1" },
    caseRef: { caseId: "case-canary-001", caseType: "COMMERCIAL", expectedVersion: "commercial-case:case-canary-001:v7" },
    purpose: "Exercise the bounded synthetic Sultan pilot.",
    arguments: args,
    argumentsHash: sha256(args),
    contextRefs: [{ sourceRef: CASE_SOURCE, sourceVersion: "commercial-case:case-canary-001:v7", integrityHash: "a".repeat(64), observedAt: NOW, freshness: "FRESH" }],
    controlEvidence: consequential ? { criticEventId: "event_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", criticPayloadHash: "b".repeat(64), criticVerdict: "AFFIRM" } : null,
  };
}

class FakeStore implements SultanAgentGatewayStore {
  preparations = 0;
  executions = 0;
  observed: AuthoritativeCaseSnapshot | null = authoritativeSnapshot();
  preparation: SultanCommandPreparation | null = null;

  async readCase() { return this.observed; }
  async readEvidence() {
    return { freshness: "FRESH" as const, sourceRefs: [CASE_SOURCE], evidence: { activityCount: 2 }, missingEvidence: [] };
  }
  async prepareCommand(input: Parameters<SultanAgentGatewayStore["prepareCommand"]>[0]) {
    this.preparations += 1;
    this.preparation = {
      contractVersion: LUZIONE_SULTAN_COMMAND_PREPARATION_V1,
      reservationId: "sultan-reservation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operationId: input.call.operationId,
      runId: input.call.runId,
      toolCallId: input.call.toolCallId,
      toolId: input.call.toolId,
      toolVersion: input.call.toolVersion,
      agent: input.call.agent,
      caseRef: input.call.caseRef,
      effectClass: input.effectClass,
      approvalMode: input.approvalMode,
      commandHash: input.commandHash,
      argumentsHash: input.call.argumentsHash,
      state: "PREPARED",
      preview: input.preview,
      expiresAt: "2026-09-01T12:15:00.000Z",
      executionAllowed: input.effectClass === "A1",
      nextSafeAction: input.effectClass === "A1" ? "Obtain human approval." : "Do not dispatch.",
      idempotentReplay: false,
    };
    return this.preparation;
  }
  async executeCommand(input: Parameters<SultanAgentGatewayStore["executeCommand"]>[0]) {
    this.executions += 1;
    const receipt: SultanEffectReceipt = {
      contractVersion: LUZIONE_SULTAN_EFFECT_RECEIPT_V1,
      receiptId: "sultan-receipt-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operationId: "operation.canary.001",
      toolCallId: "call_tool_001",
      toolId: "luzione.note.append",
      effectClass: "A1",
      state: "SOURCE_CONFIRMED",
      idempotentReplay: false,
      providerRef: null,
      resultHash: "c".repeat(64),
      createdAt: input.now,
      businessFinal: false,
    };
    const readback = await this.readEffect(input.actor, receipt.receiptId, input.now);
    assert.ok(readback);
    const execution: SultanCommandExecution = {
      contractVersion: LUZIONE_SULTAN_COMMAND_EXECUTION_V1,
      reservationId: input.reservationId,
      operationId: receipt.operationId,
      commandHash: input.commandHash,
      state: "SOURCE_CONFIRMED",
      receipt,
      readback,
      idempotentReplay: false,
      nextSafeAction: readback.nextSafeAction,
    };
    return execution;
  }
  async readEffect(_actor: ApiActor, receiptId: string, observedAt = NOW) {
    return {
      contractVersion: LUZIONE_SULTAN_READBACK_V1,
      receiptId,
      observedAt,
      state: "SOURCE_CONFIRMED" as const,
      providerRef: null,
      sourceReadbackRef: `postgres:public.sultan_agent_internal_actions/${receiptId}`,
      authoritativeSource: "public.sultan_agent_internal_actions",
      businessFinal: false,
      deliveryProven: false,
      nextSafeAction: "Review the reversible internal action.",
    };
  }
}

test("manifest derives steward server-side and hides tools outside capability intersection", () => {
  const service = new SultanAgentGatewayService(new FakeStore(), () => new Date(NOW), APPROVAL_SECRET);
  const manifest = service.manifest({
    actor: actor(["sultan.tool.manifest.read", "sultan.case.read"]),
    assertedAgent: { agentId: "agent.luzione.revenue-steward", agentVersion: "v1" },
    caseRef: call().caseRef,
  });
  assert.deepEqual(manifest.tools.map((tool) => tool.toolId), [
    "luzione.case_context.read", "luzione.missing_evidence.read", "luzione.account_activity.read",
    "luzione.proposal_evidence.read", "luzione.supplier_facts.read",
  ]);
  assert.equal(manifest.discoveryGrantsAuthority, false);
  const { manifestHash, ...unsigned } = manifest;
  assert.equal(manifestHash, sha256(unsigned));
});

test("parser rejects client-forged tenant authority at any depth", () => {
  const forged = call();
  assert.throws(
    () => parseToolCallEnvelope({ toolCall: { ...forged, arguments: { tenantId: "other" }, argumentsHash: sha256({ tenantId: "other" }) } }),
    (error: unknown) => error instanceof SultanAgentGatewayError && error.code === "CLIENT_AUTHORITY_REJECTED",
  );
});

test("read tools return exact authoritative version and stale calls fail closed", async () => {
  const service = new SultanAgentGatewayService(new FakeStore(), () => new Date(NOW), APPROVAL_SECRET);
  const ready = await service.invoke({ actor: actor(), call: call() });
  assert.equal(ready.status, "READY");
  assert.deepEqual(ready.sourceRefs, [CASE_SOURCE]);
  const stale = call();
  stale.caseRef.expectedVersion = "commercial-case:case-canary-001:v6";
  const blocked = await service.invoke({ actor: actor(), call: stale });
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.failureCode, "STALE_OBJECT_VERSION");
});

test("A1 command prepares, interrupts, and executes only with an exact signed human approval", async () => {
  const store = new FakeStore();
  const service = new SultanAgentGatewayService(store, () => new Date(NOW), APPROVAL_SECRET);
  const noteCall = call("luzione.note.append", { campaignId: "sultan-campaign-pilot-001", note: "Synthetic test note; no customer data." });
  const interrupted = await service.invoke({ actor: actor(), call: noteCall });
  assert.equal(interrupted.status, "AWAITING_APPROVAL");
  assert.equal(interrupted.policyDecision, "REQUIRE_APPROVAL");
  assert.equal(store.preparations, 1);
  assert.ok(store.preparation);

  const unsigned: Omit<SultanApprovalAdmission, "signature"> = {
    contractVersion: "sultan.human-approval-admission.v1",
    approvalId: "approval_test_001",
    operatorId: `user_${"d".repeat(64)}`,
    reservationId: store.preparation.reservationId,
    commandHash: store.preparation.commandHash,
    decision: "APPROVE",
    approvedAt: NOW,
    expiresAt: "2026-09-01T12:10:00.000Z",
  };
  const approvalAdmission = { ...unsigned, signature: approvalSignature(APPROVAL_SECRET, unsigned) };
  const executed = await service.execute({ actor: actor(), reservationId: unsigned.reservationId, commandHash: unsigned.commandHash, approvalAdmission });
  assert.equal(executed.state, "SOURCE_CONFIRMED");
  assert.equal(executed.receipt.effectClass, "A1");
  assert.equal(executed.readback.providerRef, null);
  assert.equal(store.executions, 1);

  await assert.rejects(
    () => service.execute({ actor: actor(), reservationId: unsigned.reservationId, commandHash: unsigned.commandHash, approvalAdmission: { ...approvalAdmission, signature: "e".repeat(64) } }),
    (error: unknown) => error instanceof SultanAgentGatewayError && error.code === "APPROVAL_SIGNATURE_INVALID",
  );
});

test("A2 RFQ canary stops at preparation and cannot reserve provider dispatch", async () => {
  const store = new FakeStore();
  const service = new SultanAgentGatewayService(store, () => new Date(NOW), APPROVAL_SECRET);
  const args = {
    recipient: SULTAN_RFQ_CANARY_RECIPIENT,
    subject: "[SULTAN RFQ CANARY] Synthetic stone sample pricing",
    bodyText: "Please quote the synthetic test specification and quantity shown in the allowlisted canary case.",
    contentClass: "SYNTHETIC_ALLOWLISTED_SUPPLIER_RFQ",
    evidenceRefs: [CASE_SOURCE],
  };
  const result = await service.invoke({ actor: actor(), call: call("luzione.supplier_rfq_email.send", args) });
  assert.equal(result.status, "AWAITING_APPROVAL");
  assert.equal(result.policyDecision, "BLOCK");
  assert.equal(result.failureCode, "A2_EXECUTION_DISABLED");
  assert.equal(store.preparations, 1);
  assert.equal(store.preparation?.executionAllowed, false);
  assert.equal(store.executions, 0);

  const altered = { ...args, recipient: "supplier@example.com" };
  await assert.rejects(() => service.invoke({ actor: actor(), call: call("luzione.supplier_rfq_email.send", altered) }), /exactly hello@ciflow.io/);
});

test("command parser accepts only the versioned execution envelope", () => {
  const parsed = parseCommandExecutionEnvelope({ execution: {
    contractVersion: LUZIONE_SULTAN_COMMAND_EXECUTION_V1,
    reservationId: "sultan-reservation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    commandHash: "a".repeat(64),
    approvalAdmission: {
      contractVersion: "sultan.human-approval-admission.v1", approvalId: "approval_test_001",
      operatorId: `user_${"b".repeat(64)}`, reservationId: "sultan-reservation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      commandHash: "a".repeat(64), decision: "APPROVE", approvedAt: NOW,
      expiresAt: "2026-09-01T12:10:00.000Z", signature: "c".repeat(64),
    },
  } });
  assert.equal(parsed.commandHash, "a".repeat(64));
});

test("Gmail adapter records PROVIDER_ACCEPTED identity and never retries an indeterminate send", async () => {
  let providerCalls = 0;
  const adapter = new GmailRfqCanaryAdapter({ SULTAN_RFQ_CANARY_SENDER: "canary@luzione.com", GMAIL_SULTAN_RFQ_ACCESS_TOKEN: "test-token" }, async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ id: "gmail-message-001", threadId: "thread-001" }), { status: 200 });
  });
  const accepted = await adapter.execute(await adapter.prepare(providerMessage()));
  assert.deepEqual(accepted, { state: "ACKNOWLEDGED", acknowledgementRef: "gmail:message:gmail-message-001" });
  assert.equal(providerCalls, 1);

  let ambiguousCalls = 0;
  const ambiguousAdapter = new GmailRfqCanaryAdapter({ SULTAN_RFQ_CANARY_SENDER: "canary@luzione.com", GMAIL_SULTAN_RFQ_ACCESS_TOKEN: "test-token" }, async () => {
    ambiguousCalls += 1;
    throw new TypeError("connection closed");
  });
  const ambiguous = await ambiguousAdapter.execute(await ambiguousAdapter.prepare(providerMessage()));
  assert.equal(ambiguous.state, "FAILED");
  if (ambiguous.state === "FAILED") assert.equal(ambiguous.failureClass, "AMBIGUOUS_AFTER_ACK");
  assert.equal(ambiguousCalls, 1);
});

function providerMessage(): ProviderMessage {
  const payload = {
    contractVersion: "luzione-sultan-rfq-canary-message/v1", operationId: "operation.canary.001",
    runId: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", toolCallId: "call_tool_001", sender: "canary@luzione.com",
    recipient: SULTAN_RFQ_CANARY_RECIPIENT, subject: "[SULTAN RFQ CANARY] Synthetic stone sample pricing",
    bodyText: "Please quote the synthetic test specification and quantity shown in the allowlisted canary case.",
    attachments: [], trackingLinks: [], evidenceRefs: [CASE_SOURCE], contentClass: "SYNTHETIC_ALLOWLISTED_SUPPLIER_RFQ",
    envelopeId: "envelope-001", envelopeExpiresAt: "2026-09-02T12:00:00.000Z",
  };
  return {
    authorizationRef: "sultan-rfq-envelope:envelope-001", destination: SULTAN_RFQ_CANARY_DESTINATION,
    effectClass: "EXTERNAL_EFFECT", expectedObjectVersion: "commercial-case:case-canary-001:v7",
    idempotencyKey: "sultan-rfq-canary:operation.canary.001", objectId: "case-canary-001", objectType: "commercial_case",
    outboxMessageId: "outbox-001", payload, payloadHash: sha256(payload), receiptId: "receipt-001",
    resultingObjectVersion: "commercial-case:case-canary-001:v7", tenantId: "luzione",
  };
}
