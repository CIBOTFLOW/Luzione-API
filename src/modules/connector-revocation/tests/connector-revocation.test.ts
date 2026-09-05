import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildEffectExecutionEnvelope,
  decideEffectAdmission,
  effectBindingKey,
  killState,
} from "@/modules/effect-admission/contracts";
import { CORE_CONTRACT_VERSIONS, type ConnectorBindingV1 } from "@/modules/luzione-core-contracts/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  buildProviderExecutionContext,
  preparedProviderDispatchDigest,
  type ProviderMessage,
} from "@/modules/provider-runtime/contracts";
import {
  CONNECTOR_CREDENTIAL_HANDLE_VERSION,
  CONNECTOR_REVOCATION_DESTINATION,
  CONNECTOR_REVOCATION_EMULATOR_BINDING,
  CONNECTOR_REVOCATION_EMULATOR_PROVIDER,
  CONNECTOR_REVOCATION_RECEIPT_VERSION,
  CONNECTOR_REVOCATION_REQUEST_VERSION,
  ConnectorRevocationContractError,
  assertRevocationTupleMatches,
  classifyRevocationOutcome,
  connectorRevocationPayloadDigest,
  issueConnectorRevocationReceipt,
  parseConnectorRevocationReceipt,
  parseConnectorRevocationRequest,
  revocationReservation,
  type ConnectorRevocationRequestV1,
} from "@/modules/connector-revocation/contracts";
import { ConnectorRevocationEmulatorAdapter } from "@/modules/connector-revocation/emulatorAdapter";

const binding: ConnectorBindingV1 = {
  bindingId: "10000000-0000-4000-8000-000000000001",
  consentRef: "consent:connector-proof",
  contractVersion: CORE_CONTRACT_VERSIONS.connectorBinding,
  credentialReference: "secret-ref:tenant-proof.google.primary",
  cursor: "cursor-proof",
  provider: "GOOGLE_WORKSPACE",
  revocation: { revokedAt: null, revocationRef: null },
  scopes: ["mail.metadata.read"],
  status: "BOUND",
  tenantId: "tenant-proof",
};

function request(overrides: Partial<Omit<ConnectorRevocationRequestV1, "payloadDigest">> = {}) {
  const body = {
    binding,
    contractVersion: CONNECTOR_REVOCATION_REQUEST_VERSION,
    credentialHandle: {
      contractVersion: CONNECTOR_CREDENTIAL_HANDLE_VERSION,
      reference: binding.credentialReference,
      version: "credential-generation:7",
    },
    expectedPriorReceiptId: null,
    operation: { kind: "REQUEST_REMOTE_REVOCATION" as const, scenario: "matched" as const },
    operationKey: "connector-revocation-proof-001",
    providerAccountRef: "provider-account:google:proof-001",
    ...overrides,
  };
  return { ...body, payloadDigest: connectorRevocationPayloadDigest(body) };
}

const killVersion = `kill:${"a".repeat(64)}`;

function receipt(overrides: Partial<Parameters<typeof issueConnectorRevocationReceipt>[0]> = {}) {
  const parsed = request();
  return issueConnectorRevocationReceipt({
    acknowledgement: { providerAcknowledgementRef: null, sourceReadbackRef: null },
    actor: { humanActorId: "user_human-proof", humanAuthenticationRef: "supabase-session:human-proof", requestActorClass: "service", requestActorId: "service:sultan-os" },
    binding: {
      bindingContractVersion: CORE_CONTRACT_VERSIONS.connectorBinding,
      bindingId: binding.bindingId,
      connectorProvider: binding.provider,
      credentialHandle: parsed.credentialHandle,
      providerAccountRef: parsed.providerAccountRef,
    },
    commandReceiptRef: "p110-command:connector-revocation-proof",
    containmentKillVersion: killVersion,
    localCredentialDisposition: "RETAINED",
    normalKillVersion: killVersion,
    operation: { key: parsed.operationKey, kind: parsed.operation.kind, payloadDigest: parsed.payloadDigest },
    priorReceiptId: null,
    reconciliation: { reconciliationRef: null, result: "NOT_ATTEMPTED" },
    recordedAt: "2026-09-05T13:00:00.000Z",
    recoveryState: "NORMAL",
    remoteFinality: "REQUESTED",
    tenantId: binding.tenantId,
    ...overrides,
  });
}

