import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("engineering portal is a read-only Server Component over canonical registries", () => {
  const source = readFileSync("src/app/engineering/page.tsx", "utf8");
  assert.doesNotMatch(source, /["']use client["']/);
  assert.doesNotMatch(source, /process\.env|DATABASE_URL|SERVICE_TOKEN|CONTINUATION_SECRET/);
  assert.doesNotMatch(source, /<form|fetch\(/);
  assert.match(source, /platformContractRegistry/);
  assert.match(source, /serviceCatalog/);
  assert.match(source, /sliRegistry/);
  assert.match(source, /securityControlRegistry/);
  assert.match(source, /releaseEvidenceLaw/);
  assert.match(source, /performanceProfileRegistry/);
});

test("portal exposes bounded GET navigation and no authenticated probes", () => {
  const source = readFileSync("src/app/engineering/page.tsx", "utf8");
  assert.match(source, /\/api\/v1\/livez/);
  assert.match(source, /\/api\/v1\/readyz/);
  assert.match(source, /\/api\/v1\/healthz/);
  assert.match(source, /\/api\/v1\/catalog/);
  assert.doesNotMatch(source, /rls-readiness|activeProbes|POST|DELETE|PATCH/);
});
