import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  testOrchestrationLaw,
  testSuiteTaxonomy,
  testTaxonomySummary,
  testTaxonomyViolations,
} from "../taxonomy";

function testFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? testFiles(path) : path.endsWith(".test.ts") ? [path] : [];
  });
}

test("every current TypeScript suite has exactly one primary taxonomy class", () => {
  assert.deepEqual(testTaxonomyViolations(), []);
  assert.deepEqual(
    testSuiteTaxonomy.map((suite) => suite.suitePath).sort(),
    testFiles("src").sort(),
  );
});

test("taxonomy exposes real coverage gaps instead of inferring stronger evidence", () => {
  const summary = new Map(testTaxonomySummary().map((item) => [item.testClass, item.primarySuiteCount]));
  assert.equal(summary.get("JOURNEY"), 0);
  assert.equal(summary.get("PRODUCTION_VERIFICATION"), 0);
  assert.ok((summary.get("SECURITY") ?? 0) > 0);
  assert.ok((summary.get("PERFORMANCE") ?? 0) > 0);
});

test("one canonical CI command retains every suite and focused aliases cannot claim release proof", () => {
  const packageSource = readFileSync("package.json", "utf8");
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.equal(testOrchestrationLaw.canonicalCiCommand, "npm test");
  assert.equal(testOrchestrationLaw.focusedAliasesAreReleaseEvidence, false);
  assert.match(packageSource, /src\/modules\/\*\/tests\/\*\.test\.ts/);
  assert.match(ci, /npm test/);
});

test("known-bad duplicate and primary repetition fixtures fail validation", () => {
  assert.ok(testTaxonomyViolations([...testSuiteTaxonomy, testSuiteTaxonomy[0]]).some((item) => item.startsWith("duplicate:")));
  const repeated = [{ ...testSuiteTaxonomy[0], secondaryClasses: [testSuiteTaxonomy[0].primaryClass] }];
  assert.ok(testTaxonomyViolations(repeated).some((item) => item.startsWith("primary-repeated:")));
});
