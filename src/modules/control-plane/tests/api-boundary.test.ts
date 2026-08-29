import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const store = fs.readFileSync(path.join(process.cwd(), "src/lib/control-plane/store.ts"), "utf8");
const commandRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/v1/commands/route.ts"), "utf8");
const actor = fs.readFileSync(path.join(process.cwd(), "src/lib/control-plane/actor.ts"), "utf8");
const connectionsRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/v1/connections/route.ts"), "utf8");
const connectionRoute = fs.readFileSync(path.join(process.cwd(), "src/app/api/v1/connections/[connectionId]/route.ts"), "utf8");
const providerActions = fs.readFileSync(path.join(process.cwd(), "src/lib/control-plane/providerActions.ts"), "utf8");

test("command admission rechecks global and scoped kill switches at time of use", () => {
  assert.match(store, /scope_type = 'GLOBAL'/);
  for (const scope of ["PROVIDER", "CAPABILITY", "CONNECTION", "MODEL"]) {
    assert.match(store, new RegExp(`scope_type = '${scope}'`));
  }
  assert.match(store, /CONNECTION_NOT_EXECUTABLE/);
});

test("tenant hard budgets are checked against estimated plus recorded actual spend", () => {
  assert.match(store, /coalesce\(usage\.actual_cost, usage\.estimated_cost\)/);
  assert.match(store, /total\.spent \+ \$8::numeric > policy\.hard_limit/);
  assert.match(store, /BUDGET_EXHAUSTED/);
});

test("the command endpoint admits receipts but never dispatches provider effects", () => {
  assert.match(commandRoute, /externalEffectsAuthorized: false/);
  assert.match(store, /externalEffectDispatched: false/);
  assert.doesNotMatch(store, /providerAdapters\.require/);
});

test("connection mutations require canonical tenant-administrator authority", () => {
  assert.match(actor, /TENANT_ADMIN_REQUIRED/);
  assert.match(actor, /connections\.manage/);
  assert.match(connectionsRoute, /requireConnectionAdministrator/);
  assert.match(connectionRoute, /requireConnectionAdministrator/);
  assert.match(providerActions, /requireConnectionAdministrator/);
});
