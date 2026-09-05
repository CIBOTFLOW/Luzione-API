import assert from "node:assert/strict";
import { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import {
  connectorValidationPayloadDigest,
  parseConnectorSyncValidationRequest,
} from "@/modules/onboard-core/connectorContracts";
import { ConnectorSyncValidationService } from "@/modules/onboard-core/connectorService";
import { ONBOARD_CORE_API_VERSION } from "@/modules/onboard-core/contracts";
import { OnboardCoreDomainError } from "@/modules/onboard-core/store";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const tenant = "onboard-connector-proof-a";
const actor: ApiActor = {
  actorId: "service:onboard-connector-proof",
  actorType: "service",
  capabilities: ["connector.sync_validation.execute"],
  source: "service-token",
  tenantId: tenant,
};

function request(input: {
  created?: number;
  operationKey: string;
  scenario?: "ambiguous" | "matched" | "source_unavailable" | "version_mismatch";
  tenantId?: string;
}) {
  const binding = {
    bindingId: "77777777-7777-4777-8777-777777777777",
    consentRef: "consent:connector-proof",
    contractVersion: "ConnectorBinding/v1" as const,
    credentialReference: "secret-ref:opaque-connector-binding-proof",
    cursor: null,
    provider: "GOOGLE_WORKSPACE" as const,
    revocation: { revokedAt: null, revocationRef: null },
    scopes: ["contacts.readonly"],
    status: "DRAFT" as const,
    tenantId: input.tenantId ?? tenant,
  };
  const validation = {
    changes: { created: input.created ?? 2, duplicates: 1, failed: 0, updated: 3 },
    cursorAfter: "sandbox-cursor:proof-after",
    scenario: input.scenario ?? "matched",
  };
  return parseConnectorSyncValidationRequest({
    binding,
    contractVersion: ONBOARD_CORE_API_VERSION,
    operationKey: input.operationKey,
    payloadDigest: connectorValidationPayloadDigest({ binding, validation }),
    validation,
  });
}

async function main() {
  const pool = new Pool({ connectionString });
  const service = new ConnectorSyncValidationService(pool);
  const now = new Date().toISOString();
  try {
    const matchedRequest = request({ operationKey: "connector-validation-matched" });
    const matched = await service.execute({ actor, correlationId: "correlation-connector-matched", request: matchedRequest, requestedAt: now });
    assert.equal(matched.commandReceipt.idempotentReplay, false);
    assert.equal(matched.provider.destination, "sandbox.echo");
    assert.equal(matched.provider.mode, "SANDBOX");
    assert.equal(matched.syncReceipt.finality, "SOURCE_CONFIRMED");
    assert.ok(matched.syncReceipt.providerAcknowledgementRef);
    assert.ok(matched.syncReceipt.sourceReadbackRef);

    const replay = await service.execute({ actor, correlationId: "correlation-connector-replay", request: matchedRequest, requestedAt: new Date(Date.now() + 1_000).toISOString() });
    assert.equal(replay.commandReceipt.idempotentReplay, true);
    assert.equal(replay.commandReceipt.receiptId, matched.commandReceipt.receiptId);
    assert.deepEqual(replay.syncReceipt, matched.syncReceipt);

    await assert.rejects(
      () => service.execute({
        actor,
        correlationId: "correlation-connector-changed",
        request: request({ created: 9, operationKey: "connector-validation-matched" }),
        requestedAt: new Date(Date.now() + 2_000).toISOString(),
      }),
      (error: unknown) => error instanceof IdempotencyConflictError,
    );
    await assert.rejects(
      () => service.execute({
        actor,
        correlationId: "correlation-connector-cross-tenant",
        request: request({ operationKey: "connector-validation-cross-tenant", tenantId: "onboard-connector-proof-b" }),
        requestedAt: new Date(Date.now() + 3_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "TENANT_MISMATCH",
    );
    await assert.rejects(
      () => service.execute({
        actor: { ...actor, actorType: "agent" },
        correlationId: "correlation-connector-agent",
        request: request({ operationKey: "connector-validation-agent" }),
        requestedAt: new Date(Date.now() + 4_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "SERVICE_ACTOR_REQUIRED",
    );

    const ambiguous = await service.execute({
      actor,
      correlationId: "correlation-connector-ambiguous",
      request: request({ operationKey: "connector-validation-ambiguous", scenario: "ambiguous" }),
      requestedAt: new Date(Date.now() + 5_000).toISOString(),
    });
    assert.equal(ambiguous.syncReceipt.finality, "SOURCE_CONFIRMED");
    assert.equal(ambiguous.syncReceipt.providerAcknowledgementRef, null);
    assert.ok(ambiguous.syncReceipt.sourceReadbackRef);
    const ambiguousAttempts = await pool.query(
      `select count(*)::int count from public.p110_delivery_attempts attempt
        join public.p110_command_receipts receipt
          on receipt.tenant_id=attempt.tenant_id and receipt.outbox_message_id=attempt.outbox_message_id
       where receipt.tenant_id=$1 and receipt.command_id=$2`,
      [tenant, ambiguous.commandReceipt.commandId],
    );
    assert.equal(ambiguousAttempts.rows[0].count, 1);

    const unavailable = await service.execute({
      actor,
      correlationId: "correlation-connector-unavailable",
      request: request({ operationKey: "connector-validation-unavailable", scenario: "source_unavailable" }),
      requestedAt: new Date(Date.now() + 6_000).toISOString(),
    });
    assert.equal(unavailable.syncReceipt.finality, "RECONCILING");
    assert.ok(unavailable.syncReceipt.providerAcknowledgementRef);
    assert.ok(unavailable.syncReceipt.reconciliationRef);
    assert.equal(unavailable.syncReceipt.sourceReadbackRef, null);

    const evidence = (await pool.query(
      `select
        (select count(*)::int from public.p110_command_receipts where tenant_id=$1) receipts,
        (select count(*)::int from public.p110_idempotency_conflicts where tenant_id=$1) conflicts,
        (select count(*)::int from public.p110_outbox_messages where tenant_id=$1 and destination='sandbox.echo') outbox,
        (select count(*)::int from public.p110_delivery_attempts where tenant_id=$1) delivery_attempts,
        (select count(*)::int from public.p110_reconciliation_checkpoints where tenant_id=$1) reconciliations,
        (select count(*)::int from public.p110_outbox_messages where tenant_id=$1 and effect_class='NO_EFFECT') no_effect`,
      [tenant],
    )).rows[0];
    assert.deepEqual(evidence, { conflicts: 1, delivery_attempts: 3, no_effect: 3, outbox: 3, receipts: 3, reconciliations: 3 });
    process.stdout.write(`${JSON.stringify({
      contractVersions: ["ConnectorBinding/v1", "SyncReceipt/v1", "ConnectorSyncValidation/v1"],
      evidence,
      result: "PASS",
    })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
