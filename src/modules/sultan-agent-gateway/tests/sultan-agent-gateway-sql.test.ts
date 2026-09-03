import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();

test("pilot separates command preparation from A1 execution and leaves RFQ dispatch unreachable", () => {
  const store = readFileSync(`${root}/src/modules/sultan-agent-gateway/postgresStore.ts`, "utf8");
  const service = readFileSync(`${root}/src/modules/sultan-agent-gateway/service.ts`, "utf8");
  const envelopeMigration = readFileSync(`${root}/supabase/migrations/20260901123000_sultan_agent_policy_envelopes.sql`, "utf8");
  const actionMigration = readFileSync(`${root}/supabase/migrations/20260901130000_sultan_agent_internal_actions.sql`, "utf8");
  assert.match(store, /sultan_agent_command_reservations/);
  assert.match(store, /sultan_agent_internal_actions/);
  assert.match(store, /pg_advisory_xact_lock/);
  assert.match(store, /reservation\.effect_class !== "A1"/);
  assert.match(service, /A2_EXECUTION_DISABLED/);
  assert.match(actionMigration, /external_effect_authorized boolean not null default false/);
  assert.match(actionMigration, /provider_dispatch_authorized boolean not null default false/);
  assert.match(actionMigration, /check \(external_effect_authorized = false and provider_dispatch_authorized = false\)/);
  assert.match(envelopeMigration, /expires_at <= activated_at \+ interval '24 hours'/);
  assert.doesNotMatch(envelopeMigration, /insert into public\.sultan_agent_policy_envelopes/i);
  assert.doesNotMatch(store, /GmailRfqCanaryAdapter|messages\/send|maxAttempts: 1/);
});
