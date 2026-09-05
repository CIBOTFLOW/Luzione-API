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
  { suitePath: "src/modules/platform-contracts/tests/table-object-registry.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY"], evidenceScope: "table-object ownership, browser posture, bounded coverage and fail-closed retirement" },
  { suitePath: "src/modules/platform-guarantees/tests/api-boundary.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT"], evidenceScope: "tenant-scoped reads and fail-closed API mutation boundary" },
  { suitePath: "src/modules/platform-guarantees/tests/platform-guarantees.test.ts", primaryClass: "RELIABILITY", secondaryClasses: ["CONTRACT", "SECURITY"], evidenceScope: "events, idempotency, retry, workflow and atomic owner mutation" },
  { suitePath: "src/modules/platform-journeys/tests/certification.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["JOURNEY", "SECURITY", "RELIABILITY"], evidenceScope: "fail-closed exact-version cross-system journey certification" },
  { suitePath: "src/modules/platform-operations/tests/operations-evidence.test.ts", primaryClass: "RELIABILITY", secondaryClasses: ["CONTRACT", "SECURITY", "PRODUCTION_VERIFICATION"], evidenceScope: "dashboard/alert signal coverage and exact-SHA SLO/release/restore/rollback evidence certification" },
  { suitePath: "src/modules/platform-performance/tests/program.test.ts", primaryClass: "PERFORMANCE", secondaryClasses: ["CONTRACT", "SECURITY"], evidenceScope: "workload profiles, percentile math and local-target guard" },
  { suitePath: "src/modules/platform-portal/tests/engineering-portal.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY"], evidenceScope: "read-only portal and safe registry exposure" },
  { suitePath: "src/modules/platform-readiness/tests/evidence.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY"], evidenceScope: "freshness-aware readiness evidence" },
  { suitePath: "src/modules/production-convergence/tests/program-artifacts.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["INTEGRATION"], evidenceScope: "production-convergence program, ownership, dependency and contract artifact consistency" },
  { suitePath: "src/modules/production-convergence/tests/command-ledger.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["CONTRACT", "RELIABILITY", "SECURITY"], evidenceScope: "P110 fresh/upgrade schema, tenant denial and Postgres atomic command store" },
  { suitePath: "src/modules/production-convergence/tests/workflow-delivery.test.ts", primaryClass: "RELIABILITY", secondaryClasses: ["INTEGRATION", "CONTRACT", "SECURITY"], evidenceScope: "P110/P111 restart-safe workflow, inbox, outbox, DLQ and reconciliation substrate" },
  { suitePath: "src/modules/production-convergence/tests/causal-readback.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["INTEGRATION", "RELIABILITY", "SECURITY"], evidenceScope: "tenant-bound causal receipt, source-version and freshness readback" },
  { suitePath: "src/modules/production-convergence/tests/lead-commercial-case.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["CONTRACT", "RELIABILITY", "SECURITY"], evidenceScope: "default-off Lead and Commercial Case commands, compatibility, tenant denial and authoritative readback" },
  { suitePath: "src/modules/production-convergence/tests/proposal-quote-approval.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["CONTRACT", "RELIABILITY", "SECURITY"], evidenceScope: "default-off Quote and Proposal approval commands, integer-money/currency invariants, human authority denial, exact versions and authoritative readback" },
  { suitePath: "src/modules/production-convergence/tests/order-fulfillment.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["CONTRACT", "RELIABILITY", "SECURITY"], evidenceScope: "default-off exact accepted Quote to Order and no-effect Fulfillment Intent commands, version/line invariants and canonical readback" },
  { suitePath: "src/modules/production-convergence/tests/provider-runtime.test.ts", primaryClass: "RELIABILITY", secondaryClasses: ["INTEGRATION", "CONTRACT", "SECURITY"], evidenceScope: "typed provider adapters, durable dispatch-start, sandbox acknowledgement/readback, ambiguous reconciliation and fail-closed effect activation" },
  { suitePath: "src/modules/production-convergence/tests/security-roles-rls.test.ts", primaryClass: "SECURITY", secondaryClasses: ["INTEGRATION", "CONTRACT"], evidenceScope: "least-privilege API/worker roles, forced tenant RLS, ownership boundaries and negative permission evidence" },
  { suitePath: "src/modules/production-convergence/tests/release-identity.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY", "SECURITY"], evidenceScope: "exact release identity and fail-closed provenance" },
  { suitePath: "src/modules/platform-readiness/tests/certification.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY", "SECURITY", "PRODUCTION_VERIFICATION"], evidenceScope: "fail-closed exact-candidate production readiness certification" },
  { suitePath: "src/modules/platform-recovery/tests/registry.test.ts", primaryClass: "RELIABILITY", secondaryClasses: ["INTEGRATION"], evidenceScope: "recovery objectives and disposable restore harness" },
  { suitePath: "src/modules/platform-release/tests/release-contract.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY", "SECURITY"], evidenceScope: "release provenance, promotion and rollback gates" },
  { suitePath: "src/modules/platform-security-controls/tests/registry.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT"], evidenceScope: "zero-tolerance control evidence" },
  { suitePath: "src/modules/platform-service-catalog/tests/registry.test.ts", primaryClass: "CONTRACT", secondaryClasses: [], evidenceScope: "service/dependency/runbook registries" },
  { suitePath: "src/modules/platform-slo/tests/registry.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["RELIABILITY"], evidenceScope: "SLI/SLO and error-budget law" },
  { suitePath: "src/modules/platform-telemetry/tests/telemetry.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY"], evidenceScope: "trace/log/metric semantics and redaction" },
  { suitePath: "src/modules/platform-testing/tests/taxonomy.test.ts", primaryClass: "CONTRACT", secondaryClasses: [], evidenceScope: "test inventory completeness and orchestration law" },
  { suitePath: "src/modules/platform-topology/tests/topology-inventory.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["INTEGRATION"], evidenceScope: "repository topology and ownership inventory" },
  { suitePath: "src/modules/security-posture/tests/rls-posture.test.ts", primaryClass: "SECURITY", secondaryClasses: ["INTEGRATION"], evidenceScope: "Postgres RLS/grant posture and denial probes" },
  { suitePath: "src/modules/shared-contract-drafts/tests/consumer-compatibility-fixtures.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY", "RELIABILITY", "INTEGRATION"], evidenceScope: "A02 field-level producer/consumer fixtures, exact pins, replay, cross-tenant, stale-finality and zero-effect fail-closed compatibility" },
  { suitePath: "src/modules/shared-contract-drafts/tests/shared-contract-drafts.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY", "RELIABILITY", "INTEGRATION"], evidenceScope: "A02 draft identity, tenant, command, receipt and readback compatibility adapters and exact consumer pins" },
  { suitePath: "src/modules/luzione-core-contracts/tests/core-contracts.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY", "RELIABILITY", "INTEGRATION"], evidenceScope: "CORE-01 strict v1 SDK, exact A02 pins, dark/no-effect activation, six-capability Sultan mapping and SUPPORT-01 authority/replay/stale/finality/audit negatives" },
  { suitePath: "src/modules/core-02-inventory/tests/core-02-inventory.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY", "RELIABILITY"], evidenceScope: "CORE-02 exact API-owned CRM activation-cone manifest, bidirectional journey mapping, frozen CORE-01 trees, unsigned unknown-owner packet coverage, complete-evidence-set standard secret scanning and documentary no-effect posture" },
  { suitePath: "src/modules/operations-evidence-contracts/tests/operations-evidence-contracts.test.ts", primaryClass: "CONTRACT", secondaryClasses: ["SECURITY", "RELIABILITY"], evidenceScope: "OPS-CONTRACTS-01 strict operations-evidence schema/SDK, proof and customer-zero formulas, clock/state/finality, immutable supersession, human authority and zero-effect compatibility" },
  { suitePath: "src/modules/onboard-core/tests/blueprint-mandate.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["CONTRACT", "SECURITY", "RELIABILITY"], evidenceScope: "ONBOARD-CORE-01 draft-only Tenant Pack mapping, canonical blueprint/mandate issuance, append-only approval/supersession and tenant/replay/expiry denial" },
  { suitePath: "src/modules/onboard-core/tests/import-dry-run.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["CONTRACT", "SECURITY", "RELIABILITY"], evidenceScope: "ONBOARD-CORE-01 tenant-scoped no-effect import validation, closed batch/receipt finality, durable row exceptions and replay/conflict semantics" },
  { suitePath: "src/modules/onboard-core/tests/connector-validation.test.ts", primaryClass: "INTEGRATION", secondaryClasses: ["CONTRACT", "SECURITY", "RELIABILITY"], evidenceScope: "ONBOARD-CORE-01 default-off sandbox connector validation, exact digest reservation, one-dispatch ambiguity reconciliation and canonical no-effect receipt finality" },
  { suitePath: "src/modules/sultan-agent/tests/sultan-agent-intent.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT", "INTEGRATION"], evidenceScope: "credential-bound agent identity, exact context/intent admission, stale-context abstention and cross-domain denial" },
  { suitePath: "src/modules/sultan-agent-gateway/tests/sultan-agent-gateway.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT", "INTEGRATION", "RELIABILITY"], evidenceScope: "server-derived tool discovery, tenant-bound reads, exact RFQ canary admission, provider ambiguity and readback" },
  { suitePath: "src/modules/sultan-agent-gateway/tests/sultan-agent-gateway-sql.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT", "INTEGRATION", "RELIABILITY"], evidenceScope: "forced-RLS policy envelopes, quota, kill-switch precedence and one-attempt P110 outbox reservation" },
  { suitePath: "src/modules/sultan-stage5/tests/sultan-stage5.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT", "INTEGRATION", "RELIABILITY"], evidenceScope: "exact participation, workload, agent, evidence, SHA, no-effect admission, canonical readback and outcome classification" },
  { suitePath: "src/modules/sultan-stage5/tests/sultan-stage5-sql.test.ts", primaryClass: "SECURITY", secondaryClasses: ["CONTRACT", "INTEGRATION", "RELIABILITY"], evidenceScope: "append-only Stage 5 lineage, forced tenant RLS, least privilege, admission-bound commands and no-effect constraints" },
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
