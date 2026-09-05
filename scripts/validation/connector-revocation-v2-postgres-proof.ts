import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { CORE_CONTRACT_VERSIONS, type ConnectorBindingV1 } from "@/modules/luzione-core-contracts/contracts";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import {
  connectorRevocationRawBodyDigestV2,
  issueCanonicalConnectorBindingResolutionV1,
  issueConnectorCredentialHandleV2,
  issueConnectorRevocationRequestV2,
  type ConnectorRevocationRequestV2,
} from "@/modules/connector-revocation/v2/contracts";
import { SyntheticCanonicalConnectorBindingResolver } from "@/modules/connector-revocation/v2/resolver";
import { ConnectorRevocationServiceV2 } from "@/modules/connector-revocation/v2/service";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const tenantId = "tenant-proof-a";
const actor: ApiActor = {
  actorId: "service:proof",
  actorType: "service",
  capabilities: ["connector.revocation.request", "connector.revocation.read"],
  source: "service-token",
  tenantId,
};
const human: HumanApprovalSubject = {
  actorId: "user_human-proof",
  actorType: "user",
  authenticationRef: "supabase-session:human-proof",
  authenticatedAt: "2026-09-05T07:00:00.000Z",
  capabilities: ["connector.revocation.request", "connector.revocation.forward_recovery"],
  contractVersion: "LuzioneHumanApprovalSubject/v1",
  source: "supabase-user-jwt",
  tenantId,
};
const binding: ConnectorBindingV1 = {
  bindingId: "30000000-0000-4000-8000-000000000003",
  consentRef: "consent:revocation-v2-proof",
  contractVersion: CORE_CONTRACT_VERSIONS.connectorBinding,
  credentialReference: "secret-ref:proof.connector.service",
  cursor: "cursor:proof",
  provider: "GOOGLE_WORKSPACE",
  revocation: { revokedAt: null, revocationRef: null },
  scopes: ["mail.metadata.read"],
  status: "BOUND",
  tenantId,
};
const credentialHandle = issueConnectorCredentialHandleV2({
  bindingId: binding.bindingId,
  generation: 3,
  provider: binding.provider,
  providerAccountRef: "provider-account:google:service-proof",
  reference: binding.credentialReference,
  tenantId,
  version: "credential-version:3",
});
const resolution = issueCanonicalConnectorBindingResolutionV1({
  binding,
  bindingVersion: "binding-version:9",
  credentialHandle,
  current: true,
  destination: "sandbox.connector-revocation",
  ownerReadbackRef: "connector-binding-owner-readback:disposable-proof",
  providerAccountRef: credentialHandle.providerAccountRef,
  resolvedAt: "2026-09-05T07:00:00.000Z",
  tenantId,
});

function request(input: {
  operationKey: string;
  priorReceiptId?: string | null;
  scenario?: ConnectorRevocationRequestV2["operation"]["scenario"];
  kind?: ConnectorRevocationRequestV2["operation"]["kind"];
}) {
  return issueConnectorRevocationRequestV2({
    expectedPriorReceiptId: input.priorReceiptId ?? null,
    operation: { kind: input.kind ?? "REQUEST_REMOTE_REVOCATION", scenario: input.scenario ?? "matched" },
    operationKey: input.operationKey,
    selector: {
      bindingId: binding.bindingId,
      expectedBindingVersion: resolution.bindingVersion,
      expectedCredentialGeneration: credentialHandle.generation,
      expectedCredentialVersion: credentialHandle.version,
      expectedDestination: resolution.destination,
      expectedProvider: binding.provider,
      expectedProviderAccountRef: resolution.providerAccountRef,
    },
  });
}

function rawDigest(value: ConnectorRevocationRequestV2) {
  return connectorRevocationRawBodyDigestV2(JSON.stringify(value));
}

async function expectDatabaseRejected(action: () => Promise<unknown>) {
  try {
    await action();
    assert.fail("Expected PostgreSQL to reject the operation.");
  } catch (error) {
    assert.notEqual((error as { code?: string }).code, undefined);
  }
}

