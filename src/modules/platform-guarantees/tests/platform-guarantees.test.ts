import assert from "node:assert/strict";
import test from "node:test";
import {
  createLifecycleCommandRequest,
  createUniversalEventEnvelope,
  decideRetry,
  explainFlow,
  IdempotencyConflictError,
  LifecycleCommandKernel,
  sha256,
  signContinuationDescriptor,
  transitionFlow,
  verifyContinuationToken,
} from "../index";
import type {
  AcceptedCommandWrite,
  AtomicCommandStore,
  ContinuationDescriptor,
  FlowSnapshot,
  IdempotencyConflict,
  LifecycleCommandReceipt,
} from "../index";

const now = "2026-08-20T12:00:00.000Z";
const continuationSecret = "test-continuation-secret-32";

function snapshot(overrides: Partial<FlowSnapshot> = {}): FlowSnapshot {
  return {
    blockers: [],
    checkpoints: [
      {
        checkpointId: "cp-intake",
        completedAt: "2026-08-20T11:55:00.000Z",
        evidenceRefs: ["case:v3"],
        inputVersion: "case:v3",
        name: "Validate current case",
        nextStepId: "human-review",
        owner: "LUZIONE_P03",
        state: "COMPLETED",
        stepId: "validate-case",
      },
      {
        checkpointId: "cp-review",
        completedAt: null,
        evidenceRefs: ["proposal:v7"],
        inputVersion: "proposal:v7",
        name: "Wait for exact-version proposal review",
        nextStepId: "dispatch",
        owner: "LUZIONE_P16",
        state: "ACTIVE",
        stepId: "human-review",
      },
    ],
    commandReceiptId: "receipt-1",
    correlationId: "corr-1",
    currentStepId: "human-review",
    definitionId: "proposal-lifecycle",
    definitionVersion: 2,
    delivery: null,
    flowId: "flow-1",
    idempotencyKey: "flow-1:v4",
    killSwitchActive: false,
    lastEventId: "event-1",
    lastTransitionAt: now,
    objectRef: {
      objectId: "case-1",
      objectType: "commercial_case",
      objectVersion: "case:v3",
      ownerProject: "LUZIONE_P02",
      sourceRefs: ["postgres://commercial_cases/case-1#v3"],
    },
    outboxMessageId: "outbox-1",
    retryPolicy: { backoffCoefficient: 2, baseDelayMs: 1_000, maxAttempts: 5, maxDelayMs: 60_000 },
    state: "WAITING_FOR_HUMAN",
    stateVersion: 4,
    tenantId: "tenant-a",
    ...overrides,
  };
}

test("universal events use deterministic payload hashes and explicit authority", () => {
  const first = createUniversalEventEnvelope({
    actor: { actorId: "operator-1", actorType: "user", roles: ["Operations Lead"] },
    authorityClass: "OBSERVATION",
    correlationId: "corr-1",
    eventId: "evt-1",
    eventType: "supplier.response.observed",
    eventVersion: 2,
    idempotencyKey: "supplier-response-1",
    occurredAt: now,
    payload: { nested: { a: 1, b: 2 }, status: "received" },
    producerProject: "LUZIONE_P12",
    recordedAt: now,
    subject: {
      objectId: "request-1",
      objectType: "supplier_inquiry",
      objectVersion: "v5",
      ownerProject: "LUZIONE_P12",
      sourceRefs: ["postgres://supplier_inquiries/request-1#v5"],
    },
    tenantId: "tenant-a",
  });
  const reordered = sha256({ status: "received", nested: { b: 2, a: 1 } });
  assert.equal(first.payloadHash, reordered);
  assert.equal(first.authorityClass, "OBSERVATION");
  assert.equal(first.subject.ownerProject, "LUZIONE_P12");
});

test("client payloads cannot self-grant tenant, actor, or source confirmation", () => {
  assert.throws(
    () => createUniversalEventEnvelope({
      actor: { actorId: "operator-1", actorType: "user", roles: ["Operations Lead"] },
      authorityClass: "OBSERVATION",
      correlationId: "corr-1",
      eventType: "provider.acknowledgement.observed",
      eventVersion: 1,
      idempotencyKey: "ack-1",
      occurredAt: now,
      payload: { nested: { sourceConfirmed: true }, tenantId: "forged" },
      producerProject: "LUZIONE_P110",
      recordedAt: now,
      subject: { objectId: "case-1", objectType: "commercial_case", objectVersion: "v1", ownerProject: "LUZIONE_P02", sourceRefs: [] },
      tenantId: "tenant-a",
    }),
    /cannot grant actor, tenant, source-confirmation/,
  );
});

