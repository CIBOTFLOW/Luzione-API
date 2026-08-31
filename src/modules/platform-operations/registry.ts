import { telemetryMetricRegistry } from "@/modules/platform-telemetry/telemetry";

export const PLATFORM_OPERATIONS_REGISTRY_VERSION = "luzione-operations-registry/v0.1";

export type OperationalPanel = {
  metricNames: readonly string[];
  panelId: string;
  purpose: string;
  sourceRefs: readonly string[];
  visualization: "GAUGE" | "RATIO" | "STAT" | "TIME_SERIES";
};

export type OperationalDashboard = {
  dashboardId: string;
  evidenceState: "DEFINED_NOT_DEPLOYED" | "DEPLOYED_OBSERVED";
  owner: string;
  panels: readonly OperationalPanel[];
  refreshSeconds: number;
  runbookRefs: readonly string[];
  title: string;
};

export type OperationalAlert = {
  alertId: string;
  condition: string;
  evidenceState: "DEFINED_NOT_DEPLOYED" | "DEPLOYED_OBSERVED";
  metricNames: readonly string[];
  owner: string;
  severity: "CRITICAL" | "WARNING";
  sourceRefs: readonly string[];
  runbookRef: string;
  window: string;
  zeroTolerance: boolean;
};

export const operationalDashboardRegistry: readonly OperationalDashboard[] = Object.freeze([
  {
    dashboardId: "luzione-api-runtime",
    evidenceState: "DEFINED_NOT_DEPLOYED",
    owner: "Luzione API platform owner",
    panels: [
      { panelId: "http-success-ratio", metricNames: ["luzione.api.server.request.count", "luzione.api.server.error.count"], purpose: "Completed-request success ratio by stable route and environment.", sourceRefs: ["api-http-success-ratio"], visualization: "RATIO" },
      { panelId: "http-p95-duration", metricNames: ["luzione.api.server.request.duration"], purpose: "p50/p95/p99 server duration by stable route and environment.", sourceRefs: ["api-http-p95-duration"], visualization: "TIME_SERIES" },
      { panelId: "database-pool-utilization", metricNames: ["luzione.database.pool.utilization"], purpose: "Bounded database pool pressure without connection identifiers.", sourceRefs: ["docs/runbooks/DATABASE_AND_RLS.md"], visualization: "GAUGE" },
    ],
    refreshSeconds: 60,
    runbookRefs: ["docs/runbooks/API_READINESS.md", "docs/runbooks/DATABASE_AND_RLS.md"],
    title: "Luzione API runtime",
  },
  {
    dashboardId: "luzione-durable-delivery",
    evidenceState: "DEFINED_NOT_DEPLOYED",
    owner: "Luzione workflow and provider owner",
    panels: [
      { panelId: "queue-backlog", metricNames: ["luzione.platform.queue.backlog"], purpose: "P110 delivery backlog by stable destination class and environment.", sourceRefs: ["luzione-workflow-delivery/v0.1"], visualization: "TIME_SERIES" },
      { panelId: "retry-volume", metricNames: ["luzione.platform.retry.count"], purpose: "Bounded retries by failure class and environment.", sourceRefs: ["luzione-platform-failure/v1"], visualization: "TIME_SERIES" },
      { panelId: "reconciliation-outcomes", metricNames: ["luzione.platform.reconciliation.count"], purpose: "Reconciliation outcomes without payload, tenant or provider-object identity.", sourceRefs: ["luzione-reconciliation-state/v1"], visualization: "TIME_SERIES" },
    ],
    refreshSeconds: 60,
    runbookRefs: ["docs/runbooks/API_READINESS.md", "docs/runbooks/P113_CATALOG_PROJECTION.md"],
    title: "Luzione durable delivery and reconciliation",
  },
  {
    dashboardId: "luzione-release-security-recovery",
    evidenceState: "DEFINED_NOT_DEPLOYED",
    owner: "Luzione release and recovery owner",
    panels: [
      { panelId: "rls-readiness", metricNames: [], purpose: "Exact-release RLS, role, grant and denial-probe status.", sourceRefs: ["GET /api/v1/security/rls-readiness"], visualization: "STAT" },
      { panelId: "release-identity", metricNames: [], purpose: "Deployment identity, exact SHA and bound contract/schema versions.", sourceRefs: ["GET /api/v1/release"], visualization: "STAT" },
      { panelId: "restore-evidence", metricNames: [], purpose: "Latest restore tier, fingerprint/readback status and recovery objective evidence.", sourceRefs: ["luzione-recovery-registry/v1"], visualization: "STAT" },
    ],
    refreshSeconds: 300,
    runbookRefs: ["docs/runbooks/DATABASE_AND_RLS.md", "docs/runbooks/POSTGRES_RESTORE_DRILL.md"],
    title: "Luzione release, security and recovery evidence",
  },
]);

