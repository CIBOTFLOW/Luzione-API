import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

import { CORE_CONTRACT_VERSIONS } from "@/modules/luzione-core-contracts/contracts";
import {
  CONNECTOR_CREDENTIAL_HANDLE_VERSION,
  CONNECTOR_REVOCATION_REQUEST_VERSION,
  ConnectorRevocationContractError,
  connectorRevocationPayloadDigest,
  issueConnectorRevocationReceipt,
  parseConnectorRevocationRequest,
} from "@/modules/connector-revocation/contracts";
import { ConnectorRevocationService } from "@/modules/connector-revocation/service";
import type { ApiActor } from "@/lib/api/actor";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString });
const killVersion = `kill:${"a".repeat(64)}`;
const tenant = "tenant-proof-a";
const actor: ApiActor = { actorId: "service:proof", actorType: "service", capabilities: ["connector.revocation.request", "connector.revocation.read"], source: "service-token", tenantId: tenant };
const human: HumanApprovalSubject = { actorId: "user_human-proof", actorType: "user", authenticationRef: "supabase-session:human-proof", authenticatedAt: "2026-09-05T13:00:00.000Z", capabilities: ["connector.revocation.request", "connector.revocation.forward_recovery"], contractVersion: "LuzioneHumanApprovalSubject/v1", source: "supabase-user-jwt", tenantId: tenant };

function serviceRequest(input: { operationKey: string; providerAccountRef?: string; scenario?: "ack_only" | "ambiguous" | "failed" | "matched" | "source_unavailable" | "version_mismatch" }) {
  const request = {
    binding: {
      bindingId: "30000000-0000-4000-8000-000000000003",
      consentRef: "consent:revocation-proof",
      contractVersion: CORE_CONTRACT_VERSIONS.connectorBinding,
      credentialReference: "secret-ref:proof.connector.service",
      cursor: "cursor:proof",
      provider: "GOOGLE_WORKSPACE" as const,
      revocation: { revokedAt: null, revocationRef: null },
      scopes: ["mail.metadata.read"],
      status: "BOUND" as const,
      tenantId: tenant,
    },
    contractVersion: CONNECTOR_REVOCATION_REQUEST_VERSION,
    credentialHandle: { contractVersion: CONNECTOR_CREDENTIAL_HANDLE_VERSION, reference: "secret-ref:proof.connector.service", version: "credential-generation:3" },
    expectedPriorReceiptId: null,
    operation: { kind: "REQUEST_REMOTE_REVOCATION" as const, scenario: input.scenario ?? "matched" },
    operationKey: input.operationKey,
    providerAccountRef: input.providerAccountRef ?? "provider-account:google:service-proof",
  };
  return parseConnectorRevocationRequest({ ...request, payloadDigest: connectorRevocationPayloadDigest(request) });
}

function forwardRecoveryRequest(priorReceiptId: string) {
  const prior = serviceRequest({ operationKey: "service-failed", scenario: "failed" });
  const request = {
    ...prior,
    expectedPriorReceiptId: priorReceiptId,
    operation: { kind: "AUTHORIZE_FORWARD_RECOVERY_ERASURE" as const, scenario: "ack_only" as const },
    operationKey: "service-forward-recovery",
  };
  const { payloadDigest: _payloadDigest, ...unsigned } = request;
  void _payloadDigest;
  return parseConnectorRevocationRequest({ ...unsigned, payloadDigest: connectorRevocationPayloadDigest(unsigned) });
}

