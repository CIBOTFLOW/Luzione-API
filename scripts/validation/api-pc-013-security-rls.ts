import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const proofShape = process.env.PROOF_SHAPE ?? "fresh";
const pool = new Pool({ connectionString, allowExitOnIdle: true, max: 1 });

const tenantTables = [
  "p110_command_receipts","p110_event_envelopes","p110_idempotency_conflicts","p110_outbox_messages",
  "p110_kill_switches","p110_inbox_messages","p110_delivery_attempts","p110_dead_letters",
  "p110_reconciliation_checkpoints","p111_workflow_instances","p111_workflow_checkpoints",
  "p111_step_attempts","p111_workflow_timers","p111_human_task_refs","p111_compensation_intents",
  "p111_recovery_receipts","crm_leads","commercial_case_identities","commercial_cases",
  "commercial_policy_configurations","quotes","quote_lines","quote_economics_versions",
  "quote_margin_approval_records","commercial_case_proposal_context_versions",
  "commercial_case_proposal_document_versions","commercial_case_proposal_review_versions",
  "orders","order_lines","order_fulfillment_intents",
] as const;

const workerTables = new Set([
  "p110_command_receipts","p110_outbox_messages","p110_kill_switches",
  "p110_delivery_attempts","p110_dead_letters","p110_reconciliation_checkpoints",
]);
const runtimeUpdateTables = new Set([
  "p110_command_receipts","p110_outbox_messages","p110_kill_switches","p110_inbox_messages",
  "p110_delivery_attempts","p110_dead_letters","p110_reconciliation_checkpoints",
  "p111_workflow_instances","p111_workflow_checkpoints","p111_step_attempts","p111_workflow_timers",
  "p111_human_task_refs","p111_compensation_intents","p111_recovery_receipts",
  "crm_leads","commercial_case_identities","commercial_cases","quotes",
]);
const runtimeInsertTables = new Set([
  ...runtimeUpdateTables,
  "p110_event_envelopes","p110_idempotency_conflicts","quote_lines","quote_economics_versions",
  "quote_margin_approval_records","commercial_case_proposal_review_versions","orders","order_lines",
  "order_fulfillment_intents",
]);
const workerInsertTables = new Set(["p110_delivery_attempts","p110_dead_letters","p110_reconciliation_checkpoints"]);
const workerUpdateTables = new Set(["p110_command_receipts","p110_outbox_messages","p110_delivery_attempts","p110_reconciliation_checkpoints"]);

async function asRole<T>(role: string, tenantId: string | null, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    if (tenantId !== null) await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query("rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function expectPermissionDenied(work: () => Promise<unknown>) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal(error && typeof error === "object" && "code" in error ? error.code : null, "42501");
    return true;
  });
}

