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

export const PRODUCTION_CONVERGENCE_TENANT_TABLES = Object.freeze([
  "p110_command_receipts",
  "p110_event_envelopes",
  "p110_idempotency_conflicts",
  "p110_outbox_messages",
  "p110_kill_switches",
  "p110_inbox_messages",
  "p110_delivery_attempts",
  "p110_dead_letters",
  "p110_reconciliation_checkpoints",
  "p111_workflow_instances",
  "p111_workflow_checkpoints",
  "p111_step_attempts",
  "p111_workflow_timers",
  "p111_human_task_refs",
  "p111_compensation_intents",
  "p111_recovery_receipts",
  "crm_leads",
  "commercial_case_identities",
  "commercial_cases",
  "commercial_policy_configurations",
  "quotes",
  "quote_lines",
  "quote_economics_versions",
  "quote_margin_approval_records",
  "commercial_case_proposal_context_versions",
  "commercial_case_proposal_document_versions",
  "commercial_case_proposal_review_versions",
  "orders",
  "order_lines",
  "order_fulfillment_intents",
]);

export const PRODUCTIZATION_TENANT_TABLES = Object.freeze([
  "tenant_product_license_versions",
  "tenant_product_module_entitlements",
]);

export const FORCED_TENANT_RLS_TABLES = Object.freeze([
  ...PRODUCTION_CONVERGENCE_TENANT_TABLES,
  ...PRODUCTIZATION_TENANT_TABLES,
]);

export const EXPECTED_RLS_TABLES = Object.freeze([
  ...new Set([...SENSITIVE_SERVER_ONLY_TABLES, ...FORCED_TENANT_RLS_TABLES]),
]);

export const PROVIDER_WORKER_TABLES = Object.freeze([
  "p110_command_receipts",
  "p110_outbox_messages",
  "p110_kill_switches",
  "p110_delivery_attempts",
  "p110_dead_letters",
  "p110_reconciliation_checkpoints",
]);

export const ACTIVE_DENIAL_PROBES = Object.freeze([
  Object.freeze({ role: "anon", table: "secret_registry" }),
  Object.freeze({ role: "authenticated", table: "auth_users" }),
  Object.freeze({ role: "anon", table: "orders" }),
  Object.freeze({ role: "authenticated", table: "p110_outbox_messages" }),
  Object.freeze({ role: "anon", table: "tenant_product_license_versions" }),
]);

export type RlsPostureRow = {
  anon_access: boolean;
  authenticated_access: boolean;
  policy_count: number;
  rls_enabled: boolean;
  rls_forced: boolean;
  service_role_select: boolean;
  table_name: string;
};

export type RoleTablePostureRow = {
  bypass_rls: boolean | null;
  can_login: boolean | null;
  create_db: boolean | null;
  create_role: boolean | null;
  delete_access: boolean | null;
  insert_access: boolean | null;
  owns_table: boolean;
  replication: boolean | null;
  role_exists: boolean;
  role_name: string;
  select_access: boolean | null;
  superuser: boolean | null;
  table_name: string;
  trigger_access: boolean | null;
  truncate_access: boolean | null;
  update_access: boolean | null;
};

