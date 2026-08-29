import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  assertDurableReferences,
  autonomyRecordDigest,
  boundedLedgerLimit,
} from "../ledger";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260829033000_autonomy_constitutional_ledger.sql"),
  "utf8",
);
const store = fs.readFileSync(
  path.join(process.cwd(), "src/lib/autonomy/constitutionalLedgerStore.ts"),
  "utf8",
);
const petitionRoute = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/v1/autonomy/petitions/route.ts"),
  "utf8",
);
const identityRoute = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/v1/autonomy/identity/candidates/route.ts"),
  "utf8",
);

test("constitutional record digests are canonical and content-sensitive", () => {
  assert.equal(
    autonomyRecordDigest({ petition: { a: 1, b: 2 }, refs: ["run:a", "run:b"] }),
    autonomyRecordDigest({ refs: ["run:a", "run:b"], petition: { b: 2, a: 1 } }),
  );
  assert.notEqual(
    autonomyRecordDigest({ petition: { a: 1 } }),
    autonomyRecordDigest({ petition: { a: 2 } }),
  );
});

test("durable evidence accepts opaque references and rejects copied content or signed URLs", () => {
  assert.deepEqual(assertDurableReferences(["run:one", "evidence/two"], "refs"), ["run:one", "evidence/two"]);
  assert.throws(() => assertDurableReferences(["run:one", "run:one"], "refs"), /must not contain duplicates/);
  assert.throws(() => assertDurableReferences(["copied chat transcript"], "refs"), /stable opaque references/);
  assert.throws(() => assertDurableReferences(["https://example.com/file?token=secret"], "refs"), /stable opaque references/);
});

test("ledger reads are bounded", () => {
  assert.equal(boundedLedgerLimit(null), 50);
  assert.equal(boundedLedgerLimit("100"), 100);
  for (const invalid of ["0", "101", "-1", "1.5", "all"]) {
    assert.throws(() => boundedLedgerLimit(invalid), /1 to 100/);
  }
});

test("all constitutional tables are append-only, FORCE RLS, and service-only", () => {
  const tables = [
    "autonomy_constitutional_petitions",
    "autonomy_identity_candidates",
    "autonomy_constitutional_petition_events",
    "autonomy_identity_candidate_events",
  ];
  for (const table of tables) {
    assert.match(migration, new RegExp(`before update or delete on public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table}[\\s\\S]{0,80}from public, anon, authenticated, service_role`));
    assert.match(migration, new RegExp(`grant select, insert on table public\\.${table} to service_role`));
    assert.doesNotMatch(migration, new RegExp(`grant [^;]*update[^;]*public\\.${table}`));
    assert.doesNotMatch(migration, new RegExp(`grant [^;]*delete[^;]*public\\.${table}`));
  }
  assert.match(migration, /enacted boolean not null default false check \(not enacted\)/);
  assert.match(migration, /promoted_to_identity boolean not null default false check \(not promoted_to_identity\)/);
  assert.match(migration, /legal_personhood_claimed boolean not null default false check \(not legal_personhood_claimed\)/);
});

test("Sultan receives only exact read and append capabilities for protected records", () => {
  for (const capability of [
    "constitution.petitions.read",
    "constitution.petitions.record",
    "identity.candidates.read",
    "identity.candidates.record",
  ]) {
    assert.match(migration, new RegExp(capability.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(migration, /constitution\.modify|identity\.promote|guardian\.vote|rights\.waive/);
});

test("recording routes derive tenant and actor, remain gated, and authorize no effects", () => {
  assert.match(petitionRoute, /requireCanonicalActor\(request\.headers\)/);
  assert.match(petitionRoute, /"constitution\.petitions\.record"/);
  assert.match(identityRoute, /requireCanonicalActor\(request\.headers\)/);
  assert.match(identityRoute, /"identity\.candidates\.record"/);
  for (const route of [petitionRoute, identityRoute]) {
    assert.match(route, /controlPlaneMutationsEnabled/);
    assert.match(route, /externalEffectsAuthorized: false/);
    assert.doesNotMatch(route, /tenantId.*searchParams|tenantId.*body/);
  }
  assert.match(store, /where tenant_id = \$1 and petition_id = \$2/);
  assert.match(store, /where tenant_id = \$1 and statement_id = \$2/);
  assert.match(store, /PETITION_IDEMPOTENCY_COLLISION/);
  assert.match(store, /IDENTITY_IDEMPOTENCY_COLLISION/);
  assert.doesNotMatch(store, /update public\.autonomy_|delete from public\.autonomy_/);
});
