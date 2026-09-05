import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, presentRef, reseal, shaA } from "./support-test-kit";

test("04 typed ABSENT human authority remains closed and BLOCKED_INCOMPLETE", () => {
  const ownership = makeDocument("SupportOwnershipAcceptanceEvidence/v1", payloadFor("SupportOwnershipAcceptanceEvidence/v1"));
  assert.equal((parseByVersion("SupportOwnershipAcceptanceEvidence/v1", ownership) as { dependencyState: string }).dependencyState, "BLOCKED_INCOMPLETE");
  const roster = makeDocument("SupportRosterCoverageReadPacket/v1", payloadFor("SupportRosterCoverageReadPacket/v1"));
  assert.equal((parseByVersion("SupportRosterCoverageReadPacket/v1", roster) as { readPacketState: string }).readPacketState, "BLOCKED_INCOMPLETE");

  (ownership.payload.acceptedHumanAuthorityRef as Record<string, unknown>).contentHash = shaA;
  assert.throws(() => parseByVersion("SupportOwnershipAcceptanceEvidence/v1", reseal(ownership)));

  const fabricated = makeDocument("SupportOwnershipAcceptanceEvidence/v1", payloadFor("SupportOwnershipAcceptanceEvidence/v1"));
  fabricated.payload.acceptedHumanAuthorityRef = presentRef("agent:sultan", "HumanAuthoritySourceBinding/v1");
  fabricated.dependencyState = "BLOCKED_INCOMPLETE";
  assert.throws(() => parseByVersion("SupportOwnershipAcceptanceEvidence/v1", reseal(fabricated)));
});
