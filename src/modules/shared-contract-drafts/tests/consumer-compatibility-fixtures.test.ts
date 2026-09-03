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
import {
  adaptCausalReadbackDraft,
  adaptIdentityTenantDraft,
  adaptLifecycleCommandDraft,
  adaptLifecycleReceiptDraft,
} from "../adapters";
import {
  A02ConsumerCompatibilityError,
  type A02ConsumerCompatibilityErrorCode,
  parseA02CommandConsumerFixture,
  parseA02IdentityTenantConsumerFixture,
  parseA02ReadbackConsumerFixture,
  parseA02ReceiptConsumerFixture,
} from "../consumerCompatibility";
import {
  a02RequiredConsumerPins,
  type A02CommandDraft,
  type A02ReceiptDraft,
} from "../contracts";

type Boundary = "command" | "identityTenant" | "readback" | "receipt";
type Mutation = {
  operation: "add" | "remove" | "replace";
  path: string[];
  value?: unknown;
};
type FixtureDocument = {
  classification: string;
  consumerExpectations: {
    acceptedBoundaries: Boundary[];
    negativeCases: Array<{
      boundary: Boundary;
      expectedCode: A02ConsumerCompatibilityErrorCode;
      id: string;
      mutations: Mutation[];
    }>;
  };
  contractVersions: Record<string, string>;
  producer: Record<Boundary, unknown>;
  schemaVersion: string;
  sourceImplementationSha: string;
};

const fixturePath = "contracts/drafts/fixtures/a02-v0.2-draft.1-producer-consumer.json";
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureDocument;

const actor: ApiActor = {
  actorId: "service:sultan-os",
  actorType: "service",
  capabilities: ["fulfillment.readiness.evaluate"],
  source: "vercel-oidc",
  tenantId: "tenant-luzione",
};

test("producer adapters emit the exact field-level consumer fixture chain", () => {
  const actual = produceChain();
  assert.deepEqual(actual.identityTenant, fixtures.producer.identityTenant);
  assert.deepEqual(actual.command, fixtures.producer.command);
  assert.deepEqual(actual.receipt, fixtures.producer.receipt);
  assert.deepEqual(actual.readback, fixtures.producer.readback);
  assert.equal(actual.command.requestedEffect.effectClass, "NO_EFFECT");
  assert.equal(actual.receipt.effectAuthority, "NOT_GRANTED_BY_CONTRACT");
});

test("strict consumer boundary accepts every exact producer fixture and five-pin set", () => {
  assert.equal(fixtures.classification, "G0_FIELD_LEVEL_NO_EFFECT");
  assert.equal(fixtures.sourceImplementationSha, "f2d643a0913b888809c217adfd9bdcef0385b05a");
  assert.deepEqual(fixtures.contractVersions, a02RequiredConsumerPins);
  assert.deepEqual(fixtures.consumerExpectations.acceptedBoundaries.sort(), [
    "command", "identityTenant", "readback", "receipt",
  ]);

  const identityTenant = parseA02IdentityTenantConsumerFixture(fixtures.producer.identityTenant);
  const command = parseA02CommandConsumerFixture(fixtures.producer.command);
  const receipt = parseA02ReceiptConsumerFixture(fixtures.producer.receipt, command);
  const readback = parseA02ReadbackConsumerFixture(fixtures.producer.readback, receipt);
  assert.equal(command.context.tenant.tenantId, identityTenant.tenant.tenantId);
  assert.equal(receipt.idempotency.payloadHash, command.payloadHash);
  assert.equal(readback.evidence.receiptId, receipt.receiptId);
  assert.equal(readback.businessFinal, true);
});

test("schema required fields and exact fixture top-level fields remain aligned", () => {
  const schemas: Array<[Boundary, string]> = [
    ["identityTenant", "contracts/drafts/identity-tenant-v0.2-draft.1.schema.json"],
    ["command", "contracts/drafts/command-envelope-v0.2-draft.1.schema.json"],
    ["receipt", "contracts/drafts/receipt-envelope-v0.2-draft.1.schema.json"],
    ["readback", "contracts/drafts/readback-envelope-v0.2-draft.1.schema.json"],
  ];
  for (const [boundary, path] of schemas) {
    const schema = JSON.parse(readFileSync(path, "utf8")) as {
      additionalProperties: boolean;
      required: string[];
    };
    assert.equal(schema.additionalProperties, false, path);
    assert.deepEqual(Object.keys(fixtures.producer[boundary] as object).sort(), [...schema.required].sort(), boundary);
  }
});

