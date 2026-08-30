export const PLATFORM_PERFORMANCE_PROGRAM_VERSION = "luzione-performance-program/v1";

export type PerformanceProfile = {
  campaign: "BASELINE" | "BURST" | "DATABASE_POOL_PRESSURE" | "MUTATION_IDEMPOTENCY" | "PROVIDER_SLOWDOWN" | "QUEUE_BACKLOG" | "RECOVERY" | "SUSTAINED_LOAD";
  concurrency: number;
  durationSeconds: number | null;
  evidenceState: "CONTRACT_ONLY" | "HARNESS_READY";
  method: "GET" | "POST";
  notes: readonly string[];
  profileId: string;
  requests: number | null;
  target: string;
};

export const performanceProfileRegistry: readonly PerformanceProfile[] = Object.freeze([
  { campaign: "BASELINE", concurrency: 1, durationSeconds: null, evidenceState: "HARNESS_READY", method: "GET", notes: ["localhost only", "read-only liveness path"], profileId: "local-livez-baseline", requests: 100, target: "/api/v1/livez" },
  { campaign: "BURST", concurrency: 20, durationSeconds: null, evidenceState: "HARNESS_READY", method: "GET", notes: ["localhost only", "read-only liveness path"], profileId: "local-livez-burst", requests: 500, target: "/api/v1/livez" },
  { campaign: "SUSTAINED_LOAD", concurrency: 5, durationSeconds: null, evidenceState: "HARNESS_READY", method: "GET", notes: ["localhost only", "bounded request count substitutes for a short local soak"], profileId: "local-livez-sustained", requests: 1_000, target: "/api/v1/livez" },
  { campaign: "PROVIDER_SLOWDOWN", concurrency: 4, durationSeconds: 300, evidenceState: "CONTRACT_ONLY", method: "GET", notes: ["requires an approved provider simulator and retry/reconciliation observations"], profileId: "provider-slowdown", requests: null, target: "provider adapter boundary" },
  { campaign: "DATABASE_POOL_PRESSURE", concurrency: 20, durationSeconds: 300, evidenceState: "CONTRACT_ONLY", method: "GET", notes: ["requires disposable representative Postgres and pool saturation metrics"], profileId: "database-pool-pressure", requests: null, target: "canonical read paths" },
  { campaign: "MUTATION_IDEMPOTENCY", concurrency: 20, durationSeconds: null, evidenceState: "CONTRACT_ONLY", method: "POST", notes: ["requires disposable mutation owner and exact replay/conflict readback"], profileId: "mutation-idempotency", requests: 500, target: "durable command boundary" },
  { campaign: "QUEUE_BACKLOG", concurrency: 10, durationSeconds: 600, evidenceState: "CONTRACT_ONLY", method: "POST", notes: ["requires durable queue runtime and backlog/recovery observations"], profileId: "queue-backlog", requests: null, target: "durable workflow queue" },
  { campaign: "RECOVERY", concurrency: 5, durationSeconds: 300, evidenceState: "CONTRACT_ONLY", method: "GET", notes: ["requires an isolated failure injection and measured return to threshold"], profileId: "failure-recovery", requests: null, target: "selected critical path" },
]);

export type PerformanceSample = { durationMs: number; status: number };

function percentile(sorted: readonly number[], percentileValue: number) {
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

export function summarizePerformanceSamples(input: {
  concurrency: number;
  elapsedMs: number;
  samples: readonly PerformanceSample[];
}) {
  if (!Number.isInteger(input.concurrency) || input.concurrency <= 0) throw new Error("concurrency must be a positive integer.");
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs <= 0) throw new Error("elapsedMs must be positive.");
  if (!input.samples.length) throw new Error("At least one sample is required.");
  if (input.samples.some((sample) => !Number.isFinite(sample.durationMs) || sample.durationMs < 0 || !Number.isInteger(sample.status))) {
    throw new Error("Samples require non-negative durations and integer HTTP status codes.");
  }
  const durations = input.samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const errors = input.samples.filter((sample) => sample.status >= 500 || sample.status < 200).length;
  return {
    concurrency: input.concurrency,
    errorCount: errors,
    errorRate: errors / input.samples.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    requestCount: input.samples.length,
    throughputPerSecond: input.samples.length / (input.elapsedMs / 1_000),
  };
}

export function evaluatePerformanceThresholds(
  summary: ReturnType<typeof summarizePerformanceSamples>,
  thresholds = { maxErrorRate: 0, maxP95Ms: 750 },
) {
  if (!(thresholds.maxErrorRate >= 0 && thresholds.maxErrorRate <= 1) || thresholds.maxP95Ms <= 0) {
    throw new Error("Performance thresholds must be bounded.");
  }
  const failures = [
    ...(summary.errorRate > thresholds.maxErrorRate ? ["ERROR_RATE"] : []),
    ...(summary.p95Ms > thresholds.maxP95Ms ? ["P95_LATENCY"] : []),
  ];
  return { failures, status: failures.length ? "FAIL" as const : "PASS" as const, thresholds };
}

export function performanceProfileViolations(profiles: readonly PerformanceProfile[] = performanceProfileRegistry) {
  const ids = new Set<string>();
  const violations: string[] = [];
  for (const profile of profiles) {
    if (ids.has(profile.profileId)) violations.push(`duplicate:${profile.profileId}`);
    ids.add(profile.profileId);
    if (!Number.isInteger(profile.concurrency) || profile.concurrency <= 0) violations.push(`invalid-concurrency:${profile.profileId}`);
    if (profile.evidenceState === "HARNESS_READY" && (profile.method !== "GET" || !profile.target.startsWith("/api/v1/"))) {
      violations.push(`unsafe-local-harness:${profile.profileId}`);
    }
  }
  return violations;
}
