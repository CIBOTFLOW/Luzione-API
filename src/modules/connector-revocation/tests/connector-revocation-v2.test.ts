import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { killState } from "@/modules/effect-admission/contracts";
import { CORE_CONTRACT_VERSIONS, type ConnectorBindingV1 } from "@/modules/luzione-core-contracts/contracts";
import {
  CONNECTOR_CREDENTIAL_HANDLE_V2,
  CONNECTOR_REVOCATION_RECEIPT_V2,
  CONNECTOR_REVOCATION_V2_SCHEMA_RULES,
  ConnectorRevocationV2Error,
  assertRevocationTupleMatchesV2,
  assertSelectorMatchesCanonicalResolution,
  connectorRevocationRawBodyDigestV2,
  issueCanonicalConnectorBindingResolutionV1,
  issueConnectorCredentialHandleV2,
  issueConnectorRevocationReceiptV2,
  issueConnectorRevocationRequestV2,
  parseCanonicalConnectorBindingResolutionV1,
  parseConnectorCredentialHandleV2,
  parseConnectorRevocationRawBodyV2,
  parseConnectorRevocationReceiptV2,
  parseConnectorRevocationRequestV2,
  revocationReservationV2,
  type CanonicalConnectorBindingResolutionV1,
  type ConnectorRevocationRequestV2,
} from "@/modules/connector-revocation/v2/contracts";
import { RevocationPhaseKillGuardV2 } from "@/modules/connector-revocation/v2/killGuard";
import { SyntheticCanonicalConnectorBindingResolver, UnavailableCanonicalConnectorBindingResolver } from "@/modules/connector-revocation/v2/resolver";

const tenantId = "tenant-proof";
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
  tenantId,
};

const credentialHandle = issueConnectorCredentialHandleV2({
  bindingId: binding.bindingId,
  generation: 7,
  provider: binding.provider,
  providerAccountRef: "provider-account:google:proof-001",
  reference: binding.credentialReference,
  tenantId,
  version: "credential-version:7",
});

const resolution = issueCanonicalConnectorBindingResolutionV1({
  binding,
  bindingVersion: "binding-version:11",
  credentialHandle,
  current: true,
  destination: "sandbox.connector-revocation",
  ownerReadbackRef: "connector-binding-owner-readback:proof-001",
  providerAccountRef: credentialHandle.providerAccountRef,
  resolvedAt: "2026-09-05T07:00:00.000Z",
  tenantId,
});

function request(overrides: Partial<Omit<ConnectorRevocationRequestV2, "contractVersion" | "payloadDigest">> = {}) {
  return issueConnectorRevocationRequestV2({
    expectedPriorReceiptId: null,
    operation: { kind: "REQUEST_REMOTE_REVOCATION", scenario: "matched" },
    operationKey: "connector-revocation-v2-proof-001",
    selector: {
      bindingId: binding.bindingId,
      expectedBindingVersion: resolution.bindingVersion,
      expectedCredentialGeneration: credentialHandle.generation,
      expectedCredentialVersion: credentialHandle.version,
      expectedDestination: resolution.destination,
      expectedProvider: binding.provider,
      expectedProviderAccountRef: resolution.providerAccountRef,
    },
    ...overrides,
  });
}

const killVersion = `kill:${"a".repeat(64)}`;

function receipt(overrides: Partial<Parameters<typeof issueConnectorRevocationReceiptV2>[0]> = {}) {
  const parsed = request();
  return issueConnectorRevocationReceiptV2({
    acknowledgement: { providerAcknowledgementRef: null, sourceReadbackRef: null },
    actor: { humanActorId: "user_human-proof", humanAuthenticationRef: "supabase-session:human-proof", requestActorClass: "service", requestActorId: "service:sultan-os" },
    bindingResolution: resolution,
    commandReceiptRef: "p110-command:connector-proof",
    killEvidence: {
      accepted: { containmentKillVersion: killVersion, normalKillVersion: killVersion },
      beforeCredentialHold: null,
      beforeExecuteOrDisposition: null,
    },
    localCredentialDisposition: "RETAINED",
    operation: { key: parsed.operationKey, kind: parsed.operation.kind, payloadDigest: parsed.payloadDigest, selector: parsed.selector },
    priorReceiptId: null,
    reconciliation: { reconciliationRef: null, result: "NOT_ATTEMPTED" },
    recordedAt: "2026-09-05T07:01:00.000Z",
    recoveryState: "NORMAL",
    remoteFinality: "REQUESTED",
    tenantId,
    ...overrides,
  });
}

