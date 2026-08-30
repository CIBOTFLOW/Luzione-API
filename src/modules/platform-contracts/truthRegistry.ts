export const SOURCE_OF_TRUTH_REGISTRY_VERSION = "luzione-source-of-truth-registry/v1";

export type ConsistencyModel =
  | "EVENTUAL"
  | "PROVIDER_AUTHORITATIVE"
  | "READ_AFTER_WRITE"
  | "TRANSACTIONAL"
  | "UNRESOLVED";

export type OwnershipState =
  | "CONFIRMED"
  | "PROJECTION_CONFIRMED"
  | "TRANSFER_PENDING"
  | "UNRESOLVED";

export type SourceOfTruthDescriptor = {
  canonicalStoreOrProvider: string | null;
  conflictStrategy: string | null;
  consistency: ConsistencyModel;
  domain: string;
  entity: string;
  evidenceRefs: readonly string[];
  mutationOwner: string | null;
  ownershipState: OwnershipState;
  readModels: readonly string[];
  rebuildable: boolean | null;
  reconciliationStrategy: string | null;
  retention: string | null;
  semanticOwner: string;
  versionIdentifier: string | null;
};

const unresolvedPostgresObject = (
  domain: string,
  entity: string,
  semanticOwner: string,
): SourceOfTruthDescriptor => ({
  canonicalStoreOrProvider: "canonical-postgres",
  conflictStrategy: null,
  consistency: "UNRESOLVED",
  domain,
  entity,
  evidenceRefs: [
    "docs/ARCHITECTURE.md",
    "docs/platform-engineering/CROSS_SYSTEM_TOPOLOGY_AND_OWNERSHIP_V1.md"
  ],
  mutationOwner: null,
  ownershipState: "UNRESOLVED",
  readModels: [],
  rebuildable: null,
  reconciliationStrategy: null,
  retention: null,
  semanticOwner,
  versionIdentifier: null,
});

