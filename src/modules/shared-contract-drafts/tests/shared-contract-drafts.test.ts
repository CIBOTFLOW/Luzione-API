import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ApiActor } from "@/lib/api/actor";
import { buildCommandCausalReadback } from "@/modules/platform-contracts/readbackContract";
import {
  bindAuthenticatedRequestIdentity,
  createRequestIdentity,
} from "@/modules/platform-contracts/requestIdentity";
import { createLifecycleCommandRequest } from "@/modules/platform-guarantees/commandKernel";
import { platformContractRegistry } from "@/modules/platform-contracts/registry";
import {
  adaptCausalReadbackDraft,
  adaptIdentityTenantDraft,
  adaptLifecycleCommandDraft,
  adaptLifecycleReceiptDraft,
} from "../adapters";
import {
  A02_COMMAND_CONTRACT_VERSION,
  A02_IDENTITY_TENANT_CONTRACT_VERSION,
  A02_READBACK_CONTRACT_VERSION,
  A02_RECEIPT_CONTRACT_VERSION,
  A02_SHARED_CONTRACT_BUNDLE_VERSION,
  a02CompatibilityMatrix,
  a02RequiredConsumerPins,
  assertA02ConsumerPins,
} from "../contracts";

const actor: ApiActor = {
  actorId: "service:sultan-os",
  actorType: "service",
  capabilities: ["fulfillment.readiness.evaluate"],
  source: "vercel-oidc",
  tenantId: "tenant-luzione",
};

function context() {
  const base = createRequestIdentity(new Headers({
    "x-correlation-id": "correlation-a02-draft-1",
    "x-request-id": "request-a02-draft-1",
  }), {
    now: "2026-09-02T20:00:00.000Z",
    randomBytes: (size) => Buffer.alloc(size, 1),
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
  });
  const identity = bindAuthenticatedRequestIdentity(base, actor, {
    authorityClass: "A0_READ_ONLY",
    capability: "fulfillment.readiness.evaluate",
    idempotencyKey: "a02-command-1",
    purpose: "synthetic-fulfillment-readiness",
    sourceVersionRefs: ["order:v7", "policy:v3"],
  });
  return adaptIdentityTenantDraft({
    actor,
    identity,
    logicalActor: {
      actorId: "fulfillment-steward@v1",
      definitionVersion: "fulfillment-steward/v1",
      delegationEvidenceRef: "delegation-policy:v1",
    },
  });
}

function command() {
  const draftContext = context();
  const lifecycle = createLifecycleCommandRequest({
    actor: { actorId: "fulfillment-steward@v1", actorType: "agent", roles: [] },
    causationId: null,
    commandId: "command-a02-1",
    commandType: "fulfillment.readiness.evaluate",
    correlationId: draftContext.request.correlationId,
    expectedObjectVersion: "order:v7",
    idempotencyKey: "a02-command-1",
    payload: { orderId: "order-1", simulation: true },
    policyVersion: "policy:v3",
    requestedAt: draftContext.request.requestedAt,
    stepId: null,
    target: {
      objectId: "order-1",
      objectType: "order",
      objectVersion: "order:v7",
      ownerProject: "LUZIONE_COMMERCE_ORDER",
      sourceRefs: ["order:v7"],
    },
    tenantId: draftContext.tenant.tenantId,
    workflowId: null,
  });
  return { draft: adaptLifecycleCommandDraft({ command: lifecycle, context: draftContext }), lifecycle };
}

test("credential actor, logical actor and tenant remain distinct server-derived identities", () => {
  const draft = context();
  assert.equal(draft.contractVersion, A02_IDENTITY_TENANT_CONTRACT_VERSION);
  assert.equal(draft.credentialActor.actorId, "service:sultan-os");
  assert.equal(draft.logicalActor?.actorId, "fulfillment-steward@v1");
  assert.equal(draft.tenant.tenantId, "tenant-luzione");
  assert.equal(draft.serverDerived, true);
  assert.deepEqual(draft.sourceVersionRefs, ["order:v7", "policy:v3"]);
});

