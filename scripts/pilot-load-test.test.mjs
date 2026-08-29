import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeBaseUrl, percentile } from "./pilot-load-test.mjs";

test("pilot load gate calculates a nearest-rank p95", () => {
  assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
  assert.equal(percentile([], 0.95), 0);
});

test("pilot load gate refuses non-local targets without explicit authorization", () => {
  assert.equal(assertSafeBaseUrl("http://127.0.0.1:3201").hostname, "127.0.0.1");
  assert.throws(() => assertSafeBaseUrl("https://api.example.com"), /Refusing a non-local load target/);
  assert.equal(assertSafeBaseUrl("https://api.example.com", true).hostname, "api.example.com");
});