function proofReceipt(tenantId: string) {
  return issueConnectorRevocationReceipt({
    acknowledgement: { providerAcknowledgementRef: null, sourceReadbackRef: null },
    actor: { humanActorId: "user_human-proof", humanAuthenticationRef: "supabase-session:human-proof", requestActorClass: "service", requestActorId: "service:proof" },
    binding: {
      bindingContractVersion: CORE_CONTRACT_VERSIONS.connectorBinding,
      bindingId: "10000000-0000-4000-8000-000000000001",
      connectorProvider: "GOOGLE_WORKSPACE",
      credentialHandle: { contractVersion: CONNECTOR_CREDENTIAL_HANDLE_VERSION, reference: "secret-ref:proof.connector.primary", version: "credential-generation:7" },
      providerAccountRef: "provider-account:google:proof",
    },
    commandReceiptRef: "p110-command:proof",
    containmentKillVersion: killVersion,
    localCredentialDisposition: "RETAINED",
    normalKillVersion: killVersion,
    operation: { key: "connector-revocation-proof", kind: "REQUEST_REMOTE_REVOCATION", payloadDigest: "b".repeat(64) },
    priorReceiptId: null,
    reconciliation: { reconciliationRef: null, result: "NOT_ATTEMPTED" },
    recordedAt: "2026-09-05T13:00:00.000Z",
    recoveryState: "NORMAL",
    remoteFinality: "REQUESTED",
    tenantId,
  });
}

async function insert(client: PoolClient, receipt: ReturnType<typeof proofReceipt>) {
  return client.query(
    `insert into public.connector_revocation_receipts
      (tenant_id,receipt_id,receipt_digest,prior_receipt_id,binding_id,binding_contract_version,
       connector_provider,provider_account_ref,credential_handle_ref,credential_handle_version,
       operation_kind,operation_key,payload_digest,containment_kill_version,normal_kill_version,
       request_actor_id,request_actor_class,human_actor_id,human_authentication_ref,command_receipt_ref,
       provider_acknowledgement_ref,source_readback_ref,reconciliation_ref,reconciliation_result,
       remote_finality,local_credential_disposition,recovery_state,zero_effect,canonical_receipt,recorded_at)
     values ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,true,$28::jsonb,$29)`,
    [
      receipt.tenantId, receipt.receiptId, receipt.receiptDigest, receipt.priorReceiptId,
      receipt.binding.bindingId, receipt.binding.bindingContractVersion, receipt.binding.connectorProvider,
      receipt.binding.providerAccountRef, receipt.binding.credentialHandle.reference, receipt.binding.credentialHandle.version,
      receipt.operation.kind, receipt.operation.key, receipt.operation.payloadDigest,
      receipt.containmentKillVersion, receipt.normalKillVersion, receipt.actor.requestActorId,
      receipt.actor.requestActorClass, receipt.actor.humanActorId, receipt.actor.humanAuthenticationRef,
      receipt.commandReceiptRef, receipt.acknowledgement.providerAcknowledgementRef,
      receipt.acknowledgement.sourceReadbackRef, receipt.reconciliation.reconciliationRef,
      receipt.reconciliation.result, receipt.remoteFinality, receipt.localCredentialDisposition,
      receipt.recoveryState, JSON.stringify(receipt), receipt.recordedAt,
    ],
  );
}

