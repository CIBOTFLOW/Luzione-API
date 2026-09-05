import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { ProviderContractError, parsePreparedProviderDispatch, providerMessageFromRow, type ProviderExecutionContext } from "@/modules/provider-runtime/contracts";
import { ProviderAdapterRegistry } from "@/modules/provider-runtime/registry";
import { ProviderWorkerRuntime, type ProviderWorkerStore } from "@/modules/provider-runtime/runtime";
import { SandboxEchoProviderAdapter } from "@/modules/provider-runtime/sandboxEchoAdapter";
import { effectBindingKey, killState } from "@/modules/effect-admission/contracts";
import { StaticEffectAdmissionGate } from "@/modules/effect-admission/gate";

const migration = readFileSync("supabase/migrations/20260831080000_provider_worker_runtime.sql", "utf8");
const storeSource = readFileSync("src/lib/platform-guarantees/postgresWorkflowDeliveryStore.ts", "utf8");
const routeSource = readFileSync("src/app/api/v1/provider-operations/route.ts", "utf8");

function row(scenario = "matched") {
  const payload = { scenario };
  return {
    actor_id: "proof-service",
    actor_type: "service",
    authorization_ref: "sandbox-authorization:proof",
    destination: "sandbox.echo",
    effect_class: "NO_EFFECT",
    expected_object_version: "order:proof:v0",
    idempotency_key: `provider-${scenario}`,
    outbox_message_id: `outbox-${scenario}`,
    payload,
    payload_hash: sha256(payload),
    receipt_id: `receipt-${scenario}`,
    resulting_object_version: "order:proof:v1",
    target_object_id: "proof",
    target_object_type: "order",
    tenant_id: "tenant-proof",
  };
}

class FakeStore implements ProviderWorkerStore {
  deliveries: Record<string, unknown>[] = [];
  reconciliations: Record<string, unknown>[] = [];
  calls: Array<{ input: Record<string, unknown>; method: string }> = [];
  claimed = new Map<string, Record<string, unknown>>();
  claimedReconciliations = new Map<string, Record<string, unknown>>();
  started = new Map<string, ProviderExecutionContext>();
  async claimDueOutbox() { const value = this.deliveries; this.deliveries = []; value.forEach((row) => this.claimed.set(String(row.outbox_message_id), row)); return value; }
  async claimDueReconciliations() { const value = this.reconciliations; this.reconciliations = []; value.forEach((row) => this.claimedReconciliations.set(String(row.reconciliation_id), row)); return value; }
  async readClaimedOutboxForAdmission(input: Record<string, unknown>) { return this.claimed.get(String(input.outboxMessageId))!; }
  async readClaimedReconciliationForAdmission(input: Record<string, unknown>) {
    const row = this.claimedReconciliations.get(String(input.reconciliationId))!;
    const context = this.started.get(String(row.outbox_message_id))!;
    return {
      ...row,
      effect_execution_envelope: context.executionEnvelope,
      effect_execution_envelope_ref: context.executionEnvelope.executionEnvelopeRef,
      effect_execution_identity: context.executionEnvelope.executionIdentity,
      originating_envelope_ref: context.executionEnvelope.originatingEnvelopeRef,
      prepared_dispatch_digest: context.executionEnvelope.preparedDispatchDigest,
    };
  }
  async completeClaimedReconciliation(input: Record<string, unknown>) { this.calls.push({ input, method: "complete" }); return input; }
  async recordDispatchStarted(input: Parameters<ProviderWorkerStore["recordDispatchStarted"]>[0]) {
    this.started.set(input.outboxMessageId, input.effectExecutionContext);
    this.calls.push({ input: input as unknown as Record<string, unknown>, method: "started" });
    return input;
  }
  async recordOutboxFailure(input: Record<string, unknown>) { this.calls.push({ input, method: "failed" }); return { state: input.failureClass === "AMBIGUOUS_AFTER_ACK" ? "RECONCILIATION_REQUIRED" : "DEAD_LETTERED" }; }
  async recordProviderAcknowledgement(input: Record<string, unknown>) { this.calls.push({ input, method: "acknowledged" }); return input; }
}

const sandboxBinding = {
  actor: { actorId: "proof-service", actorType: "service" as const },
  credentialBindingId: "credential-binding:none:sandbox-echo/v1",
  destination: "sandbox.echo",
  provider: "luzione-deterministic-simulator",
  tenantId: "tenant-proof",
};
const admitted = () => new StaticEffectAdmissionGate(killState([]), { admittedBindings: new Set([effectBindingKey(sandboxBinding)]), enabled: true });

