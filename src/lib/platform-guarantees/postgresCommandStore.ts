import "server-only";

import type { Pool, PoolClient } from "pg";

import { databasePool } from "@/lib/db";
import type {
  AcceptedCommandWrite,
  AtomicCommandStore,
} from "@/modules/platform-guarantees/commandKernel";
import type {
  IdempotencyConflict,
  LifecycleCommandReceipt,
  LifecycleCommandRequest,
} from "@/modules/platform-guarantees/types";

export const POSTGRES_COMMAND_LEDGER_VERSION = "luzione-command-ledger/v0.1";

type CommandTransaction = {
  client: PoolClient;
  tenantId: string | null;
};

function rowReceipt(row: Record<string, unknown>): LifecycleCommandReceipt {
  return {
    commandId: String(row.command_id),
    correlationId: String(row.correlation_id),
    eventId: String(row.event_id),
    idempotentReplay: false,
    idempotencyKey: String(row.idempotency_key),
    objectVersion: String(row.committed_object_version),
    outboxMessageId: String(row.outbox_message_id),
    payloadHash: String(row.payload_hash),
    receiptId: String(row.receipt_id),
    state: row.state as LifecycleCommandReceipt["state"],
    tenantId: String(row.tenant_id),
  };
}

async function bindTenant(transaction: CommandTransaction, tenantId: string) {
  if (transaction.tenantId && transaction.tenantId !== tenantId) {
    throw new Error("A command transaction cannot cross tenant boundaries.");
  }
  if (!transaction.tenantId) {
    await transaction.client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    transaction.tenantId = tenantId;
  }
}

export class PostgresAtomicCommandStore implements AtomicCommandStore<CommandTransaction> {
  constructor(private readonly pool: Pool = databasePool()) {}

  async findReceipt(transaction: CommandTransaction, tenantId: string, idempotencyKey: string) {
    await bindTenant(transaction, tenantId);
    await transaction.client.query(
      "select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))",
      [tenantId, idempotencyKey],
    );
    const result = await transaction.client.query(
      `select tenant_id, receipt_id, command_id, idempotency_key, payload_hash,
              correlation_id, committed_object_version, event_id, outbox_message_id, state
         from public.p110_command_receipts
        where tenant_id = $1 and idempotency_key = $2
        for update`,
      [tenantId, idempotencyKey],
    );
    return result.rows.length === 1 ? rowReceipt(result.rows[0]) : null;
  }

  async insertAccepted(
    transaction: CommandTransaction,
    write: AcceptedCommandWrite,
    request: LifecycleCommandRequest,
  ) {
    await bindTenant(transaction, request.tenantId);
    const { event, receipt } = write;
    await transaction.client.query(
      `insert into public.p110_command_receipts
        (tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
         correlation_id, causation_id, workflow_id, step_id, target_owner_project,
         target_object_type, target_object_id, expected_object_version,
         committed_object_version, policy_version, actor_id, actor_type, actor_roles,
         state, event_id, outbox_message_id, requested_at, committed_at, metadata)
       values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,
         $20,$21,$22,$23,$23,$24::jsonb)`,
      [
        request.tenantId, receipt.receiptId, request.commandId, request.commandType,
        request.idempotencyKey, request.payloadHash, request.correlationId,
        request.causationId, request.workflowId, request.stepId, request.target.ownerProject,
        request.target.objectType, request.target.objectId, request.expectedObjectVersion,
        write.objectVersion, request.policyVersion, request.actor.actorId,
        request.actor.actorType, JSON.stringify(request.actor.roles), receipt.state,
        event.eventId, write.outboxMessageId, request.requestedAt,
        JSON.stringify({ contractVersion: POSTGRES_COMMAND_LEDGER_VERSION }),
      ],
    );
    await transaction.client.query(
      `insert into public.p110_event_envelopes
        (tenant_id, event_id, contract_version, event_type, event_version, authority_class,
         producer_project, subject_owner_project, subject_object_type, subject_object_id,
         subject_object_version, subject_source_refs, actor_id, actor_type, actor_roles,
         correlation_id, causation_id, command_id, workflow_id, step_id, idempotency_key,
         occurred_at, recorded_at, payload, payload_hash, evidence_refs, privacy_class,
         retention_class, correction_of, supersedes)
       values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16,$17,$18,
         $19,$20,$21,$22,$23,$24::jsonb,$25,$26::jsonb,$27,$28,$29,$30)`,
      [
        event.tenantId, event.eventId, event.contractVersion, event.eventType,
        event.eventVersion, event.authorityClass, event.producerProject,
        event.subject.ownerProject, event.subject.objectType, event.subject.objectId,
        event.subject.objectVersion, JSON.stringify(event.subject.sourceRefs),
        event.actor.actorId, event.actor.actorType, JSON.stringify(event.actor.roles),
        event.correlationId, event.causationId, event.commandId, event.workflowId,
        event.stepId, event.idempotencyKey, event.occurredAt, event.recordedAt,
        JSON.stringify(event.payload), event.payloadHash, JSON.stringify(event.evidenceRefs),
        event.privacyClass, event.retentionClass, event.correctionOf, event.supersedes,
      ],
    );
    await transaction.client.query(
      `insert into public.p110_outbox_messages
        (tenant_id, outbox_message_id, receipt_id, event_id, destination, effect_class,
         idempotency_key, payload, payload_hash, state)
       values ($1,$2,$3,$4,'INTERNAL_WORKFLOW','NO_EFFECT',$5,$6::jsonb,$7,'PENDING')`,
      [
        request.tenantId, write.outboxMessageId, receipt.receiptId, event.eventId,
        request.idempotencyKey, JSON.stringify({ eventId: event.eventId }), event.payloadHash,
      ],
    );
  }

  async recordConflict(conflict: IdempotencyConflict) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [conflict.tenantId]);
      await client.query(
        `insert into public.p110_idempotency_conflicts
          (tenant_id, conflict_id, command_id, idempotency_key, existing_payload_hash,
           received_payload_hash, correlation_id)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          conflict.tenantId, conflict.conflictId, conflict.commandId,
          conflict.idempotencyKey, conflict.existingPayloadHash,
          conflict.receivedPayloadHash, conflict.correlationId,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async withTransaction<Result>(callback: (transaction: CommandTransaction) => Promise<Result>) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await callback({ client, tenantId: null });
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