function expectCode(action: () => unknown, code: string) {
  assert.throws(action, (error: unknown) => error instanceof ConnectorRevocationV2Error && error.code === code);
}

test("v2 request carries selectors only and binds exact raw input", () => {
  const value = request();
  assert.deepEqual(parseConnectorRevocationRequestV2(value), value);
  assert.deepEqual(Object.keys(value).sort(), CONNECTOR_REVOCATION_V2_SCHEMA_RULES.requestRequired);
  assert.equal("binding" in value, false);
  assert.equal("credentialHandle" in value, false);
  const raw = JSON.stringify(value);
  const parsed = parseConnectorRevocationRawBodyV2(raw);
  assert.equal(parsed.request.payloadDigest, value.payloadDigest);
  assert.equal(parsed.rawBodyDigest, connectorRevocationRawBodyDigestV2(raw));
  assert.notEqual(parsed.rawBodyDigest, connectorRevocationRawBodyDigestV2(JSON.stringify(value, null, 2)));
  expectCode(() => parseConnectorRevocationRawBodyV2(` ${raw}`), "RAW_CANONICAL_COLLISION");
  expectCode(() => parseConnectorRevocationRequestV2({ ...value, binding }), "FIELD_SET_MISMATCH");
});

test("strict parser rejects whitespace normalization and raw-canonical collisions", () => {
  const value = request();
  expectCode(() => parseConnectorRevocationRequestV2({ ...value, operationKey: `${value.operationKey} ` }), "RAW_CANONICAL_COLLISION");
  expectCode(() => parseConnectorRevocationRequestV2({ ...value, selector: { ...value.selector, expectedDestination: ` ${value.selector.expectedDestination}` } }), "RAW_CANONICAL_COLLISION");
  expectCode(() => parseConnectorCredentialHandleV2({ ...credentialHandle, reference: `${credentialHandle.reference} ` }), "RAW_CANONICAL_COLLISION");
  expectCode(() => parseCanonicalConnectorBindingResolutionV1({ ...resolution, ownerReadbackRef: `${resolution.ownerReadbackRef}\n` }), "RAW_CANONICAL_COLLISION");
});

test("standalone credential handle and owner resolution are strict content-bound packets", () => {
  assert.equal(credentialHandle.contractVersion, CONNECTOR_CREDENTIAL_HANDLE_V2);
  assert.deepEqual(parseConnectorCredentialHandleV2(credentialHandle), credentialHandle);
  assert.deepEqual(parseCanonicalConnectorBindingResolutionV1(resolution), resolution);
  expectCode(() => parseConnectorCredentialHandleV2({ ...credentialHandle, generation: 8 }), "CREDENTIAL_HANDLE_DIGEST_MISMATCH");
  expectCode(() => parseCanonicalConnectorBindingResolutionV1({ ...resolution, providerAccountRef: "provider-account:google:fabricated" }), "BINDING_RESOLUTION_TUPLE_MISMATCH");
  expectCode(() => parseCanonicalConnectorBindingResolutionV1({ ...resolution, current: false }), "BINDING_RESOLUTION_INVALID");
  expectCode(() => parseCanonicalConnectorBindingResolutionV1({ ...resolution, binding: { ...binding, status: "DRAFT" } }), "BINDING_NOT_CURRENT_BOUND");
  expectCode(() => parseCanonicalConnectorBindingResolutionV1({ ...resolution, tenantId: "tenant-foreign" }), "BINDING_RESOLUTION_TUPLE_MISMATCH");
});

test("server owner resolver is fail-closed and synthetic resolver cannot fabricate current truth", async () => {
  await assert.rejects(
    () => new UnavailableCanonicalConnectorBindingResolver().resolveCurrent({ bindingId: binding.bindingId, tenantId }),
    (error: unknown) => error instanceof ConnectorRevocationV2Error && error.code === "CANONICAL_BINDING_SOURCE_UNAVAILABLE",
  );
  const resolver = new SyntheticCanonicalConnectorBindingResolver([resolution]);
  assert.equal((await resolver.resolveCurrent({ bindingId: binding.bindingId, tenantId }))?.resolutionDigest, resolution.resolutionDigest);
  assert.equal(await resolver.resolveCurrent({ bindingId: binding.bindingId, tenantId: "tenant-foreign" }), null);
  await assert.rejects(
    () => new SyntheticCanonicalConnectorBindingResolver([resolution, resolution]).resolveCurrent({ bindingId: binding.bindingId, tenantId }),
    (error: unknown) => error instanceof ConnectorRevocationV2Error && error.code === "CANONICAL_BINDING_FORK",
  );
});

