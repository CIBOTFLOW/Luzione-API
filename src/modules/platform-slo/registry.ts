export const PLATFORM_SLO_REGISTRY_VERSION = "luzione-slo-registry/v1";

export type SliDescriptor = {
  calculation: string;
  exclusions: readonly string[];
  layer: "BUSINESS" | "CAPABILITY" | "PLATFORM";
  measurementSource: string;
  measurementStatus: "CONTRACT_ONLY" | "INSTRUMENTED_LOCAL" | "PRODUCTION_OBSERVED";
  metricNames: readonly string[];
  owner: string;
  runbookRef: string;
  scope: string;
  sliId: string;
  unit: "MILLISECONDS" | "RATIO" | "SECONDS";
};

export type SloDescriptor = {
  alertCondition: string;
  errorBudgetPolicy: "FREEZE_RISKY_CHANGES" | "INVESTIGATE_AND_RECONCILE";
  owner: string;
  provisional: true;
  runbookRef: string;
  sliId: string;
  sloId: string;
  target: { comparison: "GTE" | "LTE"; value: number };
  window: "ROLLING_28_DAYS" | "ROLLING_7_DAYS";
};

export const sliRegistry: readonly SliDescriptor[] = Object.freeze([
  {
    calculation: "1 - (5xx request count / all completed request count)",
    exclusions: ["operator-declared maintenance with an exact change receipt"],
    layer: "PLATFORM",
    measurementSource: "luzione-telemetry/v1 HTTP metric observations",
    measurementStatus: "INSTRUMENTED_LOCAL",
    metricNames: ["luzione.api.server.request.count", "luzione.api.server.error.count"],
    owner: "Luzione API platform owner",
    runbookRef: "docs/runbooks/API_READINESS.md",
    scope: "luzione-api HTTP availability",
    sliId: "api-http-success-ratio",
    unit: "RATIO",
  },
  {
    calculation: "p95 of completed API request duration by stable route template",
    exclusions: ["requests rejected before entering the API runtime"],
    layer: "PLATFORM",
    measurementSource: "luzione.api.server.request.duration",
    measurementStatus: "INSTRUMENTED_LOCAL",
    metricNames: ["luzione.api.server.request.duration"],
    owner: "Luzione API platform owner",
    runbookRef: "docs/runbooks/API_READINESS.md",
    scope: "luzione-api server request latency",
    sliId: "api-http-p95-duration",
    unit: "MILLISECONDS",
  },
  {
    calculation: "fresh converged P113 observations / all eligible projection observations",
    exclusions: ["Shopify source maintenance explicitly evidenced by the provider owner"],
    layer: "CAPABILITY",
    measurementSource: "luzione-reconciliation-state/v1 for provider.shopify.catalog-projection",
    measurementStatus: "INSTRUMENTED_LOCAL",
    metricNames: ["luzione.platform.reconciliation.count"],
    owner: "Luzione catalog projection owner",
    runbookRef: "docs/runbooks/P113_CATALOG_PROJECTION.md",
    scope: "P113 quote-selectable Shopify projection freshness",
    sliId: "p113-current-projection-ratio",
    unit: "RATIO",
  },
  {
    calculation: "seconds from accepted commercial intent to canonical actionable order version",
    exclusions: [],
    layer: "BUSINESS",
    measurementSource: "unresolved until Order/CommercialCase canonical mutation owner is returned",
    measurementStatus: "CONTRACT_ONLY",
    metricNames: [],
    owner: "Unresolved business outcome owner",
    runbookRef: "docs/platform-engineering/SOURCE_OF_TRUTH_AND_CONSISTENCY_V1.md",
    scope: "time to actionable order",
    sliId: "business-time-to-actionable-order",
    unit: "SECONDS",
  },
]);

export const sloRegistry: readonly SloDescriptor[] = Object.freeze([
  {
    alertCondition: "success ratio below 0.999 for the rolling window",
    errorBudgetPolicy: "FREEZE_RISKY_CHANGES",
    owner: "Luzione API platform owner",
    provisional: true,
    runbookRef: "docs/runbooks/API_READINESS.md",
    sliId: "api-http-success-ratio",
    sloId: "api-http-availability-provisional",
    target: { comparison: "GTE", value: 0.999 },
    window: "ROLLING_28_DAYS",
  },
  {
    alertCondition: "p95 duration above 750ms for the rolling window",
    errorBudgetPolicy: "INVESTIGATE_AND_RECONCILE",
    owner: "Luzione API platform owner",
    provisional: true,
    runbookRef: "docs/runbooks/API_READINESS.md",
    sliId: "api-http-p95-duration",
    sloId: "api-http-p95-latency-provisional",
    target: { comparison: "LTE", value: 750 },
    window: "ROLLING_7_DAYS",
  },
  {
    alertCondition: "fresh converged projection ratio below 0.99 for the rolling window",
    errorBudgetPolicy: "FREEZE_RISKY_CHANGES",
    owner: "Luzione catalog projection owner",
    provisional: true,
    runbookRef: "docs/runbooks/P113_CATALOG_PROJECTION.md",
    sliId: "p113-current-projection-ratio",
    sloId: "p113-projection-freshness-provisional",
    target: { comparison: "GTE", value: 0.99 },
    window: "ROLLING_7_DAYS",
  },
]);

export const errorBudgetLaw = Object.freeze({
  availabilityBudgetsMayExcuseSecurityFailure: false,
  evidenceRequirement: "Production error budgets require production-observed metric windows bound to an exact service/release identity.",
  provisionalTargetsAreReleaseFinal: false,
  zeroToleranceControlRegistry: "luzione-security-controls/v1",
});

export function calculateRatioErrorBudget(input: {
  badEvents: number;
  targetRatio: number;
  totalEvents: number;
}) {
  if (!(input.targetRatio > 0 && input.targetRatio < 1)) throw new Error("targetRatio must be between zero and one.");
  if (!Number.isInteger(input.badEvents) || !Number.isInteger(input.totalEvents)
    || input.badEvents < 0 || input.totalEvents <= 0 || input.badEvents > input.totalEvents) {
    throw new Error("Event counts must be bounded non-negative integers with a positive total.");
  }
  const allowedBadEvents = input.totalEvents * (1 - input.targetRatio);
  const remainingEvents = allowedBadEvents - input.badEvents;
  return {
    allowedBadEvents,
    consumedRatio: allowedBadEvents === 0 ? 1 : input.badEvents / allowedBadEvents,
    remainingEvents,
    status: remainingEvents >= 0 ? "WITHIN_BUDGET" as const : "EXHAUSTED" as const,
  };
}

export function sloRegistryViolations(
  slis: readonly SliDescriptor[] = sliRegistry,
  slos: readonly SloDescriptor[] = sloRegistry,
) {
  const sliIds = new Set(slis.map((item) => item.sliId));
  const violations: string[] = [];
  for (const slo of slos) {
    if (!sliIds.has(slo.sliId)) violations.push(`unknown-sli:${slo.sloId}`);
    if (!slo.provisional) violations.push(`non-provisional-without-production:${slo.sloId}`);
  }
  if (slos.some((slo) => /security|rls|authorization|tenant/i.test(slo.sliId))) {
    violations.push("security-control-in-availability-budget");
  }
  return violations;
}
