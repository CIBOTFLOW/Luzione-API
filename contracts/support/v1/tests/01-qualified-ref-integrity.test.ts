import assert from "node:assert/strict";
import test from "node:test";
import { parseQualifiedSupportSourceRefV1 } from "../generated/typescript";
import { bytes, clone, makeDocument, parseByVersion, payloadFor, reseal } from "./support-test-kit";

test("01 qualified-ref integrity and original-byte parser fail closed", () => {
  const document = makeDocument("QualifiedSupportSourceRef/v1", payloadFor("QualifiedSupportSourceRef/v1"));
  assert.equal(parseQualifiedSupportSourceRefV1(bytes(document)).contractVersion, "QualifiedSupportSourceRef/v1");

  const crossTenant = clone(document);
  (crossTenant.payload.sourceRef as Record<string, unknown>).tenantId = "tenant-other";
  assert.throws(() => parseByVersion("QualifiedSupportSourceRef/v1", reseal(crossTenant)));

  const stale = clone(document);
  ((stale.payload.sourceRef as Record<string, unknown>).validity as Record<string, unknown>).validUntil = "2026-09-05T18:29:00.000Z";
  assert.throws(() => parseByVersion("QualifiedSupportSourceRef/v1", reseal(stale)));

  const surplus = clone(document);
  (surplus.payload.sourceRef as Record<string, unknown>).bareId = "unsafe";
  assert.throws(() => parseByVersion("QualifiedSupportSourceRef/v1", reseal(surplus)));

  assert.throws(() => parseQualifiedSupportSourceRefV1(document as unknown as Uint8Array));
  assert.throws(() => parseQualifiedSupportSourceRefV1(new Uint8Array([0xff])));
  assert.throws(() => parseQualifiedSupportSourceRefV1(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(document)])));
  assert.throws(() => parseQualifiedSupportSourceRefV1(new TextEncoder().encode('{"contractVersion":"QualifiedSupportSourceRef/v1","contractVersion":"QualifiedSupportSourceRef/v1"}')));
  assert.throws(() => parseQualifiedSupportSourceRefV1(new TextEncoder().encode(`${JSON.stringify(document)} trailing`)));
  assert.throws(() => parseQualifiedSupportSourceRefV1(new TextEncoder().encode(JSON.stringify(document).replace("tenant-luzione", "tenant\\u0000luzione"))));
  assert.throws(() => parseQualifiedSupportSourceRefV1(new TextEncoder().encode(JSON.stringify(document).replace("tenant-luzione", "tenant\\ud800"))));
  assert.throws(() => parseQualifiedSupportSourceRefV1(new Uint8Array(262_145).fill(0x20)));
});