test("continuation tokens are exact-version, signed, and expiring", () => {
  const descriptor: ContinuationDescriptor = {
    allowedCommands: ["RESUME_FLOW"],
    checkpointId: "cp-review",
    expiresAt: "2026-08-20T12:15:00.000Z",
    flowId: "flow-1",
    stateVersion: 4,
    tenantId: "tenant-a",
    workflowVersion: 2,
  };
  const token = signContinuationDescriptor(descriptor, continuationSecret);
  assert.deepEqual(verifyContinuationToken(token, continuationSecret, now), descriptor);
  assert.throws(() => verifyContinuationToken(`${token}x`, continuationSecret, now), /signature is invalid/);
  assert.throws(() => verifyContinuationToken(token, continuationSecret, "2026-08-20T12:16:00.000Z"), /expired/);
  const unknownCommand = signContinuationDescriptor({ ...descriptor, allowedCommands: ["DELETE_FLOW"] } as unknown as ContinuationDescriptor, continuationSecret);
  assert.throws(() => verifyContinuationToken(unknownCommand, continuationSecret, now), /unknown command/);
});

test("safe retries are bounded and deterministic", () => {
  const first = decideRetry({ attempt: 2, failureClass: "TRANSIENT_BEFORE_ACK", idempotencyKey: "cmd-1", killSwitchActive: false, now });
  const second = decideRetry({ attempt: 2, failureClass: "TRANSIENT_BEFORE_ACK", idempotencyKey: "cmd-1", killSwitchActive: false, now });
  assert.deepEqual(first, second);
  assert.equal(first.action, "RETRY");
  assert.ok((first.delayMs ?? 0) > 0);
  assert.equal(decideRetry({ attempt: 5, failureClass: "TRANSIENT_BEFORE_ACK", idempotencyKey: "cmd-1", killSwitchActive: false, now }).action, "DEAD_LETTER");
});

test("ambiguous acknowledgement reconciles before retry and kill switch blocks dispatch", () => {
  assert.equal(decideRetry({ attempt: 1, failureClass: "AMBIGUOUS_AFTER_ACK", idempotencyKey: "cmd-1", killSwitchActive: false, now }).action, "RECONCILE");
  assert.equal(decideRetry({ attempt: 1, failureClass: "TRANSIENT_BEFORE_ACK", idempotencyKey: "cmd-1", killSwitchActive: true, now }).action, "BLOCK");
});

test("flow state transitions reject stale versions and invalid commands", () => {
  const current = snapshot();
  assert.throws(() => transitionFlow({ commandType: "RESUME_FLOW", expectedStateVersion: 3, now, snapshot: current }), /Stale flow version/);
  assert.throws(() => transitionFlow({ commandType: "START_FLOW", expectedStateVersion: 4, now, snapshot: current }), /not allowed/);
  const resumed = transitionFlow({ commandType: "RESUME_FLOW", expectedStateVersion: 4, now, snapshot: current });
  assert.equal(resumed.state, "RESUMING");
  assert.equal(resumed.stateVersion, 5);
});

test("self-explaining flows expose truth, blockers, next actions, evidence, and AI-safe continuation", () => {
  const current = snapshot({
    blockers: [{ blockerId: "block-review", evidenceNeeded: "P16 exact-version approval", owner: "Proposal reviewer", reason: "Proposal v7 has not been approved.", reviewBy: "2026-08-21T12:00:00.000Z" }],
  });
  const explanation = explainFlow({ continuationSecret, now, snapshot: current });
  assert.equal(explanation.activeCheckpoint?.checkpointId, "cp-review");
  assert.match(explanation.whereAmI, /waiting for human/);
  assert.equal(explanation.blockers.length, 1);
  assert.equal(explanation.nextActions.find((item) => item.actionId === "RESUME_FLOW")?.authorityRequired, "OPERATOR_REQUIRED");
  assert.equal(explanation.continuation.descriptor.stateVersion, 4);
  assert.equal(explanation.guarantees.every((item) => item.status !== "BREACHED"), true);
  assert.deepEqual(verifyContinuationToken(explanation.continuation.token, continuationSecret, now), explanation.continuation.descriptor);
});

test("source confirmation without readback is a visible guarantee breach", () => {
  const explanation = explainFlow({
    continuationSecret,
    now,
    snapshot: snapshot({
      delivery: {
        acknowledgementAt: now,
        acknowledgementRef: "provider://ack-1",
        attempt: 1,
        failureClass: null,
        lastErrorCode: null,
        sourceConfirmedAt: now,
        sourceReadbackRef: null,
      },
      state: "COMPLETED",
    }),
  });
  assert.equal(explanation.guarantees.find((item) => item.guaranteeId === "G-003")?.status, "BREACHED");
  assert.match(explanation.headline, /breached/);
});

test("failed ambiguous flows choose the reconciliation recovery playbook", () => {
  const explanation = explainFlow({
    continuationSecret,
    now,
    snapshot: snapshot({
      delivery: {
        acknowledgementAt: now,
        acknowledgementRef: "provider://ack-1",
        attempt: 2,
        failureClass: "AMBIGUOUS_AFTER_ACK",
        lastErrorCode: "TIMEOUT",
        sourceConfirmedAt: null,
        sourceReadbackRef: null,
      },
      state: "FAILED",
    }),
  });
  assert.equal(explanation.retry?.action, "RECONCILE");
  assert.equal(explanation.recoveryPlaybook?.playbookId, "p110.timeout-after-ack");
});

