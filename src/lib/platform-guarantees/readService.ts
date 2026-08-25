import "server-only";

import { databasePool } from "@/lib/db";

type Actor = { actorId: string; tenantId: string };

export async function readPlatformGuaranteeSummary(actor: Actor) {
  const pool = databasePool();
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [actor.tenantId]);
    const [flows, outbox, deadLetters, conflicts] = await Promise.all([
      client.query(
        `select state, count(*)::int as count
           from p111_workflow_instances
          where tenant_id = $1
          group by state
          order by state`,
        [actor.tenantId],
      ),
      client.query(
        `select state, count(*)::int as count
           from p110_outbox_messages
          where tenant_id = $1
          group by state
          order by state`,
        [actor.tenantId],
      ),
      client.query(
        `select count(*)::int as count
           from p110_dead_letters
          where tenant_id = $1 and state = 'OPEN'`,
        [actor.tenantId],
      ),
      client.query(
        `select count(*)::int as count
           from p110_idempotency_conflicts
          where tenant_id = $1 and resolved_at is null`,
        [actor.tenantId],
      ),
    ]);
    await client.query("commit");
    return {
      actorId: actor.actorId,
      deadLettersOpen: deadLetters.rows[0]?.count ?? 0,
      flowStates: flows.rows,
      idempotencyConflictsOpen: conflicts.rows[0]?.count ?? 0,
      outboxStates: outbox.rows,
      source: "canonical-postgres",
      tenantId: actor.tenantId,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
