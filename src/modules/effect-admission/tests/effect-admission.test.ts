import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EFFECT_ADMISSION_CONTRACT_VERSION,
  EFFECT_EXECUTION_ENVELOPE_VERSION,
  buildEffectExecutionEnvelope,
  configuredEffectAdmissionPolicy,
  decideEffectAdmission,
  effectBindingKey,
  killState,
  parseEffectAdmissionDecision,
  parseEffectExecutionEnvelope,
  type EffectAdmissionDecision,
  type EffectAdmissionSubject,
} from "@/modules/effect-admission/contracts";
import type { EffectAdmissionGate } from "@/modules/effect-admission/gate";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  PREPARED_PROVIDER_DISPATCH_VERSION,
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  buildProviderCredentialRelease,
  parsePreparedProviderDispatch,
  parseProviderCredentialRelease,
  preparedProviderDispatchDigest,
  providerMessageFromRow,
  type PreparedProviderDispatch,
  type ProviderAdapter,
  type ProviderExecutionContext,
  type ProviderMessage,
} from "@/modules/provider-runtime/contracts";
import { ProviderAdapterRegistry } from "@/modules/provider-runtime/registry";
import { ProviderWorkerRuntime, type ProviderWorkerStore } from "@/modules/provider-runtime/runtime";

const subject: EffectAdmissionSubject = {
  actor: { actorId: "service:sultan-os", actorType: "service" },
  authorityRef: "authority:proof-001",
  checkpoint: "PROVIDER_CLAIM",
  credentialBindingId: "credential-binding:proof/v1",
  destination: "provider.proof",
  effectClass: "NO_EFFECT",
  operationKey: "operation:proof-001",
  originatingEnvelopeRef: `p110-origin:${"b".repeat(64)}`,
  preparedDispatchDigest: "c".repeat(64),
  provider: "proof-provider",
  sourcePayloadHash: "a".repeat(64),
  tenantId: "tenant-proof",
};

const policy = { enabled: true, admittedBindings: new Set([effectBindingKey(subject)]) };

test("v2 admission is exact, deterministic, default-off and replaces noEffectOnly", () => {
  const disabled = decideEffectAdmission(subject, killState([]), { enabled: false, admittedBindings: policy.admittedBindings });
  assert.equal(disabled.denialCode, "ADMISSION_DISABLED");
  assert.equal(disabled.executeAuthorized, false);
  assert.equal(disabled.effectAuthority, "SANDBOX_ONLY");
  assert.equal("noEffectOnly" in disabled, false);
  assert.equal(configuredEffectAdmissionPolicy({
    DATABASE_URL: "postgres://synthetic",
    LUZIONE_API_EFFECT_ADMISSION_BINDINGS: effectBindingKey(subject),
    LUZIONE_API_EFFECT_ADMISSION_ENABLED: "false",
    LUZIONE_API_MUTATIONS_ENABLED: "true",
    LUZIONE_API_SERVICE_TOKEN: "synthetic",
  }).enabled, false);
  const admitted = decideEffectAdmission(subject, killState([]), policy);
  assert.equal(admitted.contractVersion, EFFECT_ADMISSION_CONTRACT_VERSION);
  assert.equal(admitted.admitted, true);
  assert.deepEqual(parseEffectAdmissionDecision(admitted), admitted);
  assert.throws(() => parseEffectAdmissionDecision({ ...admitted, surplus: true }), /exact contract/);
  const missing: Record<string, unknown> = { ...admitted };
  delete missing.authorityRef;
  assert.throws(() => parseEffectAdmissionDecision(missing), /exact contract/);
  assert.throws(() => parseEffectAdmissionDecision({ ...admitted, contractVersion: "luzione-effect-admission/v1" }), /unsupported/);
  assert.throws(() => parseEffectAdmissionDecision({ ...admitted, sourcePayloadHash: "d".repeat(64) }), /execution identity|bind/i);
});

