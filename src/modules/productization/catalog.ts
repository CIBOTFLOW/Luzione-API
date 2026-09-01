export const PRODUCT_CATALOG_CONTRACT_VERSION = "luzione-product-catalog/v0.1";

export const productModuleIds = [
  "supplier.onboarding",
  "crm.lead-management",
  "crm.accounts-opportunities",
  "growth.engine",
  "finance.money-dashboards",
  "operations.orders-delivery",
  "work.task-management",
  "service.customer-experience",
  "logistics.international-shipping",
  "fulfillment.end-to-end-quoting",
  "trade.import-export-compliance",
  "partners.service-provider-network",
  "ai.operating-system",
  "delivery.white-glove-scheduling",
  "commercial.proposals",
  "commercial.quotes",
  "design.room-planner",
] as const;

export type ProductModuleId = (typeof productModuleIds)[number];
export type CustomerSegment =
  | "DESIGN_FIRM"
  | "INTERNATIONAL_DISTRIBUTOR"
  | "PROCUREMENT_SHOP";

export type ProductModule = {
  dependencies: readonly ProductModuleId[];
  deliveryStage: "CONTRACT_FOUNDATION" | "INTEGRATION_PENDING" | "PLANNED";
  id: ProductModuleId;
  name: string;
  outcome: string;
  workflowPackCodes: readonly string[];
};

export const productModules: readonly ProductModule[] = Object.freeze([
  {
    dependencies: [],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "supplier.onboarding",
    name: "Supplier onboarding",
    outcome: "Qualify suppliers, collect evidence, map catalogs and retain approval provenance.",
    workflowPackCodes: ["luxury.supplier_onboarding"],
  },
  {
    dependencies: [],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "crm.lead-management",
    name: "Lead management",
    outcome: "Capture, deduplicate, qualify, score and route buyer or partner demand.",
    workflowPackCodes: ["crm.lead_qualification"],
  },
  {
    dependencies: ["crm.lead-management"],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "crm.accounts-opportunities",
    name: "Accounts and opportunities",
    outcome: "Operate the customer, relationship and qualified commercial pursuit lifecycle.",
    workflowPackCodes: ["crm.opportunity", "luxury.design_partner"],
  },
  {
    dependencies: ["crm.lead-management", "crm.accounts-opportunities"],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "growth.engine",
    name: "Growth engine",
    outcome: "Turn source-attributed demand signals into human-reviewed pipeline actions.",
    workflowPackCodes: ["growth.signal_to_account", "growth.outreach"],
  },
  {
    dependencies: ["operations.orders-delivery"],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "finance.money-dashboards",
    name: "Money dashboards",
    outcome: "Show incoming money, outgoing money, cash position and accounting handoff status.",
    workflowPackCodes: [],
  },
  {
    dependencies: ["commercial.quotes"],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "operations.orders-delivery",
    name: "Orders and delivery",
    outcome: "Operate accepted work through order, fulfillment, shipment and delivery evidence.",
    workflowPackCodes: ["fulfillment.exception", "luxury.import_fulfillment"],
  },
  {
    dependencies: [],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "work.task-management",
    name: "Task management",
    outcome: "Prioritize, assign and complete evidence-linked work with durable receipts.",
    workflowPackCodes: ["work.task_copilot"],
  },
  {
    dependencies: ["crm.accounts-opportunities", "operations.orders-delivery"],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "service.customer-experience",
    name: "Customer experience and support",
    outcome: "Coordinate customer issues, follow-up, service recovery and approved communications.",
    workflowPackCodes: ["service.customer_followup"],
  },
  {
    dependencies: ["supplier.onboarding", "operations.orders-delivery"],
    deliveryStage: "INTEGRATION_PENDING",
    id: "logistics.international-shipping",
    name: "International shipping and logistics",
    outcome: "Plan origin-to-destination movements with provider, document and exception evidence.",
    workflowPackCodes: ["luxury.import_fulfillment"],
  },
  {
    dependencies: ["supplier.onboarding", "commercial.quotes", "logistics.international-shipping"],
    deliveryStage: "INTEGRATION_PENDING",
    id: "fulfillment.end-to-end-quoting",
    name: "End-to-end fulfillment quoting",
    outcome: "Assemble product, freight, duties, service and white-glove assumptions into reviewed quote truth.",
    workflowPackCodes: ["luxury.import_fulfillment", "commercial.proposal"],
  },
  {
    dependencies: ["logistics.international-shipping"],
    deliveryStage: "PLANNED",
    id: "trade.import-export-compliance",
    name: "Import/export rules and documents",
    outcome: "Use effective-dated authoritative sources and human review for market-specific trade requirements.",
    workflowPackCodes: ["luxury.trade_compliance_review"],
  },
  {
    dependencies: ["supplier.onboarding", "logistics.international-shipping"],
    deliveryStage: "PLANNED",
    id: "partners.service-provider-network",
    name: "Service provider mapping and management",
    outcome: "Map forwarders, brokers, warehouses, installers and delivery partners with evidence-linked fit and health.",
    workflowPackCodes: ["luxury.supplier_onboarding"],
  },
  {
    dependencies: [],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "ai.operating-system",
    name: "AI operating system",
    outcome: "Provide governed reasoning, drafting, evaluation and workflow assistance without self-granted authority.",
    workflowPackCodes: [],
  },
  {
    dependencies: ["operations.orders-delivery", "partners.service-provider-network"],
    deliveryStage: "PLANNED",
    id: "delivery.white-glove-scheduling",
    name: "White-glove delivery scheduling",
    outcome: "Coordinate customer, carrier, warehouse and installer windows with approval and readback.",
    workflowPackCodes: ["luxury.white_glove_delivery"],
  },
  {
    dependencies: ["crm.accounts-opportunities", "commercial.quotes"],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "commercial.proposals",
    name: "Proposal generation",
    outcome: "Create, revise and human-review an exact-version proposal before any customer transmission.",
    workflowPackCodes: ["commercial.proposal", "luxury.design_partner"],
  },
  {
    dependencies: ["supplier.onboarding", "crm.accounts-opportunities"],
    deliveryStage: "CONTRACT_FOUNDATION",
    id: "commercial.quotes",
    name: "Quote generation",
    outcome: "Build exact-currency quote economics with approval, version and source evidence.",
    workflowPackCodes: ["commercial.proposal"],
  },
  {
    dependencies: ["commercial.proposals", "commercial.quotes"],
    deliveryStage: "INTEGRATION_PENDING",
    id: "design.room-planner",
    name: "Room planner",
    outcome: "Attach a reviewed, exact-version room plan and selected products to a governed proposal.",
    workflowPackCodes: ["luxury.room_plan_to_proposal"],
  },
]);

