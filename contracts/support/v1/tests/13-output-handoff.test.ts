import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("13 SupportOutputHandoff exposes only qualified evidence plus NO_EFFECT proposal and draft", () => {
  const handoff = makeDocument("SupportOutputHandoff/v1", payloadFor("SupportOutputHandoff/v1"));
  const parsed = parseByVersion("SupportOutputHandoff/v1", handoff) as { dependencyState: string; effectMode: string; finality: string };
  assert.deepEqual([parsed.dependencyState, parsed.effectMode, parsed.finality], ["BLOCKED_INCOMPLETE", "NO_EFFECT", "NOT_FINAL"]);

  const authority = makeDocument("SupportOutputHandoff/v1", payloadFor("SupportOutputHandoff/v1"));
  (authority.payload.severity_recommendation as Record<string, unknown>).authoritative = true;
  assert.throws(() => parseByVersion("SupportOutputHandoff/v1", reseal(authority)));

  const effect = makeDocument("SupportOutputHandoff/v1", payloadFor("SupportOutputHandoff/v1"));
  (effect.payload.proposed_SupportAction as Record<string, unknown>).effectMode = "SANDBOX_ONLY";
  assert.throws(() => parseByVersion("SupportOutputHandoff/v1", reseal(effect)));

  const unresolved = makeDocument("SupportOutputHandoff/v1", payloadFor("SupportOutputHandoff/v1"));
  ((unresolved.payload.evidence_bundle as Record<string, unknown>).qualifiedSourceRefs as unknown[]).pop();
  assert.throws(() => parseByVersion("SupportOutputHandoff/v1", reseal(unresolved)));

  const partial = makeDocument("SupportOutputHandoff/v1", payloadFor("SupportOutputHandoff/v1"));
  delete (partial.payload.proposed_SupportAction as Record<string, unknown>).operation;
  assert.throws(() => parseByVersion("SupportOutputHandoff/v1", reseal(partial)));
});