test("same-key replay is accepted only with the exact original payload hash", () => {
  const command = parseA02CommandConsumerFixture(fixtures.producer.command);
  const replay = structuredClone(fixtures.producer.receipt) as Record<string, unknown>;
  (replay.idempotency as Record<string, unknown>).replay = true;
  const accepted = parseA02ReceiptConsumerFixture(replay, command);
  assert.equal(accepted.idempotency.replay, true);
  assert.equal(accepted.idempotency.payloadHash, command.payloadHash);
});

test("negative fixture matrix fails closed at the named field boundary", async (context) => {
  assert.equal(fixtures.consumerExpectations.negativeCases.length, 18);
  for (const fixture of fixtures.consumerExpectations.negativeCases) {
    await context.test(fixture.id, () => {
      const mutated = structuredClone(fixtures.producer[fixture.boundary]);
      for (const mutation of fixture.mutations) applyMutation(mutated, mutation);
      assert.throws(
        () => validateBoundary(fixture.boundary, mutated),
        (error) => error instanceof A02ConsumerCompatibilityError
          && error.code === fixture.expectedCode,
      );
    });
  }
});

function produceChain() {
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
  const identityTenant = adaptIdentityTenantDraft({
    actor,
    identity,
    logicalActor: {
      actorId: "fulfillment-steward@v1",
      definitionVersion: "fulfillment-steward/v1",
      delegationEvidenceRef: "delegation-policy:v1",
    },
  });
  const lifecycle = createLifecycleCommandRequest({
    actor: { actorId: "fulfillment-steward@v1", actorType: "agent", roles: [] },
    causationId: null,
    commandId: "command-a02-1",
    commandType: "fulfillment.readiness.evaluate",
    correlationId: identityTenant.request.correlationId,
    expectedObjectVersion: "order:v7",
    idempotencyKey: "a02-command-1",
    payload: { orderId: "order-1", simulation: true },
    policyVersion: "policy:v3",
    requestedAt: identityTenant.request.requestedAt,
    stepId: null,
    target: {
      objectId: "order-1",
      objectType: "order",
      objectVersion: "order:v7",
      ownerProject: "LUZIONE_COMMERCE_ORDER",
      sourceRefs: ["order:v7"],
    },
    tenantId: identityTenant.tenant.tenantId,
    workflowId: null,
  });
  const command = adaptLifecycleCommandDraft({ command: lifecycle, context: identityTenant });
  const receipt = adaptLifecycleReceiptDraft({
    command,
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
  const readback = adaptCausalReadbackDraft({
    receipt,
    readback: buildCommandCausalReadback({
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
    }),
  });
  return { command, identityTenant, readback, receipt };
}

function validateBoundary(boundary: Boundary, value: unknown) {
  const command = parseA02CommandConsumerFixture(fixtures.producer.command) as A02CommandDraft;
  const receipt = parseA02ReceiptConsumerFixture(fixtures.producer.receipt, command) as A02ReceiptDraft;
  if (boundary === "identityTenant") return parseA02IdentityTenantConsumerFixture(value);
  if (boundary === "command") return parseA02CommandConsumerFixture(value);
  if (boundary === "receipt") return parseA02ReceiptConsumerFixture(value, command);
  return parseA02ReadbackConsumerFixture(value, receipt);
}

function applyMutation(value: unknown, mutation: Mutation) {
  let parent = value as Record<string, unknown>;
  for (const segment of mutation.path.slice(0, -1)) {
    parent = parent[segment] as Record<string, unknown>;
  }
  const key = mutation.path.at(-1) as string;
  if (mutation.operation === "remove") delete parent[key];
  else parent[key] = mutation.value;
}
