import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EFFECT_ADMISSION_CONTRACT_VERSION,
  configuredEffectAdmissionPolicy,
  decideEffectAdmission,
  effectBindingKey,
  killState,
  parseEffectAdmissionDecision,
  type EffectAdmissionDecision,
  type EffectAdmissionSubject,
} from "@/modules/effect-admission/contracts";
import type { EffectAdmissionGate } from "@/modules/effect-admission/gate";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { PreparedProviderRequest, ProviderAdapter, ProviderMessage } from "@/modules/provider-runtime/contracts";
import { PROVIDER_ADAPTER_CONTRACT_VERSION } from "@/modules/provider-runtime/contracts";
import { ProviderAdapterRegistry } from "@/modules/provider-runtime/registry";
import { ProviderWorkerRuntime, type ProviderWorkerStore } from "@/modules/provider-runtime/runtime";

const subject: EffectAdmissionSubject = {
  actor: { actorId: "service:sultan-os", actorType: "service" },
  authorityRef: "authority:proof-001",
  checkpoint: "PROVIDER_CLAIM",
  credentialBindingId: "credential-binding:proof/v1",
  destination: "provider.proof",
  effectClass: "EXTERNAL_EFFECT",
  operationKey: "operation:proof-001",
  payloadHash: "a".repeat(64),
  provider: "proof-provider",
  tenantId: "tenant-proof",
};

const policy = { enabled: true, admittedBindings: new Set([effectBindingKey(subject)]) };

test("effect admission is strict, deterministic and default-off", () => {
  const empty = killState([]);
  const disabled = decideEffectAdmission(subject, empty, { enabled: false, admittedBindings: policy.admittedBindings });
  assert.equal(disabled.denialCode, "ADMISSION_DISABLED");
  assert.equal(disabled.dispatchAuthorized, false);
  assert.equal(disabled.noEffectOnly, true);
  const configuredDisabled = configuredEffectAdmissionPolicy({
    DATABASE_URL: "postgres://synthetic",
    LUZIONE_API_EFFECT_ADMISSION_BINDINGS: effectBindingKey(subject),
    LUZIONE_API_EFFECT_ADMISSION_ENABLED: "false",
    LUZIONE_API_MUTATIONS_ENABLED: "true",
    LUZIONE_API_SERVICE_TOKEN: "synthetic",
  });
  assert.equal(configuredDisabled.enabled, false);
  const admitted = decideEffectAdmission(subject, empty, policy);
  assert.equal(admitted.contractVersion, EFFECT_ADMISSION_CONTRACT_VERSION);
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.dispatchAuthorized, false);
  assert.deepEqual(admitted, decideEffectAdmission(subject, empty, policy));
  assert.deepEqual(parseEffectAdmissionDecision(admitted), admitted);
  assert.throws(() => parseEffectAdmissionDecision({ ...admitted, surplus: true }), /exact v1 contract/);
  const missing: Record<string, unknown> = { ...admitted };
  delete missing.authorityRef;
  assert.throws(() => parseEffectAdmissionDecision(missing), /exact v1 contract/);
  assert.throws(() => parseEffectAdmissionDecision({ ...admitted, contractVersion: "luzione-effect-admission/v2" }), /unsupported/);
  assert.throws(() => parseEffectAdmissionDecision({ ...admitted, payloadHash: "b".repeat(64) }), /bindingDigest is invalid/);
});

test("exact tenant actor provider destination and opaque credential tuple is indivisible", () => {
  const variants: EffectAdmissionSubject[] = [
    { ...subject, tenantId: "tenant-other" },
    { ...subject, actor: { ...subject.actor, actorId: "service:other" } },
    { ...subject, provider: "other-provider" },
    { ...subject, destination: "provider.other" },
    { ...subject, credentialBindingId: "credential-binding:other/v1" },
  ];
  for (const variant of variants) {
    assert.equal(decideEffectAdmission(variant, killState([]), policy).denialCode, "CREDENTIAL_BINDING_NOT_ADMITTED");
  }
  assert.equal(decideEffectAdmission({ ...subject, actor: { actorId: "agent.sultan", actorType: "agent" } }, killState([]), {
    ...policy,
    admittedBindings: new Set([effectBindingKey({ ...subject, actor: { actorId: "agent.sultan", actorType: "agent" } })]),
  }).denialCode, "ACTOR_NOT_AUTHORIZED");
});