test("execution identity binds source, prepared dispatch and complete authority tuple", () => {
  const variants: EffectAdmissionSubject[] = [
    { ...subject, tenantId: "tenant-other" },
    { ...subject, actor: { ...subject.actor, actorId: "service:other" } },
    { ...subject, provider: "other-provider" },
    { ...subject, destination: "provider.other" },
    { ...subject, credentialBindingId: "credential-binding:other/v1" },
    { ...subject, authorityRef: "authority:other" },
    { ...subject, sourcePayloadHash: "d".repeat(64) },
    { ...subject, preparedDispatchDigest: "e".repeat(64) },
    { ...subject, originatingEnvelopeRef: `p110-origin:${"f".repeat(64)}` },
  ];
  for (const variant of variants) {
    const admittedVariant = decideEffectAdmission(variant, killState([]), {
      enabled: true,
      admittedBindings: new Set([effectBindingKey(variant)]),
    });
    assert.notEqual(admittedVariant.executionIdentity, decideEffectAdmission(subject, killState([]), policy).executionIdentity);
  }
  assert.equal(decideEffectAdmission({ ...subject, actor: { actorId: "agent.sultan", actorType: "agent" } }, killState([]), {
    ...policy,
    admittedBindings: new Set([effectBindingKey({ ...subject, actor: { actorId: "agent.sultan", actorType: "agent" } })]),
  }).denialCode, "ACTOR_NOT_AUTHORIZED");
});

