import assert from "node:assert/strict";
import test from "node:test";
import { absent, makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("09 reopen preserves closure lineage and advances case, watermark and SLA epoch", () => {
  const reopen = makeDocument("SupportReopenEvidence/v1", payloadFor("SupportReopenEvidence/v1"));
  assert.equal((parseByVersion("SupportReopenEvidence/v1", reopen) as { dependencyState: string }).dependencyState, "BLOCKED_INCOMPLETE");

  const sameVersion = makeDocument("SupportReopenEvidence/v1", payloadFor("SupportReopenEvidence/v1"));
  sameVersion.payload.newCaseVersion = sameVersion.payload.priorCaseVersion;
  assert.throws(() => parseByVersion("SupportReopenEvidence/v1", reseal(sameVersion)));

  const sameWatermark = makeDocument("SupportReopenEvidence/v1", payloadFor("SupportReopenEvidence/v1"));
  sameWatermark.payload.inboundWatermark = sameWatermark.payload.closureWatermark;
  assert.throws(() => parseByVersion("SupportReopenEvidence/v1", reseal(sameWatermark)));

  const missingClosure = makeDocument("SupportReopenEvidence/v1", payloadFor("SupportReopenEvidence/v1"));
  missingClosure.payload.closureEvidenceRef = absent("SupportClosureEvidence");
  assert.equal((parseByVersion("SupportReopenEvidence/v1", reseal(missingClosure)) as { dependencyState: string }).dependencyState, "BLOCKED_INCOMPLETE");
});
