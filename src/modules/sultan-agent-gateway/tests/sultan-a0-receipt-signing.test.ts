import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { ApiActor } from "@/lib/api/actor";
import { canonicalJson, sha256 } from "@/modules/platform-guarantees/eventContract";
import { buildToolManifest, buildToolResult, type SultanToolCall } from "../contracts";
import { maybeSignA0Receipt, signA0ReceiptEnvelope } from "../a0ReceiptSigning";

const NOW = new Date("2026-10-30T09:26:00.000Z");
const KEY = Buffer.alloc(32, 13);
const NONCE = Buffer.alloc(16, 11);
const actor: ApiActor = {
  actorId: "service:sultan-os", actorType: "service", source: "vercel-oidc", tenantId: "luzione",
  capabilities: ["sultan.tool.invoke", "sultan.tool.manifest.read", "sultan.case.read"],
};
const caseRef = { caseId: "synthetic-case", caseType: "COMMERCIAL" as const, expectedVersion: "v7" };
const agent = { agentId: "agent.luzione.revenue-steward", agentVersion: "v1" };
const call: SultanToolCall = {
  contractVersion: "luzione-sultan-tool-call/v1",
  admissionReceiptId: "s5admit_" + "a".repeat(32),
  operationId: "synthetic-op", runId: "synthetic-run", toolCallId: "synthetic-call",
  toolId: "luzione.case_context.read", toolVersion: "v1", agent, caseRef,
  purpose: "sultan-shadow-case-read", arguments: {}, argumentsHash: sha256({}),
  contextRefs: [], controlEvidence: null,
};
function fixture() {
  const manifest = buildToolManifest({
    generatedAt: NOW.toISOString(), tenantId: "luzione", workloadActorId: "service:sultan-os",
    logicalAgent: agent, caseRef, policyVersion: "sultan-agent-gateway-policy.v1",
    tools: [{ toolId: "luzione.case_context.read", toolVersion: "v1", effectClass: "A0",
      capability: "sultan.case.read", available: true, approvalMode: "BLOCKED",
      description: "Read only", inputSchema: {}, sourceOwner: "CIBOTFLOW/Luzione-API" }],
  });
  const refs = ["postgres:public.commercial_cases/synthetic-case@v7"];
  const toolResult = buildToolResult({
    operationId: call.operationId, toolCallId: call.toolCallId, toolId: call.toolId,
    status: "READY", effectClass: "A0", policyDecision: "ALLOW", sourceFreshness: "FRESH",
    sourceRefs: refs, receiptRef: null, readbackRef: null, failureCode: null,
    nextSafeAction: "Review only",
    result: { snapshot: { caseType: "COMMERCIAL", objectVersion: "v7",
      observedAt: "2026-10-30T09:25:00.000Z", sourceOfTruth: "commercial_cases",
      sourceRefs: refs, snapshot: { customerEmail: "synthetic@example.test" } } },
  });
  return { actor, call, manifest, toolResult, now: NOW, nonce: NONCE };
}
const sign = (overrides: Partial<Parameters<typeof signA0ReceiptEnvelope>[0]> = {}) =>
  signA0ReceiptEnvelope({ ...fixture(), keyId: "synthetic-v1", signingKey: KEY, ...overrides });

test("flag OFF returns null without inspecting signing credentials", () => {
  assert.equal(maybeSignA0Receipt(fixture(), {
    LUZIONE_SULTAN_A0_RECEIPT_SIGNING_ENABLED: "false",
    LUZIONE_SULTAN_A0_RECEIPT_HMAC_KEY_B64: "malformed",
  }), null);
});
test("valid A0 read signs exact canonical v2 envelope with no raw customer snapshot", () => {
  const envelope = sign();
  const { signature, ...unsigned } = envelope;
  assert.equal(signature, createHmac("sha256", KEY).update(canonicalJson(unsigned)).digest("hex"));
  assert.equal(envelope.manifestHash, fixture().manifest.manifestHash);
  assert.equal(envelope.resultHash, fixture().toolResult.resultHash);
  assert.equal(envelope.callHash, sha256(call));
  assert.equal(envelope.nonce, NONCE.toString("hex"));
  assert.equal(envelope.expiresAt, "2026-10-30T09:30:00.000Z");
  assert.equal(JSON.stringify(envelope).includes("synthetic@example.test"), false);
});
test("signed v2 call hash binds exact Stage 5 ID and invocation identity", () => {
  const original = sign();
  assert.equal(original.schemaVersion, "sultan.luzione-a0-transport-envelope.v2");
  for (const change of [
    { admissionReceiptId: "s5admit_" + "b".repeat(32) },
    { operationId: "synthetic-other-op" },
    { runId: "synthetic-other-run" },
    { toolCallId: "synthetic-other-call" },
  ]) {
    const changedCall = { ...call, ...change };
    const changed = sign({ call: changedCall, toolResult: {
      ...fixture().toolResult, operationId: changedCall.operationId,
      toolCallId: changedCall.toolCallId,
    } });
    assert.notEqual(changed.callHash, original.callHash);
    assert.notEqual(changed.signature, original.signature);
  }
});

