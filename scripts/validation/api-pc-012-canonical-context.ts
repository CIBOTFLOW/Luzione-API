import assert from "node:assert/strict";
import { Pool } from "pg";

import { POST as evaluateAgentIntent } from "@/app/api/v1/sultan/agent-intents/evaluate/route";
import type { ApiActor } from "@/lib/api/actor";
import { OrderFulfillmentStore } from "@/modules/order-fulfillment/store";
import { SULTAN_AGENT_CONTEXT_CONTRACT_VERSION, SULTAN_AGENT_INTENT_CONTRACT_VERSION } from "@/modules/sultan-agent/contracts";
import { canonicalOrderContextHash } from "@/modules/sultan-agent/contextVerifier";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required for the disposable API-PC-012 proof.");

const tenantA = "api-pc-012-a";
const tenantB = "api-pc-012-b";
const agentId = "agent.luzione.fulfillment-steward";
const agentVersion = "v1";
const token = "api-pc-012-proof-service-token";
const actor: ApiActor = {
  actorId: `${agentId}:${agentVersion}`,
  actorType: "agent",
  capabilities: ["sultan.agent.intent.evaluate", "analysis.read"],
  source: "service-token",
  tenantId: tenantA,
};

function configureCredential(tenantId: string) {
  process.env.LUZIONE_API_SERVICE_TOKEN = token;
  process.env.LUZIONE_API_SERVICE_ACTOR_ID = actor.actorId;
  process.env.LUZIONE_API_SERVICE_ACTOR_TYPE = actor.actorType;
  process.env.LUZIONE_API_SERVICE_TENANT_ID = tenantId;
  process.env.LUZIONE_API_SERVICE_CAPABILITIES = actor.capabilities.join(",");
}

function headers(correlationId: string, tenantId?: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-correlation-id": correlationId,
    ...(tenantId ? { "x-luzione-tenant": tenantId } : {}),
  };
}

async function post(intent: Record<string, unknown>, correlationId: string, tenantId?: string) {
  return evaluateAgentIntent(new Request("http://localhost/api/v1/sultan/agent-intents/evaluate", {
    body: JSON.stringify({ intent }),
    headers: headers(correlationId, tenantId),
    method: "POST",
  }));
}

