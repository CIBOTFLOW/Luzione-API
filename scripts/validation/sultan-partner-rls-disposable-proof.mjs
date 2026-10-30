// Run ONLY against a fresh, separately provisioned disposable PostgreSQL database.
// Requires: node --import tsx scripts/validation/sultan-partner-rls-disposable-proof.mjs
// This is a synthetic policy/adapter test, NOT verification of the production API role.
import assert from 'node:assert/strict';
import { SOURCE_TABLES, assertDisposableTarget, assertIsolationCounts } from './rls-proof-contract.mjs';

const ROLE = 'sultan_rls_disposable_reader';
const OWN_ID = '8d3d18be-2c13-4e3b-9802-0a10a2456f09';
const OTHER_ID = '2d3d18be-2c13-4e3b-9802-0a10a2456f09';
const URL_ENV = 'SULTAN_RLS_PROOF_DATABASE_URL';

async function main() {
  const url = process.env[URL_ENV];
  if (!url) throw Error('DISPOSABLE_DATABASE_URL_REQUIRED');
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw Error('POSTGRES_URL_REQUIRED');
  const intendedName = decodeURIComponent(parsed.pathname.slice(1));
  // Validate before connecting or loading database dependencies.
  assertDisposableTarget(intendedName, process.env.SULTAN_RLS_PROOF_CONFIRM, []);
  const pg = (await import('pg')).default;
  const { readPartnerCase } = await import('../../src/modules/sultan-agent-gateway/partnerCaseStore.ts');
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  let pool;
  let setupStarted = false;
  try {
    const actual = await admin.query('select current_database() as name');
    const existing = await admin.query(`select tablename from pg_tables where schemaname='public' and tablename = any($1::text[])`, [SOURCE_TABLES]);
    assertDisposableTarget(actual.rows[0]?.name, process.env.SULTAN_RLS_PROOF_CONFIRM, existing.rows.map(r => r.tablename));
    assert.equal(actual.rows[0].name, intendedName, 'DATABASE_NAME_MISMATCH');
    const priorRole = await admin.query('select 1 from pg_roles where rolname=$1', [ROLE]);
    if (priorRole.rowCount) throw Error('DISPOSABLE_TEST_ROLE_ALREADY_EXISTS');
    setupStarted = true;
    await admin.query(`create role ${ROLE} nologin nobypassrls`);
    await admin.query(`create table public.crm_accounts (
      tenant_id text not null, account_id uuid not null, id text not null,
      account_name text not null, account_type text not null, status text,
      partner_iq numeric, partner_iq_version text, partner_iq_confidence text,
      updated_at timestamptz not null)`);
    for (const table of SOURCE_TABLES.slice(1)) {
      await admin.query(`create table public.${table} (tenant_id text not null, account_id text not null, updated_at timestamptz not null)`);
    }
    for (const table of SOURCE_TABLES) {
      await admin.query(`alter table public.${table} enable row level security`);
      await admin.query(`grant select on public.${table} to ${ROLE}`);
      await admin.query(`create policy sultan_disposable_tenant_select on public.${table}
        for select to ${ROLE} using (tenant_id = current_setting('app.tenant_id', true))`);
    }
    await admin.query(`grant usage on schema public to ${ROLE}`);
    for (const [tenant, id, alias] of [['luzione', OWN_ID, 'alias-own'], ['foreign-tenant', OTHER_ID, 'alias-other']]) {
      await admin.query(`insert into public.crm_accounts
        (tenant_id,account_id,id,account_name,account_type,status,partner_iq,partner_iq_version,partner_iq_confidence,updated_at)
        values ($1,$2,$3,'Synthetic Partner','design_firm','TARGET',70,'v2','HIGH',now())`, [tenant,id,alias]);
      for (const table of SOURCE_TABLES.slice(1)) {
        await admin.query(`insert into public.${table} (tenant_id,account_id,updated_at) values ($1,$2,now())`, [tenant,alias]);
      }
    }
    pool = new pg.Pool({ connectionString: url, max: 2 });
    const rolePool = {
      connect: async () => {
        const client = await pool.connect();
        try { await client.query(`set role ${ROLE}`); return client; }
        catch (error) { client.release(); throw error; }
      },
    };
    for (const [tenant, foreignTenant] of [['luzione', 'foreign-tenant'], ['foreign-tenant', 'luzione']]) {
      const client = await rolePool.connect();
      try {
        await client.query('begin transaction read only');
        await client.query("select set_config('app.tenant_id',$1,true)", [tenant]);
        const role = await client.query('select current_user as name');
        assert.equal(role.rows[0]?.name, ROLE);
        const counts = {};
        for (const table of SOURCE_TABLES) {
          const own = await client.query(`select count(*)::int as n from public.${table} where tenant_id=$1`, [tenant]);
          const foreign = await client.query(`select count(*)::int as n from public.${table} where tenant_id=$1`, [foreignTenant]);
          counts[table] = { own: own.rows[0].n, foreign: foreign.rows[0].n };
        }
        assertIsolationCounts(counts, tenant);
        await client.query('rollback');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }
    const actor = { tenantId: 'luzione', actorId: 'service:sultan-os', actorType: 'service', source: 'vercel-oidc', capabilities: ['sultan.case.read'] };
    const own = await readPartnerCase(rolePool, actor, OWN_ID);
    assert.equal(own?.caseType, 'PARTNER_RELATIONSHIP');
    assert.equal(own.snapshot.coverage.professionals.count, 1);
    assert.equal(own.snapshot.coverage.leads.count, 1);
    assert.equal(own.snapshot.coverage.opportunities.count, 1);
    assert.equal(await readPartnerCase(rolePool, actor, OTHER_ID), null, 'FOREIGN_ACCOUNT_LEAK');
    await admin.query('drop policy sultan_disposable_tenant_select on public.crm_people');
    await assert.rejects(() => readPartnerCase(rolePool, actor, OWN_ID), error => error?.code === 'PARTNER_RLS_SELECT_POLICY_MISSING');
    console.log(JSON.stringify({ status: 'PASS', scope: 'DISPOSABLE_SYNTHETIC_ONLY', tables: SOURCE_TABLES.length,
      ownCase: 'VISIBLE', foreignCase: 'DENIED', missingPolicy: 'DENIED', productionRoleVerified: false }));
  } finally {
    if (pool) await pool.end();
    if (setupStarted) {
      // This cleanup is only reachable after the database-name, emptiness and role checks.
      for (const table of [...SOURCE_TABLES].reverse()) await admin.query(`drop table if exists public.${table}`);
      await admin.query(`drop role if exists ${ROLE}`);
    }
    await admin.end();
  }
}
main().catch(error => { console.error(`SULTAN_PARTNER_DISPOSABLE_PROOF_FAILED: ${error.message}`); process.exitCode = 1; });
