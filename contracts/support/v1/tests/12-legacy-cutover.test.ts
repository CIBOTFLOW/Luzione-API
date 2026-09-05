import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("12 legacy quarantine carries digests only and stays forward-only after a pin", () => {
  const manifest = makeDocument("LegacySupportQuarantineManifest/v1", payloadFor("LegacySupportQuarantineManifest/v1"));
  assert.equal((parseByVersion("LegacySupportQuarantineManifest/v1", manifest) as { dependencyState: string }).dependencyState, "PRESENT");

  const leaked = makeDocument("LegacySupportQuarantineManifest/v1", payloadFor("LegacySupportQuarantineManifest/v1"));
  leaked.payload.containsCustomerValues = true;
  assert.throws(() => parseByVersion("LegacySupportQuarantineManifest/v1", reseal(leaked)));

  const rawField = makeDocument("LegacySupportQuarantineManifest/v1", payloadFor("LegacySupportQuarantineManifest/v1"));
  rawField.payload.customerEmail = "customer@example.com";
  assert.throws(() => parseByVersion("LegacySupportQuarantineManifest/v1", reseal(rawField)));

  const projection = makeDocument("SupportLegacyCompatibilityReadPacket/v1", payloadFor("SupportLegacyCompatibilityReadPacket/v1"));
  assert.equal((parseByVersion("SupportLegacyCompatibilityReadPacket/v1", projection) as { readPacketState: string }).readPacketState, "BLOCKED_INCOMPLETE");
});