export const sourceOfTruthRegistry: readonly SourceOfTruthDescriptor[] = Object.freeze([
  unresolvedPostgresObject("customers", "Account", "business-domain owner unresolved"),
  unresolvedPostgresObject("customers", "Contact", "business-domain owner unresolved"),
  unresolvedPostgresObject("growth", "Lead", "business-domain owner unresolved"),
  unresolvedPostgresObject("sales", "Opportunity", "business-domain owner unresolved"),
  unresolvedPostgresObject("commercial", "CommercialCase", "business-domain owner unresolved"),
  unresolvedPostgresObject("commercial", "Proposal", "business-domain owner unresolved"),
  unresolvedPostgresObject("commercial", "Quote", "business-domain owner unresolved"),
  unresolvedPostgresObject("commerce", "Order", "business-domain owner unresolved"),
  {
    canonicalStoreOrProvider: "external:shopify",
    conflictStrategy: "Shopify source version wins; projection remains blocked when source counts or mapping evidence disagree.",
    consistency: "PROVIDER_AUTHORITATIVE",
    domain: "catalog",
    entity: "Product",
    evidenceRefs: [
      "src/modules/catalog-projection/runtime.ts",
      "src/modules/catalog-projection/store.ts"
    ],
    mutationOwner: null,
    ownershipState: "PROJECTION_CONFIRMED",
    readModels: [
      "public.p113_catalog_search_projections",
      "public.p113_catalog_sync_runs"
    ],
    rebuildable: true,
    reconciliationStrategy: "Compare authoritative Shopify product/variant counts, cursor receipts and current P107 mapping evidence before marking the projection CURRENT.",
    retention: "projection retention unresolved; source remains Shopify",
    semanticOwner: "catalog business owner unresolved; shared projection contract owned by CIBOTFLOW/Luzione-API",
    versionIdentifier: "Shopify source version plus P113 payload hash",
  },
  unresolvedPostgresObject("procurement", "Supplier", "business-domain owner unresolved"),
  unresolvedPostgresObject("fulfillment", "Shipment", "business-domain owner unresolved"),
  unresolvedPostgresObject("work", "Task", "business-domain owner unresolved"),
  {
    ...unresolvedPostgresObject("governance", "Approval", "shared approval contract owned by CIBOTFLOW/Luzione-API"),
    canonicalStoreOrProvider: null,
    evidenceRefs: [
      "src/modules/autonomy/types.ts",
      "docs/platform-engineering/CROSS_SYSTEM_TOPOLOGY_AND_OWNERSHIP_V1.md",
      "pending:pull/31:platform-approvals"
    ],
  },
  {
    ...unresolvedPostgresObject("governance", "Decision", "shared decision contract owned by CIBOTFLOW/Luzione-API"),
    canonicalStoreOrProvider: null,
    evidenceRefs: [
      "src/modules/autonomy/evaluator.ts",
      "src/modules/tenant-policy/evaluator.ts",
      "pending:pull/31:platform-audit-events"
    ],
  },
  {
    canonicalStoreOrProvider: "canonical-postgres",
    conflictStrategy: "Reject stale state versions and reconcile source state after ambiguous provider acknowledgement.",
    consistency: "TRANSACTIONAL",
    domain: "workflow",
    entity: "Workflow",
    evidenceRefs: [
      "docs/ARCHITECTURE.md",
      "src/lib/platform-guarantees/readService.ts",
      "src/modules/platform-guarantees/stateMachine.ts"
    ],
    mutationOwner: null,
    ownershipState: "TRANSFER_PENDING",
    readModels: ["public.p111_workflow_instances"],
    rebuildable: false,
    reconciliationStrategy: "P111 checkpoint/state readback; source/provider reconciliation before retry when acknowledgement is ambiguous.",
    retention: null,
    semanticOwner: "shared workflow contract owned by CIBOTFLOW/Luzione-API",
    versionIdentifier: "definitionVersion plus stateVersion",
  },
  {
    canonicalStoreOrProvider: null,
    conflictStrategy: null,
    consistency: "UNRESOLVED",
    domain: "sultan",
    entity: "Memory",
    evidenceRefs: [
      "docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md",
      "src/lib/sultan-runtime/readService.ts"
    ],
    mutationOwner: "CIBOTFLOW/Sultan-OS",
    ownershipState: "UNRESOLVED",
    readModels: ["public.luzione_sultan_runtime_status_v1() aggregate only"],
    rebuildable: null,
    reconciliationStrategy: null,
    retention: null,
    semanticOwner: "CIBOTFLOW/Sultan-OS",
    versionIdentifier: null,
  },
  {
    canonicalStoreOrProvider: null,
    conflictStrategy: null,
    consistency: "UNRESOLVED",
    domain: "sultan",
    entity: "AIGeneration",
    evidenceRefs: [
      "docs/platform-engineering/SYSTEMS_ENGINEERING_PROGRAM_V1.md",
      "src/lib/sultan-runtime/readService.ts"
    ],
    mutationOwner: "CIBOTFLOW/Sultan-OS",
    ownershipState: "UNRESOLVED",
    readModels: ["public.luzione_sultan_runtime_status_v1() aggregate only"],
    rebuildable: null,
    reconciliationStrategy: null,
    retention: null,
    semanticOwner: "CIBOTFLOW/Sultan-OS",
    versionIdentifier: null,
  },
  unresolvedPostgresObject("growth", "Campaign", "business-domain owner unresolved"),
  unresolvedPostgresObject("service", "CustomerIssue", "business-domain owner unresolved"),
]);

export const mutationPathFindings = Object.freeze([
  {
    findingId: "API_SE_003_M001",
    paths: [
      "src/modules/workflows/catalog.ts",
      "supabase/migrations/20260828210000_tenant_ai_governance_and_workflow_packs.sql"
    ],
    status: "DUPLICATE_DEFINITION",
    subject: "WorkflowPack",
  },
  {
    findingId: "API_SE_003_M002",
    paths: [
      "src/lib/platformCatalog.ts",
      "pending:pull/31:docs/production/SYSTEM_ARCHITECTURE.md"
    ],
    status: "SEMANTIC_OWNER_CONFLICT",
    subject: "business objects",
  },
  {
    findingId: "API_SE_003_M003",
    paths: [
      "src/app/api/v1/platform-guarantees/route.ts#POST",
      "pending:pull/31:src/app/api/v1/commands/route.ts#POST"
    ],
    status: "PENDING_MUTATION_PATH_COLLISION",
    subject: "LifecycleCommand",
  },
]);

export function truthRegistryViolations(
  entries: readonly SourceOfTruthDescriptor[] = sourceOfTruthRegistry,
) {
  const violations: string[] = [];
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = `${entry.domain}:${entry.entity}`;
    if (identities.has(identity)) violations.push(`duplicate:${identity}`);
    identities.add(identity);
    if (entry.ownershipState === "CONFIRMED" && (!entry.canonicalStoreOrProvider || !entry.mutationOwner)) {
      violations.push(`incomplete-confirmed:${identity}`);
    }
    if (entry.consistency !== "UNRESOLVED" && !entry.canonicalStoreOrProvider) {
      violations.push(`consistency-without-store:${identity}`);
    }
    if (entry.ownershipState === "UNRESOLVED" && entry.evidenceRefs.length === 0) {
      violations.push(`unexplained-unresolved:${identity}`);
    }
  }
  return violations;
}
