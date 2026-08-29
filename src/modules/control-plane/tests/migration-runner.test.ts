import assert from "node:assert/strict";
import test from "node:test";

import {
  checksum,
  discoverMigrations,
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