test("fresh decisions reject changed payload and active kill state", () => {
  const prior = decideEffectAdmission(subject, killState([]), policy);
  assert.equal(decideEffectAdmission({ ...subject, checkpoint: "PROVIDER_PRE_DISPATCH", payloadHash: "b".repeat(64) }, killState([]), policy, prior).denialCode, "BINDING_CHANGED");
  const killed = killState([{ active: true, activatedAt: "2026-09-05T00:00:00Z", deactivatedAt: null, scopeRef: subject.destination, scopeType: "DESTINATION", switchId: "kill-proof" }]);
  const decision = decideEffectAdmission({ ...subject, checkpoint: "PROVIDER_PRE_DISPATCH" }, killed, policy, prior);
  assert.equal(decision.denialCode, "ACTIVE_KILL_SWITCH");
  assert.notEqual(decision.killVersion, prior.killVersion);
  assert.equal(decision.dispatchAuthorized, false);
});

class SequenceGate implements EffectAdmissionGate {
  calls: EffectAdmissionSubject[] = [];
  constructor(private readonly states: ReturnType<typeof killState>[]) {}
  async decide(next: EffectAdmissionSubject, prior: EffectAdmissionDecision | null = null) {
    this.calls.push(next);
    return decideEffectAdmission(next, this.states[Math.min(this.calls.length - 1, this.states.length - 1)], policyFor(next), prior);
  }
}

class ProofAdapter implements ProviderAdapter {
  readonly credentialBindingId = "credential-binding:proof/v1";
  readonly destination = "provider.proof";
  readonly mode = "SANDBOX" as const;
  readonly provider = "proof-provider";
  executes = 0;
  reconciles = 0;
  async prepare(message: ProviderMessage): Promise<PreparedProviderRequest> {
    if (!message.effectAdmissionRef) throw new Error("admission missing");
    return { contractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION, credentialBindingId: this.credentialBindingId, destination: this.destination, effectAdmissionRef: message.effectAdmissionRef, idempotencyKey: message.idempotencyKey, objectRef: `${message.objectType}:${message.objectId}`, payload: message.payload, payloadHash: message.payloadHash, provider: this.provider, providerRequestRef: `proof:${message.idempotencyKey}`, resultingObjectVersion: message.resultingObjectVersion, tenantId: message.tenantId };
  }
  async execute() { this.executes += 1; return { errorCode: "PROOF_ACK_AMBIGUOUS", failureClass: "AMBIGUOUS_AFTER_ACK" as const, safeSummary: "Synthetic acknowledgement intentionally ambiguous.", state: "FAILED" as const }; }
  async reconcile(request: PreparedProviderRequest) { this.reconciles += 1; return { observedObjectVersion: request.resultingObjectVersion, result: "MATCHED" as const, sourceReadbackRef: `proof-readback:${request.payloadHash}` }; }
  async observe(request: PreparedProviderRequest) { return this.reconcile(request); }
  async compensate() { return { reason: "NO_EFFECT", state: "NOT_SUPPORTED" as const }; }
}

class ProofStore implements ProviderWorkerStore {
  row = providerRow();
  delivery = true;
  reconciliation = false;
  calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  async claimDueOutbox() { if (!this.delivery) return []; this.delivery = false; return [this.row]; }
  async claimDueReconciliations() { if (!this.reconciliation) return []; this.reconciliation = false; return [{ ...this.row, reconciliation_id: "reconcile-proof" }]; }
  async readClaimedOutboxForAdmission() { return this.row; }
  async readClaimedReconciliationForAdmission() { return { ...this.row, reconciliation_id: "reconcile-proof" }; }
  async completeClaimedReconciliation(input: Record<string, unknown>) { this.calls.push({ method: "complete", input }); return input; }
  async recordDispatchStarted(input: Record<string, unknown>) { this.calls.push({ method: "started", input }); return input; }
  async recordOutboxFailure(input: Record<string, unknown>) { this.calls.push({ method: "failed", input }); this.reconciliation = input.failureClass === "AMBIGUOUS_AFTER_ACK"; return { state: this.reconciliation ? "RECONCILIATION_REQUIRED" : "DEAD_LETTERED" }; }
  async recordProviderAcknowledgement(input: Record<string, unknown>) { this.calls.push({ method: "ack", input }); return input; }
}

