import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateRatioErrorBudget,
  errorBudgetLaw,
  sliRegistry,
  sloRegistry,
  sloRegistryViolations,
} from "../registry";

test("SLI registry covers platform, capability and honest contract-only business measurement", () => {
  assert.deepEqual(sloRegistryViolations(), []);
  assert.deepEqual(new Set(sliRegistry.map((item) => item.layer)), new Set(["PLATFORM", "CAPABILITY", "BUSINESS"]));
  assert.equal(sliRegistry.find((item) => item.layer === "BUSINESS")?.measurementStatus, "CONTRACT_ONLY");
  assert.ok(sliRegistry.every((item) => existsSync(item.runbookRef)));
  assert.ok(sloRegistry.every((item) => item.provisional));
});

test("ratio error budgets are deterministic and become exhausted", () => {
  assert.equal(calculateRatioErrorBudget({ badEvents: 5, targetRatio: 0.99, totalEvents: 1_000 }).status, "WITHIN_BUDGET");
  assert.equal(calculateRatioErrorBudget({ badEvents: 11, targetRatio: 0.99, totalEvents: 1_000 }).status, "EXHAUSTED");
  assert.throws(() => calculateRatioErrorBudget({ badEvents: 2, targetRatio: 1, totalEvents: 1 }), /targetRatio/);
});

test("security controls cannot be excused through availability budgets", () => {
  assert.equal(errorBudgetLaw.availabilityBudgetsMayExcuseSecurityFailure, false);
  assert.equal(errorBudgetLaw.provisionalTargetsAreReleaseFinal, false);
  const route = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(route, /sloRegistry:/);
  assert.match(route, /errorBudgetLaw/);
  const securityBudget = {
    ...sloRegistry[0],
    sliId: "security-tenant-isolation",
    sloId: "known-bad-security-budget",
  };
  assert.ok(sloRegistryViolations(sliRegistry, [securityBudget]).includes("security-control-in-availability-budget"));
});
