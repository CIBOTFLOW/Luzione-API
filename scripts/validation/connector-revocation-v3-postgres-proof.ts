import assert from "node:assert/strict";
import { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { killState } from "@/modules/effect-admission/contracts";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import { SyntheticConnectorBindingReadbackResolverV1 } from "@/modules/connector-revocation/tests/fixtures/syntheticCanonicalConnectorBindingResolvers";
import {
  connectorRevocationRawBodyDigestV3,
  issueConnectorBindingReadbackV1,
  issueConnectorRevocationRequestV3,
  type ConnectorRevocationRequestV3,
} from "@/modules/connector-revocation/v3/contracts";
import { ConnectorRevocationServiceV3 } from "@/modules/connector-revocation/v3/service";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const tenantId = "tenant-proof-a";
const bindingId = "60000000-0000-4000-8000-000000000006";
const actor: ApiActor = { actorId: "service:proof", actorType: "service", capabilities: ["connector.revocation.request", "connector.revocation.read"], source: "service-token", tenantId };
const human: HumanApprovalSubject = { actorId: "user_human-proof", actorType: "user", authenticationRef: "supabase-session:human-proof", authenticatedAt: "2026-09-05T16:00:00.000Z", capabilities: ["connector.revocation.request", "connector.revocation.forward_recovery"], contractVersion: "LuzioneHumanApprovalSubject/v1", source: "supabase-user-jwt", tenantId };
const bindingReadback = issueConnectorBindingReadbackV1({
  bindingId,
  bindingVersion: "binding-version:30",
  credential: { contentBindingDigest: "c".repeat(64), generation: 12, version: "credential-version:12" },
  destination: "sandbox.connector-revocation",
  observedAt: "2026-09-05T16:00:00.000Z",
  provider: "GOOGLE_WORKSPACE",
  providerAccountRef: "provider-account:google:proof-006",
  revocation: { revokedAt: null, revocationReadbackId: null },
  status: "BOUND",
  tenantId,
});

class OpenKillReader {
  async read() { return killState([]); }
}

function request(scenario: ConnectorRevocationRequestV3["operation"]["scenario"] = "matched") {
  return issueConnectorRevocationRequestV3({
    expectedPriorReadbackId: null,
    operation: { kind: "REQUEST_REMOTE_REVOCATION", scenario },
    operationKey: "connector-revocation-v3-disposable-proof",
    selector: { bindingId, expectedBindingHeadDigest: bindingReadback.bindingHeadDigest, expectedCredentialGeneration: bindingReadback.credential.generation },
  });
}

function rawDigest(value: ConnectorRevocationRequestV3) { return connectorRevocationRawBodyDigestV3(JSON.stringify(value)); }

async function main() {
  const service = new ConnectorRevocationServiceV3(pool, new OpenKillReader(), new SyntheticConnectorBindingReadbackResolverV1([bindingReadback]));
  const original = request();
  const first = await service.execute({ actor, correlationId: "correlation:v3-first", human, rawBodyDigest: rawDigest(original), request: original, requestedAt: "2026-09-05T16:10:00.000Z" });
  assert.equal(first.commandReceipt.idempotentReplay, false);
  assert.equal(first.readback.remoteFinality, "REQUESTED");
  assert.equal(first.readback.zeroEffect, true);
  assert.equal(first.readback.binding.bindingHeadDigest, bindingReadback.bindingHeadDigest);

  const replay = await service.execute({ actor, correlationId: "correlation:v3-replay", human, rawBodyDigest: rawDigest(original), request: original, requestedAt: "2026-09-05T16:11:00.000Z" });
  assert.equal(replay.commandReceipt.idempotentReplay, true);
  assert.equal(replay.readback.readbackId, first.readback.readbackId);

  const changed = request("failed");
  await assert.rejects(
    () => service.execute({ actor, correlationId: "correlation:v3-changed", human, rawBodyDigest: rawDigest(changed), request: changed, requestedAt: "2026-09-05T16:12:00.000Z" }),
    (error: unknown) => error instanceof IdempotencyConflictError,
  );

  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    const v3 = await client.query(
      `select count(*)::int total,
              count(*) filter (where credential_handle_ref is null and credential_handle_version is null)::int locator_null,
              count(*) filter (where canonical_receipt::text ~* 'secret-ref:|token-ref:|credential-ref:|vault:|kms:|oauth-token:|Bearer ')::int locator_value_leaks,
              count(*) filter (where canonical_readback::text ~ 'receiptId|receiptDigest|payloadDigest|credentialHandle|credentialReference')::int private_field_leaks
         from public.connector_revocation_receipts
        where tenant_id=$1 and canonical_receipt->>'contractVersion'='ConnectorRevocationReceipt/v3'`,
      [tenantId],
    );
    const legacy = await client.query(
      `select count(*)::int total,
              count(*) filter (where credential_handle_ref is not null and public_readback_id is null and canonical_readback is null)::int preserved_private
         from public.connector_revocation_receipts
        where tenant_id=$1 and canonical_receipt->>'contractVersion'='ConnectorRevocationReceipt/v2'`,
      [tenantId],
    );
    const outbox = await client.query(
      `select count(*) filter (where destination='INTERNAL_WORKFLOW' and effect_class='NO_EFFECT')::int internal_no_effect,
              count(*) filter (where payload::text ~* 'secret-ref:|credential-ref:|vault:|oauth-token:|Bearer ')::int locator_leaks
         from public.p110_outbox_messages where tenant_id=$1 and idempotency_key like 'connector-revocation:%'`,
      [tenantId],
    );
    await client.query("commit");
    assert.equal(v3.rows[0].total, 1);
    assert.equal(v3.rows[0].locator_null, 1);
    assert.equal(v3.rows[0].locator_value_leaks, 0);
    assert.equal(v3.rows[0].private_field_leaks, 0);
    assert.equal(legacy.rows[0].total, 5);
    assert.equal(legacy.rows[0].preserved_private, 5);
    assert.equal(outbox.rows[0].internal_no_effect, 1);
    assert.equal(outbox.rows[0].locator_leaks, 0);

    const columns = await client.query(
      `select count(*)::int total from information_schema.columns
        where table_schema='public' and table_name='connector_revocation_receipts'
          and column_name in ('binding_readback_contract_version','binding_head_digest','credential_content_digest','public_readback_id','public_readback_digest','request_raw_digest','canonical_readback')`,
    );
    assert.equal(columns.rows[0].total, 7);
  } finally { client.release(); }

  process.stdout.write(`${JSON.stringify({
    appendOnlyV3: true,
    changedReplayConflict: true,
    legacyLocatorRowsPrivateAndPreserved: true,
    locatorFreePublicReadback: true,
    noCredentialResolution: true,
    noProviderDispatch: true,
    p110ReservationAuthority: true,
    reversePreconditionPopulated: true,
    result: "PASS",
    syntheticResolverTestOnly: true,
    zeroEffect: true,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => pool.end());
