import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

import {
  EXPECTED_RLS_TABLES,
  PRODUCTION_CONVERGENCE_TENANT_TABLES,
  PROVIDER_WORKER_TABLES,
  SENSITIVE_SERVER_ONLY_TABLES,
} from "@/modules/security-posture/rlsPosture";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString, allowExitOnIdle: true, max: 1 });
const clientRoles = ["anon", "authenticated"] as const;
const fixedRoles = new Set([
  ...clientRoles,
  "service_role",
  "luzione_api_runtime",
  "luzione_provider_worker",
]);

async function asRole<T>(role: string, tenantId: string | null, work: (client: PoolClient) => Promise<T>) {
  assert.ok(fixedRoles.has(role), `unexpected proof role ${role}`);
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

async function expectReadDenied(role: string, table: string) {
  await expectPermissionDenied(() => asRole(role, null, (client) =>
    client.query(`select 1 from public."${table}" limit 1`)));
}

async function main() {
  try {
    assert.equal(EXPECTED_RLS_TABLES.length, 48);
    assert.equal(PRODUCTION_CONVERGENCE_TENANT_TABLES.length, 38);
    assert.equal(SENSITIVE_SERVER_ONLY_TABLES.length, 10);

    const posture = await pool.query<{
      policy_count: number;
      relforcerowsecurity: boolean;
      relname: string;
      relrowsecurity: boolean;
    }>(
      `select c.relname,c.relrowsecurity,c.relforcerowsecurity,
              (select count(*)::int from pg_policy p where p.polrelid=c.oid) policy_count
         from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p')
          and c.relname=any($1::text[]) order by c.relname`,
      [EXPECTED_RLS_TABLES],
    );
    assert.equal(posture.rows.length, 48);
    const forcedTables = new Set(PRODUCTION_CONVERGENCE_TENANT_TABLES);
    for (const row of posture.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} has RLS disabled`);
      if (forcedTables.has(row.relname)) {
        assert.equal(row.relforcerowsecurity, true, `${row.relname} does not force RLS`);
        assert.ok(Number(row.policy_count) >= 1, `${row.relname} has no tenant policy`);
      }
    }

    const unsafeRoles = await pool.query<{ rolname: string }>(
      `select rolname from pg_roles
        where rolname in ('luzione_api_runtime','luzione_provider_worker')
          and (rolsuper or rolcreatedb or rolcreaterole or rolcanlogin or rolreplication or rolbypassrls)`,
    );
    assert.deepEqual(unsafeRoles.rows, []);
    const ownedRelations = await pool.query<{ count: number }>(
      `select count(*)::int count from pg_class c
        join pg_namespace n on n.oid=c.relnamespace
        join pg_roles r on r.oid=c.relowner
       where n.nspname='public' and c.relname=any($1::text[])
         and r.rolname in ('luzione_api_runtime','luzione_provider_worker')`,
      [EXPECTED_RLS_TABLES],
    );
    assert.equal(ownedRelations.rows[0]?.count, 0);

    const publicPolicies = await pool.query<{ count: number }>(
      `select count(*)::int count from pg_policy p
        join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=any($1::text[]) and 0=any(p.polroles)`,
      [PRODUCTION_CONVERGENCE_TENANT_TABLES],
    );
    assert.equal(publicPolicies.rows[0]?.count, 0);

    let browserClientRoleDenials = 0;
    for (const table of EXPECTED_RLS_TABLES) {
      for (const role of clientRoles) {
        await expectReadDenied(role, table);
        browserClientRoleDenials += 1;
      }
    }

    let legacyServiceRoleTenantDenials = 0;
    for (const table of PRODUCTION_CONVERGENCE_TENANT_TABLES) {
      await expectReadDenied("service_role", table);
      legacyServiceRoleTenantDenials += 1;
    }

    let runtimeSensitiveDenials = 0;
    for (const table of SENSITIVE_SERVER_ONLY_TABLES) {
      await expectReadDenied("luzione_api_runtime", table);
      runtimeSensitiveDenials += 1;
    }

    const workerScope = new Set(PROVIDER_WORKER_TABLES);
    const workerDeniedTables = EXPECTED_RLS_TABLES.filter((table) => !workerScope.has(table));
    for (const table of workerDeniedTables) await expectReadDenied("luzione_provider_worker", table);

    await pool.query(
      `insert into public.p110_kill_switches
        (tenant_id,switch_id,scope_type,scope_ref,reason,activated_by)
       values ('a01-current-a','a01-current-switch','GLOBAL','*','current schema proof','a01-proof')`,
    );
    const ownLegacyRows = await asRole("luzione_api_runtime", "a01-current-a", (client) =>
      client.query("select switch_id from public.p110_kill_switches where switch_id='a01-current-switch'"));
    const crossTenantLegacyRows = await asRole("luzione_api_runtime", "a01-current-b", (client) =>
      client.query("select switch_id from public.p110_kill_switches where switch_id='a01-current-switch'"));
    const missingTenantLegacyRows = await asRole("luzione_api_runtime", null, (client) =>
      client.query("select switch_id from public.p110_kill_switches where switch_id='a01-current-switch'"));
    assert.equal(ownLegacyRows.rowCount, 1);
    assert.equal(crossTenantLegacyRows.rowCount, 0);
    assert.equal(missingTenantLegacyRows.rowCount, 0);
    await expectPermissionDenied(() => asRole("luzione_api_runtime", "a01-current-a", (client) =>
      client.query(
        `insert into public.p110_kill_switches
          (tenant_id,switch_id,scope_type,scope_ref,reason,activated_by)
         values ('a01-current-b','a01-cross-switch','GLOBAL','*','blocked','a01-proof')`,
      )));

    await pool.query(
      `insert into public.sultan_agent_policy_envelopes
        (tenant_id,envelope_id,agent_id,agent_version,tool_id,case_id,case_type,
         sender_address,recipient_address,subject_prefix,evidence_class,maximum_per_run,
         maximum_per_day,activated_at,expires_at,approved_by,approval_ref)
       values ('a01-current-a','a01-envelope','agent.luzione.revenue-steward','v1',
         'luzione.supplier_rfq_email.send','a01-case','COMMERCIAL','proof@example.com',
         'hello@ciflow.io','[SULTAN RFQ CANARY]','SYNTHETIC_ALLOWLISTED',1,1,
         '2026-09-03T03:00:00Z','2026-09-03T04:00:00Z','a01-proof','a01-current-schema')`,
    );
    const ownStage5Rows = await asRole("luzione_api_runtime", "a01-current-a", (client) =>
      client.query("select envelope_id from public.sultan_agent_policy_envelopes where envelope_id='a01-envelope'"));
    const crossTenantStage5Rows = await asRole("luzione_api_runtime", "a01-current-b", (client) =>
      client.query("select envelope_id from public.sultan_agent_policy_envelopes where envelope_id='a01-envelope'"));
    const missingTenantStage5Rows = await asRole("luzione_api_runtime", null, (client) =>
      client.query("select envelope_id from public.sultan_agent_policy_envelopes where envelope_id='a01-envelope'"));
    assert.equal(ownStage5Rows.rowCount, 1);
    assert.equal(crossTenantStage5Rows.rowCount, 0);
    assert.equal(missingTenantStage5Rows.rowCount, 0);
    await expectPermissionDenied(() => asRole("luzione_api_runtime", "a01-current-a", (client) =>
      client.query(
        `insert into public.sultan_agent_policy_envelopes
          (tenant_id,envelope_id,agent_id,agent_version,tool_id,case_id,case_type,
           sender_address,recipient_address,subject_prefix,evidence_class,maximum_per_run,
           maximum_per_day,activated_at,expires_at,approved_by,approval_ref)
         values ('a01-current-b','a01-cross-envelope','agent.luzione.revenue-steward','v1',
           'luzione.supplier_rfq_email.send','a01-case','COMMERCIAL','proof@example.com',
           'hello@ciflow.io','[SULTAN RFQ CANARY]','SYNTHETIC_ALLOWLISTED',1,1,
           '2026-09-03T03:00:00Z','2026-09-03T04:00:00Z','a01-proof','a01-current-schema')`,
      )));

    console.log(JSON.stringify({
      browserClientRoleDenials,
      crossTenantInsertDenials: 2,
      expectedRelations: EXPECTED_RLS_TABLES.length,
      forcedRlsRelations: PRODUCTION_CONVERGENCE_TENANT_TABLES.length,
      legacyServiceRoleTenantDenials,
      missingTenantRepresentativeRows: (missingTenantLegacyRows.rowCount ?? 0) + (missingTenantStage5Rows.rowCount ?? 0),
      ownedRuntimeRelations: Number(ownedRelations.rows[0]?.count ?? 0),
      publicPolicies: Number(publicPolicies.rows[0]?.count ?? 0),
      runtimeSensitiveDenials,
      workerOutOfScopeDenials: workerDeniedTables.length,
    }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
