import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveReadinessEvidenceSummary,
  readinessEvidenceViolations,
  type ReadinessEvidence,
} from "../evidence";

const observedAt = "2026-08-30T00:00:00.000Z";
const now = "2026-08-30T00:00:30.000Z";

function fixture(overrides: Partial<ReadinessEvidence> = {}): ReadinessEvidence {
  return {
    actual: "PASS",
    environment: "local",
    evidenceId: "local-readback",
    evidenceTier: "LOCAL_PROVEN",
    exactSha: null,
    impact: "BLOCKING",
    observedAt,
    owner: "Luzione API platform owner",
    scope: "service.dependency-readiness",
    source: "GET /api/v1/readyz",
    sourceKind: "CANONICAL_READBACK",
    status: "PASS",
    threshold: "database query and required configuration pass",
    validForMs: 60_000,
    ...overrides,
  };
}

test("fresh bounded observations derive readiness without claiming production", () => {
  const summary = deriveReadinessEvidenceSummary([fixture()], now);
  assert.equal(summary.overallStatus, "READY");
  assert.equal(summary.productionReleaseReady, false);
  assert.equal(summary.weakestBlockingEvidenceTier, "LOCAL_PROVEN");
  assert.equal(summary.observations[0].freshness, "FRESH");
});

test("stale, missing and failed blocking evidence fail closed", () => {
  assert.equal(deriveReadinessEvidenceSummary([fixture({ observedAt: null })], now).overallStatus, "NOT_READY");
  assert.equal(deriveReadinessEvidenceSummary([fixture({ observedAt: "2026-08-29T23:00:00.000Z" })], now).observations[0].freshness, "STALE");
  assert.equal(deriveReadinessEvidenceSummary([fixture({ status: "FAIL" })], now).overallStatus, "NOT_READY");
});

test("production claims require an exact SHA and production environment", () => {
  assert.ok(readinessEvidenceViolations([fixture({ evidenceTier: "PRODUCTION_OBSERVED" })]).some((item) => item.startsWith("unbound-release:")));
  assert.ok(readinessEvidenceViolations([fixture({ evidenceTier: "PRODUCTION_OBSERVED", exactSha: "a".repeat(40) })]).some((item) => item.startsWith("production-environment-mismatch:")));
  const production = fixture({ environment: "production", evidenceTier: "PRODUCTION_OBSERVED", exactSha: "a".repeat(40) });
  assert.equal(deriveReadinessEvidenceSummary([production], now).productionReleaseReady, true);
});

test("configuration cannot be promoted into observed proof", () => {
  const promoted = fixture({ evidenceTier: "LOCAL_PROVEN", sourceKind: "CONFIGURATION" });
  assert.ok(readinessEvidenceViolations([promoted]).some((item) => item.startsWith("configuration-promoted:")));
  const health = readFileSync("src/app/api/v1/healthz/route.ts", "utf8");
  assert.match(health, /readinessEvidence/);
  assert.match(health, /deriveReadinessEvidenceSummary/);
  const catalog = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(catalog, /readinessEvidence:/);
});
