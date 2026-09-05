import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, presentRef, reseal } from "./support-test-kit";

test("10 incident acknowledgement and recovery remain exact operations-v3 ABSENT", () => {
  const binding = makeDocument("SupportCaseIncidentBinding/v1", payloadFor("SupportCaseIncidentBinding/v1"));
  assert.equal((parseByVersion("SupportCaseIncidentBinding/v1", binding) as { dependencyState: string }).dependencyState, "BLOCKED_INCOMPLETE");
  const packet = makeDocument("SupportIncidentEscalationReadPacket/v1", payloadFor("SupportIncidentEscalationReadPacket/v1"));
  assert.equal((parseByVersion("SupportIncidentEscalationReadPacket/v1", packet) as { readPacketState: string }).readPacketState, "BLOCKED_INCOMPLETE");

  const fabricatedAck = makeDocument("SupportCaseIncidentBinding/v1", payloadFor("SupportCaseIncidentBinding/v1"));
  fabricatedAck.payload.humanAcknowledgementRef = presentRef("agent:sultan", "HumanAuthoritySourceBinding/v1");
  assert.throws(() => parseByVersion("SupportCaseIncidentBinding/v1", reseal(fabricatedAck)));

  const orphanRecovery = makeDocument("SupportIncidentEscalationReadPacket/v1", payloadFor("SupportIncidentEscalationReadPacket/v1"));
  orphanRecovery.payload.incidentRecoverySourceRef = presentRef("recovery:orphan-1", "IncidentRecoverySourceBinding/v1");
  assert.throws(() => parseByVersion("SupportIncidentEscalationReadPacket/v1", reseal(orphanRecovery)));
});
