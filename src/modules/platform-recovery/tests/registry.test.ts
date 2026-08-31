import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { recoveryRegistry, recoveryRegistryViolations } from "../registry";

test("recovery registry has bounded objectives and no unsupported production proof", () => {
  assert.deepEqual(recoveryRegistryViolations(), []);
  const database = recoveryRegistry.find((entry) => entry.recoveryScopeId === "canonical-postgres");
  assert.equal(database?.rpoTargetMinutes, 1_440);
  assert.equal(database?.rtoTargetMinutes, 480);
  assert.equal(database?.evidenceState, "DECLARED_UNVERIFIED");
  assert.ok(recoveryRegistry.every((entry) => entry.evidenceState !== "PRODUCTION_RESTORE_PROVEN"));
  assert.ok(recoveryRegistry.every((entry) => existsSync(entry.restoreProcedureRef)));
});

test("known-bad duplicate, invalid objective and production-proof claims fail validation", () => {
  const first = recoveryRegistry[0];
  assert.ok(recoveryRegistryViolations([first, first]).some((item) => item.startsWith("duplicate:")));
  assert.ok(recoveryRegistryViolations([{ ...first, rpoTargetMinutes: 0 }]).some((item) => item.startsWith("objective:")));
  assert.ok(recoveryRegistryViolations([{ ...first, evidenceState: "PRODUCTION_RESTORE_PROVEN" }]).some((item) => item.startsWith("unsupported-production-proof:")));
});

test("disposable drill script is overwrite-safe and verifies fingerprints", () => {
  const script = readFileSync("scripts/run-disposable-postgres-restore-drill.sh", "utf8");
  assert.match(script, /luzione_api_se014_restore_/);
  assert.match(script, /refusing to overwrite existing database/);
  assert.match(script, /source_fingerprint[\s\S]*restored_fingerprint/);
  assert.match(script, /post_restore_migration/);
  assert.match(script, /post_restore_verification/);
  assert.match(script, /trap cleanup EXIT/);
  assert.doesNotMatch(script, /DATABASE_URL|production/i);
});

test("API-PC-014 restore proof reapplies least privilege and exercises authoritative readback", () => {
  const wrapper = readFileSync("scripts/validation/run-api-pc-014-disposable-restore.sh", "utf8");
  const readback = readFileSync("scripts/validation/api-pc-014-restored-readback.sql", "utf8");
  assert.match(wrapper, /20260831090000_api_pc_013_least_privilege_roles_rls\.sql/);
  assert.match(wrapper, /api-pc-014-restored-readback\.sql/);
  assert.match(readback, /relforcerowsecurity/);
  assert.match(readback, /luzione_api_runtime/);
  assert.match(readback, /api-pc-014-restore-order/);
  assert.match(readback, /api-pc-014-restore-switch/);
});

test("public catalog publishes bounded recovery objectives and evidence states", () => {
  const route = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(route, /recoveryRegistry:/);
  assert.match(route, /PLATFORM_RECOVERY_CONTRACT_VERSION/);
});
