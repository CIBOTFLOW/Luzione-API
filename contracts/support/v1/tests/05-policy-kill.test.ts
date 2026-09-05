import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("05 policy entitlement and kill snapshots fail closed", () => {
  const policy = makeDocument("SupportPolicyEntitlementRef/v1", payloadFor("SupportPolicyEntitlementRef/v1"));
  assert.equal((parseByVersion("SupportPolicyEntitlementRef/v1", policy) as { dependencyState: string }).dependencyState, "BLOCKED_INCOMPLETE");

  const expired = makeDocument("SupportPolicyEntitlementRef/v1", payloadFor("SupportPolicyEntitlementRef/v1"));
  expired.payload.validUntil = expired.payload.validFrom;
  assert.throws(() => parseByVersion("SupportPolicyEntitlementRef/v1", reseal(expired)));

  const missingKill = makeDocument("SupportPolicyEntitlementRef/v1", payloadFor("SupportPolicyEntitlementRef/v1"));
  delete missingKill.payload.killRef;
  assert.throws(() => parseByVersion("SupportPolicyEntitlementRef/v1", reseal(missingKill)));

  const projection = makeDocument("SupportPolicyEntitlementReadPacket/v1", payloadFor("SupportPolicyEntitlementReadPacket/v1"));
  projection.payload.derivedStatus = "AVAILABLE";
  assert.throws(() => parseByVersion("SupportPolicyEntitlementReadPacket/v1", reseal(projection)));
});
