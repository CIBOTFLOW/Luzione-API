export const PLATFORM_SERVICE_CATALOG_VERSION = "luzione-service-catalog/v1";

export type ServiceDescriptor = {
  consumedContracts: readonly string[];
  criticalityTier: "TIER_1" | "TIER_2" | "TIER_3";
  dashboards: readonly string[];
  dataClassification: "INTERNAL_AND_TENANT_RESTRICTED" | "INTERNAL_METADATA";
  dependencies: readonly string[];
  deployableRef: string;
  externalEffectClasses: readonly string[];
  healthProbeRefs: readonly string[];
  humanOwnerRole: string;
  lastObservedReleaseSha: string | null;
  name: string;
  publishedContracts: readonly string[];
  repository: "CIBOTFLOW/Luzione-API";
  runbookRefs: readonly string[];
  runtime: string;
  serviceId: string;
  slis: readonly string[];
  sloRefs: readonly string[];
  sourceOfTruthScope: readonly string[];
  systemOwner: "luzione_api";
};

export type DependencyDescriptor = {
  dependencyId: string;
  evidenceRefs: readonly string[];
  kind: "CONSUMER" | "DATA_STORE" | "HOST_AND_IDENTITY" | "SOURCE_PROVIDER";
  observedState: "CONTRACT_ONLY" | "DIRECT_RUNTIME" | "INDIRECT_SOURCE" | "UNVERIFIED_CONSUMER";
  owner: string;
};

export type RunbookDescriptor = {
  owner: string;
  path: string;
  runbookId: string;
  scopes: readonly string[];
  title: string;
};

export const serviceCatalog: readonly ServiceDescriptor[] = Object.freeze([
  {
    consumedContracts: ["postgres-wire", "vercel-oidc", "shopify-p113-ingest"],
    criticalityTier: "TIER_1",
    dashboards: [],
    dataClassification: "INTERNAL_AND_TENANT_RESTRICTED",
    dependencies: ["canonical-postgres", "luzione-ui-consumer", "shopify-source", "sultan-os-consumer", "vercel-hosting-identity"],
    deployableRef: "vercel.json",
    externalEffectClasses: [],
    healthProbeRefs: ["GET /api/v1/livez", "GET /api/v1/readyz", "GET /api/v1/healthz", "GET /api/v1/security/rls-readiness"],
    humanOwnerRole: "Luzione API platform owner",
    lastObservedReleaseSha: null,
    name: "Luzione API and restricted engineering console",
    publishedContracts: ["luzione-platform-contract-registry/v1", "luzione-source-of-truth-registry/v1", "luzione-request-identity/v1", "luzione-platform-failure/v1", "luzione-reconciliation-state/v1", "luzione-service-catalog/v1", "luzione-slo-registry/v1", "luzione-security-controls/v1", "luzione-readiness-evidence/v1", "luzione-performance-program/v1", "luzione-release-evidence/v1"],
    repository: "CIBOTFLOW/Luzione-API",
    runbookRefs: ["api-readiness", "database-rls", "p113-catalog", "sultan-readback"],
    runtime: "Next.js 16 on Node.js, deployed to Vercel iad1",
    serviceId: "luzione-api-nextjs",
    slis: ["api-http-success-ratio", "api-http-p95-duration", "p113-current-projection-ratio"],
    sloRefs: ["api-http-availability-provisional", "api-http-p95-latency-provisional", "p113-projection-freshness-provisional"],
    sourceOfTruthScope: ["shared deterministic platform contracts", "canonical Postgres API readback", "P113 Shopify catalog projection"],
    systemOwner: "luzione_api",
  },
  {
    consumedContracts: ["postgres-ddl"],
    criticalityTier: "TIER_1",
    dashboards: [],
    dataClassification: "INTERNAL_METADATA",
    dependencies: ["canonical-postgres"],
    deployableRef: "supabase/migrations",
    externalEffectClasses: ["SCHEMA_CHANGE_REQUIRES_SEPARATE_AUTHORITY"],
    healthProbeRefs: ["GET /api/v1/healthz", "GET /api/v1/security/rls-readiness"],
    humanOwnerRole: "Luzione database migration owner",
    lastObservedReleaseSha: null,
    name: "Luzione API additive Postgres migration bundle",
    publishedContracts: ["versioned SQL migrations"],
    repository: "CIBOTFLOW/Luzione-API",
    runbookRefs: ["database-rls"],
    runtime: "PostgreSQL migration artifacts; no main-branch migration runner",
    serviceId: "luzione-api-schema-bundle",
    slis: [],
    sloRefs: [],
    sourceOfTruthScope: ["API-owned schema and RLS definitions"],
    systemOwner: "luzione_api",
  },
]);

