import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  buildRuntimeWebhookVerifier,
  configuredEnvironmentSecretNames,
  configuredWebhookProviders,
  ensureRuntimeWebhookProvider,
  type WebhookRuntimeDatabase,
} from "@/modules/control-plane/webhookRuntime";
import { ProviderWebhookRegistry } from "@/modules/control-plane/webhook";

const tenantId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000002";
const endpointSecret = "local-webhook-hmac-material-at-least-32-bytes";

function database(rows: Array<Record<string, unknown>>): WebhookRuntimeDatabase {
  return {
    async query<T extends Record<string, unknown>>() {
      return { rows: rows as T[] };
    },
  };
}

test("runtime webhook allowlists discard invalid provider and environment names", () => {
  assert.deepEqual([...configuredWebhookProviders("gmail, shopify, INVALID, gmail")], ["gmail", "shopify"]);
  assert.deepEqual([...configuredEnvironmentSecretNames("PILOT_GMAIL_WEBHOOK,not-valid,PILOT_GMAIL_WEBHOOK")], ["PILOT_GMAIL_WEBHOOK"]);
});

test("runtime webhook verifier resolves one connected endpoint through an opaque environment reference", async () => {
  const verifier = buildRuntimeWebhookVerifier("gmail", {
    allowedEnvironmentNames: new Set(["PILOT_GMAIL_WEBHOOK"]),
    database: database([{ connection_id: connectionId, secret_ref: "env:PILOT_GMAIL_WEBHOOK", tenant_id: tenantId }]),
    environmentResolver: () => ({ webhookHmacSha256: endpointSecret }),
  });
  const body = Buffer.from('{"event":"controlled"}');
  const signature = crypto.createHmac("sha256", endpointSecret).update(body).digest("hex");
  const result = await verifier.verify({
    body,
    headers: {
      "x-luzione-webhook-endpoint": "gmail-controlled-pilot",
      "x-provider-event-id": "event-controlled-1",
      "x-provider-event-type": "message.received",
      "x-provider-signature": `sha256=${signature}`,
    },
    receivedAt: "2026-08-29T00:00:00.000Z",
  });
  assert.equal(result.signatureStatus, "VERIFIED");
  assert.equal(result.connectionId, connectionId);
  assert.equal(result.tenantId, tenantId);
});

test("runtime webhook activation is explicit, idempotent and fail closed", async () => {
  const registry = new ProviderWebhookRegistry();
  const options = {
    allowedEnvironmentNames: new Set(["PILOT_GMAIL_WEBHOOK"]),
    allowedProviders: new Set(["gmail"]),
    database: database([]),
    environmentResolver: () => ({ webhookHmacSha256: endpointSecret }),
  };
  assert.equal(ensureRuntimeWebhookProvider("shopify", registry, options), false);
  assert.equal(registry.get("shopify"), undefined);
  assert.equal(ensureRuntimeWebhookProvider("gmail", registry, options), true);
  assert.equal(ensureRuntimeWebhookProvider("gmail", registry, options), true);
  await assert.rejects(
    registry.get("gmail")!.verify({
      body: Buffer.from("{}"),
      headers: { "x-luzione-webhook-endpoint": "missing" },
      receivedAt: "2026-08-29T00:00:00.000Z",
    }),
    /could not be resolved/,
  );
});
