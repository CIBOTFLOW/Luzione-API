import assert from "node:assert/strict";
import test from "node:test";

import {
  checksum,
  discoverMigrations,
  ensureLedger,
  stripOuterTransaction,
} from "../../../../scripts/run-platform-migrations.mjs";

test("API migration discovery is exact, timestamp ordered and duplicate free", () => {
  const migrations = discoverMigrations();
  assert.ok(migrations.length > 0);
  assert.deepEqual(migrations.map((item) => item.dependencyOrder), migrations.map((_, index) => index));
  assert.deepEqual(migrations.map((item) => item.id), [...migrations.map((item) => item.id)].sort());
  assert.equal(new Set(migrations.map((item) => item.id)).size, migrations.length);
  assert.equal(new Set(migrations.map((item) => item.path)).size, migrations.length);
});

test("runner strips one outer transaction and rejects incomplete or nested control", () => {
  assert.match(stripOuterTransaction("begin;\nselect 1;\ncommit;\n"), /select 1/);
  assert.throws(() => stripOuterTransaction("begin;\nselect 1;"), /incomplete/);
  assert.throws(() => stripOuterTransaction("begin;\nbegin;\ncommit;\ncommit;"), /nested/);
});

test("checksums are content-sensitive", () => {
  assert.match(checksum("select 1;"), /^[a-f0-9]{64}$/);
  assert.notEqual(checksum("select 1;"), checksum("select 2;"));
});

test("the API migration ledger is schema-qualified, RLS-enabled and client denied", async () => {
  const statements: string[] = [];
  await ensureLedger({
    async query(statement: string) {
      statements.push(statement);
      return { rows: [] };
    },
  });
  const statement = statements.join("\n");
  assert.match(statement, /public\.platform_schema_migrations/);
  assert.match(statement, /enable row level security/i);
  assert.match(statement, /revoke all[^;]+public, anon, authenticated, service_role/i);
});