export const dependencyCatalog: readonly DependencyDescriptor[] = Object.freeze([
  { dependencyId: "canonical-postgres", evidenceRefs: ["DATABASE_URL", "src/lib/db.ts"], kind: "DATA_STORE", observedState: "DIRECT_RUNTIME", owner: "Luzione canonical data owner" },
  { dependencyId: "vercel-hosting-identity", evidenceRefs: ["vercel.json", "src/lib/api/vercelOidc.ts"], kind: "HOST_AND_IDENTITY", observedState: "DIRECT_RUNTIME", owner: "Vercel / Luzione deployment owner" },
  { dependencyId: "shopify-source", evidenceRefs: ["P113 ingest contract"], kind: "SOURCE_PROVIDER", observedState: "INDIRECT_SOURCE", owner: "Shopify source owner" },
  { dependencyId: "luzione-ui-consumer", evidenceRefs: ["API_SE_001_TO_LUZIONE_UI_V1"], kind: "CONSUMER", observedState: "UNVERIFIED_CONSUMER", owner: "CIBOTFLOW/Luzione-UI" },
  { dependencyId: "sultan-os-consumer", evidenceRefs: ["API_SE_001_TO_SULTAN_OS_V1"], kind: "CONSUMER", observedState: "UNVERIFIED_CONSUMER", owner: "CIBOTFLOW/Sultan-OS" },
]);

export const runbookRegistry: readonly RunbookDescriptor[] = Object.freeze([
  { owner: "Luzione API platform owner", path: "docs/runbooks/API_READINESS.md", runbookId: "api-readiness", scopes: ["livez", "readyz", "healthz"], title: "API readiness triage" },
  { owner: "Luzione database and security owner", path: "docs/runbooks/DATABASE_AND_RLS.md", runbookId: "database-rls", scopes: ["Postgres", "RLS", "TLS"], title: "Database and RLS recovery" },
  { owner: "Luzione catalog projection owner", path: "docs/runbooks/P113_CATALOG_PROJECTION.md", runbookId: "p113-catalog", scopes: ["Shopify", "P113", "reconciliation"], title: "P113 catalog projection recovery" },
  { owner: "Luzione Sultan integration owner", path: "docs/runbooks/SULTAN_RUNTIME_READBACK.md", runbookId: "sultan-readback", scopes: ["Sultan aggregate", "provider observation"], title: "Sultan runtime readback triage" },
]);

export const dependencyGraph = Object.freeze({
  edges: serviceCatalog.flatMap((service) => service.dependencies.map((dependencyId) => ({
    dependencyId,
    serviceId: service.serviceId,
  }))),
  nodes: [
    ...serviceCatalog.map((service) => ({ id: service.serviceId, kind: "SERVICE" as const })),
    ...dependencyCatalog.map((dependency) => ({ id: dependency.dependencyId, kind: "DEPENDENCY" as const })),
  ],
});

export function serviceCatalogViolations() {
  const violations: string[] = [];
  const serviceIds = new Set(serviceCatalog.map((item) => item.serviceId));
  const dependencyIds = new Set(dependencyCatalog.map((item) => item.dependencyId));
  const runbookIds = new Set(runbookRegistry.map((item) => item.runbookId));
  if (serviceIds.size !== serviceCatalog.length) violations.push("duplicate-service-id");
  if (dependencyIds.size !== dependencyCatalog.length) violations.push("duplicate-dependency-id");
  if (runbookIds.size !== runbookRegistry.length) violations.push("duplicate-runbook-id");
  for (const service of serviceCatalog) {
    for (const id of service.dependencies) if (!dependencyIds.has(id)) violations.push(`unknown-dependency:${service.serviceId}:${id}`);
    for (const id of service.runbookRefs) if (!runbookIds.has(id)) violations.push(`unknown-runbook:${service.serviceId}:${id}`);
    if (service.lastObservedReleaseSha !== null) violations.push(`unproven-release:${service.serviceId}`);
  }
  return violations;
}
