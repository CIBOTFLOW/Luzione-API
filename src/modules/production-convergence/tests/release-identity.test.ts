import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  API_CONTRACT_RELEASE_VERSION,
  createReleaseIdentity,
  releaseIdentityViolations,
} from "../releaseIdentity";

test("exact preview release identity binds SHA, build, deployment, contracts and schemas", () => {
  const identity = createReleaseIdentity({
    environment: {
      LUZIONE_BUILD_TIME: "2026-08-30T08:00:00.000Z",
      VERCEL_DEPLOYMENT_ID: "dpl_example",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VERCEL_URL: "luzione-api-preview.example.test",
    },
    mutationsEnabled: false,
  });
  assert.deepEqual(releaseIdentityViolations(identity), []);
  assert.equal(identity.evidenceState, "EXACT_RELEASE_BOUND");
  assert.equal(identity.releaseContractVersion, API_CONTRACT_RELEASE_VERSION);
  assert.equal(identity.exactSha, "a".repeat(40));
  assert.equal(identity.mutations, "DISABLED_FAIL_CLOSED");
  assert.ok(identity.contractComponents.includes("luzione-request-identity/v1"));
  assert.ok(identity.schemaVersions.includes("20260828213000_workflow_pack_foreign_key_indexes"));
});

test("local and incomplete deployed identities stay visibly unbound", () => {
  const local = createReleaseIdentity({ environment: {}, mutationsEnabled: false });
  assert.equal(local.environment, "local");
  assert.equal(local.evidenceState, "LOCAL_UNBOUND");
  assert.equal(local.exactSha, null);

  const incomplete = createReleaseIdentity({
    environment: { VERCEL_ENV: "production", VERCEL_URL: "api.luzione.com" },
    mutationsEnabled: false,
  });
  assert.equal(incomplete.evidenceState, "DEPLOYED_INCOMPLETE");
  assert.equal(incomplete.exactSha, null);
  assert.deepEqual(releaseIdentityViolations(incomplete), []);
});

test("known-bad provenance and promoted unbound deployments fail validation", () => {
  const valid = createReleaseIdentity({
    environment: {
      LUZIONE_BUILD_TIME: "2026-08-30T08:00:00.000Z",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
      VERCEL_URL: "api.luzione.com",
    },
    mutationsEnabled: false,
  });
  assert.ok(releaseIdentityViolations({ ...valid, exactSha: "short" }).includes("invalid-exact-sha"));
  assert.ok(releaseIdentityViolations({
    ...valid,
    buildTime: null,
    exactSha: null,
  }).includes("exact-release-missing-provenance"));
});

test("release route is read only and publishes the v0.1 identity", () => {
  const route = readFileSync("src/app/api/v1/release/route.ts", "utf8");
  assert.match(route, /export function GET/);
  assert.doesNotMatch(route, /export (async )?function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /createReleaseIdentity/);
  assert.match(route, /mutationsEnabled: config\.mutationsEnabled/);
});
