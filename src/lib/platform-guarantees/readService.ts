import "server-only";

import { databasePool } from "@/lib/db";
import {
  buildCommandCausalReadback,
  missingCausalReadback,
} from "@/modules/platform-contracts/readbackContract";

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

export async function readCommandCausalReadback(actor: Actor, receiptId: string) {
  const pool = databasePool();
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [actor.tenantId]);
    const result = await client.query(
      `select r.tenant_id, r.receipt_id, r.command_id, r.state as receipt_state,
              r.target_owner_project, r.target_object_type, r.target_object_id,
              r.committed_object_version, r.committed_at, r.event_id,
              r.outbox_message_id, r.source_confirmed_at, r.source_readback_ref,
              o.state as outbox_state, o.provider_acknowledged_at,
              o.provider_acknowledgement_ref,
              coalesce(o.source_confirmed_at, r.source_confirmed_at) as effective_source_confirmed_at,
              coalesce(o.source_readback_ref, r.source_readback_ref) as effective_source_readback_ref,
              a.attempt_id,
              c.reconciliation_id, c.result as reconciliation_result, c.checked_at,
              c.source_readback_ref as reconciliation_source_readback_ref
         from public.p110_command_receipts r
         left join public.p110_outbox_messages o
           on o.tenant_id = r.tenant_id and o.receipt_id = r.receipt_id
         left join lateral (
           select attempt_id
             from public.p110_delivery_attempts
            where tenant_id = r.tenant_id and outbox_message_id = o.outbox_message_id
            order by attempt_number desc
            limit 1
         ) a on true
         left join lateral (
           select reconciliation_id, result, checked_at, source_readback_ref
             from public.p110_reconciliation_checkpoints
            where tenant_id = r.tenant_id and receipt_id = r.receipt_id
            order by checked_at desc, reconciliation_id desc
            limit 1
         ) c on true
        where r.tenant_id = $1 and r.receipt_id = $2
        limit 1`,
      [actor.tenantId, receiptId],
    );
    await client.query("commit");
    const row = result.rows[0];
    if (!row) return missingCausalReadback({ receiptId, tenantId: actor.tenantId });
    return buildCommandCausalReadback({
      row: {
        attemptId: row.attempt_id,
        checkedAt: row.checked_at,
        commandId: row.command_id,
        committedAt: row.committed_at,
        committedObjectVersion: row.committed_object_version,
        eventId: row.event_id,
        outboxMessageId: row.outbox_message_id,
        outboxState: row.outbox_state,
        providerAcknowledgedAt: row.provider_acknowledged_at,
        providerAcknowledgementRef: row.provider_acknowledgement_ref,
        receiptId: row.receipt_id,
        receiptState: row.receipt_state,
        reconciliationId: row.reconciliation_id,
        reconciliationResult: row.reconciliation_result,
        sourceConfirmedAt: row.effective_source_confirmed_at,
        sourceReadbackRef: row.effective_source_readback_ref ?? row.reconciliation_source_readback_ref,
        targetObjectId: row.target_object_id,
        targetObjectType: row.target_object_type,
        targetOwnerProject: row.target_owner_project,
        tenantId: row.tenant_id,
      },
    });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