test("request strict parser binds ConnectorBinding/v1, provider account, credential version, operation and payload", () => {
  const parsed = parseConnectorRevocationRequest(request());
  assert.equal(parsed.contractVersion, CONNECTOR_REVOCATION_REQUEST_VERSION);
  assert.equal(parsed.binding.contractVersion, CORE_CONTRACT_VERSIONS.connectorBinding);
  assert.equal(parsed.credentialHandle.reference, binding.credentialReference);
  assert.equal(parsed.credentialHandle.version, "credential-generation:7");
  assert.deepEqual(parseConnectorRevocationRequest(parsed), parsed);
  assert.throws(() => parseConnectorRevocationRequest({ ...parsed, surplus: true }), (error: unknown) => error instanceof ConnectorRevocationContractError && error.code === "FIELD_SET_MISMATCH");
  const missing: Record<string, unknown> = { ...parsed };
  delete missing.providerAccountRef;
  assert.throws(() => parseConnectorRevocationRequest(missing), /exact v1 contract/);
  assert.throws(() => parseConnectorRevocationRequest({ ...parsed, contractVersion: "ConnectorRevocationRequest/v2" }), /must be ConnectorRevocationRequest\/v1/);
  assert.throws(() => parseConnectorRevocationRequest({ ...parsed, payloadDigest: "b".repeat(64) }), (error: unknown) => error instanceof ConnectorRevocationContractError && error.code === "PAYLOAD_DIGEST_MISMATCH");
});

test("request rejects client drift in binding, tenant account, credential generation and recovery lineage", () => {
  const mismatchedHandle = request({ credentialHandle: { contractVersion: CONNECTOR_CREDENTIAL_HANDLE_VERSION, reference: "secret-ref:tenant-proof.google.other", version: "credential-generation:7" } });
  assert.throws(() => parseConnectorRevocationRequest(mismatchedHandle), (error: unknown) => error instanceof ConnectorRevocationContractError && error.code === "CREDENTIAL_HANDLE_MISMATCH");
  const draftBinding = { ...binding, status: "DRAFT" as const };
  assert.throws(() => parseConnectorRevocationRequest(request({ binding: draftBinding })), /BOUND ConnectorBinding/);
  const forwardWithoutPrior = request({ operation: { kind: "AUTHORIZE_FORWARD_RECOVERY_ERASURE", scenario: "source_unavailable" } });
  assert.throws(() => parseConnectorRevocationRequest(forwardWithoutPrior), (error: unknown) => error instanceof ConnectorRevocationContractError && error.code === "PRIOR_RECEIPT_REQUIRED");
  const initialWithPrior = request({ expectedPriorReceiptId: `connector-revocation-receipt:${"c".repeat(64)}` });
  assert.throws(() => parseConnectorRevocationRequest(initialWithPrior), (error: unknown) => error instanceof ConnectorRevocationContractError && error.code === "PRIOR_RECEIPT_DENIED");
});

test("P110 reservation is tenant plus operation-key stable and changed payload conflicts at the kernel", () => {
  const first = request();
  const changed = request({ providerAccountRef: "provider-account:google:proof-002" });
  assert.equal(revocationReservation(binding.tenantId, first).commandId, revocationReservation(binding.tenantId, changed).commandId);
  assert.equal(revocationReservation(binding.tenantId, first).idempotencyKey, revocationReservation(binding.tenantId, changed).idempotencyKey);
  assert.notEqual(revocationReservation(binding.tenantId, first).objectVersion, revocationReservation(binding.tenantId, changed).objectVersion);
  assert.notEqual(first.payloadDigest, changed.payloadDigest);
  assert.notEqual(revocationReservation("tenant-other", first).idempotencyKey, revocationReservation(binding.tenantId, first).idempotencyKey);
});

test("receipt digest is exact and REVOKED requires source confirmation", () => {
  const initial = receipt();
  assert.equal(initial.contractVersion, CONNECTOR_REVOCATION_RECEIPT_VERSION);
  assert.equal(initial.zeroEffect, true);
  assert.deepEqual(parseConnectorRevocationReceipt(initial), initial);
  assert.throws(() => parseConnectorRevocationReceipt({ ...initial, receiptDigest: "b".repeat(64) }), /digest/);
  assert.throws(() => issueConnectorRevocationReceipt({ ...initial, remoteFinality: "REVOKED" }), /REVOKED requires/);
  const confirmed = issueConnectorRevocationReceipt({
    ...initial,
    acknowledgement: { providerAcknowledgementRef: "provider-ack:proof", sourceReadbackRef: "provider-readback:proof" },
    priorReceiptId: initial.receiptId,
    reconciliation: { reconciliationRef: "reconcile:proof", result: "MATCHED" },
    remoteFinality: "REVOKED",
  });
  assert.equal(confirmed.remoteFinality, "REVOKED");
});

