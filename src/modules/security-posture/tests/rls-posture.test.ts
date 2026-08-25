import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SENSITIVE_SERVER_ONLY_TABLES,
  evaluateRlsPosture,
  probeDeniedRead,
  type RlsPostureRow,
} from "../rlsPosture";

function protectedRows(): RlsPostureRow[] {
  return SENSITIVE_SERVER_ONLY_TABLES.map((table_name) => ({
    table_name,
    rls_enabled: true,
    anon_access: false,
    authenticated_access: false,
    service_role_select: true,
    policy_count: 0,
  }));
}

test("P175 security posture passes only for the complete denied client surface", () => {
  const result = evaluateRlsPosture({ clientDefaultPrivileges: false, rows: protectedRows() });
  assert.equal(result.status, "PASS");
  assert.equal(result.expectedTableCount, 10);
  assert.deepEqual(result.violations, []);
});

test("known-bad grants, disabled RLS and unsafe future defaults fail closed", () => {
  const rows = protectedRows();
  rows.find((row) => row.table_name === "secret_registry")!.anon_access = true;
  rows.find((row) => row.table_name === "auth_users")!.rls_enabled = false;
  const result = evaluateRlsPosture({ clientDefaultPrivileges: true, rows });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.violations, [
    { code: "RLS_DISABLED", table: "auth_users" },
    { code: "ANON_PRIVILEGE_PRESENT", table: "secret_registry" },
    { code: "CLIENT_DEFAULT_PRIVILEGE_PRESENT", table: "<future tables>" },
  ]);
});

test("an expected relation missing from catalog readback fails closed", () => {
  const result = evaluateRlsPosture({ clientDefaultPrivileges: false, rows: protectedRows().slice(1) });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.violations, [{ code: "TABLE_MISSING", table: "auth_users" }]);
});

test("active probe accepts only PostgreSQL permission_denied", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.startsWith("select 1")) {
        const error = Object.assign(new Error("permission denied"), { code: "42501" });
        throw error;
      }
      return { rows: [] };
    },
  };
  const result = await probeDeniedRead(client as never, { role: "anon", table: "secret_registry" });
  assert.equal(result.denied, true);
  assert.deepEqual(queries, [
    "begin read only",
    'set local role "anon"',
    'select 1 from public."secret_registry" limit 1',
    "rollback",
  ]);
});

test("API boundary authenticates full readback and public health exposes no secrets", () => {
  const route = readFileSync("src/app/api/v1/security/rls-readiness/route.ts", "utf8");
  const health = readFileSync("src/app/api/v1/healthz/route.ts", "utf8");
  assert.match(route, /requireServiceActor\(request\.headers\)/);
  assert.match(route, /readRlsReadiness/);
  assert.match(route, /status: result\.status === "PASS" \? 200 : 503/);
  assert.match(health, /CONNECTED_RLS_GATE_PASS/);
  assert.match(health, /SECURITY_POSTURE_REQUIRED/);
  assert.doesNotMatch(health, /DATABASE_URL|LUZIONE_API_SERVICE_TOKEN|PLATFORM_CONTINUATION_SECRET/);
});
