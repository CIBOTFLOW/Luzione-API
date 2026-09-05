export const PLATFORM_CONTRACT_REGISTRY_VERSION = "luzione-platform-contract-registry/v1";

export type ContractMaturity =
  | "IMPLEMENTED"
  | "IMPLEMENTED_TRANSITIONAL"
  | "LIBRARY_ONLY"
  | "PENDING_CHANGESET"
  | "SPECIFIED_ONLY";

export type PlatformContractDescriptor = {
  compatibility: "ADDITIVE_MINOR" | "EXACT_VERSION" | "NEW_MAJOR_FOR_BREAKING";
  consumers: readonly ("CIBOTFLOW/Luzione-UI" | "CIBOTFLOW/Sultan-OS")[];
  contractId: string;
  currentRuntime: boolean;
  maturity: ContractMaturity;
  name: string;
  ownerRepository: "CIBOTFLOW/Luzione-API";
  pendingChangeRefs: readonly string[];
  sourcePaths: readonly string[];
  version: string;
};

export const platformCompatibilityLaw = Object.freeze({
  registryVersion: PLATFORM_CONTRACT_REGISTRY_VERSION,
  additiveDefault: true,
  breakingChangeRequires: Object.freeze([
    "new major contract version",
    "consumer inventory",
    "migration and cutover plan",
    "compatibility evidence",
    "old-path retirement criteria",
  ]),
  consumerRules: Object.freeze([
    "Unknown optional fields are ignored without changing known field meaning.",
    "Unknown authority, effect, failure, state or retry enum values fail closed.",
    "A field name is never reused with a different meaning inside one major version.",
    "Draft pull requests are not current contract versions.",
    "Producer evidence does not prove consumer integration.",
  ]),
  ownerRepository: "CIBOTFLOW/Luzione-API" as const,
});

