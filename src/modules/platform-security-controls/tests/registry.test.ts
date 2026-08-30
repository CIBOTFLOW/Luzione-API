import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateSecurityControlEvidence,
  securityControlRegistry,
  securityControlRegistryViolations,
} from "../registry";

test("zero-tolerance registry covers identity, tenancy, authority, effects, telemetry and mutation switches", () => {
  assert.deepEqual(securityControlRegistryViolations(), []);
  assert.ok(securityControlRegistry.length >= 7);
  assert.ok(securityControlRegistry.every((control) => control.zeroTolerance));
  assert.ok(securityControlRegistry.every((control) => control.evidenceState === "IMPLEMENTED_LOCAL"));
  for (const control of securityControlRegistry) {
    for (const path of control.evidenceRefs) assert.ok(existsSync(path), `${control.controlId}:${path}`);
  }
  const duplicate = [...securityControlRegistry, securityControlRegistry[0]];
  assert.ok(securityControlRegistryViolations(duplicate).includes(`duplicate:${securityControlRegistry[0].controlId}`));
  const unsupportedProduction = [{ ...securityControlRegistry[0], evidenceState: "PRODUCTION_OBSERVED" as const }];
  assert.ok(securityControlRegistryViolations(unsupportedProduction).some((item) => item.startsWith("unsupported-production:")));
});

test("missing, unknown or failed zero-tolerance evidence blocks the release gate", () => {
  assert.equal(evaluateSecurityControlEvidence([]).releaseGate, "BLOCK");
  const allPass = securityControlRegistry.map((control) => ({ controlId: control.controlId, status: "PASS" as const }));
  assert.equal(evaluateSecurityControlEvidence(allPass).releaseGate, "PASS");
  assert.equal(evaluateSecurityControlEvidence([{ controlId: securityControlRegistry[0].controlId, status: "UNKNOWN" }]).releaseGate, "BLOCK");
});

test("public catalog publishes security controls without raw probe evidence", () => {
  const route = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(route, /securityControls:/);
  assert.match(route, /securityControlRegistry/);
  assert.doesNotMatch(route, /DATABASE_URL|SERVICE_TOKEN|CONTINUATION_SECRET/);
});
