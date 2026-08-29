import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CIRCUIT_HALF_OPEN_MS,
  EXECUTION_HEARTBEAT_MS,
  EXECUTION_LEASE_MS,
  EXECUTION_RETRY_DELAYS_MS,
  type CircuitSnapshot,
  circuitAdmission,
  classifyProviderHttpFailure,
  durableRetryDecision,
  recordTransientCircuitFailure,
} from "../durableExecution";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260829041000_durable_execution_runtime.sql"),
  "utf8",
);
const executionStore = fs.readFileSync(
  path.join(process.cwd(), "src/lib/control-plane/executionStore.ts"),
  "utf8",
);
const now = "2026-08-28T12:00:00.000Z";

test("durable execution uses the required lease, heartbeat and retry schedule", () => {
  assert.equal(EXECUTION_LEASE_MS, 60_000);
  assert.equal(EXECUTION_HEARTBEAT_MS, 20_000);
  assert.deepEqual(EXECUTION_RETRY_DELAYS_MS, [2_000, 10_000, 30_000, 120_000, 600_000]);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const decision = durableRetryDecision({
      attempt,
      failureClass: "TRANSIENT_BEFORE_ACK",
      idempotencyKey: "tenant:capability:key",
      now,
    });
    assert.equal(decision.action, "RETRY");
    const base = EXECUTION_RETRY_DELAYS_MS[attempt - 1];
    assert.ok(decision.delayMs >= base * 0.8 && decision.delayMs <= base * 1.2);
  }
  assert.equal(durableRetryDecision({ attempt: 6, failureClass: "TRANSIENT_BEFORE_ACK", idempotencyKey: "key", now }).action, "DEAD_LETTER");
  assert.equal(durableRetryDecision({ attempt: 1, failureClass: "AMBIGUOUS_AFTER_ACK", idempotencyKey: "key", now }).action, "RECONCILE");
});

test("non-transient 4xx failures never retry", () => {
  assert.equal(classifyProviderHttpFailure(400), "PERMANENT");
  assert.equal(classifyProviderHttpFailure(403), "PERMANENT");
  assert.equal(classifyProviderHttpFailure(422), "PERMANENT");
  assert.equal(classifyProviderHttpFailure(429), "RATE_LIMITED");
  assert.equal(classifyProviderHttpFailure(503), "TRANSIENT_BEFORE_ACK");
});

test("circuit opens after five failures in sixty seconds and half-opens after five minutes", () => {
  let circuit: CircuitSnapshot = {
    failureWindowStartedAt: null,
    halfOpenAt: null,
    state: "CLOSED" as const,
    transientFailureCount: 0,
  };
  for (let second = 0; second < 5; second += 1) {
    circuit = recordTransientCircuitFailure(circuit, new Date(new Date(now).getTime() + second * 1_000).toISOString());
  }
  assert.equal(circuit.state, "OPEN");
  assert.equal(circuit.transientFailureCount, 5);
  assert.equal(new Date(circuit.halfOpenAt ?? 0).getTime(), new Date(now).getTime() + 4_000 + CIRCUIT_HALF_OPEN_MS);
  assert.equal(circuitAdmission(circuit, new Date(new Date(now).getTime() + 60_000).toISOString()).allowed, false);
  assert.equal(circuitAdmission(circuit, circuit.halfOpenAt ?? now).nextState, "HALF_OPEN");
});

test("migration makes request and readback separate resumable steps with explicit RLS", () => {
  assert.match(migration, /'PROVIDER_REQUEST','PROVIDER_READBACK','COMPENSATION','RECONCILIATION'/);
  assert.match(migration, /unique \(tenant_id, capability, idempotency_key\)/);
  assert.match(migration, /lease_expires_at timestamptz/);
  assert.match(migration, /retry_policy set default[\s\S]*2000,10000,30000,120000,600000/);
  for (const table of ["platform_execution_steps", "integration_circuit_breakers", "platform_audit_events", "platform_effect_receipts"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role`));
  }
  assert.match(migration, /before update or delete on public\.platform_effect_receipts/);
  assert.match(migration, /before update or delete on public\.platform_audit_events/);
  assert.match(migration, /not luzione_api_private\.jsonb_contains_secret_key\(provider_readback\)/);
});

test("worker store claims with SKIP LOCKED and enforces lease ownership at every checkpoint", () => {
  assert.match(executionStore, /for update skip locked/);
  assert.match(executionStore, /lease_expires_at = now\(\) \+ interval '60 seconds'/);
  assert.match(executionStore, /request_deadline_at = now\(\) \+ interval '45 seconds'/);
  assert.match(executionStore, /lease_expires_at > now\(\) and request_deadline_at > now\(\)/);
  assert.match(executionStore, /step_kind !== "PROVIDER_REQUEST"/);
  assert.match(executionStore, /step_kind !== "PROVIDER_READBACK"/);
  assert.match(executionStore, /insert into public\.platform_effect_receipts/);
  assert.match(executionStore, /insert into public\.p110_dead_letters/);
});
