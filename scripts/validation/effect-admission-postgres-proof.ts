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
      `select table_name,column_name from information_schema.columns
        where table_schema='public' and (
          (table_name='p110_delivery_attempts' and column_name = any($1::text[]))
          or (table_name='sultan_agent_command_reservations' and column_name = any($2::text[]))
          or (table_name='sultan_agent_internal_actions' and column_name = any($3::text[]))
        ) order by table_name,column_name`,
      [
        ["effect_execution_envelope", "effect_execution_envelope_ref", "effect_execution_identity", "originating_envelope_ref", "prepared_dispatch_digest"],
        ["admission_receipt_hash", "originating_envelope_ref", "prepare_effect_admission_ref", "prepare_execution_identity"],
        ["effect_execution_envelope", "effect_execution_envelope_ref", "effect_execution_identity", "originating_envelope_ref"],
      ],
    );
    assert.equal(columns.rows.length, 13, JSON.stringify(columns.rows));
    const constraints = await pool.query(
      `select conname,pg_get_constraintdef(oid) definition
         from pg_constraint
        where conname = any($1::text[])
        order by conname`,
      [[
        "p110_delivery_attempt_effect_admission_check",
        "sultan_agent_command_exact_stage5_admission_fk",
        "sultan_agent_command_prepare_effect_lineage_check",
        "sultan_agent_internal_action_effect_envelope_check",
      ]],
    );
    assert.equal(constraints.rows.length, 4);
    assert.match(constraints.rows.find((row) => row.conname === "p110_delivery_attempt_effect_admission_check").definition, /luzione-effect-admission\/v2/);
    assert.match(constraints.rows.find((row) => row.conname === "p110_delivery_attempt_effect_admission_check").definition, /SANDBOX/);

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
    process.stdout.write(`${JSON.stringify({ correctionColumns: columns.rows.length, correctionConstraints: constraints.rows.length, crossTenantVisible: false, killVersionChangesOnToggle: true, result: "PASS" })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