export const platformContractRegistry: readonly PlatformContractDescriptor[] = Object.freeze([
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "api-http-response",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "HTTP response and request-ID envelope",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: ["src/lib/api/http.ts"],
    version: "1.0",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "api-service-actor",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Credential-bound actor, tenant and capability subject",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:canonical-membership-resolution"],
    sourcePaths: [
      "src/lib/api/actor.ts",
      "architecture/production-convergence/API_PC_004_WORKING_CONTRACT.md"
    ],
    version: "luzione-authority-subject/v0.1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "request-identity-envelope",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Request, correlation, trace, actor, tenant, purpose and capability envelope",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:canonical-membership-resolution"],
    sourcePaths: [
      "src/modules/platform-contracts/requestIdentity.ts",
      "src/lib/api/http.ts"
    ],
    version: "luzione-request-identity/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "universal-event-envelope",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Universal event envelope",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-guarantees/types.ts",
      "src/modules/platform-guarantees/eventContract.ts"
    ],
    version: "1.0",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "lifecycle-command",
    currentRuntime: false,
    maturity: "IMPLEMENTED",
    name: "Atomic lifecycle command and idempotency contract",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-guarantees/types.ts",
      "src/modules/platform-guarantees/commandKernel.ts",
      "src/lib/platform-guarantees/postgresCommandStore.ts",
      "supabase/migrations/20260831022000_p110_command_ledger_baseline.sql"
    ],
    version: "luzione-command-ledger/v0.1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "platform-receipt",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Decision, action intent, execution, readback, recovery and release receipt",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:durable-receipt-store"],
    sourcePaths: [
      "src/modules/platform-contracts/receiptContract.ts",
      "src/modules/platform-contracts/tests/receipt-contract.test.ts"
    ],
    version: "luzione-platform-receipt/v1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "lifecycle-command-receipt",
    currentRuntime: false,
    maturity: "IMPLEMENTED",
    name: "Lifecycle command receipt",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-guarantees/types.ts",
      "src/modules/platform-guarantees/commandKernel.ts",
      "src/lib/platform-guarantees/postgresCommandStore.ts"
    ],
    version: "luzione-command-ledger/v0.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "workflow-state-and-continuation",
    currentRuntime: false,
    maturity: "IMPLEMENTED",
    name: "Workflow state, checkpoint and signed continuation contract",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-guarantees/types.ts",
      "src/modules/platform-guarantees/stateMachine.ts",
      "src/modules/platform-guarantees/eventContract.ts",
      "src/lib/platform-guarantees/postgresWorkflowDeliveryStore.ts",
      "supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql"
    ],
    version: "luzione-workflow-delivery/v0.1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "legacy-retry-decision",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Bounded retry and reconciliation decision",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-guarantees/types.ts",
      "src/modules/platform-guarantees/retryPolicy.ts"
    ],
    version: "1.0",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "autonomy-constitution",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Autonomy effect and authority constitution",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:luzione-authority-v2"],
    sourcePaths: [
      "src/modules/autonomy/constitution.ts",
      "src/modules/autonomy/evaluator.ts"
    ],
    version: "2026-08-31.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Sultan-OS"],
    contractId: "sultan-rights-charter",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Sultan reciprocal rights and amendment boundary",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/30:constitutional-ledger", "pull/31:constitutional-ledger"],
    sourcePaths: ["src/modules/autonomy/rights.ts"],
    version: "2026-08-28.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI"],
    contractId: "p113-catalog-ingest",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Shopify catalog observation ingest",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/catalog-projection/runtime.ts",
      "src/app/api/v1/catalog/shopify/projections/route.ts"
    ],
    version: "2026-08-26.p113.api-ingest.v1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI"],
    contractId: "p113-catalog-projection",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Quote-selection catalog projection",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/catalog-projection/runtime.ts",
      "src/modules/catalog-projection/store.ts"
    ],
    version: "2026-08-19.p113.v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "tenant-autonomy-policy",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Tenant autonomy policy snapshot",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:luzione-authority-v2"],
    sourcePaths: [
      "src/modules/tenant-policy/types.ts",
      "src/modules/tenant-policy/parser.ts",
      "src/modules/tenant-policy/evaluator.ts"
    ],
    version: "1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "platform-failure",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Universal failure domain, class, retry and severity taxonomy",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md",
      "src/modules/platform-contracts/failureContract.ts",
      "src/lib/api/http.ts"
    ],
    version: "luzione-platform-failure/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "desired-observed-reconciliation-state",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Desired, observed, freshness and reconciliation state",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md",
      "src/modules/platform-contracts/stateContract.ts",
      "src/app/api/v1/healthz/route.ts",
      "src/app/api/v1/readyz/route.ts",
      "src/modules/sultan-runtime/runtimeStatus.ts"
    ],
    version: "luzione-reconciliation-state/v1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "service-descriptor",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Service and dependency descriptor",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-service-catalog/registry.ts",
      "src/app/api/v1/catalog/route.ts"
    ],
    version: "luzione-service-catalog/v1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "table-object-descriptor",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Physical table ownership, lifecycle, reconciliation, security and retirement gate",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-contracts/tableObjectRegistry.ts",
      "contracts/objects/luzione-table-object-registry-v1.schema.json",
      "src/app/api/v1/catalog/route.ts"
    ],
    version: "luzione-table-object-registry/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "telemetry-semantic-conventions",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "OpenTelemetry-compatible trace, structured-log and metric semantics",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-telemetry/telemetry.ts",
      "instrumentation.ts",
      "src/lib/api/http.ts"
    ],
    version: "luzione-telemetry/v1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "production-convergence-operations-evidence",
    currentRuntime: true,
    maturity: "LIBRARY_ONLY",
    name: "Dashboard, alert, SLO, release, rollback and recovery evidence binding",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-operations/registry.ts",
      "src/modules/platform-operations/evidence.ts",
      "contracts/operations/luzione-production-convergence-evidence-v0.1.schema.json",
      "docs/platform-engineering/PRODUCTION_CONVERGENCE_OPERATIONS_EVIDENCE_V0.1.md",
      "src/app/api/v1/catalog/route.ts"
    ],
    version: "luzione-production-convergence-evidence/v0.1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "recovery-registry",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Recovery ownership, RPO/RTO target and evidence registry",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-recovery/registry.ts",
      "scripts/run-disposable-postgres-restore-drill.sh",
      "engineering/execution/recovery/API_SE_014_DISPOSABLE_RESTORE_20260829.json"
    ],
    version: "luzione-recovery-registry/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "sli-slo-error-budget-registry",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Platform, capability and business SLI/SLO/error-budget semantics",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-slo/registry.ts",
      "src/app/api/v1/catalog/route.ts"
    ],
    version: "luzione-slo-registry/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "security-control-evidence",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Zero-tolerance security control and denial-probe evidence registry",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-security-controls/registry.ts",
      "src/modules/security-posture/rlsPosture.ts",
      "src/app/api/v1/security/rls-readiness/route.ts",
      "supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql",
      "architecture/production-convergence/API_PC_013_OWNERSHIP_MANIFEST.json"
    ],
    version: "luzione-security-controls/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "readiness-evidence",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Freshness-aware production truth and readiness evidence",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-readiness/evidence.ts",
      "src/app/api/v1/healthz/route.ts"
    ],
    version: "luzione-readiness-evidence/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "production-readiness-certification",
    currentRuntime: true,
    maturity: "LIBRARY_ONLY",
    name: "Exact-candidate critical-invariant production readiness certification",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-readiness/certification.ts",
      "docs/platform-engineering/PRODUCTION_READINESS_CERTIFICATION_V1.md"
    ],
    version: "luzione-production-readiness-certification/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "performance-program",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Performance workload profiles and bounded measurement evidence",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-performance/program.ts",
      "scripts/run-http-performance-profile.ts"
    ],
    version: "luzione-performance-program/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "causal-navigation",
    currentRuntime: true,
    maturity: "LIBRARY_ONLY",
    name: "Authorized causal request/event/receipt/trace/readback navigation",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-causality/navigation.ts",
      "src/modules/platform-contracts/receiptContract.ts",
      "src/modules/platform-telemetry/telemetry.ts"
    ],
    version: "luzione-causal-navigation/v1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "causal-readback",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Tenant-bound causal receipt, source version and freshness readback",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-contracts/readbackContract.ts",
      "src/lib/platform-guarantees/readService.ts",
      "src/app/api/v1/platform-guarantees/route.ts",
      "src/modules/catalog-projection/store.ts"
    ],
    version: "luzione-causal-readback/v0.1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "lead-commercial-case-command",
    currentRuntime: true,
    maturity: "IMPLEMENTED_TRANSITIONAL",
    name: "Default-off Lead and Commercial Case command/readback boundary",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/lead-commercial-case/contracts.ts",
      "src/modules/lead-commercial-case/store.ts",
      "src/app/api/v1/commands/leads/route.ts",
      "src/app/api/v1/commands/commercial-cases/route.ts",
      "supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql"
    ],
    version: "luzione-lead-commercial-case/v0.1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "proposal-quote-approval-command",
    currentRuntime: true,
    maturity: "IMPLEMENTED_TRANSITIONAL",
    name: "Default-off Quote, margin approval and exact-version Proposal review boundary",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/proposal-quote-approval/contracts.ts",
      "src/modules/proposal-quote-approval/store.ts",
      "src/app/api/v1/commands/quotes/route.ts",
      "src/app/api/v1/commands/quote-approvals/route.ts",
      "src/app/api/v1/commands/proposal-reviews/route.ts",
      "supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql"
    ],
    version: "luzione-proposal-quote-approval/v0.1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "order-fulfillment-intent-command",
    currentRuntime: true,
    maturity: "IMPLEMENTED_TRANSITIONAL",
    name: "Default-off accepted Quote to Order and no-effect Fulfillment Intent boundary",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: ["src/modules/order-fulfillment/contracts.ts", "src/modules/order-fulfillment/store.ts", "src/app/api/v1/commands/orders/route.ts", "src/app/api/v1/commands/fulfillment-intents/route.ts", "supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql"],
    version: "luzione-order-fulfillment-intent/v0.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Sultan-OS"],
    contractId: "sultan-agent-context",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Canonical context reference presented by a Sultan agent",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "contracts/sultan/agent-context-v0.1.schema.json",
      "src/modules/sultan-agent/contracts.ts",
      "src/modules/sultan-agent/parser.ts"
    ],
    version: "luzione-sultan-agent-context/v0.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Sultan-OS"],
    contractId: "sultan-agent-intent",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Typed no-effect Sultan agent work intent",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "contracts/sultan/agent-intent-v0.1.schema.json",
      "src/modules/sultan-agent/contracts.ts",
      "src/app/api/v1/sultan/agent-intents/evaluate/route.ts"
    ],
    version: "luzione-sultan-agent-intent/v0.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Sultan-OS"],
    contractId: "sultan-agent-policy",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Deterministic Sultan agent admission decision",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "contracts/sultan/agent-policy-decision-v0.1.schema.json",
      "src/modules/sultan-agent/evaluator.ts",
      "src/app/api/v1/sultan/agent-intents/evaluate/route.ts"
    ],
    version: "luzione-sultan-agent-policy/v0.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Sultan-OS"],
    contractId: "sultan-agent-outcome",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Exact-version Sultan agent outcome and readback reference",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "contracts/sultan/agent-outcome-v0.1.schema.json",
      "src/modules/sultan-agent/contracts.ts"
    ],
    version: "luzione-sultan-agent-outcome/v0.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "provider-adapter-runtime",
    currentRuntime: false,
    maturity: "IMPLEMENTED_TRANSITIONAL",
    name: "Typed provider adapter, restart-safe dispatch and exact source reconciliation boundary",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: ["src/modules/provider-runtime/contracts.ts", "src/modules/provider-runtime/runtime.ts", "src/lib/platform-guarantees/postgresWorkflowDeliveryStore.ts", "src/app/api/v1/provider-operations/route.ts", "supabase/migrations/20260831080000_provider_worker_runtime.sql"],
    version: "luzione-provider-adapter/v0.1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "cross-system-journey-certification",
    currentRuntime: true,
    maturity: "LIBRARY_ONLY",
    name: "Independent exact-version cross-system journey certification",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-journeys/certification.ts",
      "engineering/execution/journeys/API_SE_019_CERTIFICATION_20260829.json"
    ],
    version: "luzione-cross-system-journey-certification/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "test-taxonomy",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Test evidence taxonomy and orchestration law",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-testing/taxonomy.ts",
      ".github/workflows/ci.yml"
    ],
    version: "luzione-test-taxonomy/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "release-identity",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Exact API release, deployment, schema and contract identity",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/production-convergence/releaseIdentity.ts",
      "src/app/api/v1/release/route.ts",
      "contracts/contract-manifest.v0.1.json"
    ],
    version: "luzione-release-identity/v0.1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "release-evidence",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Release provenance and evidence maturity",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "src/modules/platform-release/releaseContract.ts",
      "docs/platform-engineering/DEPLOYMENT_PROVENANCE_CANARY_ROLLBACK_V1.md"
    ],
    version: "luzione-release-evidence/v1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "a02-shared-contract-bundle-draft",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "A02 exact-pin shared identity, tenant, command, receipt and readback draft bundle",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["controller:A02:G0"],
    sourcePaths: [
      "contracts/drafts/luzione-shared-contracts-v0.2-draft.1.manifest.json",
      "contracts/drafts/fixtures/a02-v0.2-draft.1-producer-consumer.json",
      "src/modules/shared-contract-drafts/contracts.ts",
      "src/modules/shared-contract-drafts/adapters.ts",
      "src/modules/shared-contract-drafts/consumerCompatibility.ts"
    ],
    version: "luzione-shared-contracts/v0.2-draft.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "a02-identity-tenant-draft",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Credential actor, logical actor and exact tenant draft",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["controller:A02:G0"],
    sourcePaths: [
      "contracts/drafts/identity-tenant-v0.2-draft.1.schema.json",
      "contracts/drafts/fixtures/a02-v0.2-draft.1-producer-consumer.json",
      "src/modules/shared-contract-drafts/contracts.ts",
      "src/modules/shared-contract-drafts/adapters.ts",
      "src/modules/shared-contract-drafts/consumerCompatibility.ts"
    ],
    version: "luzione-identity-tenant/v0.2-draft.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "a02-command-envelope-draft",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Server-bound exact-idempotency no-effect command draft",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["controller:A02:G0"],
    sourcePaths: [
      "contracts/drafts/command-envelope-v0.2-draft.1.schema.json",
      "contracts/drafts/fixtures/a02-v0.2-draft.1-producer-consumer.json",
      "src/modules/shared-contract-drafts/contracts.ts",
      "src/modules/shared-contract-drafts/adapters.ts",
      "src/modules/shared-contract-drafts/consumerCompatibility.ts"
    ],
    version: "luzione-command-envelope/v0.2-draft.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "a02-receipt-envelope-draft",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Causal command receipt draft without effect authority",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["controller:A02:G0"],
    sourcePaths: [
      "contracts/drafts/receipt-envelope-v0.2-draft.1.schema.json",
      "contracts/drafts/fixtures/a02-v0.2-draft.1-producer-consumer.json",
      "src/modules/shared-contract-drafts/contracts.ts",
      "src/modules/shared-contract-drafts/adapters.ts",
      "src/modules/shared-contract-drafts/consumerCompatibility.ts"
    ],
    version: "luzione-receipt-envelope/v0.2-draft.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "a02-readback-envelope-draft",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Tenant-bound finality and freshness readback draft",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["controller:A02:G0"],
    sourcePaths: [
      "contracts/drafts/readback-envelope-v0.2-draft.1.schema.json",
      "contracts/drafts/fixtures/a02-v0.2-draft.1-producer-consumer.json",
      "src/modules/shared-contract-drafts/contracts.ts",
      "src/modules/shared-contract-drafts/adapters.ts",
      "src/modules/shared-contract-drafts/consumerCompatibility.ts"
    ],
    version: "luzione-readback-envelope/v0.2-draft.1",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "luzione-core-contract-bundle-v1",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "CORE-01 strict operation, receipt, readback, onboarding, import, connector and support contract bundle",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["controller:CORE-01:G0", "controller:SUPPORT-01:L1-CORE-CONTRACTS:v1"],
    sourcePaths: [
      "contracts/core/luzione-core-v1.manifest.json",
      "contracts/core/v1/luzione-core-contracts-v1.schema.json",
      "contracts/core/consumer-mappings/sultan-runtime-01-v1.json",
      "src/modules/luzione-core-contracts/contracts.ts",
      "src/modules/luzione-core-contracts/consumerSdk.ts",
      "src/modules/luzione-core-contracts/fixtures.ts"
    ],
    version: "LuzioneCoreContracts/v1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "luzione-authority",
    currentRuntime: false,
    maturity: "PENDING_CHANGESET",
    name: "Canonical membership and authority-v2 command boundary",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/29", "pull/31"],
    sourcePaths: ["docs/platform-engineering/CROSS_SYSTEM_TOPOLOGY_AND_OWNERSHIP_V1.md"],
    version: "2-candidate",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "openapi-http-catalog",
    currentRuntime: true,
    maturity: "IMPLEMENTED",
    name: "Production-convergence read-only OpenAPI and schema bundle",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: [
      "contracts/contract-manifest.v0.1.json",
      "contracts/openapi/luzione-api-v0.1.yaml",
      "contracts/context/request-context-v0.1.schema.json",
      "contracts/errors/platform-failure-v0.1.schema.json",
      "contracts/receipts/receipt-reference-v0.1.schema.json"
    ],
    version: "luzione-api-contract/v0.1",
  },
]);

export function contractRegistryViolations(
  entries: readonly PlatformContractDescriptor[] = platformContractRegistry,
) {
  const violations: string[] = [];
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = `${entry.contractId}@${entry.version}`;
    if (identities.has(identity)) violations.push(`duplicate:${identity}`);
    identities.add(identity);
    if (entry.ownerRepository !== "CIBOTFLOW/Luzione-API") {
      violations.push(`owner:${identity}`);
    }
    if (entry.maturity === "PENDING_CHANGESET" && entry.currentRuntime) {
      violations.push(`pending-current:${identity}`);
    }
    if (entry.currentRuntime && entry.sourcePaths.length === 0) {
      violations.push(`missing-source:${identity}`);
    }
  }
  return violations;
}
