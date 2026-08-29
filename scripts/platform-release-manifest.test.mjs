import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { canonicalJson, sha256, signPayload, verifySignature } from "./platform-release-manifest.mjs";

test("canonical JSON is stable across object insertion order", () => {
  const first = { z: [3, { b: true, a: null }], a: "value" };
  const second = { a: "value", z: [3, { a: null, b: true }] };
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(sha256(canonicalJson(first)), sha256(canonicalJson(second)));
});

test("Ed25519 manifest signatures bind the complete canonical payload", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = { schemaVersion: "luzione-platform-release/v1", migrations: [{ id: "001", sha256: "abc" }] };
  const signature = signPayload(payload, privateKey, "release-test-key");
  assert.equal(verifySignature({ payload, signature }, publicKey), true);
  assert.throws(
    () => verifySignature({ payload: { ...payload, releaseId: "changed" }, signature }, publicKey),
    /digest mismatch/,
  );
});

test("a signature from an untrusted key is rejected", () => {
  const trusted = generateKeyPairSync("ed25519");
  const untrusted = generateKeyPairSync("ed25519");
  const payload = { schemaVersion: "luzione-platform-release/v1" };
  const signature = signPayload(payload, untrusted.privateKey, "untrusted");
  assert.throws(() => verifySignature({ payload, signature }, trusted.publicKey), /signature is invalid/);
});