export const operationalAlertRegistry: readonly OperationalAlert[] = Object.freeze([
  { alertId: "api-availability-budget-burn", condition: "5xx ratio exceeds the provisional 0.001 budget in both fast and slow windows", evidenceState: "DEFINED_NOT_DEPLOYED", metricNames: ["luzione.api.server.request.count", "luzione.api.server.error.count"], owner: "Luzione API platform owner", severity: "CRITICAL", sourceRefs: ["api-http-availability-provisional"], runbookRef: "docs/runbooks/API_READINESS.md", window: "5m and 1h", zeroTolerance: false },
  { alertId: "api-p95-latency-breach", condition: "p95 completed request duration exceeds 750ms", evidenceState: "DEFINED_NOT_DEPLOYED", metricNames: ["luzione.api.server.request.duration"], owner: "Luzione API platform owner", severity: "WARNING", sourceRefs: ["api-http-p95-latency-provisional"], runbookRef: "docs/runbooks/API_READINESS.md", window: "15m", zeroTolerance: false },
  { alertId: "delivery-backlog-stalled", condition: "queue backlog grows for three evaluation windows while completions do not advance", evidenceState: "DEFINED_NOT_DEPLOYED", metricNames: ["luzione.platform.queue.backlog"], owner: "Luzione workflow and provider owner", severity: "CRITICAL", sourceRefs: ["luzione-workflow-delivery/v0.1"], runbookRef: "docs/runbooks/API_READINESS.md", window: "15m", zeroTolerance: false },
  { alertId: "reconciliation-failure", condition: "reconciliation reports VERSION_MISMATCH, SOURCE_UNAVAILABLE or exhausted ambiguity", evidenceState: "DEFINED_NOT_DEPLOYED", metricNames: ["luzione.platform.reconciliation.count"], owner: "Luzione workflow and provider owner", severity: "CRITICAL", sourceRefs: ["luzione-reconciliation-state/v1"], runbookRef: "docs/runbooks/P113_CATALOG_PROJECTION.md", window: "5m", zeroTolerance: false },
  { alertId: "database-pool-pressure", condition: "pool utilization remains above 0.85", evidenceState: "DEFINED_NOT_DEPLOYED", metricNames: ["luzione.database.pool.utilization"], owner: "Luzione database owner", severity: "WARNING", sourceRefs: ["canonical-postgres"], runbookRef: "docs/runbooks/DATABASE_AND_RLS.md", window: "10m", zeroTolerance: false },
  { alertId: "security-rls-readiness-failed", condition: "the exact-release RLS readiness endpoint is non-PASS or unavailable", evidenceState: "DEFINED_NOT_DEPLOYED", metricNames: [], owner: "Luzione database and security owner", severity: "CRITICAL", sourceRefs: ["GET /api/v1/security/rls-readiness"], runbookRef: "docs/runbooks/DATABASE_AND_RLS.md", window: "one observation", zeroTolerance: true },
  { alertId: "release-identity-drift", condition: "runtime release identity differs from the promoted candidate or required contract/migration set", evidenceState: "DEFINED_NOT_DEPLOYED", metricNames: [], owner: "Luzione release owner", severity: "CRITICAL", sourceRefs: ["GET /api/v1/release"], runbookRef: "docs/runbooks/API_READINESS.md", window: "one observation", zeroTolerance: true },
]);

export function operationsRegistryViolations(
  dashboards: readonly OperationalDashboard[] = operationalDashboardRegistry,
  alerts: readonly OperationalAlert[] = operationalAlertRegistry,
) {
  const metricNames = new Set(telemetryMetricRegistry.map((metric) => metric.name));
  const dashboardIds = new Set<string>();
  const panelIds = new Set<string>();
  const alertIds = new Set<string>();
  const violations: string[] = [];
  for (const dashboard of dashboards) {
    if (dashboardIds.has(dashboard.dashboardId)) violations.push(`duplicate-dashboard:${dashboard.dashboardId}`);
    dashboardIds.add(dashboard.dashboardId);
    if (dashboard.evidenceState === "DEPLOYED_OBSERVED") violations.push(`unsupported-deployment:${dashboard.dashboardId}`);
    if (!dashboard.runbookRefs.length || dashboard.refreshSeconds < 15) violations.push(`incomplete-dashboard:${dashboard.dashboardId}`);
    for (const panel of dashboard.panels) {
      if (panelIds.has(panel.panelId)) violations.push(`duplicate-panel:${panel.panelId}`);
      panelIds.add(panel.panelId);
      if (!panel.metricNames.length && !panel.sourceRefs.length) violations.push(`unbound-panel:${panel.panelId}`);
      for (const metric of panel.metricNames) if (!metricNames.has(metric as never)) violations.push(`unknown-panel-metric:${panel.panelId}:${metric}`);
    }
  }
  for (const alert of alerts) {
    if (alertIds.has(alert.alertId)) violations.push(`duplicate-alert:${alert.alertId}`);
    alertIds.add(alert.alertId);
    if (alert.evidenceState === "DEPLOYED_OBSERVED") violations.push(`unsupported-alert-deployment:${alert.alertId}`);
    if (!alert.runbookRef.trim() || !alert.condition.trim() || !alert.sourceRefs.length) violations.push(`incomplete-alert:${alert.alertId}`);
    for (const metric of alert.metricNames) if (!metricNames.has(metric as never)) violations.push(`unknown-alert-metric:${alert.alertId}:${metric}`);
  }
  return violations;
}
