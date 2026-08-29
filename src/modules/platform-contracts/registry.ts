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
    maturity: "IMPLEMENTED_TRANSITIONAL",
    name: "Initial authenticated service actor and tenant context",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:canonical-membership-resolution"],
    sourcePaths: ["src/lib/api/actor.ts", "docs/ARCHITECTURE.md"],
    version: "1.0",
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
    maturity: "LIBRARY_ONLY",
    name: "Atomic lifecycle command and idempotency contract",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:authority-v2-command-admission"],
    sourcePaths: [
      "src/modules/platform-guarantees/types.ts",
      "src/modules/platform-guarantees/commandKernel.ts"
    ],
    version: "1.0",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "lifecycle-command-receipt",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Lifecycle command receipt",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:durable-command-and-effect-receipts"],
    sourcePaths: [
      "src/modules/platform-guarantees/types.ts",
      "src/modules/platform-guarantees/commandKernel.ts"
    ],
    version: "1.0",
  },
  {
    compatibility: "EXACT_VERSION",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "workflow-state-and-continuation",
    currentRuntime: false,
    maturity: "LIBRARY_ONLY",
    name: "Workflow state, checkpoint and signed continuation contract",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:durable-execution-runtime"],
    sourcePaths: [
      "src/modules/platform-guarantees/types.ts",
      "src/modules/platform-guarantees/stateMachine.ts",
      "src/modules/platform-guarantees/eventContract.ts"
    ],
    version: "1.0",
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
    version: "2026-08-28.3",
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
    currentRuntime: false,
    maturity: "SPECIFIED_ONLY",
    name: "Universal failure domain, class, retry and severity taxonomy",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: ["docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md"],
    version: "1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "desired-observed-reconciliation-state",
    currentRuntime: false,
    maturity: "SPECIFIED_ONLY",
    name: "Desired, observed, freshness and reconciliation state",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: ["docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md"],
    version: "1",
  },
  {
    compatibility: "ADDITIVE_MINOR",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "service-descriptor",
    currentRuntime: false,
    maturity: "SPECIFIED_ONLY",
    name: "Service and dependency descriptor",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: [],
    sourcePaths: ["docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md"],
    version: "1",
  },
  {
    compatibility: "NEW_MAJOR_FOR_BREAKING",
    consumers: ["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"],
    contractId: "release-evidence",
    currentRuntime: false,
    maturity: "SPECIFIED_ONLY",
    name: "Release provenance and evidence maturity",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/31:signed-release-manifest"],
    sourcePaths: [
      "AGENTS.md",
      "docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md"
    ],
    version: "1",
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
    currentRuntime: false,
    maturity: "PENDING_CHANGESET",
    name: "Generated OpenAPI HTTP catalog",
    ownerRepository: "CIBOTFLOW/Luzione-API",
    pendingChangeRefs: ["pull/29", "pull/31"],
    sourcePaths: ["docs/platform-engineering/CROSS_SYSTEM_TOPOLOGY_AND_OWNERSHIP_V1.md"],
    version: "1-candidate",
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
