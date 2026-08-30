import {
  evaluatePerformanceThresholds,
  performanceProfileRegistry,
  summarizePerformanceSamples,
  type PerformanceSample,
} from "../src/modules/platform-performance/program";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const profileId = argument("profile") ?? "local-livez-baseline";
  const origin = argument("origin") ?? "http://127.0.0.1:3107";
  const profile = performanceProfileRegistry.find((item) => item.profileId === profileId);
  if (!profile || profile.evidenceState !== "HARNESS_READY" || !profile.requests) {
    throw new Error(`Profile ${profileId} is not available to the local HTTP harness.`);
  }
  const runnableProfile = profile;
  const target = new URL(runnableProfile.target, origin);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname)) {
    throw new Error("Remote performance targets are prohibited; use an isolated localhost runtime.");
  }

  const samples: PerformanceSample[] = [];
  const startedAt = performance.now();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < runnableProfile.requests!) {
      nextIndex += 1;
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(target, { method: "GET", redirect: "error" });
        await response.arrayBuffer();
        samples.push({ durationMs: performance.now() - requestStartedAt, status: response.status });
      } catch {
        samples.push({ durationMs: performance.now() - requestStartedAt, status: 599 });
      }
    }
  }

  await Promise.all(Array.from({ length: runnableProfile.concurrency }, () => worker()));
  const completedAt = new Date().toISOString();
  const summary = summarizePerformanceSamples({
    concurrency: runnableProfile.concurrency,
    elapsedMs: performance.now() - startedAt,
    samples,
  });
  const evaluation = evaluatePerformanceThresholds(summary);
  console.log(JSON.stringify({
    contractVersion: "luzione-performance-evidence/v1",
    environment: "local",
    exactSha: process.env.PERFORMANCE_EXACT_SHA ?? null,
    measuredAt: completedAt,
    profile: runnableProfile,
    target: { origin: target.origin, path: target.pathname },
    summary,
    evaluation,
    strongestClaim: "LOCAL_MEASUREMENT_ONLY",
  }, null, 2));
  if (evaluation.status === "FAIL") process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Performance harness failed.");
  process.exitCode = 1;
});
