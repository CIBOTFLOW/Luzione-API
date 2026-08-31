import assert from "node:assert/strict";
import { Pool } from "pg";
import { PostgresWorkflowDeliveryStore } from "@/lib/platform-guarantees/postgresWorkflowDeliveryStore";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { assertObservation, providerMessageFromRow, PROVIDER_ADAPTER_CONTRACT_VERSION } from "@/modules/provider-runtime/contracts";
import { ProviderAdapterRegistry } from "@/modules/provider-runtime/registry";
import { ProviderWorkerRuntime } from "@/modules/provider-runtime/runtime";
import { SandboxEchoProviderAdapter } from "@/modules/provider-runtime/sandboxEchoAdapter";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const tenantId = "api-pc-011-a";
const pool = new Pool({ connectionString });
const store = new PostgresWorkflowDeliveryStore(pool);
const adapter = new SandboxEchoProviderAdapter();
const runtime = new ProviderWorkerRuntime(store, new ProviderAdapterRegistry([adapter]));

async function seed(label: string, scenario: string, destination = "sandbox.echo", payloadHashOverride?: string) {
  const payload = { scenario };
  const payloadHash = payloadHashOverride ?? sha256(payload);
  const values = [tenantId, label, destination, JSON.stringify(payload), payloadHash];
  await pool.query(
    `insert into public.p110_command_receipts (
       tenant_id,receipt_id,command_id,command_type,idempotency_key,payload_hash,correlation_id,
       target_owner_project,target_object_type,target_object_id,expected_object_version,
       committed_object_version,policy_version,actor_id,actor_type,state,event_id,outbox_message_id,
       requested_at,committed_at
     ) values ($1,'receipt-'||$2,'command-'||$2,'sandbox.provider.command','idempotency-'||$2,$3,
       'correlation-'||$2,'CIBOTFLOW/Luzione-API','order','order-'||$2,'order:'||$2||':v0',
       'order:'||$2||':v1','api-pc-011-proof','proof-service','service','DISPATCH_PENDING',
       'event-'||$2,'outbox-'||$2,now(),now())`,
    [tenantId, label, payloadHash],
  );
  await pool.query(
    `insert into public.p110_event_envelopes (
       tenant_id,event_id,event_type,event_version,authority_class,producer_project,
       subject_owner_project,subject_object_type,subject_object_id,subject_object_version,
       actor_id,actor_type,correlation_id,command_id,idempotency_key,occurred_at,recorded_at,
       payload,payload_hash
     ) values ($1,'event-'||$2,'sandbox.provider.requested',1,'COMMAND_EVIDENCE','CIBOTFLOW/Luzione-API',
       'CIBOTFLOW/Luzione-API','order','order-'||$2,'order:'||$2||':v1','proof-service','service',
       'correlation-'||$2,'command-'||$2,'idempotency-'||$2,now(),now(),$3::jsonb,$4)`,
    [tenantId, label, JSON.stringify(payload), payloadHash],
  );
  await pool.query(
    `insert into public.p110_outbox_messages (
       tenant_id,outbox_message_id,receipt_id,event_id,destination,effect_class,authorization_ref,
       idempotency_key,payload,payload_hash,state
     ) values ($1,'outbox-'||$2,'receipt-'||$2,'event-'||$2,$3,'EXTERNAL_EFFECT',
       'sandbox-authorization:'||$2,'idempotency-'||$2,$4::jsonb,$5,'PENDING')`,
    values,
  );
}

