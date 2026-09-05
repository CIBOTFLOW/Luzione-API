import assert from "node:assert/strict";
import test from "node:test";
import { clone, makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("03 privacy and redaction evidence never expose raw values or fabricate PASS", () => {
  assert.doesNotThrow(() => parseByVersion("SupportRedactionReceipt/v1", makeDocument("SupportRedactionReceipt/v1", payloadFor("SupportRedactionReceipt/v1"))));
  assert.doesNotThrow(() => parseByVersion("SupportPrivacyRetentionRef/v1", makeDocument("SupportPrivacyRetentionRef/v1", payloadFor("SupportPrivacyRetentionRef/v1"))));

  const absentPass = makeDocument("SupportRedactionReceipt/v1", payloadFor("SupportRedactionReceipt/v1"));
  absentPass.payload.sourceRef = { expectedOwner: "CIBOTFLOW/Luzione-UI", expectedType: "RawSupportSource", expectedVersion: "RawSupportSource/v1", reason: "SOURCE_NOT_RETURNED", observedAt: "2026-09-05T18:30:00.000Z" };
  absentPass.dependencyState = "BLOCKED_INCOMPLETE";
  assert.throws(() => parseByVersion("SupportRedactionReceipt/v1", reseal(absentPass)));

  const rawUri = makeDocument("SupportPrivacyRetentionRef/v1", payloadFor("SupportPrivacyRetentionRef/v1"));
  rawUri.payload.opaqueLocationRef = "https://storage.example/customer/raw";
  assert.throws(() => parseByVersion("SupportPrivacyRetentionRef/v1", reseal(rawUri)));

  const secret = clone(rawUri);
  secret.payload.opaqueLocationRef = "api_key=customer-secret";
  assert.throws(() => parseByVersion("SupportPrivacyRetentionRef/v1", reseal(secret)));
});