export type GlobalClientExposureRow = {
  public_table_count: number;
  rls_disabled_client_accessible_count: number;
  rls_disabled_client_writable_count: number;
  rls_disabled_table_count: number;
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
    | "CLIENT_ACCESS_TO_RLS_DISABLED_TABLE"
    | "CLIENT_DEFAULT_PRIVILEGE_PRESENT"
    | "CLIENT_WRITE_TO_RLS_DISABLED_TABLE"
    | "FORBIDDEN_RUNTIME_PRIVILEGE_PRESENT"
    | "LEGACY_SERVICE_ROLE_PRIVILEGE_PRESENT"
    | "PUBLIC_RLS_DISABLED"
    | "RLS_DISABLED"
    | "RLS_NOT_FORCED"
    | "ROLE_ACCESS_MISSING"
    | "ROLE_MISSING"
    | "ROLE_OWNS_RUNTIME_TABLE"
    | "ROLE_UNSAFE_ATTRIBUTE"
    | "WORKER_SCOPE_DRIFT"
    | "TABLE_MISSING";
  count?: number;
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
  forceRlsTables?: readonly string[];
  globalExposure: GlobalClientExposureRow;
  probes?: readonly RlsProbeResult[];
  roleRows?: readonly RoleTablePostureRow[];
  rows: readonly RlsPostureRow[];
}) {
  const expectedTables = input.expectedTables ?? SENSITIVE_SERVER_ONLY_TABLES;
  const forceRlsTables = new Set(input.forceRlsTables ?? []);
  const byName = new Map(input.rows.map((row) => [row.table_name, row]));
  const violations: RlsViolation[] = [];

  for (const table of expectedTables) {
    const row = byName.get(table);
    if (!row) {
      violations.push({ code: "TABLE_MISSING", table });
      continue;
    }
    if (!row.rls_enabled) violations.push({ code: "RLS_DISABLED", table });
    if (forceRlsTables.has(table) && !row.rls_forced) violations.push({ code: "RLS_NOT_FORCED", table });
    if (forceRlsTables.has(table) && row.service_role_select) violations.push({ code: "LEGACY_SERVICE_ROLE_PRIVILEGE_PRESENT", role: "service_role", table });
    if (row.anon_access) violations.push({ code: "ANON_PRIVILEGE_PRESENT", table });
    if (row.authenticated_access) {
      violations.push({ code: "AUTHENTICATED_PRIVILEGE_PRESENT", table });
    }
  }

  if (input.clientDefaultPrivileges) {
    violations.push({ code: "CLIENT_DEFAULT_PRIVILEGE_PRESENT", table: "<future tables>" });
  }
  if (input.globalExposure.rls_disabled_table_count > 0) {
    violations.push({
      code: "PUBLIC_RLS_DISABLED",
      count: input.globalExposure.rls_disabled_table_count,
      table: "<public schema>",
    });
  }
  if (input.globalExposure.rls_disabled_client_accessible_count > 0) {
    violations.push({
      code: "CLIENT_ACCESS_TO_RLS_DISABLED_TABLE",
      count: input.globalExposure.rls_disabled_client_accessible_count,
      table: "<public schema>",
    });
  }
  if (input.globalExposure.rls_disabled_client_writable_count > 0) {
    violations.push({
      code: "CLIENT_WRITE_TO_RLS_DISABLED_TABLE",
      count: input.globalExposure.rls_disabled_client_writable_count,
      table: "<public schema>",
    });
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

  const roleRows = input.roleRows ?? [];
  const workerScope = new Set<string>(PROVIDER_WORKER_TABLES);
  for (const roleName of ["luzione_api_runtime", "luzione_provider_worker"]) {
    const rows = roleRows.filter((row) => row.role_name === roleName);
    if (roleRows.length > 0 && !rows.some((row) => row.role_exists)) {
      violations.push({ code: "ROLE_MISSING", role: roleName, table: "<role>" });
      continue;
    }
    const first = rows[0];
    if (first && (first.superuser || first.create_db || first.create_role || first.can_login || first.replication || first.bypass_rls)) {
      violations.push({ code: "ROLE_UNSAFE_ATTRIBUTE", role: roleName, table: "<role>" });
    }
    for (const row of rows) {
      if (row.owns_table) violations.push({ code: "ROLE_OWNS_RUNTIME_TABLE", role: roleName, table: row.table_name });
      const forbidden = row.delete_access || row.truncate_access || row.trigger_access;
      if (forbidden) violations.push({ code: "FORBIDDEN_RUNTIME_PRIVILEGE_PRESENT", role: roleName, table: row.table_name });
      if (roleName === "luzione_api_runtime" && !row.select_access) {
        violations.push({ code: "ROLE_ACCESS_MISSING", role: roleName, table: row.table_name });
      }
      if (roleName === "luzione_provider_worker") {
        const anyAccess = row.select_access || row.insert_access || row.update_access || row.delete_access || row.truncate_access || row.trigger_access;
        if (workerScope.has(row.table_name) ? !row.select_access : anyAccess) {
          violations.push({ code: "WORKER_SCOPE_DRIFT", role: roleName, table: row.table_name });
        }
      }
    }
  }

  return {
    status: violations.length === 0 ? "PASS" as const : "FAIL" as const,
    expectedTableCount: expectedTables.length,
    globalExposure: input.globalExposure,
    observedTableCount: input.rows.length,
    probes: input.probes ?? [],
    rolePostureRowsObserved: roleRows.length,
    violations,
  };
}