test("kill inserted between claim and dispatch denies before adapter execution", async () => {
  const active = killState([{ active: true, activatedAt: "2026-09-05T00:00:00Z", deactivatedAt: null, scopeRef: "provider.proof", scopeType: "DESTINATION", switchId: "kill-race" }]);
  const gate = new SequenceGate([killState([]), killState([]), active]);
  const adapter = new ProofAdapter();
  const store = new ProofStore();
  const outcome = await new ProviderWorkerRuntime(store, new ProviderAdapterRegistry([adapter]), () => true, gate).runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(outcome.outcomes[0].state, "DEAD_LETTERED");
  assert.equal(adapter.executes, 0);
  assert.deepEqual(gate.calls.map((call) => call.checkpoint), ["PROVIDER_CLAIM", "PROVIDER_PRE_CREDENTIAL", "PROVIDER_PRE_DISPATCH"]);
  assert.match(String(store.calls[0].input.errorCode), /ACTIVE_KILL_SWITCH/);
});

test("changed durable payload and ambiguous acknowledgement reconcile without redispatch", async () => {
  const adapter = new ProofAdapter();
  const changedStore = new ProofStore();
  let reads = 0;
  changedStore.readClaimedOutboxForAdmission = async () => {
    reads += 1;
    if (reads < 3) return changedStore.row;
    const payload = { scenario: "changed" };
    return { ...changedStore.row, payload, payload_hash: sha256(payload) };
  };
  const changed = await new ProviderWorkerRuntime(changedStore, new ProviderAdapterRegistry([adapter]), () => true, new SequenceGate([killState([])])).runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(changed.outcomes[0].state, "DEAD_LETTERED");
  assert.equal(adapter.executes, 0);
  assert.match(String(changedStore.calls[0].input.errorCode), /BINDING_CHANGED/);

  const store = new ProofStore();
  const gate = new SequenceGate([killState([])]);
  const runtime = new ProviderWorkerRuntime(store, new ProviderAdapterRegistry([adapter]), () => true, gate);
  const delivery = await runtime.runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(delivery.outcomes[0].state, "RECONCILIATION_REQUIRED");
  store.reconciliation = true;
  const reconciliation = await runtime.runReconciliationBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(reconciliation.outcomes[0].result, "MATCHED");
  assert.equal(adapter.executes, 1);
  assert.equal(adapter.reconciles, 1);
  assert.equal(gate.calls.at(-1)?.checkpoint, "PROVIDER_RECONCILE");
});

test("schema, P110 evidence and opaque Gmail boundary remain mechanically aligned", () => {
  const schema = JSON.parse(readFileSync("contracts/effect-admission/luzione-effect-admission-v1.schema.json", "utf8"));
  assert.equal(schema.properties.contractVersion.const, EFFECT_ADMISSION_CONTRACT_VERSION);
  assert.equal(schema.additionalProperties, false);
  const migration = readFileSync("supabase/migrations/20260905090000_effect_admission_evidence.sql", "utf8");
  const rollback = readFileSync("scripts/validation/rollback-effect-admission-evidence.sql", "utf8");
  const gmail = readFileSync("src/modules/sultan-agent-gateway/gmailRfqCanaryAdapter.ts", "utf8");
  assert.match(migration, /effect_admission_ref[\s\S]*credential_binding_id/);
  assert.match(rollback, /drop column if exists effect_admission_contract_version/);
  assert.doesNotMatch(gmail, /GMAIL_SULTAN_RFQ_ACCESS_TOKEN|process\.env|NEXT_PUBLIC_/);
  assert.match(gmail, /resolveCredential[\s\S]*credentialBindingId[\s\S]*effectAdmissionRef/);
});

function providerRow() {
  const payload = { scenario: "ambiguous" };
  return {
    actor_id: "service:sultan-os",
    actor_type: "service",
    authorization_ref: "authority:proof-001",
    destination: "provider.proof",
    effect_class: "EXTERNAL_EFFECT",
    expected_object_version: "object:proof:v0",
    idempotency_key: "operation:proof-001",
    outbox_message_id: "outbox-proof",
    payload,
    payload_hash: sha256(payload),
    receipt_id: "receipt-proof",
    resulting_object_version: "object:proof:v1",
    target_object_id: "proof",
    target_object_type: "proof_object",
    tenant_id: "tenant-proof",
  };
}

function policyFor(next: EffectAdmissionSubject) {
  return { admittedBindings: new Set([effectBindingKey(next)]), enabled: true };
}
