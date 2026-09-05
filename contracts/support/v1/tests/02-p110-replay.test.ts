import assert from "node:assert/strict";
import test from "node:test";
import { bytes, clone, laterAt, makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("02 P110 exact replay and append-only supersession", () => {
  const first = makeDocument("SupportRedactionReceipt/v1", payloadFor("SupportRedactionReceipt/v1"));
  const firstBytes = bytes(first);
  assert.doesNotThrow(() => parseByVersion("SupportRedactionReceipt/v1", first, { priorDocuments: [firstBytes] }));

  const changed = clone(first);
  changed.payload.result = "BLOCKED";
  assert.throws(() => parseByVersion("SupportRedactionReceipt/v1", reseal(changed), { priorDocuments: [firstBytes] }));

  const changedKeyReuse = clone(changed);
  changedKeyReuse.documentId = "10000000-0000-4000-8000-000000000001";
  assert.throws(() => parseByVersion("SupportRedactionReceipt/v1", reseal(changedKeyReuse), { priorDocuments: [firstBytes] }));

  const successor = clone(first);
  successor.documentId = "10000000-0000-4000-8000-000000000002";
  successor.idempotencyKey = "support:redaction:successor-1";
  successor.observedAt = laterAt;
  successor.supersedesDocumentId = first.documentId;
  assert.doesNotThrow(() => parseByVersion("SupportRedactionReceipt/v1", successor, { priorDocuments: [firstBytes] }));

  const fork = clone(successor);
  fork.documentId = "10000000-0000-4000-8000-000000000003";
  fork.idempotencyKey = "support:redaction:successor-2";
  assert.throws(() => parseByVersion("SupportRedactionReceipt/v1", fork, { priorDocuments: [firstBytes, bytes(successor)] }));

  const cyclicPrior = clone(first);
  cyclicPrior.documentId = "10000000-0000-4000-8000-000000000004";
  cyclicPrior.idempotencyKey = "support:redaction:cycle-a";
  cyclicPrior.supersedesDocumentId = "10000000-0000-4000-8000-000000000005";
  const cyclicCurrent = clone(successor);
  cyclicCurrent.documentId = "10000000-0000-4000-8000-000000000005";
  cyclicCurrent.idempotencyKey = "support:redaction:cycle-b";
  cyclicCurrent.supersedesDocumentId = cyclicPrior.documentId;
  assert.throws(() => parseByVersion("SupportRedactionReceipt/v1", cyclicCurrent, { priorDocuments: [bytes(cyclicPrior)] }));
});
