import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260831022000_p110_command_ledger_baseline.sql",
  "utf8",
);
const store = readFileSync(
  "src/lib/platform-guarantees/postgresCommandStore.ts",
  "utf8",
);

test("command-ledger migration supports fresh and legacy-upgrade paths", () => {
  for (const table of [
    "p110_command_receipts",
    "p110_event_envelopes",
    "p110_idempotency_conflicts",
    "p110_outbox_messages",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(migration, new RegExp(`create policy ${table}_tenant_policy`));
  }
  assert.match(migration, /add column if not exists resolved_at/);
  assert.match(migration, /add column if not exists resolution_ref/);
  assert.match(migration, /foreign key \(tenant_id, receipt_id\)/);
  assert.match(migration, /foreign key \(tenant_id, event_id\)/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from/);
});

test("browser roles receive no ledger grant and tenant policies use initplan-safe context", () => {
  assert.match(migration, /revoke all on table public\.p110_command_receipts from public/);
  assert.match(migration, /from anon/);
  assert.match(migration, /from authenticated/);
  assert.match(migration, /tenant_id = \(select current_setting\('app\.tenant_id', true\)\)/);
  assert.doesNotMatch(migration, /grant [^;]+ to anon|grant [^;]+ to authenticated/);
});

test("Postgres store preserves atomic order, tenant binding, replay and conflict evidence", () => {
  assert.match(store, /select set_config\('app\.tenant_id', \$1, true\)/);
  const receipt = store.indexOf("insert into public.p110_command_receipts");
  const event = store.indexOf("insert into public.p110_event_envelopes");
  const outbox = store.indexOf("insert into public.p110_outbox_messages");
  assert.ok(receipt >= 0 && event > receipt && outbox > event);
  assert.match(store, /pg_advisory_xact_lock\(hashtextextended/);
  assert.match(store, /where tenant_id = \$1 and idempotency_key = \$2[\s\S]*for update/);
  assert.match(store, /insert into public\.p110_idempotency_conflicts/);
  assert.match(store, /await client\.query\("rollback"\)/);
  assert.match(store, /'NO_EFFECT'/);
});