test("failed pre-ack flows explain the bounded outbox recovery playbook", () => {
  const explanation = explainFlow({
    continuationSecret,
    now,
    snapshot: snapshot({
      delivery: {
        acknowledgementAt: null,
        acknowledgementRef: null,
        attempt: 1,
        failureClass: "TRANSIENT_BEFORE_ACK",
        lastErrorCode: "TIMEOUT",
        sourceConfirmedAt: null,
        sourceReadbackRef: null,
      },
      state: "FAILED",
    }),
  });
  assert.equal(explanation.retry?.action, "RETRY");
  assert.equal(explanation.recoveryPlaybook?.playbookId, "p110.outbox-stuck");
});

type StoreState = {
  accepted: AcceptedCommandWrite[];
  conflicts: IdempotencyConflict[];
  domainWrites: number;
  receipts: LifecycleCommandReceipt[];
};

class InMemoryAtomicStore implements AtomicCommandStore<StoreState> {
  state: StoreState = { accepted: [], conflicts: [], domainWrites: 0, receipts: [] };

  async findReceipt(transaction: StoreState, tenantId: string, idempotencyKey: string) {
    return transaction.receipts.find((item) => item.tenantId === tenantId && item.idempotencyKey === idempotencyKey) ?? null;
  }

  async insertAccepted(transaction: StoreState, write: AcceptedCommandWrite) {
    transaction.accepted.push(write);
    transaction.receipts.push(write.receipt);
  }

  async recordConflict(conflict: IdempotencyConflict) {
    this.state.conflicts.push(conflict);
  }

  async withTransaction<Result>(callback: (transaction: StoreState) => Promise<Result>) {
    const draft = structuredClone(this.state);
    const result = await callback(draft);
    this.state = draft;
    return result;
  }
}

function command(payload: Record<string, unknown>) {
  return createLifecycleCommandRequest({
    actor: { actorId: "operator-1", actorType: "user", roles: ["Operations Lead"] },
    causationId: null,
    commandId: "cmd-1",
    commandType: "NO_EFFECT_DIAGNOSTIC",
    correlationId: "corr-1",
    expectedObjectVersion: "v1",
    idempotencyKey: "diag-1",
    payload,
    policyVersion: "p110.no-effect.v1",
    requestedAt: now,
    stepId: "diagnose",
    target: { objectId: "probe-1", objectType: "platform_probe", objectVersion: "v1", ownerProject: "LUZIONE_P110", sourceRefs: [] },
    tenantId: "tenant-a",
    workflowId: "flow-1",
  });
}

test("command receipt, owner mutation, event, and outbox commit atomically", async () => {
  const store = new InMemoryAtomicStore();
  const kernel = new LifecycleCommandKernel(store);
  const receipt = await kernel.execute(command({ value: 1 }), async (transaction) => {
    transaction.domainWrites += 1;
    return { evidenceRefs: ["probe://readback/v2"], objectVersion: "v2" };
  });
  assert.equal(receipt.state, "DISPATCH_PENDING");
  assert.equal(store.state.domainWrites, 1);
  assert.equal(store.state.accepted.length, 1);
  assert.equal(store.state.accepted[0].event.subject.objectVersion, "v2");
  assert.equal(store.state.accepted[0].outboxMessageId, receipt.outboxMessageId);
});

test("an exact replay returns the original receipt and never repeats the owner mutation", async () => {
  const store = new InMemoryAtomicStore();
  const kernel = new LifecycleCommandKernel(store);
  let mutations = 0;
  const mutate = async (transaction: StoreState) => {
    mutations += 1;
    transaction.domainWrites += 1;
    return { objectVersion: "v2" };
  };
  const first = await kernel.execute(command({ value: 1 }), mutate);
  const replay = await kernel.execute(command({ value: 1 }), mutate);
  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(mutations, 1);
  assert.equal(store.state.accepted.length, 1);
});

test("same idempotency key with a different payload records a conflict and creates no second effect", async () => {
  const store = new InMemoryAtomicStore();
  const kernel = new LifecycleCommandKernel(store);
  await kernel.execute(command({ value: 1 }), async (transaction) => {
    transaction.domainWrites += 1;
    return { objectVersion: "v2" };
  });
  await assert.rejects(
    kernel.execute(command({ value: 2 }), async (transaction) => {
      transaction.domainWrites += 1;
      return { objectVersion: "v3" };
    }),
    IdempotencyConflictError,
  );
  assert.equal(store.state.conflicts.length, 1);
  assert.equal(store.state.domainWrites, 1);
  assert.equal(store.state.accepted.length, 1);
});

test("owner failure rolls back receipt, event, and outbox together", async () => {
  const store = new InMemoryAtomicStore();
  const kernel = new LifecycleCommandKernel(store);
  await assert.rejects(
    kernel.execute(command({ value: 1 }), async (transaction) => {
      transaction.domainWrites += 1;
      throw new Error("synthetic owner rollback");
    }),
    /synthetic owner rollback/,
  );
  assert.equal(store.state.domainWrites, 0);
  assert.equal(store.state.receipts.length, 0);
  assert.equal(store.state.accepted.length, 0);
});