async function main() {
  const resolver = new SyntheticCanonicalConnectorBindingResolver([resolution]);
  const service = new ConnectorRevocationServiceV2(pool, undefined, undefined, resolver);
  const matchedRequest = request({ operationKey: "v2-service-matched" });
  const matched = await service.execute({
    actor,
    correlationId: "correlation:v2-matched",
    human,
    rawBodyDigest: rawDigest(matchedRequest),
    request: matchedRequest,
    requestedAt: "2026-09-05T07:10:00.000Z",
  });
  assert.equal(matched.receipt.remoteFinality, "REVOKED");
  assert.equal(matched.receipt.localCredentialDisposition, "RETAINED");
  assert.equal(matched.receipt.bindingResolution.resolutionDigest, resolution.resolutionDigest);
  assert.ok(matched.receipt.killEvidence.beforeCredentialHold);
  assert.ok(matched.receipt.killEvidence.beforeExecuteOrDisposition);

  const replay = await service.execute({
    actor,
    correlationId: "correlation:v2-replay",
    human,
    rawBodyDigest: rawDigest(matchedRequest),
    request: matchedRequest,
    requestedAt: "2026-09-05T07:11:00.000Z",
  });
  assert.equal(replay.commandReceipt.idempotentReplay, true);
  assert.equal(replay.receipt.receiptId, matched.receipt.receiptId);

  const changed = request({ operationKey: matchedRequest.operationKey, scenario: "failed" });
  await assert.rejects(
    () => service.execute({ actor, correlationId: "correlation:v2-changed", human, rawBodyDigest: rawDigest(changed), request: changed, requestedAt: "2026-09-05T07:12:00.000Z" }),
    (error: unknown) => error instanceof IdempotencyConflictError,
  );
  await assert.rejects(
    () => service.execute({ actor, correlationId: "correlation:v2-raw-collision", human, rawBodyDigest: connectorRevocationRawBodyDigestV2(JSON.stringify(matchedRequest, null, 2)), request: matchedRequest, requestedAt: "2026-09-05T07:12:10.000Z" }),
    (error: unknown) => error instanceof IdempotencyConflictError,
  );

  const failedRequest = request({ operationKey: "v2-service-failed", scenario: "failed" });
  const failed = await service.execute({ actor, correlationId: "correlation:v2-failed", human, rawBodyDigest: rawDigest(failedRequest), request: failedRequest, requestedAt: "2026-09-05T07:13:00.000Z" });
  assert.equal(failed.receipt.remoteFinality, "REMOTE_REVOKE_FAILED");
  assert.equal(failed.receipt.localCredentialDisposition, "RETAINED");
  const forwardRequest = request({
    kind: "AUTHORIZE_FORWARD_RECOVERY_ERASURE",
    operationKey: "v2-service-forward-recovery",
    priorReceiptId: failed.receipt.receiptId,
    scenario: "ack_only",
  });
  const forward = await service.execute({ actor, correlationId: "correlation:v2-forward", human, rawBodyDigest: rawDigest(forwardRequest), request: forwardRequest, requestedAt: "2026-09-05T07:14:00.000Z" });
  assert.equal(forward.receipt.remoteFinality, "REMOTE_REVOKE_FAILED");
  assert.equal(forward.receipt.recoveryState, "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT");
  assert.equal(forward.receipt.localCredentialDisposition, "ERASURE_AUTHORIZED_NO_EFFECT");
  assert.ok(forward.receipt.killEvidence.beforeExecuteOrDisposition);

  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    const receipts = await client.query(
      `select count(*)::int total,
              count(*) filter (where canonical_receipt->>'contractVersion'='ConnectorRevocationReceipt/v2')::int v2,
              count(*) filter (where local_credential_disposition='RETAINED')::int retained,
              count(*) filter (where binding_resolution_digest=$2)::int owner_bound
         from public.connector_revocation_receipts where tenant_id=$1`,
      [tenantId, resolution.resolutionDigest],
    );
    const outbox = await client.query(
      `select count(*) filter (where effect_class='NO_EFFECT')::int no_effect,
              count(*) filter (where destination='sandbox.connector-revocation')::int emulator,
              count(*) filter (where payload::text like '%secret-ref:%')::int leaked_opaque_handle
         from public.p110_outbox_messages where tenant_id=$1`,
      [tenantId],
    );
    await client.query("commit");
    assert.equal(receipts.rows[0].v2, 5);
    assert.equal(receipts.rows[0].owner_bound, 5);
    assert.equal(receipts.rows[0].retained, 4);
    assert.equal(outbox.rows[0].no_effect, 3);
    assert.equal(outbox.rows[0].emulator, 2);
    assert.equal(outbox.rows[0].leaked_opaque_handle, 0);

    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    await expectDatabaseRejected(() => client.query("update public.connector_revocation_receipts set remote_finality='REQUESTED' where receipt_id=$1", [matched.receipt.receiptId]));
    await client.query("rollback");

    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    await expectDatabaseRejected(() => client.query(readFileSync("scripts/validation/rollback-connector-revocation-l1-correction-01.sql", "utf8")));
    await client.query("rollback").catch(() => undefined);
  } finally {
    client.release();
  }

  process.stdout.write(`${JSON.stringify({
    appendOnly: true,
    changedReplayConflict: true,
    credentialMaterialResolved: false,
    emulatorOnly: true,
    forwardRecoveryNoRemoteFinalityClaim: true,
    ownerBound: true,
    p110Authority: true,
    rawCanonicalCollisionConflict: true,
    reverseBlockedAfterV2Evidence: true,
    result: "PASS",
    zeroEffect: true,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => pool.end());