test("every caller selector is checked against current same-tenant owner truth", () => {
  const base = request().selector;
  assert.doesNotThrow(() => assertSelectorMatchesCanonicalResolution(base, resolution, tenantId));
  const probes: Array<[keyof typeof base, unknown, string]> = [
    ["bindingId", "20000000-0000-4000-8000-000000000002", "BINDING_ID_DRIFT"],
    ["expectedBindingVersion", "binding-version:10", "BINDING_VERSION_DRIFT"],
    ["expectedProvider", "MICROSOFT_365", "PROVIDER_DRIFT"],
    ["expectedProviderAccountRef", "provider-account:google:stale", "PROVIDER_ACCOUNT_DRIFT"],
    ["expectedDestination", "sandbox.connector-other", "DESTINATION_DRIFT"],
    ["expectedCredentialGeneration", 6, "CREDENTIAL_GENERATION_DRIFT"],
    ["expectedCredentialVersion", "credential-version:6", "CREDENTIAL_VERSION_DRIFT"],
  ];
  for (const [field, value, code] of probes) {
    expectCode(() => assertSelectorMatchesCanonicalResolution({ ...base, [field]: value }, resolution, tenantId), code);
  }
  expectCode(() => assertSelectorMatchesCanonicalResolution(base, resolution, "tenant-foreign"), "CANONICAL_TENANT_MISMATCH");
});

test("reservation binds current owner resolution and changed replay content conflicts mechanically", () => {
  const original = request();
  const same = revocationReservationV2(tenantId, original, resolution);
  assert.deepEqual(revocationReservationV2(tenantId, original, resolution), same);
  const changedRequest = request({ operation: { kind: "REQUEST_REMOTE_REVOCATION", scenario: "failed" } });
  const { contractVersion: _contractVersion, resolutionDigest: _resolutionDigest, ...resolutionInput } = resolution;
  void _contractVersion;
  void _resolutionDigest;
  const changedOwner: CanonicalConnectorBindingResolutionV1 = issueCanonicalConnectorBindingResolutionV1({
    ...resolutionInput,
    bindingVersion: "binding-version:12",
  });
  assert.equal(revocationReservationV2(tenantId, changedRequest, resolution).idempotencyKey, same.idempotencyKey);
  assert.notEqual(revocationReservationV2(tenantId, changedRequest, resolution).objectVersion, same.objectVersion);
  assert.notEqual(revocationReservationV2(tenantId, original, changedOwner).objectVersion, same.objectVersion);
});

test("v2 receipt binds owner resolution, preserves retention and requires source proof for finality", () => {
  const requested = receipt();
  assert.equal(requested.contractVersion, CONNECTOR_REVOCATION_RECEIPT_V2);
  assert.deepEqual(parseConnectorRevocationReceiptV2(requested), requested);
  assert.equal(requested.localCredentialDisposition, "RETAINED");
  expectCode(() => parseConnectorRevocationReceiptV2({ ...requested, remoteFinality: "REVOKED" }), "REMOTE_FINALITY_UNPROVEN");
  expectCode(() => parseConnectorRevocationReceiptV2({ ...requested, tenantId: "tenant-foreign" }), "RECEIPT_OWNER_TUPLE_MISMATCH");
  const { contractVersion: _contractVersion, resolutionDigest: _resolutionDigest, ...resolutionInput } = resolution;
  void _contractVersion;
  void _resolutionDigest;
  const changedResolution = issueCanonicalConnectorBindingResolutionV1({
    ...resolutionInput,
    bindingVersion: "binding-version:12",
  });
  expectCode(() => assertRevocationTupleMatchesV2(requested, tenantId, request(), changedResolution), "REVOCATION_TUPLE_MISMATCH");
});

class SequenceKillReader {
  private calls = 0;
  constructor(private readonly states: ReturnType<typeof killState>[]) {}
  async read() {
    return this.states[Math.min(this.calls++, this.states.length - 1)];
  }
}

const activeKill = killState([{ active: true, activatedAt: "2026-09-05T07:00:00.000Z", deactivatedAt: null, scopeRef: "sandbox.connector-revocation", scopeType: "DESTINATION", switchId: "kill-proof" }]);

