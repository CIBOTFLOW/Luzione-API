import assert from "node:assert/strict";
import { Pool } from "pg";

import { PostgresEffectKillStateReader } from "@/modules/effect-admission/gate";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString });
const reader = new PostgresEffectKillStateReader(pool);

async function main() {
  try {
    const columns = await pool.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='p110_delivery_attempts'
          and column_name = any($1::text[])
        order by column_name`,
      [["credential_binding_id", "effect_admission_contract_version", "effect_admission_digest", "effect_admission_kill_version", "effect_admission_ref"]],
    );
    assert.equal(columns.rows.length, 5);

    await pool.query(
      `insert into public.p110_kill_switches(tenant_id,switch_id,scope_type,scope_ref,reason,activated_by)
       values
         ('effect-proof-a','effect-proof-global','GLOBAL','*','synthetic effect proof','proof-service'),
         ('effect-proof-b','effect-proof-other','DESTINATION','provider.proof','synthetic cross-tenant proof','proof-service')`,
    );
    const tenantA = await reader.read({ destination: "provider.proof", tenantId: "effect-proof-a" });
    const tenantB = await reader.read({ destination: "provider.other", tenantId: "effect-proof-b" });
    assert.deepEqual(tenantA.activeKillRefs, ["GLOBAL:*:effect-proof-global"]);
    assert.deepEqual(tenantB.activeKillRefs, []);
    assert.notEqual(tenantA.killVersion, tenantB.killVersion);

    await pool.query(
      `update public.p110_kill_switches
          set active=false,deactivated_by='proof-service',deactivated_at=now()
        where tenant_id='effect-proof-a' and switch_id='effect-proof-global'`,
    );
    const deactivated = await reader.read({ destination: "provider.proof", tenantId: "effect-proof-a" });
    assert.deepEqual(deactivated.activeKillRefs, []);
    assert.notEqual(deactivated.killVersion, tenantA.killVersion);
    process.stdout.write(`${JSON.stringify({ columns: columns.rows.map((row) => row.column_name), crossTenantVisible: false, killVersionChangesOnToggle: true, result: "PASS" })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
