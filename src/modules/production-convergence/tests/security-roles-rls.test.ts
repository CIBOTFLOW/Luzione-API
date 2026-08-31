import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql", "utf8");
const ownership = JSON.parse(readFileSync("architecture/production-convergence/API_PC_013_OWNERSHIP_MANIFEST.json", "utf8")) as {
  deployment_boundary: { migration_applied: boolean; production_cutover_authorized: boolean };
  policy_contract: { direct_tenant_tables: number; forced_rls: boolean; permissive_public_policies_allowed: boolean };
  roles: Array<{ bypass_rls: boolean; login: boolean; relation_owner: boolean; role: string }>;
};
const postureSource = readFileSync("src/modules/security-posture/rlsPosture.ts", "utf8");
const readServiceSource = readFileSync("src/lib/security-posture/readService.ts", "utf8");

test("API-PC-013 roles are non-login, non-owner and cannot bypass RLS", () => {
  assert.deepEqual(ownership.roles.map((role) => role.role), ["luzione_api_runtime", "luzione_provider_worker"]);
  assert.ok(ownership.roles.every((role) => !role.login && !role.bypass_rls && !role.relation_owner));
  assert.match(migration, /create role luzione_api_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls/);
  assert.match(migration, /create role luzione_provider_worker nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls/);
  assert.doesNotMatch(migration, /alter table [^;]+ owner to luzione_(?:api_runtime|provider_worker)/i);
});

test("all admitted relations force tenant RLS with no public or legacy service grants", () => {
  assert.equal(ownership.policy_contract.forced_rls, true);
  assert.equal(ownership.policy_contract.direct_tenant_tables, 29);
  assert.equal(ownership.policy_contract.permissive_public_policies_allowed, false);
  assert.match(migration, /alter table public\.%I force row level security/);
  assert.match(migration, /alter table public\.quote_lines force row level security/);
  assert.match(migration, /to luzione_api_runtime using \(tenant_id::text/);
  assert.match(migration, /create policy api_pc013_worker_tenant/);
  assert.match(migration, /revoke all on table public\.%I from service_role/);
  assert.match(migration, /revoke all on table public\.quote_lines from service_role/);
  assert.doesNotMatch(migration, /grant [^;]* to (?:anon|authenticated|service_role)/i);
  assert.doesNotMatch(migration, /\bdelete from\b|\btruncate\b/i);
});

test("worker grants stay inside delivery and reconciliation while runtime has no destructive privilege", () => {
  assert.match(migration, /grant select on table[\s\S]*public\.p110_reconciliation_checkpoints[\s\S]*to luzione_provider_worker/);
  assert.match(migration, /grant update on table[\s\S]*public\.p110_reconciliation_checkpoints[\s\S]*to luzione_provider_worker/);
  assert.match(migration, /grant insert on table[\s\S]*public\.p110_dead_letters[\s\S]*to luzione_provider_worker/);
  assert.doesNotMatch(migration, /grant delete|grant truncate|grant references|grant trigger/i);
  assert.doesNotMatch(migration, /grant [^;]*public\.orders[^;]*to luzione_provider_worker/i);
});

test("catalog readiness fails closed on forced-RLS and role drift", () => {
  assert.match(postureSource, /RLS_NOT_FORCED/);
  assert.match(postureSource, /LEGACY_SERVICE_ROLE_PRIVILEGE_PRESENT/);
  assert.match(postureSource, /WORKER_SCOPE_DRIFT/);
  assert.match(readServiceSource, /c\.relforcerowsecurity as rls_forced/);
  assert.match(readServiceSource, /luzione_api_runtime/);
  assert.match(readServiceSource, /luzione_provider_worker/);
  assert.equal(ownership.deployment_boundary.migration_applied, false);
  assert.equal(ownership.deployment_boundary.production_cutover_authorized, false);
});