test("identity adaptation rejects actor, tenant and capability drift", () => {
  const base = createRequestIdentity(new Headers(), {
    now: "2026-09-02T20:00:00.000Z",
    randomBytes: (size) => Buffer.alloc(size, 2),
    randomUUID: () => "22222222-2222-4222-8222-222222222222",
  });
  const wrongTenant = bindAuthenticatedRequestIdentity(base, {
    actorId: actor.actorId,
    actorType: actor.actorType,
    tenantId: "tenant-other",
  }, {
    authorityClass: "A0_READ_ONLY",
    capability: "fulfillment.readiness.evaluate",
    purpose: "synthetic-fulfillment-readiness",
  });
  assert.throws(() => adaptIdentityTenantDraft({ actor, identity: wrongTenant }), /do not match/);
  const unavailableCapability = { ...wrongTenant, tenantId: actor.tenantId, capability: "command.execute" };
  assert.throws(() => adaptIdentityTenantDraft({ actor, identity: unavailableCapability }), /absent from the verified credential/);
});

test("current command and receipt contracts adapt without changing causal identity", () => {
  const { draft, lifecycle } = command();
  assert.equal(draft.contractVersion, A02_COMMAND_CONTRACT_VERSION);
  assert.equal(draft.activation, "DRAFT_ONLY");
  assert.equal(draft.requestedEffect.effectClass, "NO_EFFECT");
  assert.equal(draft.payloadHash, lifecycle.payloadHash);
  const lifecycleReceipt = {
    commandId: lifecycle.commandId,
    correlationId: lifecycle.correlationId,
    eventId: "event-a02-1",
    idempotentReplay: false,
    idempotencyKey: lifecycle.idempotencyKey,
    objectVersion: "order:v8",
    outboxMessageId: "outbox-a02-1",
    payloadHash: lifecycle.payloadHash,
    receiptId: "receipt-a02-1",
    state: "DISPATCH_PENDING" as const,
    tenantId: lifecycle.tenantId,
  };
  const receipt = adaptLifecycleReceiptDraft({ command: draft, receipt: lifecycleReceipt });
  assert.equal(receipt.contractVersion, A02_RECEIPT_CONTRACT_VERSION);
  assert.equal(receipt.effectAuthority, "NOT_GRANTED_BY_CONTRACT");
  assert.equal(receipt.object.version, "order:v8");
  assert.throws(() => adaptLifecycleReceiptDraft({
    command: draft,
    receipt: { ...lifecycleReceipt, payloadHash: "different" },
  }), /does not close/);
  assert.throws(() => adaptLifecycleReceiptDraft({
    command: draft,
    receipt: { ...lifecycleReceipt, tenantId: "tenant-other" },
  }), /does not close/);
});

test("provider acknowledgement stays non-final and only fresh source readback closes business finality", () => {
  const { draft, lifecycle } = command();
  const receipt = adaptLifecycleReceiptDraft({
    command: draft,
    receipt: {
      commandId: lifecycle.commandId,
      correlationId: lifecycle.correlationId,
      eventId: "event-a02-1",
      idempotentReplay: false,
      idempotencyKey: lifecycle.idempotencyKey,
      objectVersion: "order:v8",
      outboxMessageId: "outbox-a02-1",
      payloadHash: lifecycle.payloadHash,
      receiptId: "receipt-a02-1",
      state: "DISPATCH_PENDING",
      tenantId: lifecycle.tenantId,
    },
  });
  const providerAcknowledged = buildCommandCausalReadback({
    now: "2026-09-02T20:01:00.000Z",
    row: {
      commandId: receipt.commandId,
      committedObjectVersion: receipt.object.version,
      eventId: receipt.evidence.eventId,
      outboxMessageId: receipt.evidence.outboxMessageId,
      providerAcknowledgedAt: "2026-09-02T20:00:30.000Z",
      providerAcknowledgementRef: "provider:ack-1",
      receiptId: receipt.receiptId,
      receiptState: "PROVIDER_ACKNOWLEDGED",
      targetObjectId: receipt.object.id,
      targetObjectType: receipt.object.type,
      targetOwnerProject: receipt.object.ownerProject,
      tenantId: receipt.tenantId,
    },
  });
  const acknowledgedDraft = adaptCausalReadbackDraft({ readback: providerAcknowledged, receipt });
  assert.equal(acknowledgedDraft.contractVersion, A02_READBACK_CONTRACT_VERSION);
  assert.equal(acknowledgedDraft.finality, "PROVIDER_ACKNOWLEDGED");
  assert.equal(acknowledgedDraft.businessFinal, false);
  assert.throws(() => adaptCausalReadbackDraft({
    readback: { ...providerAcknowledged, tenantId: "tenant-other" },
    receipt,
  }), /does not match/);

  const sourceConfirmed = buildCommandCausalReadback({
    now: "2026-09-02T20:01:00.000Z",
    row: {
      commandId: receipt.commandId,
      committedObjectVersion: receipt.object.version,
      eventId: receipt.evidence.eventId,
      outboxMessageId: receipt.evidence.outboxMessageId,
      providerAcknowledgedAt: "2026-09-02T20:00:30.000Z",
      providerAcknowledgementRef: "provider:ack-1",
      receiptId: receipt.receiptId,
      receiptState: "SOURCE_CONFIRMED",
      sourceConfirmedAt: "2026-09-02T20:00:45.000Z",
      sourceReadbackRef: "postgres:order-1:v8",
      targetObjectId: receipt.object.id,
      targetObjectType: receipt.object.type,
      targetOwnerProject: receipt.object.ownerProject,
      tenantId: receipt.tenantId,
    },
  });
  const confirmedDraft = adaptCausalReadbackDraft({ readback: sourceConfirmed, receipt });
  assert.equal(confirmedDraft.finality, "SOURCE_CONFIRMED");
  assert.equal(confirmedDraft.businessFinal, true);
  assert.equal(confirmedDraft.evidence.sourceReadbackRef, "postgres:order-1:v8");

  const staleSourceConfirmed = buildCommandCausalReadback({
    now: "2026-09-02T21:01:00.000Z",
    row: {
      commandId: receipt.commandId,
      committedObjectVersion: receipt.object.version,
      eventId: receipt.evidence.eventId,
      outboxMessageId: receipt.evidence.outboxMessageId,
      providerAcknowledgedAt: "2026-09-02T20:00:30.000Z",
      providerAcknowledgementRef: "provider:ack-1",
      receiptId: receipt.receiptId,
      receiptState: "SOURCE_CONFIRMED",
      sourceConfirmedAt: "2026-09-02T20:00:45.000Z",
      sourceReadbackRef: "postgres:order-1:v8",
      targetObjectId: receipt.object.id,
      targetObjectType: receipt.object.type,
      targetOwnerProject: receipt.object.ownerProject,
      tenantId: receipt.tenantId,
    },
  });
  const staleDraft = adaptCausalReadbackDraft({ readback: staleSourceConfirmed, receipt });
  assert.equal(staleDraft.finality, "RECONCILING");
  assert.equal(staleDraft.businessFinal, false);
});