async function main() {
try {
  const roleResult = await pool.query<{
    rolbypassrls: boolean; rolcanlogin: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
    rolname: string; rolreplication: boolean; rolsuper: boolean;
  }>(`select rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolreplication, rolbypassrls
        from pg_roles where rolname in ('luzione_api_runtime','luzione_provider_worker') order by rolname`);
  assert.equal(roleResult.rows.length, 2);
  for (const role of roleResult.rows) {
    assert.equal(role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolcanlogin || role.rolreplication || role.rolbypassrls, false, `${role.rolname} has an unsafe role attribute`);
  }

  const posture = await pool.query<{ policy_count: number; relforcerowsecurity: boolean; relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policy_count
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1::text[]) order by c.relname`,
    [tenantTables],
  );
  assert.equal(posture.rows.length, tenantTables.length);
  for (const row of posture.rows) {
    assert.equal(row.relrowsecurity, true, `${row.relname} has RLS disabled`);
    assert.equal(row.relforcerowsecurity, true, `${row.relname} does not force RLS`);
    assert.ok(Number(row.policy_count) >= 1, `${row.relname} has no policy`);
  }

  const publicPolicies = await pool.query<{ count: number }>(
    `select count(*)::int as count from pg_policy p
      join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1::text[]) and 0 = any(p.polroles)`,
    [tenantTables],
  );
  assert.equal(publicPolicies.rows[0]?.count, 0);

  const ownership = await pool.query<{ count: number }>(
    `select count(*)::int as count from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_roles owner on owner.oid = c.relowner
     where n.nspname = 'public' and c.relname = any($1::text[])
       and owner.rolname in ('luzione_api_runtime','luzione_provider_worker')`,
    [tenantTables],
  );
  assert.equal(ownership.rows[0]?.count, 0);

  for (const table of tenantTables) {
    for (const deniedRole of ["anon", "authenticated", "service_role"]) {
      const denied = await pool.query<{ access: boolean }>(
        `select has_table_privilege($1,$2,'SELECT') or has_table_privilege($1,$2,'INSERT')
             or has_table_privilege($1,$2,'UPDATE') or has_table_privilege($1,$2,'DELETE') as access`,
        [deniedRole, `public.${table}`],
      );
      assert.equal(denied.rows[0]?.access, false, `${deniedRole} retained access to ${table}`);
    }
    const runtime = await pool.query<{ delete_access: boolean; insert_access: boolean; references_access: boolean; select_access: boolean; trigger_access: boolean; truncate_access: boolean; update_access: boolean }>(
      `select has_table_privilege('luzione_api_runtime',$1,'SELECT') as select_access,
              has_table_privilege('luzione_api_runtime',$1,'INSERT') as insert_access,
              has_table_privilege('luzione_api_runtime',$1,'UPDATE') as update_access,
              has_table_privilege('luzione_api_runtime',$1,'DELETE') as delete_access,
              has_table_privilege('luzione_api_runtime',$1,'TRUNCATE') as truncate_access,
              has_table_privilege('luzione_api_runtime',$1,'REFERENCES') as references_access,
              has_table_privilege('luzione_api_runtime',$1,'TRIGGER') as trigger_access`,
      [`public.${table}`],
    );
    assert.deepEqual(runtime.rows[0], {
      delete_access: false,
      insert_access: runtimeInsertTables.has(table),
      references_access: false,
      select_access: true,
      trigger_access: false,
      truncate_access: false,
      update_access: runtimeUpdateTables.has(table),
    }, `runtime privilege drift on ${table}`);
    const worker = await pool.query<{ delete_access: boolean; insert_access: boolean; select_access: boolean; trigger_access: boolean; truncate_access: boolean; update_access: boolean }>(
      `select has_table_privilege('luzione_provider_worker',$1,'SELECT') as select_access,
              has_table_privilege('luzione_provider_worker',$1,'INSERT') as insert_access,
              has_table_privilege('luzione_provider_worker',$1,'UPDATE') as update_access,
              has_table_privilege('luzione_provider_worker',$1,'DELETE') as delete_access,
              has_table_privilege('luzione_provider_worker',$1,'TRUNCATE') as truncate_access,
              has_table_privilege('luzione_provider_worker',$1,'TRIGGER') as trigger_access`,
      [`public.${table}`],
    );
    assert.deepEqual(worker.rows[0], {
      delete_access: false,
      insert_access: workerInsertTables.has(table),
      select_access: workerTables.has(table),
      trigger_access: false,
      truncate_access: false,
      update_access: workerUpdateTables.has(table),
    }, `worker privilege drift on ${table}`);
  }

  await pool.query(`insert into public.orders
    (tenant_id, external_order_id, customer_name, status, currency, total_cents, source_system)
    values ('api-pc-013-a','pc013-order-a','Tenant A','created','USD',100,'proof'),
           ('api-pc-013-b','pc013-order-b','Tenant B','created','USD',200,'proof')`);
  const quotes = await pool.query<{ id: string; tenant_id: string }>(`insert into public.quotes
    (tenant_id, external_quote_id, customer_name, status, currency, subtotal_cents, source_system)
    values ('api-pc-013-a','pc013-quote-a','Tenant A','draft','USD',100,'proof'),
           ('api-pc-013-b','pc013-quote-b','Tenant B','draft','USD',200,'proof') returning id, tenant_id`);
  for (const quote of quotes.rows) {
    await pool.query(`insert into public.quote_lines (quote_id,line_number,description,quantity,unit_price_cents,source_system)
      values ($1,1,$2,1,100,'proof')`, [quote.id, quote.tenant_id]);
  }
  await pool.query(`insert into public.p110_kill_switches
    (tenant_id,switch_id,scope_type,scope_ref,reason,activated_by)
    values ('api-pc-013-a','pc013-switch-a','GLOBAL','*','proof','proof'),
           ('api-pc-013-b','pc013-switch-b','GLOBAL','*','proof','proof')`);

  const ownOrders = await asRole("luzione_api_runtime", "api-pc-013-a", (client) =>
    client.query<{ external_order_id: string }>("select external_order_id from public.orders order by external_order_id"));
  assert.deepEqual(ownOrders.rows.map((row) => row.external_order_id), ["pc013-order-a"]);
  const noTenantOrders = await asRole("luzione_api_runtime", null, (client) =>
    client.query("select 1 from public.orders"));
  assert.equal(noTenantOrders.rowCount, 0);
  const ownQuoteLines = await asRole("luzione_api_runtime", "api-pc-013-a", (client) =>
    client.query("select 1 from public.quote_lines"));
  assert.equal(ownQuoteLines.rowCount, 1);
  await expectPermissionDenied(() => asRole("luzione_api_runtime", "api-pc-013-a", (client) =>
    client.query(`insert into public.orders
      (tenant_id,external_order_id,status,currency,total_cents,source_system)
      values ('api-pc-013-b','pc013-cross-tenant','created','USD',1,'proof')`)));
  await expectPermissionDenied(() => asRole("luzione_api_runtime", "api-pc-013-a", (client) =>
    client.query("delete from public.orders where external_order_id='pc013-order-a'")));

  const workerRows = await asRole("luzione_provider_worker", "api-pc-013-a", (client) =>
    client.query<{ switch_id: string }>("select switch_id from public.p110_kill_switches order by switch_id"));
  assert.deepEqual(workerRows.rows.map((row) => row.switch_id), ["pc013-switch-a"]);
  await expectPermissionDenied(() => asRole("luzione_provider_worker", "api-pc-013-a", (client) =>
    client.query("select 1 from public.orders")));
  await expectPermissionDenied(() => asRole("luzione_provider_worker", "api-pc-013-a", (client) =>
    client.query(`insert into public.p110_inbox_messages
      (tenant_id,inbox_message_id,producer,producer_message_id,event_type,correlation_id,payload_hash)
      values ('api-pc-013-a','blocked','proof','blocked','proof.event','proof',repeat('a',64))`)));

  for (const role of ["anon", "authenticated", "service_role"]) {
    await expectPermissionDenied(() => asRole(role, null, (client) => client.query("select 1 from public.orders")));
  }

  if (proofShape === "observed_upgrade") {
    const preserved = await asRole("luzione_api_runtime", "legacy-tenant", (client) =>
      client.query<{ id: string }>("select id from public.crm_leads where id='legacy-lead-001'"));
    assert.deepEqual(preserved.rows.map((row) => row.id), ["legacy-lead-001"]);
    const hidden = await asRole("luzione_api_runtime", "api-pc-013-a", (client) =>
      client.query("select 1 from public.crm_leads where id='legacy-lead-001'"));
    assert.equal(hidden.rowCount, 0);
  }

  console.log(JSON.stringify({
    advisorChecks: { clientRoleDenials: 3 * tenantTables.length, forcedRlsRelations: posture.rows.length, publicPolicies: 0 },
    crossTenantInsertDenied: true,
    missingTenantRows: noTenantOrders.rowCount,
    proofShape,
    runtimeVisibleOrders: ownOrders.rowCount,
    workerScopedRelations: workerTables.size,
  }));
} finally {
  await pool.end();
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
