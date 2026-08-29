import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  HmacSha256WebhookVerifier,
  MAX_WEBHOOK_BYTES,
  ProviderWebhookRegistry,
  readBoundedWebhookBody,
} from "../webhook";

const body = new TextEncoder().encode('{"event":"reply"}');
const tenantId = "1ef8061d-1c82-4e7e-8e45-9123e17f8b0a";
const connectionId = "d873b07e-2de3-45f7-b46d-d3dc7db100a9";
const secret = "test-only-signing-secret";

function headers(signature: string) {
  return {
    "x-luzione-webhook-endpoint": "endpoint-1",
    "x-provider-event-id": "evt-123",
    "x-provider-event-type": "message.reply",
    "x-provider-signature": `sha256=${signature}`,
  };
}

test("HMAC webhook verification derives tenant context from the resolved endpoint", async () => {
  const verifier = new HmacSha256WebhookVerifier(async (endpoint) => endpoint === "endpoint-1"
    ? { connectionId, secret, tenantId }
    : null);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const verified = await verifier.verify({ body, headers: headers(signature), receivedAt: "2026-08-28T00:00:00Z" });
  assert.equal(verified.signatureStatus, "VERIFIED");
  assert.equal(verified.tenantId, tenantId);
  assert.equal(verified.connectionId, connectionId);
  assert.equal(verified.providerEventId, "evt-123");
  assert.match(verified.deduplicationKey, /^[a-f0-9]{64}$/);
  const rejected = await verifier.verify({ body, headers: headers("0".repeat(64)), receivedAt: "2026-08-28T00:00:00Z" });
  assert.equal(rejected.signatureStatus, "REJECTED");
});

test("registry rejects duplicate adapters and unknown providers remain fail-closed", () => {
  const registry = new ProviderWebhookRegistry();
  const verifier = new HmacSha256WebhookVerifier(async () => null);
  registry.register("gmail", verifier);
  assert.equal(registry.get("gmail"), verifier);
  assert.equal(registry.get("shopify"), undefined);
  assert.throws(() => registry.register("gmail", verifier), /already registered/);
});

test("webhook bodies are bounded before verification", async () => {
  const request = new Request("https://api.luzione.com/api/v1/webhooks/gmail", {
    body: new Uint8Array(MAX_WEBHOOK_BYTES + 1),
    method: "POST",
  });
  await assert.rejects(readBoundedWebhookBody(request), /too large/);
});

test("route acknowledges only after digest-only durable persistence", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/v1/webhooks/[provider]/route.ts"),
    "utf8",
  );
  const store = fs.readFileSync(
    path.join(process.cwd(), "src/lib/control-plane/webhookStore.ts"),
    "utf8",
  );
  assert.match(route, /await persistWebhookReceipt/);
  assert.match(route, /processing: "ASYNCHRONOUS"/);
  assert.match(route, /status: durable\.duplicate \? 200 : 202/);
  assert.match(store, /payloadDigest = crypto\.createHash\("sha256"\)/);
  assert.doesNotMatch(store, /insert[\s\S]*payload\s*[,)]/i);
  assert.match(store, /on conflict do nothing/);
});
