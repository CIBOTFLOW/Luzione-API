import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("07 CustomerReply stays draft, unreserved and unverified", () => {
  const handoff = makeDocument("SupportOutputHandoff/v1", payloadFor("SupportOutputHandoff/v1"));
  assert.equal((parseByVersion("SupportOutputHandoff/v1", handoff) as { finality: string }).finality, "NOT_FINAL");

  const delivered = makeDocument("SupportOutputHandoff/v1", payloadFor("SupportOutputHandoff/v1"));
  const reply = delivered.payload.draft_CustomerReply as Record<string, unknown>;
  reply.delivery = { deliveredAt: "2026-09-05T18:30:01.000Z", providerReceiptRef: "provider:ack-1", readbackRef: "provider:readback-1", state: "SENT_VERIFIED" };
  reply.finality = "SOURCE_CONFIRMED";
  reply.reservation = { receiptRef: "reservation:reply-1", state: "RESERVED" };
  assert.throws(() => parseByVersion("SupportOutputHandoff/v1", reseal(delivered)));

  const providerAckOnly = makeDocument("SupportOutputHandoff/v1", payloadFor("SupportOutputHandoff/v1"));
  (providerAckOnly.payload.draft_CustomerReply as Record<string, unknown>).delivery = { deliveredAt: null, providerReceiptRef: "provider:ack-1", readbackRef: null, state: "DRAFT" };
  assert.throws(() => parseByVersion("SupportOutputHandoff/v1", reseal(providerAckOnly)));
});