test("provider ACK never grants erasure and genuine-human forward recovery does not claim remote finality", () => {
  const initial = receipt();
  assert.throws(() => issueConnectorRevocationReceipt({
    ...initial,
    acknowledgement: { providerAcknowledgementRef: "provider-ack:proof", sourceReadbackRef: null },
    localCredentialDisposition: "ERASURE_AUTHORIZED_NO_EFFECT",
    remoteFinality: "ACKNOWLEDGED",
  }), (error: unknown) => error instanceof ConnectorRevocationContractError && error.code === "ERASURE_AUTHORITY_MISSING");
  const failed = issueConnectorRevocationReceipt({ ...initial, priorReceiptId: initial.receiptId, remoteFinality: "AMBIGUITY_EXHAUSTED" });
  const forward = issueConnectorRevocationReceipt({
    ...failed,
    localCredentialDisposition: "ERASURE_AUTHORIZED_NO_EFFECT",
    operation: { ...failed.operation, kind: "AUTHORIZE_FORWARD_RECOVERY_ERASURE" },
    priorReceiptId: failed.receiptId,
    recoveryState: "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT",
  });
  assert.equal(forward.remoteFinality, "AMBIGUITY_EXHAUSTED");
  assert.equal(forward.localCredentialDisposition, "ERASURE_AUTHORIZED_NO_EFFECT");
  assert.equal(forward.zeroEffect, true);
});

test("forward recovery tuple rejects tenant, account, binding and credential-version drift", () => {
  const prior = receipt({ remoteFinality: "REMOTE_REVOKE_FAILED" });
  assert.doesNotThrow(() => assertRevocationTupleMatches(prior, binding.tenantId, request()));
  assert.throws(() => assertRevocationTupleMatches(prior, "tenant-other", request()), /cannot change tenant/);
  assert.throws(() => assertRevocationTupleMatches(prior, binding.tenantId, request({ providerAccountRef: "provider-account:other" })), /provider account/);
  assert.throws(() => assertRevocationTupleMatches(prior, binding.tenantId, request({ credentialHandle: { ...request().credentialHandle, version: "credential-generation:8" } })), /credential-handle version/);
  const otherBinding = { ...binding, bindingId: "20000000-0000-4000-8000-000000000002" };
  assert.throws(() => assertRevocationTupleMatches(prior, binding.tenantId, request({ binding: otherBinding })), /cannot change tenant/);
});

test("outcome classification keeps ACK, pending, unavailable, exhausted, failure and exact source finality distinct", () => {
  const base = { lastErrorCode: null, providerAcknowledgementRef: null, reconciliationRef: null, reconciliationResult: null, sourceReadbackRef: null, state: "PENDING" };
  assert.equal(classifyRevocationOutcome({ ...base, providerAcknowledgementRef: "ack:proof", state: "PROVIDER_ACKNOWLEDGED" }).remoteFinality, "ACKNOWLEDGED");
  assert.equal(classifyRevocationOutcome({ ...base, providerAcknowledgementRef: "ack:proof", reconciliationRef: "reconcile:proof", reconciliationResult: "PENDING", state: "PROVIDER_ACKNOWLEDGED" }).remoteFinality, "RECONCILING");
  assert.equal(classifyRevocationOutcome({ ...base, lastErrorCode: "CONNECTOR_REVOCATION_SOURCE_UNAVAILABLE" }).remoteFinality, "SOURCE_UNAVAILABLE");
  assert.equal(classifyRevocationOutcome({ ...base, lastErrorCode: "RECONCILIATION_BUDGET_EXHAUSTED", reconciliationRef: "reconcile:proof", state: "BLOCKED" }).remoteFinality, "AMBIGUITY_EXHAUSTED");
  assert.equal(classifyRevocationOutcome({ ...base, lastErrorCode: "CONNECTOR_REMOTE_REVOKE_FAILED", state: "DEAD_LETTERED" }).remoteFinality, "REMOTE_REVOKE_FAILED");
  assert.equal(classifyRevocationOutcome({ ...base, providerAcknowledgementRef: "ack:proof", reconciliationRef: "reconcile:proof", reconciliationResult: "MATCHED", sourceReadbackRef: "readback:proof", state: "SOURCE_CONFIRMED" }).remoteFinality, "REVOKED");
  assert.equal(classifyRevocationOutcome({ ...base, reconciliationResult: "VERSION_MISMATCH", state: "BLOCKED" }).remoteFinality, "VERSION_MISMATCH");
});