test("provider adapter contract validates durable payload identity and exact readback", async () => {
  const message = providerMessageFromRow(row());
  assert.equal(message.destination, "sandbox.echo");
  assert.throws(() => providerMessageFromRow({ ...row(), payload_hash: "0".repeat(64) }), (error: unknown) => error instanceof ProviderContractError && error.code === "PROVIDER_PAYLOAD_HASH_MISMATCH");
  const adapter = new SandboxEchoProviderAdapter();
  const prepared = parsePreparedProviderDispatch(await adapter.prepare(message), message, adapter);
  assert.equal(prepared.sourcePayloadHash, message.payloadHash);
  assert.equal(prepared.originatingEnvelopeRef, message.originatingEnvelopeRef);
  assert.throws(() => parsePreparedProviderDispatch({ ...prepared, surplus: true }, message, adapter), /missing or surplus/);
  const missing: Record<string, unknown> = { ...prepared };
  delete missing.sourcePayloadHash;
  assert.throws(() => parsePreparedProviderDispatch(missing, message, adapter), /missing or surplus/);
  assert.throws(() => parsePreparedProviderDispatch({ ...prepared, contractVersion: "luzione-prepared-provider-dispatch/v2" }, message, adapter), /unsupported/);
  assert.throws(() => parsePreparedProviderDispatch({ ...prepared, payload: { scenario: "different" } }, message, adapter), /payload digest/);
  assert.throws(() => parsePreparedProviderDispatch({ ...prepared, providerRequestRef: ` ${prepared.providerRequestRef}` }, message, adapter), /bounded non-empty/);
  assert.throws(() => providerMessageFromRow({ ...row(), destination: `sandbox.${"a".repeat(190)}` }), /bounded non-empty/);
});

test("worker durably starts before acknowledgement and reconciles ambiguous outcomes", async () => {
  const store = new FakeStore();
  store.deliveries = [row("matched"), row("ambiguous")];
  const runtime = new ProviderWorkerRuntime(store, new ProviderAdapterRegistry([new SandboxEchoProviderAdapter()]), () => true, admitted());
  const delivery = await runtime.runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(delivery.claimed, 2);
  assert.deepEqual(store.calls.map((call) => call.method), ["started", "acknowledged", "started", "failed"]);
  assert.equal(store.calls[3].input.failureClass, "AMBIGUOUS_AFTER_ACK");
  store.calls = [];
  store.reconciliations = [{ ...row("ambiguous"), reconciliation_id: "reconcile-proof" }];
  const reconciliation = await runtime.runReconciliationBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(reconciliation.outcomes[0].result, "MATCHED");
  assert.equal(store.calls[0].input.observedObjectVersion, "order:proof:v1");
  assert.equal(store.calls[0].input.sourceReadbackRef, `sandbox-readback:provider-ambiguous:${sha256({ scenario: "ambiguous" })}`);
});

test("worker fails closed for disabled and unregistered destinations", async () => {
  const disabled = new FakeStore(); disabled.deliveries = [row()];
  await new ProviderWorkerRuntime(disabled, new ProviderAdapterRegistry([new SandboxEchoProviderAdapter()]), () => false).runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(disabled.calls[0].input.failureClass, "POLICY_BLOCKED");
  const missing = new FakeStore(); missing.deliveries = [{ ...row(), destination: "provider.missing" }];
  await new ProviderWorkerRuntime(missing, new ProviderAdapterRegistry([]), () => true).runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(missing.calls[0].input.failureClass, "PERMANENT");
});

test("P110 provider runtime adds restart-safe dispatch and reconciliation leases", () => {
  assert.match(migration, /add column if not exists dispatch_started_at/);
  assert.match(migration, /p110_reconciliation_lease_evidence_check/);
  assert.match(migration, /p110_reconciliation_due_claim_idx/);
  assert.match(storeSource, /result = 'STARTED'[\s\S]*WORKER_LOST_AFTER_DISPATCH[\s\S]*RECONCILIATION_REQUIRED/);
  assert.match(storeSource, /claimDueReconciliations[\s\S]*for update skip locked/);
  assert.match(storeSource, /READBACK_VERSION_MISMATCH/);
  assert.match(storeSource, /state = 'SOURCE_CONFIRMED'/);
  assert.match(storeSource, /attempt\.attempt_id=checkpoint\.originating_delivery_attempt_id/);
  assert.doesNotMatch(storeSource, /attempt\.attempt_number=outbox\.attempt_count/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from/);
});

test("provider operations route is authenticated, tenant-bound and read only", () => {
  assert.match(routeSource, /requireServiceActor\(request\.headers, "provider_operations\.read"\)/);
  assert.match(routeSource, /readProviderOperations\(\{ tenantId: actor\.tenantId \}\)/);
  assert.doesNotMatch(routeSource, /export async function POST/);
  assert.match(routeSource, /providerAdapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION/);
});
