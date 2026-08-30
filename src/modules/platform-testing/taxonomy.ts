export const PLATFORM_TEST_TAXONOMY_VERSION = "luzione-test-taxonomy/v1";

export const testClasses = [
  "UNIT", "CONTRACT", "INTEGRATION", "JOURNEY", "RELIABILITY", "SECURITY", "PERFORMANCE", "PRODUCTION_VERIFICATION",
] as const;
export type TestClass = (typeof testClasses)[number];

export type TestSuiteDescriptor = {
  evidenceScope: string;
  primaryClass: TestClass;
  secondaryClasses: readonly TestClass[];
  suitePath: string;
};

export const testSuiteTaxonomy: readonly TestSuiteDescriptor[] = Object.freeze([
  { suitePath: "src/lib/tests/api-actor.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT"], evidenceScope: "workload identity and protected route admission" },
  { suitePath: "src/lib/tests/databaseConnection.test.ts", primaryClass: "SECURITY", secondaryClasses: ["UNIT"], evidenceScope: "database TLS and connection posture" },
  { suitePath: "src/lib/tests/sultan-runtime-status.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["CONTRACT"], evidenceScope: "aggregate Sultan/provider/database status readback" },
  { suitePath: "src/modules/autonomy/tests/autonomy-policy.test.ts", primaryClass: "SECURITY", secondaryClasses: ["UNIT", "CONTRACT"], evidenceScope: "authority/effect policy and parser boundary" },
  { suitePath: "src/modules/autonomy/tests/constitutional-rights.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT"], evidenceScope: "protected rights, identity and petition invariants" },
  { suitePath: "src/modules/catalog-projection/tests/p113-catalog-projection.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["RELIABILITY", "CONTRACT"], evidenceScope: "P113 service/database/projection contract" },
  { suitePath: "src/modules/platform-causality/tests/navigation.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY"], evidenceScope: "tenant-scoped causal evidence navigation" },
  { suitePath: "src/modules/platform-contracts/tests/execution-contracts.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY", "RELIABILITY"], evidenceScope: "request/failure/state contracts" },
  { suitePath: "src/modules/platform-contracts/tests/receipt-contract.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY"], evidenceScope: "receipt lineage and evidence separation" },
  { suitePath: "src/modules/platform-contracts/tests/registry.test.ts", primaryClass: "CONTRACT", secondaryClasses: [], evidenceScope: "contract/source-of-truth registry compatibility" },
  { suitePath: "src/modules/platform-guarantees/tests/api-boundary.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT"], evidenceScope: "tenant-scoped reads and fail-closed API mutation boundary" },
  { suitePath: "src/modules/platform-guarantees/tests/platform-guarantees.test.ts", primaryClass: "RELIABILITY", secondaryClasses: ["CONTRACT", "SECURITY"], evidenceScope: "events, idempotency, retry, workflow and atomic owner mutation" },
  { suitePath: "src/modules/platform-journeys/tests/certification.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["JOURNEY", "SECURITY", "RELIABILITY"], evidenceScope: "fail-closed exact-version cross-system journey certification" },
  { suitePath: "src/modules/platform-performance/tests/program.test.ts", primaryClass: "PERFORMANCE", secondaryClasses: ["CONTRACT", "SECURITY"], evidenceScope: "workload profiles, percentile math and local-target guard" },
  { suitePath: "src/modules/platform-portal/tests/engineering-portal.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY"], evidenceScope: "read-only portal and safe registry exposure" },
  { suitePath: "src/modules/platform-readiness/tests/evidence.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY"], evidenceScope: "freshness-aware readiness evidence" },
  { suitePath: "src/modules/platform-recovery/tests/registry.test.ts", primaryClass: "RELIABILITY", secondaryClasses: ["INTEGRATION"], evidenceScope: "recovery objectives and disposable restore harness" },
  { suitePath: "src/modules/platform-release/tests/release-contract.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY", "SECURITY"], evidenceScope: "release provenance, promotion and rollback gates" },
  { suitePath: "src/modules/platform-security-controls/tests/registry.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT"], evidenceScope: "zero-tolerance control evidence" },
  { suitePath: "src/modules/platform-service-catalog/tests/registry.test.ts", primaryClass: "CONTRACT", secondaryClasses: [], evidenceScope: "service/dependency/runbook registries" },
  { suitePath: "src/modules/platform-slo/tests/registry.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY"], evidenceScope: "SLI/SLO and error-budget law" },
  { suitePath: "src/modules/platform-telemetry/tests/telemetry.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY"], evidenceScope: "trace/log/metric semantics and redaction" },
  { suitePath: "src/modules/platform-testing/tests/taxonomy.test.ts", primaryClass: "CONTRACT", secondaryClasses: [], evidenceScope: "test inventory completeness and orchestration law" },
  { suitePath: "src/modules/platform-topology/tests/topology-inventory.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["INTEGRATION"], evidenceScope: "repository topology and ownership inventory" },
  { suitePath: "src/modules/security-posture/tests/rls-posture.test.ts", primaryClass: "SECURITY", secondaryClasses: ["INTEGRATION"], evidenceScope: "Postgres RLS/grant posture and denial probes" },
  { suitePath: "src/modules/tenant-policy/tests/tenant-policy.test.ts", primaryClass: "SECURITY", secondaryClasses: ["UNIT"], evidenceScope: "tenant autonomy policy and approval default" },
  { suitePath: "src/modules/workflows/tests/workflow-catalog.test.ts", primaryClass: "CONTRACT", secondaryClasses: [], evidenceScope: "workflow launch-pack completeness" },
]);

export const testOrchestrationLaw = Object.freeze({
  canonicalCiCommand: "npm test",
  canonicalPattern: "src/lib/tests/*.test.ts src/modules/*/tests/*.test.ts",
  focusedAliasesAreReleaseEvidence: false,
  performanceCampaignCommand: "npm run performance:local",
  productionVerificationRequiresDeployedEnvironment: true,
});

export function testTaxonomyViolations(suites: readonly TestSuiteDescriptor[] = testSuiteTaxonomy) {
  const paths = new Set<string>();
  const violations: string[] = [];
  for (const suite of suites) {
    if (paths.has(suite.suitePath)) violations.push(`duplicate:${suite.suitePath}`);
    paths.add(suite.suitePath);
    if (!testClasses.includes(suite.primaryClass)) violations.push(`invalid-primary:${suite.suitePath}`);
    if (suite.secondaryClasses.includes(suite.primaryClass)) violations.push(`primary-repeated:${suite.suitePath}`);
    if (!suite.evidenceScope.trim()) violations.push(`missing-scope:${suite.suitePath}`);
  }
  return violations;
}

export function testTaxonomySummary() {
  return testClasses.map((testClass) => ({
    primarySuiteCount: testSuiteTaxonomy.filter((suite) => suite.primaryClass === testClass).length,
    testClass,
  }));
}
