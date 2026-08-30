import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluatePerformanceThresholds,
  performanceProfileRegistry,
  performanceProfileViolations,
  summarizePerformanceSamples,
} from "../program";

test("performance registry covers required campaigns without inventing unavailable harnesses", () => {
  assert.deepEqual(performanceProfileViolations(), []);
  assert.deepEqual(
    new Set(performanceProfileRegistry.map((item) => item.campaign)),
    new Set(["BASELINE", "BURST", "SUSTAINED_LOAD", "PROVIDER_SLOWDOWN", "DATABASE_POOL_PRESSURE", "MUTATION_IDEMPOTENCY", "QUEUE_BACKLOG", "RECOVERY"]),
  );
  assert.ok(performanceProfileRegistry.filter((item) => item.evidenceState === "HARNESS_READY").every((item) => item.method === "GET"));
});

test("percentiles, throughput and errors are deterministic", () => {
  const summary = summarizePerformanceSamples({
    concurrency: 2,
    elapsedMs: 1_000,
    samples: [10, 20, 30, 40, 500].map((durationMs, index) => ({ durationMs, status: index === 4 ? 503 : 200 })),
  });
  assert.equal(summary.p50Ms, 30);
  assert.equal(summary.p95Ms, 500);
  assert.equal(summary.throughputPerSecond, 5);
  assert.equal(summary.errorRate, 0.2);
  assert.equal(evaluatePerformanceThresholds(summary, { maxErrorRate: 0, maxP95Ms: 100 }).status, "FAIL");
});

test("known-bad profiles and samples fail closed", () => {
  assert.throws(() => summarizePerformanceSamples({ concurrency: 0, elapsedMs: 1, samples: [{ durationMs: 1, status: 200 }] }), /concurrency/);
  const unsafe = [{ ...performanceProfileRegistry[0], method: "POST" as const }];
  assert.ok(performanceProfileViolations(unsafe).some((item) => item.startsWith("unsafe-local-harness:")));
});

test("localhost harness is bounded and cannot target remote systems", () => {
  const scriptPath = "scripts/run-http-performance-profile.ts";
  assert.ok(existsSync(scriptPath));
  const script = readFileSync(scriptPath, "utf8");
  assert.match(script, /localhost|127\.0\.0\.1/);
  assert.match(script, /Remote performance targets are prohibited/);
  assert.match(script, /evaluation\.status === "FAIL"/);
  assert.doesNotMatch(script, /method:\s*["']POST/);
  const catalog = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(catalog, /performanceProgram:/);
});
