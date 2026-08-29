import "server-only";

import crypto from "node:crypto";

import { databasePool } from "@/lib/db";
import type { WebhookVerification } from "@/modules/control-plane/webhook";

export async function persistWebhookReceipt(input: {
  body: Uint8Array;
  provider: string;
  verification: WebhookVerification;
}) {
  const payloadDigest = crypto.createHash("sha256").update(input.body).digest("hex");
  const state = input.verification.signatureStatus === "VERIFIED" ? "RECEIVED" : "REJECTED";
  const result = await databasePool().query(
    `insert into public.integration_webhook_receipts
      (tenant_id, connection_id, provider, provider_event_id, event_type,
       payload_digest, deduplication_key, signature_status, state, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict do nothing
     returning webhook_receipt_id, signature_status, state, received_at`,
    [
      input.verification.tenantId,
      input.verification.connectionId,
      input.provider,
      input.verification.providerEventId,
      input.verification.eventType,
      payloadDigest,
      input.verification.deduplicationKey,
      input.verification.signatureStatus,
      state,
      input.verification.correlationId,
    ],
  );
  if (result.rows.length === 1) {
    return { duplicate: false, payloadDigest, receipt: result.rows[0] };
  }
  const duplicate = await databasePool().query(
    `select webhook_receipt_id, signature_status, state, received_at
     from public.integration_webhook_receipts
     where tenant_id = $1 and provider = $2
       and (provider_event_id = $3 or deduplication_key = $4)
     limit 1`,
    [
      input.verification.tenantId,
      input.provider,
      input.verification.providerEventId,
      input.verification.deduplicationKey,
    ],
  );
  if (duplicate.rows.length !== 1) throw new Error("Webhook deduplication readback failed.");
  return { duplicate: true, payloadDigest, receipt: duplicate.rows[0] };
}