test("only the credential-free revocation emulator prepares and executes the P110 NO_EFFECT packet", async () => {
  const adapter = new ConnectorRevocationEmulatorAdapter();
  const sourcePayload = { operation: "REQUEST_REMOTE_REVOCATION", scenario: "matched" };
  const message: ProviderMessage = {
    actor: { actorId: "service:sultan-os", actorType: "service" },
    authorizationRef: "supabase-session:human-proof",
    destination: CONNECTOR_REVOCATION_DESTINATION,
    effectClass: "NO_EFFECT",
    expectedObjectVersion: "ABSENT",
    idempotencyKey: "connector-revocation:proof",
    objectId: binding.bindingId,
    objectType: "connector_revocation",
    originatingEnvelopeRef: `p110-origin:${"b".repeat(64)}`,
    outboxMessageId: "outbox:proof",
    payload: sourcePayload,
    payloadHash: sha256(sourcePayload),
    receiptId: "receipt:proof",
    resultingObjectVersion: "connector-revocation:proof",
    tenantId: binding.tenantId,
  };
  const prepared = await adapter.prepare(message);
  assert.equal(adapter.mode, "SANDBOX");
  assert.equal(adapter.effectClass, "NO_EFFECT");
  assert.equal(adapter.credentialBindingId, CONNECTOR_REVOCATION_EMULATOR_BINDING);
  assert.equal(adapter.provider, CONNECTOR_REVOCATION_EMULATOR_PROVIDER);
  const common = {
    actor: message.actor,
    authorityRef: message.authorizationRef as string,
    credentialBindingId: adapter.credentialBindingId,
    destination: adapter.destination,
    effectClass: adapter.effectClass,
    operationKey: message.idempotencyKey,
    originatingEnvelopeRef: message.originatingEnvelopeRef,
    preparedDispatchDigest: preparedProviderDispatchDigest(prepared),
    provider: adapter.provider,
    sourcePayloadHash: message.payloadHash,
    tenantId: message.tenantId,
  };
  const policy = { admittedBindings: new Set([effectBindingKey(common)]), enabled: true };
  const claim = decideEffectAdmission({ ...common, checkpoint: "PROVIDER_CLAIM" }, killState([]), policy);
  const credential = decideEffectAdmission({ ...common, checkpoint: "PROVIDER_CREDENTIAL_RELEASE" }, killState([]), policy, claim);
  const final = decideEffectAdmission({ ...common, checkpoint: "PROVIDER_PRE_EXECUTE" }, killState([]), policy, credential);
  const envelope = buildEffectExecutionEnvelope({ ...common, checkpoint: "PROVIDER_PRE_EXECUTE" }, final);
  const release = await adapter.releaseCredential(prepared, credential);
  assert.equal(release.state, "NO_CREDENTIAL_REQUIRED");
  assert.equal((await adapter.execute(buildProviderExecutionContext(envelope, prepared))).state, "ACKNOWLEDGED");
});

test("schema, migration, routes and config preserve strict default-off append-only behavior", () => {
  const requestSchema = JSON.parse(readFileSync("contracts/connector-revocation/connector-revocation-request-v1.schema.json", "utf8"));
  const receiptSchema = JSON.parse(readFileSync("contracts/connector-revocation/connector-revocation-receipt-v1.schema.json", "utf8"));
  assert.equal(requestSchema.title, CONNECTOR_REVOCATION_REQUEST_VERSION);
  assert.equal(receiptSchema.title, CONNECTOR_REVOCATION_RECEIPT_VERSION);
  assert.equal(requestSchema.additionalProperties, false);
  assert.equal(receiptSchema.additionalProperties, false);
  assert.deepEqual([...requestSchema.required].sort(), Object.keys(request()).sort());
  assert.deepEqual([...receiptSchema.required].sort(), Object.keys(receipt()).sort());
  const migration = readFileSync("supabase/migrations/20260905130000_connector_revocation_receipts.sql", "utf8");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /append-only/);
  assert.match(migration, /revoke all on table public\.connector_revocation_receipts from service_role/);
  assert.match(migration, /remote_finality <> 'REVOKED'/);
  const config = readFileSync("src/lib/api/config.ts", "utf8");
  assert.match(config, /LUZIONE_API_CONNECTOR_REVOCATIONS_ENABLED === "true"/);
  assert.match(config, /sandbox\.connector-revocation/);
  const post = readFileSync("src/app/api/v1/connectors/revocations/route.ts", "utf8");
  const get = readFileSync("src/app/api/v1/connectors/revocations/[receiptId]/route.ts", "utf8");
  assert.match(post, /requireHumanApprovalSubject/);
  assert.match(post, /requireServiceActor/);
  assert.match(get, /readById/);
});
