import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decideRetry } from "@/modules/platform-guarantees/retryPolicy";
import { nextWorkflowState } from "@/modules/platform-guarantees/stateMachine";

const migration = readFileSync(
  "supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql",
  "utf8",
);
const store = readFileSync(
  "src/lib/platform-guarantees/postgresWorkflowDeliveryStore.ts",
  "utf8",
);

test("workflow-delivery migration converges the observed P110/P111 substrate additively", () => {
  for (const table of [
    "p110_kill_switches",
    "p110_inbox_messages",
    "p110_delivery_attempts",
    "p110_dead_letters",
    "p110_reconciliation_checkpoints",
    "p111_workflow_instances",
    "p111_workflow_checkpoints",
    "p111_step_attempts",
    "p111_workflow_timers",
    "p111_human_task_refs",
    "p111_compensation_intents",
    "p111_recovery_receipts",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /add column if not exists lease_expires_at/);
  assert.match(migration, /state <> 'CLAIMED'[\s\S]*lease_expires_at > locked_at/);
  assert.match(migration, /alter table public\.%I force row level security/);
  assert.match(migration, /tenant_id = \(select current_setting\(''app\.tenant_id'', true\)\)/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from/);
});

test("worker store reclaims expired leases and claims competing work with SKIP LOCKED", () => {
  assert.match(store, /state = 'CLAIMED'[\s\S]*lease_expires_at <= now\(\)/);
  assert.match(store, /for update of outbox skip locked/);
  assert.match(store, /attempt_count = outbox\.attempt_count \+ 1/);
  assert.match(store, /lease_expires_at = now\(\) \+ interval '60 seconds'/);
  assert.match(store, /request_deadline_at = now\(\) \+ interval '45 seconds'/);
  assert.match(store, /p110_kill_switches/);
  assert.match(store, /LEASE_NOT_OWNED/);
  assert.match(store, /update public\.p110_inbox_messages[\s\S]*state = 'RECEIVED'/);
  assert.match(store, /update public\.p111_workflow_timers[\s\S]*state = 'SCHEDULED'/);
});

test("delivery outcomes separate acknowledgement, reconciliation, readback and dead letters", () => {
  assert.match(store, /state = 'PROVIDER_ACKNOWLEDGED'/);
  assert.match(store, /decision\.action === "RECONCILE"/);
  assert.match(store, /insert into public\.p110_reconciliation_checkpoints/);
  assert.match(store, /insert into public\.p110_dead_letters/);
  assert.match(store, /READBACK_REF_REQUIRED/);
  assert.match(store, /state = 'SOURCE_CONFIRMED'/);
  assert.match(store, /INBOX_PAYLOAD_CONFLICT/);
  assert.match(store, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(store, /where tenant_id = \$1 and producer = \$2 and producer_message_id = \$3 for update/);
});

test("retry and workflow decisions fail closed before persistence", () => {
  const ambiguous = decideRetry({
    attempt: 1,
    failureClass: "AMBIGUOUS_AFTER_ACK",
    idempotencyKey: "delivery-1",
    killSwitchActive: false,
    now: "2026-08-31T03:00:00.000Z",
  });
  assert.equal(ambiguous.action, "RECONCILE");
  assert.equal(decideRetry({
    attempt: 5,
    failureClass: "TRANSIENT_BEFORE_ACK",
    idempotencyKey: "delivery-1",
    killSwitchActive: false,
    now: "2026-08-31T03:00:00.000Z",
  }).action, "DEAD_LETTER");
  assert.equal(nextWorkflowState({
    commandType: "START_FLOW",
    currentState: "PLANNED",
    killSwitchActive: false,
  }), "RUNNING");
  assert.throws(() => nextWorkflowState({
    commandType: "START_FLOW",
    currentState: "PLANNED",
    killSwitchActive: true,
  }), /Kill switch blocks/);
});
