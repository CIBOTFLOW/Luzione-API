import assert from "node:assert/strict";
import test from "node:test";
import {
  createLifecycleCommandExecutionReceipt,
  createPlatformReceipt,
  receiptContentHash,
} from "../receiptContract";

const base = {
  acknowledgementRef: null,
  actualEffect: null,
  actor: { actorId: "operator-1", actorType: "user" as const, roles: ["operator"] },
  authority: "A2_EXACT_VERSION_APPROVAL",
  capability: "proposal.send",
  correlationId: "corr-1",
  cost: null,
  createdAt: "2026-08-29T12:00:00.000Z",
  failure: null,
  idempotencyKey: "proposal-1:v7:send",
  inputVersionRefs: ["proposal:v7"],
  latencyMs: null,
  modelRef: null,
  observedAt: null,
  outcome: "ACCEPTED" as const,
  policyVersionRefs: ["tenant-policy:v3"],
  predecessorReceiptIds: [] as string[],
  providerRef: null,
  purpose: "send-approved-proposal",
  receiptId: "receipt-intent-1",
  releaseSha: "abc1234",
  requestId: "request-1",
  requestedEffect: { effectClass: "EXTERNAL_COMMUNICATION", summary: "Send proposal v7." },
  sourceReadbackRef: null,
  tenantId: "tenant-a",
  toolRef: null,
  traceId: "0123456789abcdef0123456789abcdef",
};

test("intent, execution acknowledgement and source readback remain distinct receipts", () => {
  const intent = createPlatformReceipt({ ...base, receiptType: "action_intent" });
  const execution = createPlatformReceipt({
    ...base,
    acknowledgementRef: "provider://message/ack-1",
    actualEffect: { effectClass: "EXTERNAL_COMMUNICATION", summary: "Provider accepted the dispatch." },
    outcome: "SUCCEEDED",
    predecessorReceiptIds: [intent.receiptId],
    receiptId: "receipt-execution-1",
    receiptType: "execution",
  });
  const readback = createPlatformReceipt({
    ...base,
    actualEffect: { effectClass: "EXTERNAL_COMMUNICATION", summary: "Provider source contains message ack-1." },
    observedAt: "2026-08-29T12:00:03.000Z",
    outcome: "CONFIRMED",
    predecessorReceiptIds: [execution.receiptId],
    receiptId: "receipt-readback-1",
    receiptType: "readback",
    sourceReadbackRef: "provider://messages/ack-1#v2",
  });
  assert.equal(intent.actualEffect, null);
  assert.equal(execution.sourceReadbackRef, null);
  assert.equal(readback.predecessorReceiptIds[0], execution.receiptId);
  assert.notEqual(receiptContentHash(intent), receiptContentHash(execution));
});

test("known-bad evidence conflation fails closed", () => {
  assert.throws(() => createPlatformReceipt({
    ...base,
    actualEffect: { effectClass: "EXTERNAL_COMMUNICATION", summary: "Claimed effect." },
    receiptType: "action_intent",
  }), /cannot claim an actual effect/);
  assert.throws(() => createPlatformReceipt({
    ...base,
    receiptType: "readback",
  }), /readback requires/);
  assert.throws(() => createPlatformReceipt({
    ...base,
    inputVersionRefs: ["model:gpt-output-1"],
    modelRef: "model:gpt-output-1",
    receiptType: "decision",
  }), /metadata, not an authoritative input/);
});

test("legacy lifecycle receipt adapter claims only committed owner mutation and pending dispatch", () => {
  const receipt = createLifecycleCommandExecutionReceipt({
    authority: "A1_SCOPED_SERVICE",
    capability: "catalog.projection.ingest",
    command: {
      actor: { actorId: "service-1", actorType: "service", roles: [] },
      causationId: null,
      commandId: "command-1",
      commandType: "INGEST_PROJECTION",
      contractVersion: "1.0",
      correlationId: "corr-1",
      expectedObjectVersion: "projection:v1",
      idempotencyKey: "projection:v2",
      payload: { count: 4 },
      payloadHash: "hash-1",
      policyVersion: "projection-policy:v1",
      requestedAt: "2026-08-29T12:00:00.000Z",
      stepId: null,
      target: { objectId: "projection-1", objectType: "catalog_projection", objectVersion: "projection:v1", ownerProject: "LUZIONE_P113", sourceRefs: [] },
      tenantId: "tenant-a",
      workflowId: null,
    },
    lifecycleReceipt: {
      commandId: "command-1",
      correlationId: "corr-1",
      eventId: "event-1",
      idempotentReplay: false,
      idempotencyKey: "projection:v2",
      objectVersion: "projection:v2",
      outboxMessageId: "outbox-1",
      payloadHash: "hash-1",
      receiptId: "receipt-legacy-1",
      state: "DISPATCH_PENDING",
      tenantId: "tenant-a",
    },
    purpose: "ingest-catalog-projection",
    releaseSha: "abc1234",
    requestId: "request-1",
    traceId: "0123456789abcdef0123456789abcdef",
  });
  assert.equal(receipt.receiptType, "execution");
  assert.equal(receipt.acknowledgementRef, "event:event-1");
  assert.equal(receipt.sourceReadbackRef, null);
  assert.match(receipt.actualEffect?.summary ?? "", /dispatch remains pending/);
});
