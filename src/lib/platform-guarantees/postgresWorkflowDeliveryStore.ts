import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { decideRetry } from "@/modules/platform-guarantees/retryPolicy";
import { nextWorkflowState } from "@/modules/platform-guarantees/stateMachine";
import type { FailureClass, FlowCommandType, WorkflowState } from "@/modules/platform-guarantees/types";

export const WORKFLOW_DELIVERY_CONTRACT_VERSION = "luzione-workflow-delivery/v0.1";
export const WORKER_LEASE_MS = 60_000;
export const WORKER_REQUEST_DEADLINE_MS = 45_000;

const WORKER_ID = /^[A-Za-z0-9._:@-]{1,190}$/;
const boundedLimit = (value: number | undefined) => Number.isInteger(value) ? Math.max(1, Math.min(value ?? 10, 50)) : 10;

export class WorkflowDeliveryStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WorkflowDeliveryStoreError";
  }
}

function validatedWorkerId(value: string) {
  if (!WORKER_ID.test(value)) throw new WorkflowDeliveryStoreError("WORKER_ID_INVALID", "workerId is invalid.");
  return value;
}

async function bindTenant(client: PoolClient, tenantId: string) {
  if (!tenantId.trim()) throw new WorkflowDeliveryStoreError("TENANT_REQUIRED", "tenantId is required.");
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}

export class PostgresWorkflowDeliveryStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<Result>(tenantId: string, work: (client: PoolClient) => Promise<Result>) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await bindTenant(client, tenantId);
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimDueOutbox(input: { limit?: number; tenantId: string; workerId: string }) {
    const workerId = validatedWorkerId(input.workerId);
    return this.transaction(input.tenantId, async (client) => {
      const expired = await client.query(
        `select outbox.*, receipt.correlation_id, receipt.committed_object_version as resulting_object_version,
                receipt.target_object_type, receipt.target_object_id,
                exists (
                  select 1 from public.p110_delivery_attempts attempt
                   where attempt.tenant_id = outbox.tenant_id
                     and attempt.outbox_message_id = outbox.outbox_message_id
                     and attempt.attempt_number = outbox.attempt_count
                     and attempt.result = 'STARTED'
                ) as dispatch_started
           from public.p110_outbox_messages outbox
           join public.p110_command_receipts receipt
             on receipt.tenant_id = outbox.tenant_id and receipt.receipt_id = outbox.receipt_id
          where outbox.tenant_id = $1 and outbox.state = 'CLAIMED'
            and outbox.lease_expires_at <= now()
          for update of outbox skip locked`,
        [input.tenantId],
      );
      for (const row of expired.rows) {
        if (row.dispatch_started) {
          const reconciliationId = `reconcile_${row.outbox_message_id}_${row.attempt_count}`;
          await client.query(
            `update public.p110_delivery_attempts
                set result = 'RECONCILIATION_REQUIRED', failure_class = 'AMBIGUOUS_AFTER_ACK',
                    finished_at = now(), error_code = 'WORKER_LOST_AFTER_DISPATCH',
                    error_summary = 'The worker lease expired after durable dispatch start; source reconciliation is required.'
              where tenant_id = $1 and outbox_message_id = $2 and attempt_number = $3 and result = 'STARTED'`,
            [input.tenantId, row.outbox_message_id, row.attempt_count],
          );
          await client.query(
            `insert into public.p110_reconciliation_checkpoints
              (tenant_id, reconciliation_id, receipt_id, outbox_message_id, source_system,
               source_object_ref, expected_object_version, result, checked_at, checked_by, notes)
             values ($1,$2,$3,$4,$5,$6,$7,'PENDING',now(),$8,$9)
             on conflict (tenant_id, reconciliation_id) do nothing`,
            [input.tenantId, reconciliationId, row.receipt_id, row.outbox_message_id,
              row.destination, `${row.target_object_type}:${row.target_object_id}`,
              row.resulting_object_version, workerId,
              "A worker disappeared after durable dispatch start; reconcile source state before any retry."],
          );
          await client.query(
            `update public.p110_outbox_messages
                set state = 'RECONCILIATION_REQUIRED', locked_at = null, lock_owner = null,
                    heartbeat_at = null, lease_expires_at = null, request_deadline_at = null,
                    failure_class = 'AMBIGUOUS_AFTER_ACK', last_error_code = 'WORKER_LOST_AFTER_DISPATCH',
                    last_error_summary = 'The worker lease expired after durable dispatch start; source reconciliation is required.',
                    updated_at = now()
              where tenant_id = $1 and outbox_message_id = $2`,
            [input.tenantId, row.outbox_message_id],
          );
          continue;
        }
        const exhausted = Number(row.attempt_count) >= Number(row.max_attempts);
        if (exhausted) {
          await client.query(
            `insert into public.p110_dead_letters
              (tenant_id, dead_letter_id, message_kind, message_ref, correlation_id,
               failure_class, error_code, error_summary, payload_hash, replay_policy)
             values ($1,$2,'OUTBOX',$3,$4,'TRANSIENT_BEFORE_ACK','LEASE_EXPIRED',
                     'Worker lease expired after the bounded attempt budget.',$5,'AFTER_REPAIR')
             on conflict (tenant_id, message_kind, message_ref) do nothing`,
            [input.tenantId, `dead_${crypto.randomUUID()}`, row.outbox_message_id, row.correlation_id, row.payload_hash],
          );
        }
        await client.query(
          `update public.p110_outbox_messages
              set state = $3, not_before = now(), locked_at = null, lock_owner = null,
                  heartbeat_at = null, lease_expires_at = null, request_deadline_at = null,
                  failure_class = 'TRANSIENT_BEFORE_ACK', last_error_code = 'LEASE_EXPIRED',
                  last_error_summary = 'The prior worker lease expired before a terminal checkpoint.',
                  updated_at = now()
            where tenant_id = $1 and outbox_message_id = $2`,
          [input.tenantId, row.outbox_message_id, exhausted ? "DEAD_LETTERED" : "RETRY_SCHEDULED"],
        );
      }

      const claimed = await client.query(
        `with candidates as (
           select outbox.outbox_message_id
             from public.p110_outbox_messages outbox
            where outbox.tenant_id = $1
              and outbox.state in ('PENDING','RETRY_SCHEDULED')
              and outbox.not_before <= now()
              and outbox.attempt_count < outbox.max_attempts
              and not exists (
                select 1 from public.p110_kill_switches switch
                 where switch.tenant_id = outbox.tenant_id and switch.active
                   and (switch.scope_type = 'GLOBAL'
                     or (switch.scope_type = 'DESTINATION' and switch.scope_ref = outbox.destination))
              )
            order by outbox.not_before, outbox.created_at
            for update of outbox skip locked
            limit $2
         ), claimed as (
         update public.p110_outbox_messages outbox
            set state = 'CLAIMED', attempt_count = outbox.attempt_count + 1,
                locked_at = now(), heartbeat_at = now(), lock_owner = $3,
                lease_expires_at = now() + interval '60 seconds',
                request_deadline_at = now() + interval '45 seconds', updated_at = now()
           from candidates
          where outbox.tenant_id = $1 and outbox.outbox_message_id = candidates.outbox_message_id
          returning outbox.*
         )
         select claimed.*, receipt.target_object_type, receipt.target_object_id,
                receipt.expected_object_version,
                receipt.committed_object_version as resulting_object_version
           from claimed
           join public.p110_command_receipts receipt
             on receipt.tenant_id = claimed.tenant_id and receipt.receipt_id = claimed.receipt_id`,
        [input.tenantId, boundedLimit(input.limit), workerId],
      );
      return claimed.rows;
    });
  }

  async heartbeatOutbox(input: { outboxMessageId: string; tenantId: string; workerId: string }) {
    return this.transaction(input.tenantId, async (client) => {
      const result = await client.query(
        `update public.p110_outbox_messages
            set heartbeat_at = now(), lease_expires_at = now() + interval '60 seconds', updated_at = now()
          where tenant_id = $1 and outbox_message_id = $2 and state = 'CLAIMED'
            and lock_owner = $3 and lease_expires_at > now() and request_deadline_at > now()
          returning outbox_message_id, heartbeat_at, lease_expires_at, request_deadline_at`,
        [input.tenantId, input.outboxMessageId, validatedWorkerId(input.workerId)],
      );
      if (result.rows.length !== 1) throw new WorkflowDeliveryStoreError("LEASE_NOT_OWNED", "The outbox lease is absent, expired or owned by another worker.");
      return result.rows[0];
    });
  }

  async recordDispatchStarted(input: {
    adapterContractVersion: string;
    outboxMessageId: string;
    providerMode: "LIVE" | "SANDBOX";
    providerRequestRef: string;
    tenantId: string;
    workerId: string;
  }) {
    return this.transaction(input.tenantId, async (client) => {
      const row = await this.lockOwnedOutbox(client, input);
      await client.query(
        `insert into public.p110_delivery_attempts
          (tenant_id, attempt_id, outbox_message_id, attempt_number, result, started_at,
           adapter_contract_version, provider_mode, provider_request_ref)
         values ($1,$2,$3,$4,'STARTED',now(),$5,$6,$7)`,
        [input.tenantId, `attempt_${crypto.randomUUID()}`, input.outboxMessageId,
          row.attempt_count, input.adapterContractVersion, input.providerMode, input.providerRequestRef],
      );
      await client.query(
        `update public.p110_outbox_messages
            set dispatch_started_at = now(), updated_at = now()
          where tenant_id = $1 and outbox_message_id = $2`,
        [input.tenantId, input.outboxMessageId],
      );
      return { attemptNumber: Number(row.attempt_count), state: "STARTED" as const };
    });
  }

  private async lockOwnedOutbox(client: PoolClient, input: { outboxMessageId: string; tenantId: string; workerId: string }) {
    const result = await client.query(
      `select outbox.*, receipt.correlation_id, receipt.expected_object_version,
              receipt.committed_object_version as resulting_object_version,
              receipt.target_object_type, receipt.target_object_id
         from public.p110_outbox_messages outbox
         join public.p110_command_receipts receipt
           on receipt.tenant_id = outbox.tenant_id and receipt.receipt_id = outbox.receipt_id
        where outbox.tenant_id = $1 and outbox.outbox_message_id = $2
          and outbox.state = 'CLAIMED' and outbox.lock_owner = $3
          and outbox.lease_expires_at > now() and outbox.request_deadline_at > now()
        for update of outbox`,
      [input.tenantId, input.outboxMessageId, validatedWorkerId(input.workerId)],
    );
    if (result.rows.length !== 1) throw new WorkflowDeliveryStoreError("LEASE_NOT_OWNED", "The outbox lease is absent, expired or owned by another worker.");
    return result.rows[0] as Record<string, unknown>;
  }

  async recordProviderAcknowledgement(input: {
    outboxMessageId: string;
    providerAcknowledgementRef: string;
    tenantId: string;
    workerId: string;
  }) {
    if (!input.providerAcknowledgementRef.trim()) throw new WorkflowDeliveryStoreError("ACK_REF_REQUIRED", "Provider acknowledgement reference is required.");
    return this.transaction(input.tenantId, async (client) => {
      const row = await this.lockOwnedOutbox(client, input);
      const attempt = await client.query(
        `update public.p110_delivery_attempts
            set result = 'SUCCEEDED', finished_at = now(), provider_acknowledgement_ref = $4
          where tenant_id = $1 and outbox_message_id = $2 and attempt_number = $3 and result = 'STARTED'
          returning attempt_id`,
        [input.tenantId, input.outboxMessageId, row.attempt_count, input.providerAcknowledgementRef],
      );
      if (attempt.rows.length !== 1) throw new WorkflowDeliveryStoreError("DISPATCH_START_MISSING", "Provider acknowledgement requires a durable dispatch-start attempt.");
      const reconciliationId = `reconcile_${input.outboxMessageId}_${row.attempt_count}`;
      await client.query(
        `insert into public.p110_reconciliation_checkpoints
          (tenant_id, reconciliation_id, receipt_id, outbox_message_id, source_system,
           source_object_ref, expected_object_version, result, checked_at, checked_by, notes)
         values ($1,$2,$3,$4,$5,$6,$7,'PENDING',now(),$8,$9)
         on conflict (tenant_id, reconciliation_id) do nothing`,
        [input.tenantId, reconciliationId, row.receipt_id, input.outboxMessageId,
          row.destination, `${row.target_object_type}:${row.target_object_id}`,
          row.resulting_object_version, input.workerId,
          "Provider acknowledgement recorded; authoritative source readback remains required."],
      );
      await client.query(
        `update public.p110_outbox_messages
            set state = 'PROVIDER_ACKNOWLEDGED', provider_acknowledged_at = now(),
                provider_acknowledgement_ref = $3, locked_at = null, lock_owner = null,
                heartbeat_at = null, lease_expires_at = null, request_deadline_at = null,
                updated_at = now()
          where tenant_id = $1 and outbox_message_id = $2`,
        [input.tenantId, input.outboxMessageId, input.providerAcknowledgementRef],
      );
      return { reconciliationId, state: "PROVIDER_ACKNOWLEDGED" as const };
    });
  }

  async recordOutboxFailure(input: {
    errorCode: string;
    errorSummary: string;
    failureClass: FailureClass;
    outboxMessageId: string;
    retryAfterMs?: number | null;
    tenantId: string;
    workerId: string;
  }) {
    return this.transaction(input.tenantId, async (client) => {
      const row = await this.lockOwnedOutbox(client, input);
      const decision = decideRetry({
        attempt: Number(row.attempt_count),
        failureClass: input.failureClass,
        idempotencyKey: String(row.idempotency_key),
        killSwitchActive: false,
        now: new Date().toISOString(),
        policy: { backoffCoefficient: 2, baseDelayMs: 1_000, maxAttempts: Number(row.max_attempts), maxDelayMs: 900_000 },
        retryAfterMs: input.retryAfterMs,
      });
      const state = decision.action === "RETRY"
        ? "RETRY_SCHEDULED"
        : decision.action === "RECONCILE"
          ? "RECONCILIATION_REQUIRED"
          : decision.action === "BLOCK"
            ? "BLOCKED"
            : "DEAD_LETTERED";
      const attemptResult = decision.action === "RETRY"
        ? "RETRY_SCHEDULED"
        : decision.action === "RECONCILE"
          ? "RECONCILIATION_REQUIRED"
          : decision.action === "BLOCK"
            ? "BLOCKED"
            : "FAILED";
      await client.query(
        `insert into public.p110_delivery_attempts
          (tenant_id, attempt_id, outbox_message_id, attempt_number, failure_class,
           result, started_at, finished_at, retry_at, error_code, error_summary)
         values ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10)
         on conflict (tenant_id, outbox_message_id, attempt_number) do update
           set failure_class = excluded.failure_class, result = excluded.result,
               finished_at = excluded.finished_at, retry_at = excluded.retry_at,
               error_code = excluded.error_code, error_summary = excluded.error_summary`,
        [input.tenantId, `attempt_${crypto.randomUUID()}`, input.outboxMessageId,
          row.attempt_count, input.failureClass, attemptResult, row.locked_at,
          decision.retryAt, input.errorCode, input.errorSummary],
      );
      await client.query(
        `update public.p110_outbox_messages
            set state = $3, not_before = coalesce($4::timestamptz, not_before),
                failure_class = $5, last_error_code = $6, last_error_summary = $7,
                locked_at = null, lock_owner = null, heartbeat_at = null,
                lease_expires_at = null, request_deadline_at = null, updated_at = now()
          where tenant_id = $1 and outbox_message_id = $2`,
        [input.tenantId, input.outboxMessageId, state, decision.retryAt,
          input.failureClass, input.errorCode, input.errorSummary],
      );
      if (decision.action === "RECONCILE") {
        const reconciliationId = `reconcile_${input.outboxMessageId}_${row.attempt_count}`;
        await client.query(
          `insert into public.p110_reconciliation_checkpoints
            (tenant_id, reconciliation_id, receipt_id, outbox_message_id, source_system,
             source_object_ref, expected_object_version, result, checked_at, checked_by, notes)
           values ($1,$2,$3,$4,$5,$6,$7,'PENDING',now(),$8,$9)
           on conflict (tenant_id, reconciliation_id) do nothing`,
          [input.tenantId, reconciliationId, row.receipt_id,
            input.outboxMessageId, row.destination,
            `${row.target_object_type}:${row.target_object_id}`, row.resulting_object_version,
            input.workerId, "Ambiguous provider acknowledgement requires source readback before retry."],
        );
      }
      if (decision.action === "DEAD_LETTER") {
        await client.query(
          `insert into public.p110_dead_letters
            (tenant_id, dead_letter_id, message_kind, message_ref, correlation_id,
             failure_class, error_code, error_summary, payload_hash, replay_policy)
           values ($1,$2,'OUTBOX',$3,$4,$5,$6,$7,$8,'AFTER_REPAIR')
           on conflict (tenant_id, message_kind, message_ref) do nothing`,
          [input.tenantId, `dead_${crypto.randomUUID()}`, input.outboxMessageId,
            row.correlation_id, input.failureClass, input.errorCode,
            input.errorSummary, row.payload_hash],
        );
      }
      return { decision, state };
    });
  }

  async recordReconciliation(input: {
    checkedBy: string;
    notes?: string | null;
    observedObjectVersion?: string | null;
    reconciliationId: string;
    result: "AMBIGUOUS" | "MATCHED" | "NOT_FOUND" | "SOURCE_UNAVAILABLE" | "VERSION_MISMATCH";
    sourceReadbackRef?: string | null;
    tenantId: string;
  }) {
    if (input.result === "MATCHED" && !input.sourceReadbackRef?.trim()) {
      throw new WorkflowDeliveryStoreError("READBACK_REF_REQUIRED", "Matched reconciliation requires source readback evidence.");
    }
    return this.transaction(input.tenantId, async (client) => {
      const checkpoint = await client.query(
        `select * from public.p110_reconciliation_checkpoints
          where tenant_id = $1 and reconciliation_id = $2 and result = 'PENDING' for update`,
        [input.tenantId, input.reconciliationId],
      );
      if (checkpoint.rows.length !== 1) throw new WorkflowDeliveryStoreError("RECONCILIATION_MISSING", "Reconciliation checkpoint was not found.");
      const row = checkpoint.rows[0];
      await client.query(
        `update public.p110_reconciliation_checkpoints
            set result = $3, observed_object_version = $4, source_readback_ref = $5,
                checked_at = now(), checked_by = $6, notes = $7
          where tenant_id = $1 and reconciliation_id = $2`,
        [input.tenantId, input.reconciliationId, input.result,
          input.observedObjectVersion ?? null, input.sourceReadbackRef ?? null,
          input.checkedBy, input.notes ?? null],
      );
      if (input.result === "MATCHED") {
        await client.query(
          `update public.p110_outbox_messages
              set state = 'SOURCE_CONFIRMED', source_confirmed_at = now(),
                  source_readback_ref = $3, updated_at = now()
            where tenant_id = $1 and outbox_message_id = $2`,
          [input.tenantId, row.outbox_message_id, input.sourceReadbackRef],
        );
        await client.query(
          `update public.p110_command_receipts
              set state = 'SOURCE_CONFIRMED', source_confirmed_at = now(),
                  source_readback_ref = $3, updated_at = now()
            where tenant_id = $1 and receipt_id = $2`,
          [input.tenantId, row.receipt_id, input.sourceReadbackRef],
        );
      }
      return { result: input.result, sourceConfirmed: input.result === "MATCHED" };
    });
  }

  async claimDueReconciliations(input: { limit?: number; tenantId: string; workerId: string }) {
    const workerId = validatedWorkerId(input.workerId);
    return this.transaction(input.tenantId, async (client) => {
      await client.query(
        `update public.p110_reconciliation_checkpoints
            set lease_owner = null, lease_started_at = null, heartbeat_at = null,
                lease_expires_at = null, next_check_at = now(),
                notes = 'The prior reconciliation lease expired and was safely released.'
          where tenant_id = $1 and result = 'PENDING' and lease_expires_at <= now()`,
        [input.tenantId],
      );
      const claimed = await client.query(
        `with candidates as (
           select reconciliation_id
             from public.p110_reconciliation_checkpoints
            where tenant_id = $1 and result = 'PENDING' and next_check_at <= now()
              and attempt_count < max_attempts and lease_owner is null
            order by next_check_at, checked_at
            for update skip locked
            limit $2
         ), claimed as (
           update public.p110_reconciliation_checkpoints checkpoint
              set lease_owner = $3, lease_started_at = now(), heartbeat_at = now(),
                  lease_expires_at = now() + interval '60 seconds',
                  attempt_count = checkpoint.attempt_count + 1, checked_by = $3
             from candidates
            where checkpoint.tenant_id = $1 and checkpoint.reconciliation_id = candidates.reconciliation_id
            returning checkpoint.*
         )
         select claimed.*, outbox.destination, outbox.effect_class, outbox.authorization_ref,
                outbox.idempotency_key, outbox.payload, outbox.payload_hash, outbox.attempt_count as delivery_attempt_count,
                outbox.provider_acknowledgement_ref, receipt.target_object_type, receipt.target_object_id,
                receipt.expected_object_version, receipt.committed_object_version as resulting_object_version
           from claimed
           join public.p110_outbox_messages outbox
             on outbox.tenant_id = claimed.tenant_id and outbox.outbox_message_id = claimed.outbox_message_id
           join public.p110_command_receipts receipt
             on receipt.tenant_id = claimed.tenant_id and receipt.receipt_id = claimed.receipt_id`,
        [input.tenantId, boundedLimit(input.limit), workerId],
      );
      return claimed.rows;
    });
  }

  async completeClaimedReconciliation(input: {
    notes?: string | null;
    observedObjectVersion?: string | null;
    reconciliationId: string;
    result: "AMBIGUOUS" | "MATCHED" | "NOT_FOUND" | "SOURCE_UNAVAILABLE" | "VERSION_MISMATCH";
    sourceReadbackRef?: string | null;
    tenantId: string;
    workerId: string;
  }) {
    if (input.result === "MATCHED" && !input.sourceReadbackRef?.trim()) {
      throw new WorkflowDeliveryStoreError("READBACK_REF_REQUIRED", "Matched reconciliation requires source readback evidence.");
    }
    return this.transaction(input.tenantId, async (client) => {
      const checkpoint = await client.query(
        `select checkpoint.*, outbox.attempt_count as delivery_attempt_count,
                outbox.max_attempts as delivery_max_attempts, outbox.idempotency_key,
                outbox.payload_hash, receipt.correlation_id
           from public.p110_reconciliation_checkpoints checkpoint
           join public.p110_outbox_messages outbox
             on outbox.tenant_id = checkpoint.tenant_id and outbox.outbox_message_id = checkpoint.outbox_message_id
           join public.p110_command_receipts receipt
             on receipt.tenant_id = checkpoint.tenant_id and receipt.receipt_id = checkpoint.receipt_id
          where checkpoint.tenant_id = $1 and checkpoint.reconciliation_id = $2
            and checkpoint.result = 'PENDING' and checkpoint.lease_owner = $3
            and checkpoint.lease_expires_at > now()
          for update of checkpoint, outbox`,
        [input.tenantId, input.reconciliationId, validatedWorkerId(input.workerId)],
      );
      if (checkpoint.rows.length !== 1) throw new WorkflowDeliveryStoreError("RECONCILIATION_LEASE_NOT_OWNED", "The reconciliation lease is absent, expired or owned by another worker.");
      const row = checkpoint.rows[0];
      if (input.result === "MATCHED" && input.observedObjectVersion !== row.expected_object_version) {
        throw new WorkflowDeliveryStoreError("READBACK_VERSION_MISMATCH", "Matched source readback must equal the exact expected object version.");
      }
      const pendingAgain = ["AMBIGUOUS", "SOURCE_UNAVAILABLE"].includes(input.result) && Number(row.attempt_count) < Number(row.max_attempts);
      const recordedResult = pendingAgain ? "PENDING" : input.result;
      const nextCheckAt = pendingAgain
        ? new Date(Date.now() + Math.min(900_000, 1_000 * 2 ** Math.max(0, Number(row.attempt_count) - 1))).toISOString()
        : null;
      await client.query(
        `update public.p110_reconciliation_checkpoints
            set result = $4, observed_object_version = $5, source_readback_ref = $6,
                checked_at = now(), checked_by = $3, notes = $7,
                lease_owner = null, lease_started_at = null, heartbeat_at = null,
                lease_expires_at = null, next_check_at = coalesce($8::timestamptz, next_check_at)
          where tenant_id = $1 and reconciliation_id = $2`,
        [input.tenantId, input.reconciliationId, input.workerId, recordedResult,
          input.observedObjectVersion ?? null, input.sourceReadbackRef ?? null,
          input.notes ?? null, nextCheckAt],
      );
      if (input.result === "MATCHED") {
        await client.query(
          `update public.p110_outbox_messages
              set state = 'SOURCE_CONFIRMED', source_confirmed_at = now(),
                  source_readback_ref = $3, updated_at = now()
            where tenant_id = $1 and outbox_message_id = $2`,
          [input.tenantId, row.outbox_message_id, input.sourceReadbackRef],
        );
        await client.query(
          `update public.p110_command_receipts
              set state = 'SOURCE_CONFIRMED', source_confirmed_at = now(),
                  source_readback_ref = $3, updated_at = now()
            where tenant_id = $1 and receipt_id = $2`,
          [input.tenantId, row.receipt_id, input.sourceReadbackRef],
        );
        await client.query(
          `update public.p110_delivery_attempts
              set source_readback_ref = $4
            where tenant_id = $1 and outbox_message_id = $2 and attempt_number = $3`,
          [input.tenantId, row.outbox_message_id, row.delivery_attempt_count, input.sourceReadbackRef],
        );
      } else if (input.result === "NOT_FOUND") {
        const exhausted = Number(row.delivery_attempt_count) >= Number(row.delivery_max_attempts);
        if (exhausted) {
          await client.query(
            `insert into public.p110_dead_letters
              (tenant_id, dead_letter_id, message_kind, message_ref, correlation_id,
               failure_class, error_code, error_summary, payload_hash, replay_policy)
             values ($1,$2,'OUTBOX',$3,$4,'PERMANENT','RECONCILIATION_RETRY_EXHAUSTED',
                     'Authoritative source readback proved absence after the delivery retry budget was exhausted.',$5,'OPERATOR_ONLY')
             on conflict (tenant_id, message_kind, message_ref) do nothing`,
            [input.tenantId, `dead_${crypto.randomUUID()}`, row.outbox_message_id, row.correlation_id, row.payload_hash],
          );
        }
        await client.query(
          `update public.p110_outbox_messages
              set state = $3, not_before = now(), updated_at = now(),
                  failure_class = case when $3 = 'DEAD_LETTERED' then 'PERMANENT' else 'TRANSIENT_BEFORE_ACK' end,
                  last_error_code = case when $3 = 'DEAD_LETTERED' then 'RECONCILIATION_RETRY_EXHAUSTED' else 'SOURCE_CONFIRMED_ABSENT' end,
                  last_error_summary = 'Authoritative source readback proved absence after an ambiguous attempt.'
            where tenant_id = $1 and outbox_message_id = $2`,
          [input.tenantId, row.outbox_message_id, exhausted ? "DEAD_LETTERED" : "RETRY_SCHEDULED"],
        );
      } else if (input.result === "VERSION_MISMATCH" || (!pendingAgain && ["AMBIGUOUS", "SOURCE_UNAVAILABLE"].includes(input.result))) {
        await client.query(
          `update public.p110_outbox_messages
              set state = 'BLOCKED', failure_class = 'POLICY_BLOCKED',
                  last_error_code = $3,
                  last_error_summary = 'Provider reconciliation could not establish the exact expected source version.',
                  updated_at = now()
            where tenant_id = $1 and outbox_message_id = $2`,
          [input.tenantId, row.outbox_message_id,
            input.result === "VERSION_MISMATCH" ? "SOURCE_VERSION_MISMATCH" : "RECONCILIATION_BUDGET_EXHAUSTED"],
        );
      }
      return { pending: pendingAgain, result: input.result, sourceConfirmed: input.result === "MATCHED" };
    });
  }

  async readProviderOperations(input: { tenantId: string }) {
    return this.transaction(input.tenantId, async (client) => {
      const outbox = await client.query(
          `select destination, state, count(*)::int as count, max(updated_at) as latest_at
             from public.p110_outbox_messages where tenant_id = $1
            group by destination, state order by destination, state`,
          [input.tenantId],
        );
      const reconciliation = await client.query(
          `select result, count(*)::int as count, max(checked_at) as latest_at
             from public.p110_reconciliation_checkpoints where tenant_id = $1
            group by result order by result`,
          [input.tenantId],
        );
      const deadLetters = await client.query(
          `select count(*)::int as count from public.p110_dead_letters
            where tenant_id = $1 and state in ('OPEN','UNDER_REVIEW','QUARANTINED')`,
          [input.tenantId],
        );
      const killSwitches = await client.query(
          `select scope_type, scope_ref, reason, activated_at
             from public.p110_kill_switches where tenant_id = $1 and active
            order by scope_type, scope_ref`,
          [input.tenantId],
        );
      return {
        contractVersion: WORKFLOW_DELIVERY_CONTRACT_VERSION,
        deadLetterCount: Number(deadLetters.rows[0]?.count ?? 0),
        destinations: outbox.rows.map((row) => ({ count: Number(row.count), destination: String(row.destination), latestAt: row.latest_at ? new Date(row.latest_at).toISOString() : null, state: String(row.state) })),
        killSwitches: killSwitches.rows.map((row) => ({ activatedAt: new Date(row.activated_at).toISOString(), reason: String(row.reason), scopeRef: String(row.scope_ref), scopeType: String(row.scope_type) })),
        reconciliations: reconciliation.rows.map((row) => ({ count: Number(row.count), latestAt: row.latest_at ? new Date(row.latest_at).toISOString() : null, result: String(row.result) })),
      };
    });
  }

  async acceptInbox(input: {
    correlationId: string;
    eventType: string;
    inboxMessageId: string;
    payload: Record<string, unknown>;
    payloadHash: string;
    producer: string;
    producerMessageId: string;
    tenantId: string;
  }) {
    return this.transaction(input.tenantId, async (client) => {
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':' || $3, 0))",
        [input.tenantId, input.producer, input.producerMessageId],
      );
      const existing = await client.query(
        `select inbox_message_id, payload_hash, state from public.p110_inbox_messages
          where tenant_id = $1 and producer = $2 and producer_message_id = $3 for update`,
        [input.tenantId, input.producer, input.producerMessageId],
      );
      if (existing.rows.length === 1) {
        if (existing.rows[0].payload_hash !== input.payloadHash) {
          throw new WorkflowDeliveryStoreError("INBOX_PAYLOAD_CONFLICT", "Producer message ID was reused with a different payload hash.");
        }
        return { duplicate: true, inboxMessageId: existing.rows[0].inbox_message_id, state: existing.rows[0].state };
      }
      await client.query(
        `insert into public.p110_inbox_messages
          (tenant_id, inbox_message_id, producer, producer_message_id, event_type,
           correlation_id, payload_hash, payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [input.tenantId, input.inboxMessageId, input.producer, input.producerMessageId,
          input.eventType, input.correlationId, input.payloadHash, JSON.stringify(input.payload)],
      );
      return { duplicate: false, inboxMessageId: input.inboxMessageId, state: "RECEIVED" as const };
    });
  }

  async claimDueInbox(input: { limit?: number; tenantId: string; workerId: string }) {
    const workerId = validatedWorkerId(input.workerId);
    return this.transaction(input.tenantId, async (client) => {
      await client.query(
        `update public.p110_inbox_messages
            set state = 'RECEIVED', lease_owner = null, lease_started_at = null,
                heartbeat_at = null, lease_expires_at = null,
                last_error_code = 'LEASE_EXPIRED'
          where tenant_id = $1 and state = 'PROCESSING' and lease_expires_at <= now()`,
        [input.tenantId],
      );
      const claimed = await client.query(
        `with candidates as (
           select inbox_message_id from public.p110_inbox_messages
            where tenant_id = $1 and state = 'RECEIVED'
            order by received_at
            for update skip locked
            limit $2
         )
         update public.p110_inbox_messages inbox
            set state = 'PROCESSING', lease_owner = $3, lease_started_at = now(),
                heartbeat_at = now(), lease_expires_at = now() + interval '60 seconds'
           from candidates
          where inbox.tenant_id = $1 and inbox.inbox_message_id = candidates.inbox_message_id
          returning inbox.*`,
        [input.tenantId, boundedLimit(input.limit), workerId],
      );
      return claimed.rows;
    });
  }

  async completeInbox(input: { inboxMessageId: string; receiptId: string; tenantId: string; workerId: string }) {
    return this.transaction(input.tenantId, async (client) => {
      const result = await client.query(
        `update public.p110_inbox_messages
            set state = 'PROCESSED', processed_at = now(), receipt_id = $4,
                lease_owner = null, lease_started_at = null, heartbeat_at = null,
                lease_expires_at = null
          where tenant_id = $1 and inbox_message_id = $2 and state = 'PROCESSING'
            and lease_owner = $3 and lease_expires_at > now()
          returning inbox_message_id, state, processed_at, receipt_id`,
        [input.tenantId, input.inboxMessageId, validatedWorkerId(input.workerId), input.receiptId],
      );
      if (result.rows.length !== 1) throw new WorkflowDeliveryStoreError("LEASE_NOT_OWNED", "The inbox lease is absent, expired or owned by another worker.");
      return result.rows[0];
    });
  }

  async deadLetterInbox(input: { errorCode: string; errorSummary: string; inboxMessageId: string; tenantId: string; workerId: string }) {
    return this.transaction(input.tenantId, async (client) => {
      const inbox = await client.query(
        `select * from public.p110_inbox_messages
          where tenant_id = $1 and inbox_message_id = $2 and state = 'PROCESSING'
            and lease_owner = $3 and lease_expires_at > now()
          for update`,
        [input.tenantId, input.inboxMessageId, validatedWorkerId(input.workerId)],
      );
      if (inbox.rows.length !== 1) throw new WorkflowDeliveryStoreError("LEASE_NOT_OWNED", "The inbox lease is absent, expired or owned by another worker.");
      const row = inbox.rows[0];
      await client.query(
        `insert into public.p110_dead_letters
          (tenant_id, dead_letter_id, message_kind, message_ref, correlation_id,
           failure_class, error_code, error_summary, payload_hash, replay_policy)
         values ($1,$2,'INBOX',$3,$4,'PERMANENT',$5,$6,$7,'AFTER_REPAIR')
         on conflict (tenant_id, message_kind, message_ref) do nothing`,
        [input.tenantId, `dead_${crypto.randomUUID()}`, input.inboxMessageId,
          row.correlation_id, input.errorCode, input.errorSummary, row.payload_hash],
      );
      await client.query(
        `update public.p110_inbox_messages
            set state = 'DEAD_LETTERED', last_error_code = $3,
                lease_owner = null, lease_started_at = null, heartbeat_at = null,
                lease_expires_at = null
          where tenant_id = $1 and inbox_message_id = $2`,
        [input.tenantId, input.inboxMessageId, input.errorCode],
      );
      return { state: "DEAD_LETTERED" as const };
    });
  }

  async claimDueTimers(input: { limit?: number; tenantId: string; workerId: string }) {
    const workerId = validatedWorkerId(input.workerId);
    return this.transaction(input.tenantId, async (client) => {
      await client.query(
        `update public.p111_workflow_timers
            set state = 'SCHEDULED', lease_owner = null, lease_started_at = null,
                heartbeat_at = null, lease_expires_at = null
          where tenant_id = $1 and state = 'CLAIMED' and lease_expires_at <= now()`,
        [input.tenantId],
      );
      const claimed = await client.query(
        `with candidates as (
           select timer_id from public.p111_workflow_timers
            where tenant_id = $1 and state = 'SCHEDULED' and fire_at <= now()
            order by fire_at
            for update skip locked
            limit $2
         )
         update public.p111_workflow_timers timer
            set state = 'CLAIMED', lease_owner = $3, lease_started_at = now(),
                heartbeat_at = now(), lease_expires_at = now() + interval '60 seconds'
           from candidates
          where timer.tenant_id = $1 and timer.timer_id = candidates.timer_id
          returning timer.*`,
        [input.tenantId, boundedLimit(input.limit), workerId],
      );
      return claimed.rows;
    });
  }

  async fireTimer(input: { tenantId: string; timerId: string; workerId: string }) {
    return this.transaction(input.tenantId, async (client) => {
      const result = await client.query(
        `update public.p111_workflow_timers
            set state = 'FIRED', fired_at = now(), lease_owner = null,
                lease_started_at = null, heartbeat_at = null, lease_expires_at = null
          where tenant_id = $1 and timer_id = $2 and state = 'CLAIMED'
            and lease_owner = $3 and lease_expires_at > now()
          returning timer_id, flow_id, checkpoint_id, fired_at`,
        [input.tenantId, input.timerId, validatedWorkerId(input.workerId)],
      );
      if (result.rows.length !== 1) throw new WorkflowDeliveryStoreError("LEASE_NOT_OWNED", "The timer lease is absent, expired or owned by another worker.");
      return result.rows[0];
    });
  }

  async transitionWorkflow(input: {
    commandType: FlowCommandType;
    expectedStateVersion: number;
    flowId: string;
    tenantId: string;
  }) {
    return this.transaction(input.tenantId, async (client) => {
      const flow = await client.query(
        `select state, state_version from public.p111_workflow_instances
          where tenant_id = $1 and flow_id = $2 for update`,
        [input.tenantId, input.flowId],
      );
      if (flow.rows.length !== 1) throw new WorkflowDeliveryStoreError("FLOW_MISSING", "Workflow instance was not found.");
      if (Number(flow.rows[0].state_version) !== input.expectedStateVersion) {
        throw new WorkflowDeliveryStoreError("STALE_FLOW_VERSION", "Workflow state version is stale.");
      }
      const killSwitch = await client.query(
        `select exists (
           select 1 from public.p110_kill_switches
            where tenant_id = $1 and active and scope_type = 'GLOBAL'
         ) as active`,
        [input.tenantId],
      );
      const nextState = nextWorkflowState({
        commandType: input.commandType,
        currentState: flow.rows[0].state as WorkflowState,
        killSwitchActive: Boolean(killSwitch.rows[0]?.active),
      });
      const terminal = ["COMPLETED", "CANCELLED", "SUPERSEDED"].includes(nextState);
      const updated = await client.query(
        `update public.p111_workflow_instances
            set state = $4, state_version = state_version + 1,
                started_at = case when $4 = 'RUNNING' then coalesce(started_at, now()) else started_at end,
                completed_at = case when $5 then now() else completed_at end,
                last_transition_at = now(), updated_at = now()
          where tenant_id = $1 and flow_id = $2 and state_version = $3
          returning state, state_version, last_transition_at`,
        [input.tenantId, input.flowId, input.expectedStateVersion, nextState, terminal],
      );
      if (updated.rows.length !== 1) throw new WorkflowDeliveryStoreError("STALE_FLOW_VERSION", "Workflow state changed concurrently.");
      return updated.rows[0];
    });
  }
}