export const customerProfiles: ReadonlyArray<{
  recommendedModuleIds: readonly ProductModuleId[];
  segment: CustomerSegment;
  summary: string;
}> = Object.freeze([
  {
    recommendedModuleIds: productModuleIds,
    segment: "INTERNATIONAL_DISTRIBUTOR",
    summary: "Cross-border catalog, supplier, commercial, fulfillment and customer operations.",
  },
  {
    recommendedModuleIds: [
      "supplier.onboarding",
      "crm.lead-management",
      "crm.accounts-opportunities",
      "growth.engine",
      "finance.money-dashboards",
      "operations.orders-delivery",
      "work.task-management",
      "service.customer-experience",
      "logistics.international-shipping",
      "fulfillment.end-to-end-quoting",
      "trade.import-export-compliance",
      "partners.service-provider-network",
      "ai.operating-system",
      "delivery.white-glove-scheduling",
      "commercial.proposals",
      "commercial.quotes",
      "design.room-planner",
    ],
    segment: "PROCUREMENT_SHOP",
    summary: "Project sourcing, quotes, proposals, room planning and delivery coordination.",
  },
  {
    recommendedModuleIds: [
      "supplier.onboarding",
      "crm.lead-management",
      "crm.accounts-opportunities",
      "growth.engine",
      "finance.money-dashboards",
      "operations.orders-delivery",
      "work.task-management",
      "service.customer-experience",
      "logistics.international-shipping",
      "partners.service-provider-network",
      "ai.operating-system",
      "delivery.white-glove-scheduling",
      "commercial.proposals",
      "commercial.quotes",
      "design.room-planner",
    ],
    segment: "DESIGN_FIRM",
    summary: "Client pursuit, project proposal, room planning, procurement handoff and service coordination.",
  },
]);

export const marketRollout = Object.freeze({
  destinationMarket: Object.freeze({ countryCode: "US", countryName: "United States" }),
  originPhases: Object.freeze([
    Object.freeze({
      phase: 1,
      countries: Object.freeze([
        { countryCode: "IT", countryName: "Italy" },
        { countryCode: "DK", countryName: "Denmark" },
        { countryCode: "PT", countryName: "Portugal" },
        { countryCode: "ES", countryName: "Spain" },
        { countryCode: "TR", countryName: "Türkiye" },
        { countryCode: "FR", countryName: "France" },
        { countryCode: "NL", countryName: "Netherlands" },
      ]),
    }),
    Object.freeze({
      phase: 2,
      countries: Object.freeze([
        { countryCode: "MA", countryName: "Morocco" },
        { countryCode: "IN", countryName: "India" },
        { countryCode: "SE", countryName: "Sweden" },
        { countryCode: "JP", countryName: "Japan" },
        { countryCode: "VN", countryName: "Vietnam" },
        { countryCode: "DE", countryName: "Germany" },
      ]),
    }),
  ]),
  regulatoryDataLaw: Object.freeze({
    aiMayCreateLegalFinality: false,
    effectiveDatedSourceRequired: true,
    humanReviewRequired: true,
    sourceAuthorityRequired: true,
  }),
});