test("draft manifest, schemas, registry and exact consumer pins agree without runtime activation", () => {
  const manifest = JSON.parse(readFileSync(
    "contracts/drafts/luzione-shared-contracts-v0.2-draft.1.manifest.json",
    "utf8",
  )) as Record<string, unknown>;
  assert.equal(manifest.bundleVersion, A02_SHARED_CONTRACT_BUNDLE_VERSION);
  assert.equal(manifest.runtimeActivation, false);
  assert.equal(manifest.effectAuthority, "NO_EFFECT");

  const schemaVersions = [
    ["contracts/drafts/identity-tenant-v0.2-draft.1.schema.json", A02_IDENTITY_TENANT_CONTRACT_VERSION],
    ["contracts/drafts/command-envelope-v0.2-draft.1.schema.json", A02_COMMAND_CONTRACT_VERSION],
    ["contracts/drafts/receipt-envelope-v0.2-draft.1.schema.json", A02_RECEIPT_CONTRACT_VERSION],
    ["contracts/drafts/readback-envelope-v0.2-draft.1.schema.json", A02_READBACK_CONTRACT_VERSION],
  ] as const;
  for (const [path, version] of schemaVersions) {
    const schema = JSON.parse(readFileSync(path, "utf8")) as {
      additionalProperties: boolean;
      properties: { contractVersion: { const: string } };
    };
    assert.equal(schema.additionalProperties, false, path);
    assert.equal(schema.properties.contractVersion.const, version, path);
  }

  const exactVersions = new Set<string>(Object.values(a02RequiredConsumerPins));
  const registered = platformContractRegistry.filter((entry) => exactVersions.has(entry.version));
  assert.equal(registered.length, 5);
  assert.ok(registered.every((entry) => !entry.currentRuntime && entry.maturity === "LIBRARY_ONLY"));
  assert.equal(a02CompatibilityMatrix.length, 4);
  assert.doesNotThrow(() => assertA02ConsumerPins({ ...a02RequiredConsumerPins }));
  assert.throws(() => assertA02ConsumerPins({ ...a02RequiredConsumerPins, readback: "local-fork/v1" }), /must be/);
  assert.throws(() => assertA02ConsumerPins({ ...a02RequiredConsumerPins, localIdentity: "fork/v1" }), /Unknown/);
});