test("containment and normal kill are freshly read at acceptance, credential hold and execute", async () => {
  const open = killState([]);
  const guard = new RevocationPhaseKillGuardV2(new SequenceKillReader([open, open, open, open, open, open]), tenantId);
  await guard.accepted();
  await guard.recheckBeforeCredentialHold();
  await guard.recheckBeforeExecuteOrDisposition();
  assert.ok(guard.beforeCredentialHold);
  assert.ok(guard.beforeExecuteOrDisposition);
});

for (const [name, states, action] of [
  ["acceptance containment", [activeKill], (guard: RevocationPhaseKillGuardV2) => guard.accepted()],
  ["acceptance normal", [killState([]), activeKill], (guard: RevocationPhaseKillGuardV2) => guard.accepted()],
  ["credential containment", [killState([]), killState([]), activeKill], async (guard: RevocationPhaseKillGuardV2) => { await guard.accepted(); return guard.recheckBeforeCredentialHold(); }],
  ["credential normal", [killState([]), killState([]), killState([]), activeKill], async (guard: RevocationPhaseKillGuardV2) => { await guard.accepted(); return guard.recheckBeforeCredentialHold(); }],
  ["execute containment", [killState([]), killState([]), killState([]), killState([]), activeKill], async (guard: RevocationPhaseKillGuardV2) => { await guard.accepted(); await guard.recheckBeforeCredentialHold(); return guard.recheckBeforeExecuteOrDisposition(); }],
  ["execute normal", [killState([]), killState([]), killState([]), killState([]), killState([]), activeKill], async (guard: RevocationPhaseKillGuardV2) => { await guard.accepted(); await guard.recheckBeforeCredentialHold(); return guard.recheckBeforeExecuteOrDisposition(); }],
] as const) {
  test(`containment flip fails closed at ${name}`, async () => {
    const guard = new RevocationPhaseKillGuardV2(new SequenceKillReader([...states]), tenantId);
    await assert.rejects(() => action(guard), (error: unknown) => error instanceof ConnectorRevocationV2Error && error.code === "ACTIVE_KILL_SWITCH");
  });
}

test("JSON Schema required fields and parser rule source remain in parity", () => {
  const schemas = [
    ["contracts/connector-revocation/v2/connector-credential-handle-v2.schema.json", CONNECTOR_REVOCATION_V2_SCHEMA_RULES.credentialHandleRequired],
    ["contracts/connector-revocation/v2/connector-revocation-request-v2.schema.json", CONNECTOR_REVOCATION_V2_SCHEMA_RULES.requestRequired],
    ["contracts/connector-revocation/v2/connector-revocation-receipt-v2.schema.json", CONNECTOR_REVOCATION_V2_SCHEMA_RULES.receiptRequired],
  ] as const;
  for (const [path, required] of schemas) {
    const schema = JSON.parse(readFileSync(path, "utf8")) as { additionalProperties: boolean; required: string[] };
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), required);
  }
  assert.equal(CONNECTOR_REVOCATION_V2_SCHEMA_RULES.strictIdMaxLength, 190);
  assert.equal(CONNECTOR_REVOCATION_V2_SCHEMA_RULES.strictRawWhitespace, true);
});

test("migration and routes preserve append-only P110 authority and fail-closed owner resolution", () => {
  const migration = readFileSync("supabase/migrations/20260905150000_connector_revocation_l1_correction.sql", "utf8");
  const reverse = readFileSync("scripts/validation/rollback-connector-revocation-l1-correction-01.sql", "utf8");
  const route = readFileSync("src/app/api/v1/connectors/revocations/route.ts", "utf8");
  const service = readFileSync("src/modules/connector-revocation/v2/service.ts", "utf8");
  assert.match(migration, /ConnectorRevocationReceipt\/v2/);
  assert.match(reverse, /reverse blocked: ConnectorRevocationReceipt\/v2 evidence exists/);
  assert.match(route, /parseConnectorRevocationRawBodyV2/);
  assert.match(service, /UnavailableCanonicalConnectorBindingResolver/);
  assert.match(service, /PostgresAtomicCommandStore/);
  assert.doesNotMatch(service, /delete from public\.connector_revocation_receipts/i);
  const deliveryPayload = service.slice(service.indexOf("delivery: {"), service.indexOf("expectedObjectVersion:"));
  assert.doesNotMatch(deliveryPayload, /credentialHandle\.reference|credentialReference/);
});