async function main() {
  const pool = new Pool({ connectionString });
  const store = new OrderFulfillmentStore(pool);
  try {
    configureCredential(tenantA);
    const readback = await store.readOrder(actor, "order-pc012");
    assert.ok(readback);
    const integrityHash = canonicalOrderContextHash(readback);
    const intent = {
      actionId: "action-api-pc-012-proof",
      actionVersion: "v1",
      agent: { agentId, agentVersion, authorityDomain: "LUZIONE" },
      capability: "analysis.read",
      caseRef: { caseId: "order-pc012", caseType: "FULFILLMENT", expectedVersion: readback.objectVersion },
      controls: {
        budgetWithinLimit: true,
        dependenciesReady: true,
        evidenceComplete: true,
        idempotencyKey: "idempotency-api-pc-012-proof",
        killSwitchReady: true,
        providerReconciliationPlanned: true,
        readbackPlanned: true,
        rollbackPlanned: true,
        simulationPassed: true,
      },
      dataClassification: "INTERNAL",
      declaredEffectClass: "A0",
      intentContractVersion: SULTAN_AGENT_INTENT_CONTRACT_VERSION,
      purpose: "fulfillment-read-analysis",
      runMode: "SHADOW",
      sourceContext: [{
        contextContractVersion: SULTAN_AGENT_CONTEXT_CONTRACT_VERSION,
        freshness: "FRESH",
        integrityHash,
        observedAt: "2026-08-31T12:00:00.000Z",
        sourceOwner: "CIBOTFLOW/Luzione-API",
        sourceRef: "api:orders:order-pc012",
        sourceVersion: readback.objectVersion,
      }],
      workOrderId: "work-order-api-pc-012-proof",
    };

    const currentResponse = await post(intent, "correlation-api-pc-012-current");
    assert.equal(currentResponse.status, 200);
    const current = await currentResponse.json() as { decision: { sourceContext: { verification: string; verifiedCount: number }; status: string; tenantPolicy: { allowedByPolicy: boolean } } };
    assert.equal(current.decision.status, "ADMIT_READ_ONLY");
    assert.equal(current.decision.sourceContext.verification, "CANONICAL_READBACK");
    assert.equal(current.decision.sourceContext.verifiedCount, 1);
    assert.equal(current.decision.tenantPolicy.allowedByPolicy, true);

    const staleResponse = await post({
      ...intent,
      caseRef: { ...intent.caseRef, expectedVersion: "order:order-pc012:v0:screated" },
      sourceContext: [{ ...intent.sourceContext[0], freshness: "FRESH", integrityHash: "f".repeat(64), sourceVersion: "order:order-pc012:v0:screated" }],
    }, "correlation-api-pc-012-stale");
    assert.equal(staleResponse.status, 200);
    const stale = await staleResponse.json() as { decision: { reasonCodes: string[]; sourceContext: { freshness: string }; status: string } };
    assert.equal(stale.decision.status, "ABSTAIN_STALE_CONTEXT");
    assert.equal(stale.decision.sourceContext.freshness, "STALE");
    assert.ok(stale.decision.reasonCodes.includes("SOURCE_CONTEXT_NOT_FRESH"));

    const deniedResponse = await post({ ...intent, purpose: "unapproved-purpose" }, "correlation-api-pc-012-policy-denied");
    assert.equal(deniedResponse.status, 422);
    const denied = await deniedResponse.json() as { decision: { reasonCodes: string[]; status: string; tenantPolicy: { allowedByPolicy: boolean } } };
    assert.equal(denied.decision.status, "BLOCKED");
    assert.equal(denied.decision.tenantPolicy.allowedByPolicy, false);
    assert.ok(denied.decision.reasonCodes.includes("PURPOSE_NOT_ALLOWED"));

    configureCredential(tenantB);
    const crossTenantResponse = await post(intent, "correlation-api-pc-012-cross-tenant");
    assert.equal(crossTenantResponse.status, 200);
    const crossTenant = await crossTenantResponse.json() as { decision: { reasonCodes: string[]; sourceContext: { freshness: string; verifiedCount: number }; status: string } };
    assert.equal(crossTenant.decision.status, "ABSTAIN_STALE_CONTEXT");
    assert.equal(crossTenant.decision.sourceContext.freshness, "UNKNOWN");
    assert.equal(crossTenant.decision.sourceContext.verifiedCount, 0);
    assert.ok(crossTenant.decision.reasonCodes.includes("SOURCE_CONTEXT_NOT_CANONICALLY_VERIFIED"));

    configureCredential(tenantA);
    const mismatchResponse = await post(intent, "correlation-api-pc-012-mismatch", tenantB);
    assert.equal(mismatchResponse.status, 401);
    const mismatch = await mismatchResponse.json() as { message: string };
    assert.equal(mismatch.message, "Service authentication failed.");

    await pool.query("begin read only");
    await pool.query("select set_config('app.tenant_id',$1,true)", [tenantA]);
    const evidence = (await pool.query(`select
      (select count(*)::int from public.order_fulfillment_intents where tenant_id = $1) as fulfillment_intents,
      (select count(*)::int from public.p110_command_receipts where tenant_id = $1) as receipts,
      (select count(*)::int from public.p110_event_envelopes where tenant_id = $1) as events,
      (select count(*)::int from public.p110_outbox_messages where tenant_id = $1) as outbox`, [tenantA])).rows[0];
    await pool.query("commit");
    assert.deepEqual(evidence, { events: 0, fulfillment_intents: 0, outbox: 0, receipts: 0 });

    process.stdout.write(`${JSON.stringify({
      contractVersion: SULTAN_AGENT_INTENT_CONTRACT_VERSION,
      evidence,
      result: "PASS",
      scenarios: ["current", "stale-version-and-hash", "tenant-policy-denied", "cross-tenant", "identity-mismatch", "zero-business-writes"],
    })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
