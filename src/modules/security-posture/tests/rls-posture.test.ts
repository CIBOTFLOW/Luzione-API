import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  type GlobalClientExposureRow,
  SENSITIVE_SERVER_ONLY_TABLES,
  evaluateRlsPosture,
  probeDeniedRead,
  type RlsPostureRow,
} from "../rlsPosture";
import {
  RLS_READBACK_FAILURE_CODES,
  classifyRlsReadbackError,
} from "../readbackFailure";

const protectedGlobalExposure: GlobalClientExposureRow = {
  public_table_count: 10,
  rls_disabled_client_accessible_count: 0,
  rls_disabled_client_writable_count: 0,
  rls_disabled_table_count: 0,
};

function protectedRows(): RlsPostureRow[] {
  return SENSITIVE_SERVER_ONLY_TABLES.map((table_name) => ({
    table_name,
    rls_enabled: true,
    anon_access: false,
    authenticated_access: false,
    service_role_select: true,
    policy_count: 0,
    rls_forced: true,
  }));
}

test("API-PC-013 forced RLS and runtime-role drift fail closed", () => {
  const rows: RlsPostureRow[] = [{
    table_name: "orders",
    rls_enabled: true,
    rls_forced: false,
    anon_access: false,
    authenticated_access: false,
    service_role_select: true,
    policy_count: 1,
  }];
  const result = evaluateRlsPosture({
    clientDefaultPrivileges: false,
    expectedTables: ["orders"],
    forceRlsTables: ["orders"],
    globalExposure: { ...protectedGlobalExposure, public_table_count: 1 },
    roleRows: [
      {
        role_name: "luzione_api_runtime", table_name: "orders", role_exists: true,
        superuser: false, create_db: false, create_role: false, can_login: false,
        replication: false, bypass_rls: false, owns_table: false,
        select_access: false, insert_access: true, update_access: false,
        delete_access: false, truncate_access: false, trigger_access: false,
      },
      {
        role_name: "luzione_provider_worker", table_name: "orders", role_exists: true,
        superuser: false, create_db: false, create_role: false, can_login: false,
        replication: false, bypass_rls: false, owns_table: false,
        select_access: true, insert_access: false, update_access: false,
        delete_access: false, truncate_access: false, trigger_access: false,
      },
    ],
    rows,
  });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.violations, [
    { code: "RLS_NOT_FORCED", table: "orders" },
    { code: "LEGACY_SERVICE_ROLE_PRIVILEGE_PRESENT", role: "service_role", table: "orders" },
    { code: "ROLE_ACCESS_MISSING", role: "luzione_api_runtime", table: "orders" },
    { code: "WORKER_SCOPE_DRIFT", role: "luzione_provider_worker", table: "orders" },
  ]);
});

test("P175 security posture passes only for the complete denied client surface", () => {
  const result = evaluateRlsPosture({
    clientDefaultPrivileges: false,
    globalExposure: protectedGlobalExposure,
    rows: protectedRows(),
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.expectedTableCount, 10);
  assert.deepEqual(result.violations, []);
});

test("known-bad grants, disabled RLS and unsafe future defaults fail closed", () => {
  const rows = protectedRows();
  rows.find((row) => row.table_name === "secret_registry")!.anon_access = true;
  rows.find((row) => row.table_name === "auth_users")!.rls_enabled = false;
  const result = evaluateRlsPosture({
    clientDefaultPrivileges: true,
    globalExposure: protectedGlobalExposure,
    rows,
  });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.violations, [
    { code: "RLS_DISABLED", table: "auth_users" },
    { code: "ANON_PRIVILEGE_PRESENT", table: "secret_registry" },
    { code: "CLIENT_DEFAULT_PRIVILEGE_PRESENT", table: "<future tables>" },
  ]);
});

test("an expected relation missing from catalog readback fails closed", () => {
  const result = evaluateRlsPosture({
    clientDefaultPrivileges: false,
    globalExposure: protectedGlobalExposure,
    rows: protectedRows().slice(1),
  });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.violations, [{ code: "TABLE_MISSING", table: "auth_users" }]);
});

test("global public-table exposure fails the production gate", () => {
  const result = evaluateRlsPosture({
    clientDefaultPrivileges: false,
    globalExposure: {
      public_table_count: 546,
      rls_disabled_client_accessible_count: 383,
      rls_disabled_client_writable_count: 383,
      rls_disabled_table_count: 383,
    },
    rows: protectedRows(),
  });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.violations, [
    { code: "PUBLIC_RLS_DISABLED", count: 383, table: "<public schema>" },
    { code: "CLIENT_ACCESS_TO_RLS_DISABLED_TABLE", count: 383, table: "<public schema>" },
    { code: "CLIENT_WRITE_TO_RLS_DISABLED_TABLE", count: 383, table: "<public schema>" },
  ]);
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

test("readback failures are classified without returning raw connection details", () => {
  assert.deepEqual(
    classifyRlsReadbackError(Object.assign(new Error("Tenant or user not found"), { code: "XX000" })),
    {
      failureCode: RLS_READBACK_FAILURE_CODES.poolerTenantOrUserMissing,
      providerCode: "XX000",
    },
  );
  assert.deepEqual(classifyRlsReadbackError({ code: "28P01", message: "secret-bearing detail" }), {
    failureCode: RLS_READBACK_FAILURE_CODES.authenticationFailed,
    providerCode: "28P01",
  });
  assert.deepEqual(classifyRlsReadbackError({ code: "ENOTFOUND" }), {
    failureCode: RLS_READBACK_FAILURE_CODES.dnsUnavailable,
    providerCode: "ENOTFOUND",
  });
});

test("API boundary authenticates full readback and public health exposes no secrets", () => {
  const route = readFileSync("src/app/api/v1/security/rls-readiness/route.ts", "utf8");
  const health = readFileSync("src/app/api/v1/healthz/route.ts", "utf8");
  assert.match(route, /requireServiceActor\(request\.headers, "security\.rls\.read"\)/);
  assert.match(route, /readRlsReadiness/);
  assert.match(route, /status: result\.status === "PASS" \? 200 : 503/);
  assert.match(health, /CONNECTED_RLS_GATE_PASS/);
  assert.match(health, /SECURITY_POSTURE_REQUIRED/);
  assert.match(health, /readbackErrorCode/);
  assert.doesNotMatch(health, /DATABASE_URL|LUZIONE_API_SERVICE_TOKEN|PLATFORM_CONTINUATION_SECRET/);
});