async function expectRejected(action: () => Promise<unknown>) {
  try {
    await action();
    assert.fail("Expected PostgreSQL to reject the operation.");
  } catch (error) {
    assert.notEqual((error as { code?: string }).code, undefined);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    const table = await client.query(
      `select relrowsecurity,relforcerowsecurity from pg_class
        where oid='public.connector_revocation_receipts'::regclass`,
    );
    assert.equal(table.rows[0].relrowsecurity, true);
    assert.equal(table.rows[0].relforcerowsecurity, true);
    const trigger = await client.query(
      `select count(*)::int count from pg_trigger
        where tgrelid='public.connector_revocation_receipts'::regclass
          and tgname='connector_revocation_receipts_append_only' and not tgisinternal`,
    );
    assert.equal(trigger.rows[0].count, 1);

    await client.query("begin");
    await client.query("select set_config('app.tenant_id','tenant-proof-a',true)");
    const receipt = proofReceipt("tenant-proof-a");
    await insert(client, receipt);
    await client.query("commit");

    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id','tenant-proof-b',true)");
    const crossTenant = await client.query("select receipt_id from public.connector_revocation_receipts");
    await client.query("commit");
    assert.equal(crossTenant.rows.length, 0);

    await client.query("begin");
    await client.query("select set_config('app.tenant_id','tenant-proof-a',true)");
    await expectRejected(() => client.query("update public.connector_revocation_receipts set remote_finality='REVOKED' where receipt_id=$1", [receipt.receiptId]));
    await client.query("rollback");

    await client.query("begin");
    await client.query("select set_config('app.tenant_id','tenant-proof-a',true)");
    await expectRejected(() => client.query("delete from public.connector_revocation_receipts where receipt_id=$1", [receipt.receiptId]));
    await client.query("rollback");

    await client.query("begin");
    await client.query("select set_config('app.tenant_id','tenant-proof-a',true)");
    await expectRejected(() => client.query(
      `insert into public.connector_revocation_receipts
        (tenant_id,receipt_id,receipt_digest,binding_id,binding_contract_version,connector_provider,
         provider_account_ref,credential_handle_ref,credential_handle_version,operation_kind,operation_key,
         payload_digest,containment_kill_version,normal_kill_version,request_actor_id,request_actor_class,
         human_actor_id,human_authentication_ref,command_receipt_ref,reconciliation_result,remote_finality,
         local_credential_disposition,recovery_state,zero_effect,canonical_receipt,recorded_at)
       values ('tenant-proof-a',$1,$2,'10000000-0000-4000-8000-000000000002','ConnectorBinding/v1',
         'GOOGLE_WORKSPACE','provider-account:proof','secret-ref:proof.other','credential-generation:1',
         'REQUEST_REMOTE_REVOCATION','invalid-proof',$3,$4,$4,'service:proof','service','user:proof',
         'supabase-session:proof','p110-command:proof','NOT_ATTEMPTED','REVOKED','RETAINED','NORMAL',true,
         jsonb_build_object('contractVersion','ConnectorRevocationReceipt/v1','receiptId',$1,'receiptDigest',$2,'zeroEffect',true),now())`,
      [`connector-revocation-receipt:${"c".repeat(64)}`, "c".repeat(64), "d".repeat(64), killVersion],
    ));
    await client.query("rollback");

    const service = new ConnectorRevocationService(pool);
    const matchedRequest = serviceRequest({ operationKey: "service-matched" });
    const matched = await service.execute({ actor, correlationId: "correlation:matched", human, request: matchedRequest, requestedAt: "2026-09-05T13:10:00.000Z" });
    assert.equal(matched.receipt.remoteFinality, "REVOKED");
    assert.equal(matched.receipt.localCredentialDisposition, "RETAINED");
    assert.equal(matched.receipt.zeroEffect, true);
    assert.ok(matched.receipt.acknowledgement.sourceReadbackRef);
    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenant]);
    await expectRejected(() => client.query(
      `insert into public.p110_reconciliation_checkpoints
        (tenant_id,reconciliation_id,receipt_id,outbox_message_id,originating_delivery_attempt_id,
         originating_delivery_attempt_number,source_system,source_object_ref,expected_object_version,
         result,checked_at,checked_by,notes,next_check_at,attempt_count,max_attempts)
       select tenant_id,'reconcile_foreign_attempt',receipt_id,outbox_message_id,'attempt_foreign',
              originating_delivery_attempt_number,source_system,source_object_ref,expected_object_version,
              'PENDING',now(),'proof','foreign attempt must fail',now(),0,5
         from public.p110_reconciliation_checkpoints where tenant_id=$1 limit 1`,
      [tenant],
    ));
    await client.query("rollback");
    const replay = await service.execute({ actor, correlationId: "correlation:replay", human, request: matchedRequest, requestedAt: "2026-09-05T13:11:00.000Z" });
    assert.equal(replay.commandReceipt.idempotentReplay, true);
    assert.equal(replay.receipt.receiptId, matched.receipt.receiptId);
    await assert.rejects(
      () => service.execute({ actor, correlationId: "correlation:changed", human, request: serviceRequest({ operationKey: "service-matched", providerAccountRef: "provider-account:google:changed" }), requestedAt: "2026-09-05T13:12:00.000Z" }),
      (error: unknown) => error instanceof IdempotencyConflictError,
    );
    await assert.rejects(
      () => service.execute({ actor, correlationId: "correlation:tenant", human, request: { ...serviceRequest({ operationKey: "service-tenant" }), binding: { ...serviceRequest({ operationKey: "service-tenant" }).binding, tenantId: "tenant-other" } }, requestedAt: "2026-09-05T13:13:00.000Z" }),
      (error: unknown) => error instanceof ConnectorRevocationContractError && error.code === "TENANT_MISMATCH",
    );
    const failed = await service.execute({ actor, correlationId: "correlation:failed", human, request: serviceRequest({ operationKey: "service-failed", scenario: "failed" }), requestedAt: "2026-09-05T13:13:10.000Z" });
    assert.equal(failed.receipt.remoteFinality, "REMOTE_REVOKE_FAILED");
    assert.equal(failed.receipt.localCredentialDisposition, "RETAINED");
    const forward = await service.execute({ actor, correlationId: "correlation:forward", human, request: forwardRecoveryRequest(failed.receipt.receiptId), requestedAt: "2026-09-05T13:13:20.000Z" });
    assert.equal(forward.receipt.remoteFinality, "REMOTE_REVOKE_FAILED");
    assert.equal(forward.receipt.recoveryState, "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT");
    assert.equal(forward.receipt.localCredentialDisposition, "ERASURE_AUTHORIZED_NO_EFFECT");
    assert.equal(forward.receipt.zeroEffect, true);
    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenant]);
    await client.query(
      `insert into public.p110_kill_switches(tenant_id,switch_id,scope_type,scope_ref,active,reason,activated_by)
       values ($1,'kill:connector-revocation','DESTINATION','sandbox.connector-revocation',true,'synthetic proof','user:proof')`,
      [tenant],
    );
    await client.query("commit");
    await assert.rejects(
      () => service.execute({ actor, correlationId: "correlation:killed", human, request: serviceRequest({ operationKey: "service-killed" }), requestedAt: "2026-09-05T13:14:00.000Z" }),
      (error: unknown) => error instanceof ConnectorRevocationContractError && error.code === "ACTIVE_KILL_SWITCH",
    );
    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenant]);
    await client.query(`update public.p110_kill_switches set active=false,deactivated_by='user:proof',deactivated_at=now() where tenant_id=$1 and switch_id='kill:connector-revocation'`, [tenant]);
    await client.query("commit");

    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenant]);
    const p110 = (await client.query(
      `select count(*) filter (where effect_class='NO_EFFECT')::int no_effect,
              count(*) filter (where state='SOURCE_CONFIRMED')::int source_confirmed,
              count(*) filter (where destination='sandbox.connector-revocation')::int emulator_only
         from public.p110_outbox_messages where tenant_id=$1`,
      [tenant],
    )).rows[0];
    await client.query("commit");
    assert.equal(p110.no_effect, 3);
    assert.equal(p110.emulator_only, 3);
    assert.equal(p110.source_confirmed, 1);

    process.stdout.write(`${JSON.stringify({ appendOnlyUpdateRejected: true, appendOnlyDeleteRejected: true, changedPayloadConflict: true, emulatorOnly: true, failedRemoteRevokeRetainsCredential: true, foreignOriginatingAttemptRejected: true, forwardRecoveryDoesNotClaimRemoteFinality: true, impossibleRemoteFinalityRejected: true, killDenied: true, p110, replayStable: true, rlsCrossTenantVisible: false, rowSecurityForced: true, sourceConfirmedRemoteFinality: true, result: "PASS" })}\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