test("enabled flag requires canonical base64 key and bounded key ID", () => {
  const env = { LUZIONE_SULTAN_A0_RECEIPT_SIGNING_ENABLED: "true",
    LUZIONE_SULTAN_A0_RECEIPT_KEY_ID: "synthetic-v1",
    LUZIONE_SULTAN_A0_RECEIPT_HMAC_KEY_B64: KEY.toString("base64") };
  assert.equal(maybeSignA0Receipt(fixture(), env)?.schemaVersion,
    "sultan.luzione-a0-transport-envelope.v2");
  for (const change of [
    { LUZIONE_SULTAN_A0_RECEIPT_HMAC_KEY_B64: "not base64!!" },
    { LUZIONE_SULTAN_A0_RECEIPT_HMAC_KEY_B64: Buffer.alloc(16).toString("base64") },
    { LUZIONE_SULTAN_A0_RECEIPT_KEY_ID: "../invalid" },
  ]) assert.throws(() => maybeSignA0Receipt(fixture(), { ...env, ...change }), /A0_RECEIPT_SIGNING_DENIED/);
});
test("OIDC identity, tenant, capability and credential source are mandatory", () => {
  for (const change of [
    { source: "service-token" }, { actorId: "service:luzione-ui" },
    { tenantId: "foreign" }, { actorType: "user" },
    { capabilities: ["sultan.tool.invoke"] },
  ]) assert.throws(() => sign({ actor: { ...actor, ...change } as ApiActor }), /A0_RECEIPT_SIGNING_DENIED/);
});
test("effectful or non-ready results, stale evidence and mismatched case cannot be signed", () => {
  const base = fixture();
  const results = [
    { status: "AWAITING_APPROVAL" }, { effectClass: "A1" },
    { policyDecision: "REQUIRE_APPROVAL" }, { sourceFreshness: "STALE" },
    { receiptRef: "effect-ref" }, { toolCallId: "other" },
  ];
  for (const change of results) assert.throws(() =>
    sign({ toolResult: { ...base.toolResult, ...change } as typeof base.toolResult }), /A0_RECEIPT_SIGNING_DENIED/);
  assert.throws(() => sign({ call: { ...call, toolId: "luzione.task.create" } }), /A0_RECEIPT_SIGNING_DENIED/);
  assert.throws(() => sign({ call: { ...call, admissionReceiptId: "invalid" } }), /A0_RECEIPT_SIGNING_DENIED/);
  assert.throws(() => sign({ call: { ...call, controlEvidence: { criticEventId: "x", criticPayloadHash: "a".repeat(64), criticVerdict: "AFFIRM" } } }), /A0_RECEIPT_SIGNING_DENIED/);
  assert.throws(() => sign({ now: new Date("2026-11-04T09:26:00.000Z") }), /A0_RECEIPT_SIGNING_DENIED/);
  assert.throws(() => sign({ manifest: { ...base.manifest, manifestHash: "0".repeat(64) } }), /A0_RECEIPT_SIGNING_DENIED/);
  assert.throws(() => sign({ manifest: { ...base.manifest, caseRef: { ...caseRef, expectedVersion: "v8" } } }), /A0_RECEIPT_SIGNING_DENIED/);
  assert.throws(() => sign({ toolResult: { ...base.toolResult, resultHash: "0".repeat(64) } }), /A0_RECEIPT_SIGNING_DENIED/);
});

test("Sultan consumer cross-repository golden v2 receipt parity", () => {
  // Synthetic fixture mirrored in Sultan-OS/agent-lab/fixtures/a0-api-v2-golden.json.
  // This assertion runs the ACTUAL API signer, not a reconstructed HMAC signer.
  const { manifest, toolResult } = fixture();
  const signed = sign();
  assert.equal(manifest.manifestHash,
    "9338fc925ef0d6a08c171275bbd38026e8b18e7e613e96ac31381e4aaf8f07a1");
  assert.equal(toolResult.resultHash,
    "d53a88cf51d334195347241b95edf1d80279e94b2a33a3ded4ecf7fba2a30d20");
  assert.equal(signed.callHash,
    "232ca6f61989731e82cec2875fb21f342d86e0cda9e6d8388ef2924341548566");
  assert.equal(signed.signature,
    "cd87157872d4a56bf684372ba9583eddf70e9f6b4c73393fd65262c89d5e39bf");
  assert.equal(signed.issuedAt, "2026-10-30T09:26:00.000Z");
  assert.equal(signed.expiresAt, "2026-10-30T09:30:00.000Z");
});