async function main() {
  try {
    if (process.env.PROOF_SHAPE === "observed") {
      const legacy = await pool.query(`select attempt_count,max_attempts,next_check_at,lease_owner from public.p110_reconciliation_checkpoints where tenant_id='api-pc-011-observed-legacy' and reconciliation_id='reconcile-legacy'`);
      assert.equal(legacy.rows.length, 1); assert.equal(legacy.rows[0].attempt_count, 0); assert.equal(legacy.rows[0].max_attempts, 5); assert.equal(legacy.rows[0].lease_owner, null); assert.ok(legacy.rows[0].next_check_at);
    }

    await seed("success", "matched");
    const successDelivery = await runtime.runDeliveryBatch({ tenantId, workerId: "worker-success" });
    assert.equal(successDelivery.outcomes[0].state, "PROVIDER_ACKNOWLEDGED");
    const competing = await Promise.all([
      store.claimDueReconciliations({ limit: 1, tenantId, workerId: "worker-reconcile-a" }),
      store.claimDueReconciliations({ limit: 1, tenantId, workerId: "worker-reconcile-b" }),
    ]);
    assert.equal(competing[0].length + competing[1].length, 1);
    const claimed = (competing[0][0] ?? competing[1][0]) as Record<string, unknown>;
    const owner = competing[0].length ? "worker-reconcile-a" : "worker-reconcile-b";
    const message = providerMessageFromRow(claimed); const prepared = await adapter.prepare(message); const observed = assertObservation(await adapter.observe(prepared, String(claimed.provider_acknowledgement_ref)), message.resultingObjectVersion);
    await store.completeClaimedReconciliation({ observedObjectVersion: observed.observedObjectVersion, reconciliationId: String(claimed.reconciliation_id), result: observed.result, sourceReadbackRef: observed.sourceReadbackRef, tenantId, workerId: owner });

    await seed("ambiguous", "ambiguous"); await seed("rate", "rate_limited"); await seed("permanent", "permanent");
    await seed("altered", "matched", "sandbox.echo", "0".repeat(64)); await seed("unknown", "matched", "provider.missing");
    const mixed = await runtime.runDeliveryBatch({ limit: 10, tenantId, workerId: "worker-mixed" });
    assert.equal(mixed.claimed, 5);
    assert.equal(mixed.outcomes.find((item) => item.outboxMessageId === "outbox-ambiguous")?.state, "RECONCILIATION_REQUIRED");
    assert.equal(mixed.outcomes.find((item) => item.outboxMessageId === "outbox-rate")?.state, "RETRY_SCHEDULED");
    await runtime.runReconciliationBatch({ limit: 10, tenantId, workerId: "worker-reconcile" });

    await seed("crash", "matched");
    const crashClaim = await store.claimDueOutbox({ limit: 1, tenantId, workerId: "worker-crashed" }); assert.equal(crashClaim.length, 1);
    const crashMessage = providerMessageFromRow(crashClaim[0]); const crashPrepared = await adapter.prepare(crashMessage);
    await store.recordDispatchStarted({ adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION, outboxMessageId: crashMessage.outboxMessageId, providerMode: adapter.mode, providerRequestRef: crashPrepared.providerRequestRef, tenantId, workerId: "worker-crashed" });
    await pool.query(`update public.p110_outbox_messages set locked_at=now()-interval '2 minutes',heartbeat_at=now()-interval '90 seconds',request_deadline_at=now()-interval '70 seconds',lease_expires_at=now()-interval '60 seconds' where tenant_id=$1 and outbox_message_id=$2`, [tenantId, crashMessage.outboxMessageId]);
    await runtime.runDeliveryBatch({ limit: 10, tenantId, workerId: "worker-reclaimer" });
    const crashState = await pool.query(`select state,last_error_code from public.p110_outbox_messages where tenant_id=$1 and outbox_message_id=$2`, [tenantId, crashMessage.outboxMessageId]);
    assert.deepEqual(crashState.rows[0], { last_error_code: "WORKER_LOST_AFTER_DISPATCH", state: "RECONCILIATION_REQUIRED" });
    await runtime.runReconciliationBatch({ limit: 10, tenantId, workerId: "worker-crash-reconcile" });

    await seed("killed", "matched");
    await pool.query(`insert into public.p110_kill_switches(tenant_id,switch_id,scope_type,scope_ref,reason,activated_by) values($1,'switch-sandbox','DESTINATION','sandbox.echo','proof kill switch','proof')`, [tenantId]);
    assert.equal((await runtime.runDeliveryBatch({ limit: 10, tenantId, workerId: "worker-killed" })).claimed, 0);
    await pool.query(`update public.p110_kill_switches set active=false,deactivated_by='proof',deactivated_at=now() where tenant_id=$1 and switch_id='switch-sandbox'`, [tenantId]);
    await runtime.runDeliveryBatch({ limit: 10, tenantId, workerId: "worker-after-kill" }); await runtime.runReconciliationBatch({ limit: 10, tenantId, workerId: "worker-after-kill-reconcile" });

    const evidence = (await pool.query(
      `select
        (select count(*)::int from public.p110_outbox_messages where tenant_id=$1 and state='SOURCE_CONFIRMED') source_confirmed,
        (select count(*)::int from public.p110_outbox_messages where tenant_id=$1 and state='RETRY_SCHEDULED') retry_scheduled,
        (select count(*)::int from public.p110_outbox_messages where tenant_id=$1 and state='DEAD_LETTERED') dead_lettered,
        (select count(*)::int from public.p110_reconciliation_checkpoints where tenant_id=$1 and result='MATCHED') reconciled,
        (select count(*)::int from public.p110_delivery_attempts where tenant_id=$1 and result='SUCCEEDED') acknowledged,
        (select count(*)::int from public.p110_delivery_attempts where tenant_id=$1 and error_code='WORKER_LOST_AFTER_DISPATCH') crash_recovered`,
      [tenantId],
    )).rows[0];
    assert.deepEqual(evidence, { acknowledged: 2, crash_recovered: 1, dead_lettered: 3, reconciled: 4, retry_scheduled: 1, source_confirmed: 4 });
    const operations = await store.readProviderOperations({ tenantId }); assert.equal(operations.deadLetterCount, 3); assert.ok(operations.destinations.length >= 4);
    const otherTenant = await store.readProviderOperations({ tenantId: "api-pc-011-b" }); assert.equal(otherTenant.destinations.length, 0); assert.equal(otherTenant.deadLetterCount, 0);
    process.stdout.write(`${JSON.stringify({ contractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION, evidence, operatorDestinations: operations.destinations.length, result: "PASS" })}\n`);
  } finally { await pool.end(); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
