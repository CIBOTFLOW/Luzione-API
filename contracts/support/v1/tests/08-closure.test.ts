import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, presentRef, reseal } from "./support-test-kit";

test("08 closure requires one verified reply or human exception and complete owner/readback evidence", () => {
  const closure = makeDocument("SupportClosureEvidence/v1", payloadFor("SupportClosureEvidence/v1"));
  assert.equal((parseByVersion("SupportClosureEvidence/v1", closure) as { dependencyState: string }).dependencyState, "BLOCKED_INCOMPLETE");

  const dual = makeDocument("SupportClosureEvidence/v1", payloadFor("SupportClosureEvidence/v1"));
  dual.payload.humanNoReplyExceptionRef = presentRef("human:closure-exception-1");
  assert.throws(() => parseByVersion("SupportClosureEvidence/v1", reseal(dual)));

  const neither = makeDocument("SupportClosureEvidence/v1", payloadFor("SupportClosureEvidence/v1"));
  neither.payload.verifiedReplyRef = null;
  assert.throws(() => parseByVersion("SupportClosureEvidence/v1", reseal(neither)));

  const falseReady = makeDocument("SupportClosureEvidence/v1", payloadFor("SupportClosureEvidence/v1"));
  falseReady.payload.closureState = "READY_FOR_OWNER_COMMIT";
  assert.throws(() => parseByVersion("SupportClosureEvidence/v1", reseal(falseReady)));
});
