import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("06 SLA events preserve severity and exact time without scheduling authority", () => {
  const event = makeDocument("SupportSlaScheduleEvent/v1", payloadFor("SupportSlaScheduleEvent/v1"));
  assert.equal((parseByVersion("SupportSlaScheduleEvent/v1", event) as { dependencyState: string }).dependencyState, "BLOCKED_INCOMPLETE");

  const pastDue = makeDocument("SupportSlaScheduleEvent/v1", payloadFor("SupportSlaScheduleEvent/v1"));
  pastDue.payload.dueAt = "2026-09-05T18:29:00.000Z";
  assert.throws(() => parseByVersion("SupportSlaScheduleEvent/v1", reseal(pastDue)));

  const lossySeverity = makeDocument("SupportSlaScheduleEvent/v1", payloadFor("SupportSlaScheduleEvent/v1"));
  lossySeverity.payload.severity = "CRITICAL";
  assert.throws(() => parseByVersion("SupportSlaScheduleEvent/v1", reseal(lossySeverity)));

  const fakeClaim = makeDocument("SupportSlaScheduleEvent/v1", payloadFor("SupportSlaScheduleEvent/v1"));
  (fakeClaim.payload.p111AttemptRef as Record<string, unknown>).state = "PRESENT";
  assert.throws(() => parseByVersion("SupportSlaScheduleEvent/v1", reseal(fakeClaim)));
});
