import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequestIdentity, bindAuthenticatedRequestIdentity } from "../../platform-contracts/requestIdentity";
import {
  createHttpMetricObservations,
  createTelemetryLogRecord,
  emitTelemetryLog,
  redactTelemetryAttributes,
  telemetryAttributeLaw,
  telemetryMetricRegistry,
} from "../telemetry";

function identity() {
  return bindAuthenticatedRequestIdentity(createRequestIdentity(new Headers({
    "x-correlation-id": "corr_observability_1",
    "x-request-id": "req_observability_1",
  }), {
    now: "2026-08-29T12:00:00.000Z",
    randomBytes: (size) => Buffer.alloc(size, 7),
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
  }), { actorId: "operator-secret", actorType: "user", tenantId: "tenant-secret" }, {
    authorityClass: "A0",
    capability: "platform.observe",
    purpose: "verify-telemetry-contract",
  });
}

test("structured logs preserve trace lineage while omitting tenant and actor", () => {
  const record = createTelemetryLogRecord({
    attributes: { "http.route": "/api/v1/healthz", status: 200 },
    body: "Request completed.",
    eventName: "http.server.request.completed",
    identity: identity(),
    now: "2026-08-29T12:00:01.000Z",
    severity: "INFO",
  });
  assert.equal(record.trace_id, "07070707070707070707070707070707");
  assert.equal(record.correlation_id, "corr_observability_1");
  assert.equal(record.tenant_ref, null);
  assert.doesNotMatch(JSON.stringify(record), /operator-secret|tenant-secret/);
});

test("telemetry redaction removes secrets and unbounded content recursively", () => {
  const redacted = redactTelemetryAttributes({
    authorization: "Bearer top-secret",
    nested: { password: "secret", payload: { customer: "private" }, safe: "ok" },
    safe: "a".repeat(500),
  });
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /top-secret|private|"secret"/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.ok(serialized.length < 1_000);
});

test("HTTP metric observations use only stable low-cardinality dimensions", () => {
  const observations = createHttpMetricObservations({ durationMs: 12.3, method: "GET", route: "/api/v1/healthz", status: 503 });
  assert.deepEqual(observations.map((item) => item.name), [
    "luzione.api.server.request.count",
    "luzione.api.server.request.duration",
    "luzione.api.server.error.count",
  ]);
  assert.ok(observations.every((item) => !Object.keys(item.attributes).some((key) => telemetryAttributeLaw.forbiddenMetricDimensions.includes(key as never))));
  assert.ok(telemetryMetricRegistry.some((item) => item.name === "luzione.platform.reconciliation.count"));
  assert.throws(() => createHttpMetricObservations({ durationMs: -1, method: "GET", route: "/", status: 200 }), /non-negative/);
});

test("emission supports a test sink and known-bad event names fail closed", () => {
  const records: Record<string, unknown>[] = [];
  emitTelemetryLog({
    body: "RLS readback failed safely.",
    eventName: "database.rls.readback.failed",
    identity: identity(),
    severity: "ERROR",
    sink: (record) => records.push(record),
  });
  assert.equal(records.length, 1);
  assert.throws(() => createTelemetryLogRecord({ body: "bad", eventName: "Bad Event", severity: "INFO" }), /dot notation/);
});

test("public catalog publishes telemetry semantics additively", () => {
  const route = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(route, /observability:/);
  assert.match(route, /telemetryAttributeLaw/);
  assert.match(route, /telemetryMetricRegistry/);
});
