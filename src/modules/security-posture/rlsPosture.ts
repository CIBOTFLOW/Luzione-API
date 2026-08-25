export const SENSITIVE_SERVER_ONLY_TABLES = Object.freeze([
  "auth_users",
  "connected_accounts",
  "connected_assets",
  "connector_sync_logs",
  "manual_connector_credentials",
  "migration_discipline_records",
  "policy_constant_migrations",
  "schema_migrations",
  "secret_registry",
  "service_auth_clients",
]);

export const ACTIVE_DENIAL_PROBES = Object.freeze([
  Object.freeze({ role: "anon", table: "secret_registry" }),
  Object.freeze({ role: "authenticated", table: "auth_users" }),
]);

export type RlsPostureRow = {
  anon_access: boolean;
  authenticated_access: boolean;
  policy_count: number;
  rls_enabled: boolean;
  service_role_select: boolean;
  table_name: string;
};

export type RlsProbeResult = {
  denied: boolean;
  errorCode?: string | null;
  reason: "permission_denied" | "query_succeeded" | "unexpected_probe_error";
  role: string;
  table: string;
};

export type RlsViolation = {
  code:
    | "ACTIVE_DENIAL_PROBE_FAILED"
    | "ANON_PRIVILEGE_PRESENT"
    | "AUTHENTICATED_PRIVILEGE_PRESENT"
    | "CLIENT_DEFAULT_PRIVILEGE_PRESENT"
    | "RLS_DISABLED"
    | "TABLE_MISSING";
  reason?: string;
  role?: string;
  table: string;
};

type QueryClient = {
  query(sql: string): Promise<unknown>;
};

const safeIdentifier = /^[a-z_][a-z0-9_]*$/;

function quoteIdentifier(value: string) {
  if (!safeIdentifier.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

export async function probeDeniedRead(
  client: QueryClient,
  probe: { role: string; table: string },
): Promise<RlsProbeResult> {
  const role = quoteIdentifier(probe.role);
  const table = quoteIdentifier(probe.table);
  await client.query("begin read only");
  try {
    await client.query(`set local role ${role}`);
    await client.query(`select 1 from public.${table} limit 1`);
    return { ...probe, denied: false, reason: "query_succeeded" };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "42501") {
      return { ...probe, denied: true, reason: "permission_denied" };
    }
    return {
      ...probe,
      denied: false,
      errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : null,
      reason: "unexpected_probe_error",
    };
  } finally {
    await client.query("rollback");
  }
}

export function evaluateRlsPosture(input: {
  clientDefaultPrivileges: boolean;
  expectedTables?: readonly string[];
  probes?: readonly RlsProbeResult[];
  rows: readonly RlsPostureRow[];
}) {
  const expectedTables = input.expectedTables ?? SENSITIVE_SERVER_ONLY_TABLES;
  const byName = new Map(input.rows.map((row) => [row.table_name, row]));
  const violations: RlsViolation[] = [];

  for (const table of expectedTables) {
    const row = byName.get(table);
    if (!row) {
      violations.push({ code: "TABLE_MISSING", table });
      continue;
    }
    if (!row.rls_enabled) violations.push({ code: "RLS_DISABLED", table });
    if (row.anon_access) violations.push({ code: "ANON_PRIVILEGE_PRESENT", table });
    if (row.authenticated_access) {
      violations.push({ code: "AUTHENTICATED_PRIVILEGE_PRESENT", table });
    }
  }

  if (input.clientDefaultPrivileges) {
    violations.push({ code: "CLIENT_DEFAULT_PRIVILEGE_PRESENT", table: "<future tables>" });
  }
  for (const probe of input.probes ?? []) {
    if (!probe.denied) {
      violations.push({
        code: "ACTIVE_DENIAL_PROBE_FAILED",
        reason: probe.reason,
        role: probe.role,
        table: probe.table,
      });
    }
  }

  return {
    status: violations.length === 0 ? "PASS" as const : "FAIL" as const,
    expectedTableCount: expectedTables.length,
    observedTableCount: input.rows.length,
    probes: input.probes ?? [],
    violations,
  };
}