test("claim, credential release and pre-execute require an exact chain and fresh kill", () => {
  const claim = decideEffectAdmission(subject, killState([]), policy);
  const credentialSubject = { ...subject, checkpoint: "PROVIDER_CREDENTIAL_RELEASE" as const };
  const missingPrior = decideEffectAdmission(credentialSubject, killState([]), policy);
  assert.equal(missingPrior.denialCode, "PRIOR_DECISION_REQUIRED");
  const credential = decideEffectAdmission(credentialSubject, killState([]), policy, claim);
  assert.equal(credential.credentialReleaseAuthorized, true);
  const changed = decideEffectAdmission({ ...credentialSubject, sourcePayloadHash: "d".repeat(64) }, killState([]), policy, claim);
  assert.equal(changed.denialCode, "BINDING_CHANGED");
  const killed = killState([{ active: true, activatedAt: "2026-09-05T00:00:00Z", deactivatedAt: null, scopeRef: subject.destination, scopeType: "DESTINATION", switchId: "kill-proof" }]);
  const final = decideEffectAdmission({ ...subject, checkpoint: "PROVIDER_PRE_EXECUTE" }, killed, policy, credential);
  assert.equal(final.denialCode, "ACTIVE_KILL_SWITCH");
  assert.equal(final.executeAuthorized, false);

  const executeDecision = decideEffectAdmission({ ...subject, checkpoint: "PROVIDER_PRE_EXECUTE" }, killState([]), policy, credential);
  const envelope = buildEffectExecutionEnvelope({ ...subject, checkpoint: "PROVIDER_PRE_EXECUTE" }, executeDecision);
  assert.equal(envelope.contractVersion, EFFECT_EXECUTION_ENVELOPE_VERSION);
  assert.deepEqual(parseEffectExecutionEnvelope(envelope), envelope);
  assert.throws(() => parseEffectExecutionEnvelope({ ...envelope, destination: "provider.other" }), /identity|digest/i);
  assert.throws(() => parseEffectExecutionEnvelope({ ...envelope, surplus: true }), /exact contract/);
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
  readonly contractVersion = PROVIDER_ADAPTER_CONTRACT_VERSION;
  readonly credentialBindingId = "credential-binding:proof/v1";
  readonly destination = "provider.proof";
  readonly effectClass = "NO_EFFECT" as const;
  readonly mode: "LIVE" | "SANDBOX";
  readonly provider = "proof-provider";
  executes = 0;
  reconciles = 0;
  credentialReleases = 0;
  constructor(mode: "LIVE" | "SANDBOX" = "SANDBOX") { this.mode = mode; }
  async prepare(message: ProviderMessage): Promise<PreparedProviderDispatch> {
    const payload = { ...message.payload };
    return {
      adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
      contractVersion: PREPARED_PROVIDER_DISPATCH_VERSION,
      credentialBindingId: this.credentialBindingId,
      destination: this.destination,
      effectClass: this.effectClass,
      idempotencyKey: message.idempotencyKey,
      objectRef: `${message.objectType}:${message.objectId}`,
      originatingEnvelopeRef: message.originatingEnvelopeRef,
      payload,
      payloadHash: sha256(payload),
      provider: this.provider,
      providerRequestRef: `proof:${message.idempotencyKey}`,
      resultingObjectVersion: message.resultingObjectVersion,
      sourcePayloadHash: message.payloadHash,
      tenantId: message.tenantId,
    };
  }
  async releaseCredential(prepared: PreparedProviderDispatch, decision: EffectAdmissionDecision) {
    this.credentialReleases += 1;
    return buildProviderCredentialRelease(prepared, decision, "NO_CREDENTIAL_REQUIRED");
  }
  async execute() { this.executes += 1; return { errorCode: "PROOF_ACK_AMBIGUOUS", failureClass: "AMBIGUOUS_AFTER_ACK" as const, safeSummary: "Synthetic acknowledgement intentionally ambiguous.", state: "FAILED" as const }; }
  async reconcile(context: ProviderExecutionContext) { this.reconciles += 1; return { observedObjectVersion: context.preparedDispatch.resultingObjectVersion, result: "MATCHED" as const, sourceReadbackRef: `proof-readback:${context.preparedDispatch.payloadHash}` }; }
  async observe(context: ProviderExecutionContext) { return this.reconcile(context); }
  async compensate() { return { reason: "NO_EFFECT", state: "NOT_SUPPORTED" as const }; }
}

class ProofStore implements ProviderWorkerStore {
  row = providerRow();
  delivery = true;
  reconciliation = false;
  calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  started: ProviderExecutionContext | null = null;
  async claimDueOutbox() { if (!this.delivery) return []; this.delivery = false; return [this.row]; }
  async claimDueReconciliations() { if (!this.reconciliation) return []; this.reconciliation = false; return [{ ...this.row, reconciliation_id: "reconcile-proof" }]; }
  async readClaimedOutboxForAdmission() { return this.row; }
  async readClaimedReconciliationForAdmission() {
    assert.ok(this.started);
    return {
      ...this.row,
      reconciliation_id: "reconcile-proof",
      effect_execution_envelope: this.started.executionEnvelope,
      effect_execution_envelope_ref: this.started.executionEnvelope.executionEnvelopeRef,
      effect_execution_identity: this.started.executionEnvelope.executionIdentity,
      originating_envelope_ref: this.started.executionEnvelope.originatingEnvelopeRef,
      prepared_dispatch_digest: this.started.executionEnvelope.preparedDispatchDigest,
    };
  }
  async completeClaimedReconciliation(input: Record<string, unknown>) { this.calls.push({ method: "complete", input }); return input; }
  async recordDispatchStarted(input: Parameters<ProviderWorkerStore["recordDispatchStarted"]>[0]) {
    this.started = input.effectExecutionContext;
    this.calls.push({ method: "started", input: input as unknown as Record<string, unknown> });
    return input;
  }
  async recordOutboxFailure(input: Record<string, unknown>) { this.calls.push({ method: "failed", input }); this.reconciliation = input.failureClass === "AMBIGUOUS_AFTER_ACK"; return { state: this.reconciliation ? "RECONCILIATION_REQUIRED" : "DEAD_LETTERED" }; }
  async recordProviderAcknowledgement(input: Record<string, unknown>) { this.calls.push({ method: "ack", input }); return input; }
}

test("credential release strictly binds the admitted prepared dispatch", async () => {
  const adapter = new ProofAdapter();
  const message = providerMessageFromRow(providerRow());
  const prepared = parsePreparedProviderDispatch(await adapter.prepare(message), message, adapter);
  const base = {
    actor: message.actor,
    authorityRef: message.authorizationRef!,
    credentialBindingId: adapter.credentialBindingId,
    destination: adapter.destination,
    effectClass: message.effectClass,
    operationKey: message.idempotencyKey,
    originatingEnvelopeRef: message.originatingEnvelopeRef,
    preparedDispatchDigest: preparedProviderDispatchDigest(prepared),
    provider: adapter.provider,
    sourcePayloadHash: message.payloadHash,
    tenantId: message.tenantId,
  };
  const exactPolicy = { enabled: true, admittedBindings: new Set([effectBindingKey(base)]) };
  const claim = decideEffectAdmission({ ...base, checkpoint: "PROVIDER_CLAIM" }, killState([]), exactPolicy);
  const credential = decideEffectAdmission({ ...base, checkpoint: "PROVIDER_CREDENTIAL_RELEASE" }, killState([]), exactPolicy, claim);
  const release = buildProviderCredentialRelease(prepared, credential, "NO_CREDENTIAL_REQUIRED");
  assert.deepEqual(parseProviderCredentialRelease(release, prepared, credential), release);
  assert.throws(() => parseProviderCredentialRelease({ ...release, surplus: true }, prepared, credential), /missing or surplus/);
  assert.throws(() => parseProviderCredentialRelease({ ...release, contractVersion: "luzione-provider-credential-release/v2" }, prepared, credential), /does not match/);
  assert.throws(() => parseProviderCredentialRelease({ ...release, executionIdentity: `effect-execution:${"0".repeat(64)}` }, prepared, credential), /does not match/);
});

test("kill inserted immediately before execute denies before STARTED and adapter execution", async () => {
  const active = killState([{ active: true, activatedAt: "2026-09-05T00:00:00Z", deactivatedAt: null, scopeRef: "provider.proof", scopeType: "DESTINATION", switchId: "kill-race" }]);
  const gate = new SequenceGate([killState([]), killState([]), active]);
  const adapter = new ProofAdapter();
  const store = new ProofStore();
  const outcome = await new ProviderWorkerRuntime(store, new ProviderAdapterRegistry([adapter]), () => true, gate).runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(outcome.outcomes[0].state, "DEAD_LETTERED");
  assert.equal(adapter.executes, 0);
  assert.equal(store.started, null);
  assert.deepEqual(gate.calls.map((call) => call.checkpoint), ["PROVIDER_CLAIM", "PROVIDER_CREDENTIAL_RELEASE", "PROVIDER_PRE_EXECUTE"]);
  assert.match(String(store.calls[0].input.errorCode), /ACTIVE_KILL_SWITCH/);
});

test("kill at credential release and live-adapter registration both fail before credential access", async () => {
  const active = killState([{ active: true, activatedAt: "2026-09-05T00:00:00Z", deactivatedAt: null, scopeRef: "provider.proof", scopeType: "DESTINATION", switchId: "kill-credential" }]);
  const adapter = new ProofAdapter();
  const store = new ProofStore();
  const killed = await new ProviderWorkerRuntime(store, new ProviderAdapterRegistry([adapter]), () => true, new SequenceGate([killState([]), active]))
    .runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(killed.outcomes[0].state, "DEAD_LETTERED");
  assert.equal(adapter.credentialReleases, 0);
  assert.equal(adapter.executes, 0);

  const live = new ProofAdapter("LIVE");
  const liveStore = new ProofStore();
  const blocked = await new ProviderWorkerRuntime(liveStore, new ProviderAdapterRegistry([live]), () => true, new SequenceGate([killState([])]))
    .runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(blocked.outcomes[0].state, "DEAD_LETTERED");
  assert.equal(live.credentialReleases, 0);
  assert.equal(live.executes, 0);
  assert.equal(liveStore.calls[0].input.errorCode, "PROVIDER_EFFECT_MODE_UNSUPPORTED");
});

test("changed durable payload is blocked and ambiguous acknowledgement reconciles from the originating envelope without redispatch", async () => {
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
  assert.equal((await runtime.runDeliveryBatch({ tenantId: "tenant-proof", workerId: "worker-proof" })).outcomes[0].state, "RECONCILIATION_REQUIRED");
  store.reconciliation = true;
  const reconciliation = await runtime.runReconciliationBatch({ tenantId: "tenant-proof", workerId: "worker-proof" });
  assert.equal(reconciliation.outcomes[0].result, "MATCHED");
  assert.equal(adapter.executes, 1);
  assert.equal(adapter.reconciles, 1);
  assert.equal(adapter.credentialReleases, 2);
  assert.equal(gate.calls.at(-1)?.checkpoint, "PROVIDER_RECONCILE");

  store.reconciliation = true;
  const stored = store.started!;
  store.started = { ...stored, executionEnvelope: { ...stored.executionEnvelope, destination: "provider.other" } };
  assert.equal((await runtime.runReconciliationBatch({ tenantId: "tenant-proof", workerId: "worker-proof" })).outcomes[0].result, "VERSION_MISMATCH");
  assert.equal(adapter.executes, 1);
});

test("schema, persistence and rollback surfaces are mechanically aligned", () => {
  const admissionSchema = JSON.parse(readFileSync("contracts/effect-admission/luzione-effect-admission-v2.schema.json", "utf8"));
  const envelopeSchema = JSON.parse(readFileSync("contracts/effect-admission/luzione-effect-execution-envelope-v1.schema.json", "utf8"));
  const preparedSchema = JSON.parse(readFileSync("contracts/effect-admission/luzione-prepared-provider-dispatch-v1.schema.json", "utf8"));
  const releaseSchema = JSON.parse(readFileSync("contracts/effect-admission/luzione-provider-credential-release-v1.schema.json", "utf8"));
  assert.equal(admissionSchema.properties.contractVersion.const, EFFECT_ADMISSION_CONTRACT_VERSION);
  assert.equal(envelopeSchema.properties.contractVersion.const, EFFECT_EXECUTION_ENVELOPE_VERSION);
  assert.equal(admissionSchema.additionalProperties, false);
  assert.equal(envelopeSchema.additionalProperties, false);
  assert.equal(preparedSchema.additionalProperties, false);
  assert.equal(releaseSchema.additionalProperties, false);
  const claim = decideEffectAdmission(subject, killState([]), policy);
  const credential = decideEffectAdmission({ ...subject, checkpoint: "PROVIDER_CREDENTIAL_RELEASE" }, killState([]), policy, claim);
  const final = decideEffectAdmission({ ...subject, checkpoint: "PROVIDER_PRE_EXECUTE" }, killState([]), policy, credential);
  const envelope = buildEffectExecutionEnvelope({ ...subject, checkpoint: "PROVIDER_PRE_EXECUTE" }, final);
  assert.deepEqual([...admissionSchema.required].sort(), Object.keys(claim).sort());
  assert.deepEqual([...envelopeSchema.required].sort(), Object.keys(envelope).sort());
  const migration = readFileSync("supabase/migrations/20260905120000_effect_admission_l1_correction.sql", "utf8");
  const rollback = readFileSync("scripts/validation/rollback-effect-admission-l1-correction.sql", "utf8");
  const gmail = readFileSync("src/modules/sultan-agent-gateway/gmailRfqCanaryAdapter.ts", "utf8");
  assert.match(migration, /effect_execution_envelope[\s\S]*originating_envelope_ref[\s\S]*prepared_dispatch_digest/);
  assert.match(migration, /provider_mode = 'SANDBOX'/);
  assert.match(rollback, /Rollback blocked: v2 provider execution-envelope evidence exists/);
  assert.doesNotMatch(gmail, /GMAIL_SULTAN_RFQ_ACCESS_TOKEN|process\.env|NEXT_PUBLIC_/);
  assert.match(gmail, /Historical v0\.2 canary adapter/);
});

function providerRow() {
  const payload = { scenario: "ambiguous" };
  return {
    actor_id: "service:sultan-os",
    actor_type: "service",
    authorization_ref: "authority:proof-001",
    destination: "provider.proof",
    effect_class: "NO_EFFECT",
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
