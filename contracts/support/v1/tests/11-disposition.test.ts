import assert from "node:assert/strict";
import test from "node:test";
import { makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("11 local credential/data disposition never claims remote erasure finality", () => {
  const disposition = makeDocument("SupportDataDispositionReceipt/v1", payloadFor("SupportDataDispositionReceipt/v1"));
  assert.equal((parseByVersion("SupportDataDispositionReceipt/v1", disposition) as { finality: string }).finality, "NOT_FINAL");

  const localAsFinal = makeDocument("SupportDataDispositionReceipt/v1", payloadFor("SupportDataDispositionReceipt/v1"));
  localAsFinal.payload.localDisposition = "ERASED_LOCAL_ONLY";
  localAsFinal.payload.remoteFinality = "SOURCE_CONFIRMED";
  assert.throws(() => parseByVersion("SupportDataDispositionReceipt/v1", reseal(localAsFinal)));

  const activeHold = makeDocument("SupportDataDispositionReceipt/v1", payloadFor("SupportDataDispositionReceipt/v1"));
  activeHold.payload.localDisposition = "ERASED_LOCAL_ONLY";
  activeHold.payload.remoteFinality = "SOURCE_CONFIRMED";
  activeHold.payload.legalHoldState = "ACTIVE";
  activeHold.payload.residualCopyRefs = [];
  assert.throws(() => parseByVersion("SupportDataDispositionReceipt/v1", reseal(activeHold)));
});
