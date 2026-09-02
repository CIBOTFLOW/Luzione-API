import assert from "node:assert/strict";
import { Pool } from "pg";
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
} from "@/modules/shared-contract-drafts/adapters";
import { a02RequiredConsumerPins } from "@/modules/shared-contract-drafts/contracts";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", ["a02-tenant-a"]);
    const result = await client.query(`
      select r.*, o.effect_class, o.state as outbox_state
        from public.p110_command_receipts r
        join public.p110_outbox_messages o
          on o.tenant_id = r.tenant_id and o.receipt_id = r.receipt_id
       where r.tenant_id = $1 and r.receipt_id = $2
    `, ["a02-tenant-a", "receipt-a02-1"]);
    assert.equal(result.rows.length, 1);
    const row = result.rows[0] as Record<string, unknown>;
    assert.equal(row.effect_class, "NO_EFFECT");
    assert.equal(row.outbox_state, "PENDING");
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.bundleVersion, a02RequiredConsumerPins.bundle);
    assert.equal(metadata.identityTenantVersion, a02RequiredConsumerPins.identityTenant);
    assert.equal(metadata.commandVersion, a02RequiredConsumerPins.command);
    assert.equal(metadata.receiptVersion, a02RequiredConsumerPins.receipt);
    assert.equal(metadata.readbackVersion, a02RequiredConsumerPins.readback);

    const actor = {
      actorId: "service:sultan-os",
      actorType: "service" as const,
      capabilities: ["fulfillment.readiness.evaluate"],
      source: "vercel-oidc" as const,
      tenantId: "a02-tenant-a",
    };
    const baseIdentity = createRequestIdentity(new Headers({
      "x-correlation-id": String(row.correlation_id),
      "x-request-id": "request-a02-rehearsal",
    }), {
      now: new Date(String(row.requested_at)).toISOString(),
      randomBytes: (size) => Buffer.alloc(size, 3),
      randomUUID: () => "33333333-3333-4333-8333-333333333333",
    });
    const identity = bindAuthenticatedRequestIdentity(baseIdentity, actor, {
      authorityClass: "A0_READ_ONLY",
      capability: "fulfillment.readiness.evaluate",
      idempotencyKey: String(row.idempotency_key),
      purpose: "synthetic-fulfillment-readiness",
      sourceVersionRefs: ["order:v7", "policy:v3"],
    });
    const context = adaptIdentityTenantDraft({
      actor,
      identity,
      logicalActor: {
        actorId: String(row.actor_id),
        definitionVersion: "fulfillment-steward/v1",
        delegationEvidenceRef: "delegation-policy:v1",
      },
    });
    const lifecycleCommand = createLifecycleCommandRequest({
      actor: { actorId: String(row.actor_id), actorType: "agent", roles: [] },
      causationId: null,
      commandId: String(row.command_id),
      commandType: String(row.command_type),
      correlationId: String(row.correlation_id),
      expectedObjectVersion: String(row.expected_object_version),
      idempotencyKey: String(row.idempotency_key),
      payload: { orderId: "order-a02-1", simulation: true },
      policyVersion: String(row.policy_version),
      requestedAt: new Date(String(row.requested_at)).toISOString(),
      stepId: null,
      target: {
        objectId: String(row.target_object_id),
        objectType: String(row.target_object_type),
        objectVersion: String(row.expected_object_version),
        ownerProject: String(row.target_owner_project),
        sourceRefs: [String(row.expected_object_version)],
      },
      tenantId: String(row.tenant_id),
      workflowId: null,
    });
    assert.equal(lifecycleCommand.payloadHash, row.payload_hash);
    const command = adaptLifecycleCommandDraft({ command: lifecycleCommand, context });
    const receipt = adaptLifecycleReceiptDraft({
      command,
      receipt: {
        commandId: String(row.command_id),
        correlationId: String(row.correlation_id),
        eventId: String(row.event_id),
        idempotentReplay: false,
        idempotencyKey: String(row.idempotency_key),
        objectVersion: String(row.committed_object_version),
        outboxMessageId: String(row.outbox_message_id),
        payloadHash: String(row.payload_hash),
        receiptId: String(row.receipt_id),
        state: "DISPATCH_PENDING",
        tenantId: String(row.tenant_id),
      },
    });
    const readback = adaptCausalReadbackDraft({
      receipt,
      readback: buildCommandCausalReadback({
        row: {
          commandId: receipt.commandId,
          committedObjectVersion: receipt.object.version,
          eventId: receipt.evidence.eventId,
          outboxMessageId: receipt.evidence.outboxMessageId,
          receiptId: receipt.receiptId,
          receiptState: String(row.state),
          targetObjectId: receipt.object.id,
          targetObjectType: receipt.object.type,
          targetOwnerProject: receipt.object.ownerProject,
          tenantId: receipt.tenantId,
        },
      }),
    });
    assert.equal(command.requestedEffect.effectClass, "NO_EFFECT");
    assert.equal(receipt.effectAuthority, "NOT_GRANTED_BY_CONTRACT");
    assert.equal(readback.finality, "DOMAIN_COMMITTED");
    assert.equal(readback.businessFinal, false);
    await client.query("rollback");

    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", ["a02-tenant-b"]);
    const crossTenant = await client.query(
      "select count(*)::integer as count from public.p110_command_receipts where receipt_id = $1",
      ["receipt-a02-1"],
    );
    assert.equal(crossTenant.rows[0].count, 0);
    await client.query("rollback");
    console.log(JSON.stringify({
      adapterVersions: a02RequiredConsumerPins,
      crossTenantRows: 0,
      effectClass: "NO_EFFECT",
      proofShape: process.env.PROOF_SHAPE,
      receiptId: receipt.receiptId,
      result: "PASS",
    }));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