export const productEditions: ReadonlyArray<{
  editionId: "AI_OCRMS" | "DESIGN_COMMERCE" | "ENTERPRISE" | "IMPORT_OPERATIONS";
  moduleIds: readonly ProductModuleId[];
  name: string;
}> = Object.freeze([
  {
    editionId: "AI_OCRMS",
    moduleIds: [
      "supplier.onboarding",
      "crm.lead-management",
      "crm.accounts-opportunities",
      "growth.engine",
      "finance.money-dashboards",
      "operations.orders-delivery",
      "work.task-management",
      "service.customer-experience",
      "ai.operating-system",
      "commercial.quotes",
    ],
    name: "AI Operating CRM",
  },
  {
    editionId: "IMPORT_OPERATIONS",
    moduleIds: [
      "supplier.onboarding",
      "crm.lead-management",
      "crm.accounts-opportunities",
      "operations.orders-delivery",
      "logistics.international-shipping",
      "fulfillment.end-to-end-quoting",
      "trade.import-export-compliance",
      "partners.service-provider-network",
      "delivery.white-glove-scheduling",
      "commercial.quotes",
    ],
    name: "International Import Operations",
  },
  {
    editionId: "DESIGN_COMMERCE",
    moduleIds: [
      "supplier.onboarding",
      "crm.lead-management",
      "crm.accounts-opportunities",
      "operations.orders-delivery",
      "work.task-management",
      "logistics.international-shipping",
      "partners.service-provider-network",
      "commercial.proposals",
      "commercial.quotes",
      "design.room-planner",
      "delivery.white-glove-scheduling",
    ],
    name: "Design Commerce",
  },
  {
    editionId: "ENTERPRISE",
    moduleIds: productModuleIds,
    name: "Luzione Enterprise",
  },
]);

export function productCatalogViolations() {
  const violations: string[] = [];
  const moduleIds = new Set<ProductModuleId>();
  const dependencyGraph = new Map<ProductModuleId, readonly ProductModuleId[]>();
  for (const productModule of productModules) {
    if (moduleIds.has(productModule.id)) violations.push(`duplicate-module:${productModule.id}`);
    moduleIds.add(productModule.id);
    dependencyGraph.set(productModule.id, productModule.dependencies);
    for (const dependency of productModule.dependencies) {
      if (!productModuleIds.includes(dependency)) violations.push(`unknown-dependency:${productModule.id}:${dependency}`);
    }
  }
  const visited = new Set<ProductModuleId>();
  const active = new Set<ProductModuleId>();
  const visit = (moduleId: ProductModuleId) => {
    if (active.has(moduleId)) {
      violations.push(`dependency-cycle:${moduleId}`);
      return;
    }
    if (visited.has(moduleId)) return;
    active.add(moduleId);
    for (const dependency of dependencyGraph.get(moduleId) ?? []) visit(dependency);
    active.delete(moduleId);
    visited.add(moduleId);
  };
  for (const moduleId of moduleIds) visit(moduleId);

  const profileSegments = new Set<CustomerSegment>();
  for (const profile of customerProfiles) {
    if (profileSegments.has(profile.segment)) violations.push(`duplicate-profile:${profile.segment}`);
    profileSegments.add(profile.segment);
    const included = new Set(profile.recommendedModuleIds);
    if (included.size !== profile.recommendedModuleIds.length) {
      violations.push(`duplicate-profile-module:${profile.segment}`);
    }
    for (const moduleId of profile.recommendedModuleIds) {
      if (!moduleIds.has(moduleId)) violations.push(`unknown-profile-module:${profile.segment}:${moduleId}`);
      const productModule = productModules.find((candidate) => candidate.id === moduleId);
      for (const dependency of productModule?.dependencies ?? []) {
        if (!included.has(dependency)) {
          violations.push(`missing-profile-dependency:${profile.segment}:${moduleId}:${dependency}`);
        }
      }
    }
  }
  const editionIds = new Set<string>();
  for (const edition of productEditions) {
    if (editionIds.has(edition.editionId)) violations.push(`duplicate-edition:${edition.editionId}`);
    editionIds.add(edition.editionId);
    const included = new Set(edition.moduleIds);
    if (included.size !== edition.moduleIds.length) {
      violations.push(`duplicate-edition-module:${edition.editionId}`);
    }
    for (const moduleId of edition.moduleIds) {
      if (!moduleIds.has(moduleId)) violations.push(`unknown-edition-module:${edition.editionId}:${moduleId}`);
      const productModule = productModules.find((candidate) => candidate.id === moduleId);
      for (const dependency of productModule?.dependencies ?? []) {
        if (!included.has(dependency)) {
          violations.push(`missing-edition-dependency:${edition.editionId}:${moduleId}:${dependency}`);
        }
      }
    }
  }
  const countryCodes = new Set<string>();
  for (const phase of marketRollout.originPhases) {
    for (const country of phase.countries) {
      if (countryCodes.has(country.countryCode)) {
        violations.push(`duplicate-origin-country:${country.countryCode}`);
      }
      countryCodes.add(country.countryCode);
    }
  }
  return violations;
}
