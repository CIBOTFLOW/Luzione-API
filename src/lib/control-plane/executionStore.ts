import "server-only";

import crypto from "node:crypto";
import type { PoolClient } from "pg";

import { databasePool } from "@/lib/db";
import {
  EXECUTION_LEASE_MS,
  durableRetryDecision,
} from "@/modules/control-plane/durableExecution";
import type { Money } from "@/modules/control-plane/types";
import type { FailureClass } from "@/modules/platform-guarantees/types";

const WORKER_PATTERN = /^[A-Za-z0-9._:@-]{1,190}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ExecutionStoreError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
  }
}

function workerId(value: string) {
  if (!WORKER_PATTERN.test(value)) throw new ExecutionStoreError("WORKER_ID_INVALID", "workerId is invalid.", 400);
  return value;
}

function executionStepId(value: string) {
  if (!UUID_PATTERN.test(value)) throw new ExecutionStoreError("EXECUTION_STEP_ID_INVALID", "executionStepId is invalid.", 400);
  return value;
}

function boundedLimit(value: number) {
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 50)) : 10;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimDueExecutionSteps(input: { limit?: number; workerId: string }) {
  const owner = workerId(input.workerId);
  return transaction(async (client) => {
    await client.query(
      `update public.platform_execution_steps
       set state = case when attempt_count >= max_attempts then 'DEAD_LETTERED' else 'RETRY_SCHEDULED' end,
           not_before = now(), lease_owner = null, leased_at = null, lease_expires_at = null,
           heartbeat_at = null, request_deadline_at = null,
           last_error_code = 'LEASE_EXPIRED',
           last_error_summary = 'The prior worker lease expired before a terminal checkpoint.',
           updated_at = now()
       where state = 'LEASED' and lease_expires_at <= now()`
    );
    const claimed = await client.query(
      `with candidates as (
         select step.execution_step_id
         from public.platform_execution_steps step
         where step.state in ('PENDING','RETRY_SCHEDULED')
           and step.not_before <= now()
           and step.attempt_count < step.max_attempts
           and not exists (
             select 1 from public.p110_kill_switches switch
             where switch.active
               and switch.canonical_tenant_id = step.tenant_id
               and (
                 switch.scope_type = 'GLOBAL'
                 or (switch.scope_type = 'PROVIDER' and switch.scope_ref = step.provider)
                 or (switch.scope_type = 'CAPABILITY' and switch.scope_ref = step.capability)
                 or (switch.scope_type = 'CONNECTION' and switch.scope_ref = coalesce(step.connection_id::text, ''))
               )
           )
           and not exists (
             select 1 from public.integration_circuit_breakers circuit
             where circuit.tenant_id = step.tenant_id
               and circuit.provider = step.provider
               and circuit.capability = step.capability
               and circuit.connection_id is not distinct from step.connection_id
               and circuit.state = 'OPEN'
               and circuit.half_open_at > now()
           )
         order by step.not_before, step.created_at
         for update skip locked
         limit $1
       )
       update public.platform_execution_steps step
       set state = 'LEASED', attempt_count = step.attempt_count + 1,
           lease_owner = $2, leased_at = now(), heartbeat_at = now(),
           lease_expires_at = now() + interval '60 seconds',
           request_deadline_at = now() + interval '45 seconds', updated_at = now()
       from candidates
       where step.execution_step_id = candidates.execution_step_id
       returning step.*`,
      [boundedLimit(input.limit ?? 10), owner],
    );
    return claimed.rows;
  });
}

export async function heartbeatExecutionStep(input: { executionStepId: string; workerId: string }) {
  const result = await databasePool().query(
    `update public.platform_execution_steps
     set heartbeat_at = now(), lease_expires_at = now() + interval '60 seconds', updated_at = now()
     where execution_step_id = $1 and state = 'LEASED' and lease_owner = $2
       and lease_expires_at > now() and request_deadline_at > now()
     returning execution_step_id, lease_expires_at, request_deadline_at`,
    [executionStepId(input.executionStepId), workerId(input.workerId)],
  );
  if (result.rows.length !== 1) {
    throw new ExecutionStoreError("LEASE_NOT_OWNED", "The execution lease is missing, expired, timed out, or owned by another worker.");
  }
  return result.rows[0];
}

async function lockOwnedStep(client: PoolClient, input: { executionStepId: string; workerId: string }) {
  const result = await client.query(
    `select * from public.platform_execution_steps
     where execution_step_id = $1 and state = 'LEASED' and lease_owner = $2
       and lease_expires_at > now() and request_deadline_at > now()
     for update`,
    [executionStepId(input.executionStepId), workerId(input.workerId)],
  );
  if (result.rows.length !== 1) {
    throw new ExecutionStoreError("LEASE_NOT_OWNED", "The execution lease is missing, expired, timed out, or owned by another worker.");
  }
  return result.rows[0] as Record<string, unknown>;
}

export async function completeProviderRequestStep(input: {
  executionStepId: string;
  output: Record<string, unknown>;
  providerRequestRef: string;
  workerId: string;
}) {
  if (!input.providerRequestRef.trim()) throw new ExecutionStoreError("PROVIDER_REQUEST_REF_REQUIRED", "Provider request evidence is required.", 400);
  return transaction(async (client) => {
    const step = await lockOwnedStep(client, input);
    if (step.step_kind !== "PROVIDER_REQUEST") {
      throw new ExecutionStoreError("EXECUTION_STEP_KIND_MISMATCH", "Only a provider request step can create the readback checkpoint.");
    }
    const outputDigest = digest(input.output);
    await client.query(
      `update public.platform_execution_steps
       set state = 'COMPLETED', output_digest = $3, provider_request_ref = $4,
           completed_at = now(), lease_owner = null, leased_at = null,
           lease_expires_at = null, heartbeat_at = null, request_deadline_at = null,
           updated_at = now()
       where execution_step_id = $1 and lease_owner = $2`,
      [input.executionStepId, input.workerId, outputDigest, input.providerRequestRef],
    );
    const readbackStepId = crypto.randomUUID();
    await client.query(
      `insert into public.platform_execution_steps
        (execution_step_id, tenant_id, legacy_tenant_id, command_id, receipt_id,
         connection_id, provider, capability, step_kind, step_sequence, state,
         idempotency_key, input_digest, provider_request_ref)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'PROVIDER_READBACK',$9,'PENDING',$10,$11,$12)`,
      [
        readbackStepId,
        step.tenant_id,
        step.legacy_tenant_id,
        step.command_id,
        step.receipt_id,
        step.connection_id,
        step.provider,
        step.capability,
        Number(step.step_sequence) + 1,
        `${step.idempotency_key}:provider-readback`,
        outputDigest,
        input.providerRequestRef,
      ],
    );
    return { outputDigest, readbackStepId };
  });
}

export async function completeProviderReadbackStep(input: {
  actualCost?: Money;
  adapterVersion: string;
  executionStepId: string;
  normalizedOutcome: Record<string, unknown>;
  providerReadback: Record<string, unknown>;
  sourceReadbackRef: string;
  workerIdentityId: string;
  workerId: string;
}) {
  if (!input.sourceReadbackRef.trim()) throw new ExecutionStoreError("SOURCE_READBACK_REQUIRED", "Provider readback evidence is required.", 400);
  return transaction(async (client) => {
    const step = await lockOwnedStep(client, input);
    if (step.step_kind !== "PROVIDER_READBACK" || typeof step.provider_request_ref !== "string") {
      throw new ExecutionStoreError("EXECUTION_STEP_KIND_MISMATCH", "Only a provider readback step can create an effect receipt.");
    }
    const receipt = await client.query(
      `select authority_contract_version, correlation_id
       from public.p110_command_receipts
       where tenant_id = $1 and receipt_id = $2
       for update`,
      [step.legacy_tenant_id, step.receipt_id],
    );
    if (receipt.rows.length !== 1) throw new ExecutionStoreError("COMMAND_RECEIPT_MISSING", "The canonical command receipt is missing.");
    const outputDigest = digest({ normalizedOutcome: input.normalizedOutcome, providerReadback: input.providerReadback });
    const auditEventId = crypto.randomUUID();
    const effectReceiptId = crypto.randomUUID();
    await client.query(
      `update public.platform_execution_steps
       set state = 'COMPLETED', output_digest = $3, source_readback_ref = $4,
           completed_at = now(), lease_owner = null, leased_at = null,
           lease_expires_at = null, heartbeat_at = null, request_deadline_at = null,
           updated_at = now()
       where execution_step_id = $1 and lease_owner = $2`,
      [input.executionStepId, input.workerId, outputDigest, input.sourceReadbackRef],
    );
    await client.query(
      `insert into public.platform_audit_events
        (audit_event_id, tenant_id, identity_id, event_type, command_id,
         execution_step_id, correlation_id, payload_digest, evidence)
       values ($1,$2,$3,'provider.readback_verified',$4,$5,$6,$7,$8::jsonb)`,
      [
        auditEventId,
        step.tenant_id,
        input.workerIdentityId,
        step.command_id,
        input.executionStepId,
        receipt.rows[0].correlation_id,
        outputDigest,
        JSON.stringify({ adapterVersion: input.adapterVersion, sourceReadbackRef: input.sourceReadbackRef }),
      ],
    );
    await client.query(
      `insert into public.platform_effect_receipts
        (effect_receipt_id, tenant_id, command_id, execution_step_id, connection_id,
         provider, capability, authority_contract_version, normalized_outcome,
         provider_readback, provider_request_ref, source_readback_ref, actual_cost,
         adapter_version, audit_event_id, correlation_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16)`,
      [
        effectReceiptId,
        step.tenant_id,
        step.command_id,
        input.executionStepId,
        step.connection_id,
        step.provider,
        step.capability,
        receipt.rows[0].authority_contract_version,
        JSON.stringify(input.normalizedOutcome),
        JSON.stringify(input.providerReadback),
        step.provider_request_ref,
        input.sourceReadbackRef,
        input.actualCost ? JSON.stringify(input.actualCost) : null,
        input.adapterVersion,
        auditEventId,
        receipt.rows[0].correlation_id,
      ],
    );
    await client.query(
      `update public.p110_command_receipts
       set state = 'SOURCE_CONFIRMED', source_confirmed_at = now(),
           source_readback_ref = $3, actual_cost = $4::jsonb, updated_at = now()
       where tenant_id = $1 and receipt_id = $2`,
      [
        step.legacy_tenant_id,
        step.receipt_id,
        input.sourceReadbackRef,
        input.actualCost ? JSON.stringify(input.actualCost) : null,
      ],
    );
    return {
      actualCost: input.actualCost ?? null,
      adapterVersion: input.adapterVersion,
      auditReference: `audit:${auditEventId}`,
      commandState: "SOURCE_CONFIRMED" as const,
      correlationId: receipt.rows[0].correlation_id,
      effectReceiptId,
      normalizedOutcome: input.normalizedOutcome,
      providerReadback: input.providerReadback,
    };
  });
}

export async function failExecutionStep(input: {
  errorCode: string;
  errorSummary: string;
  executionStepId: string;
  failureClass: FailureClass;
  retryAfterMs?: number | null;
  workerId: string;
}) {
  return transaction(async (client) => {
    const step = await lockOwnedStep(client, input);
    const decision = durableRetryDecision({
      attempt: Number(step.attempt_count),
      failureClass: input.failureClass,
      idempotencyKey: String(step.idempotency_key),
      now: new Date().toISOString(),
      retryAfterMs: input.retryAfterMs,
    });
    const state = decision.action === "RETRY"
      ? "RETRY_SCHEDULED"
      : decision.action === "RECONCILE"
        ? "FAILED"
        : "DEAD_LETTERED";
    await client.query(
      `update public.platform_execution_steps
       set state = $3, not_before = coalesce($4::timestamptz, not_before),
           last_error_code = $5, last_error_summary = $6,
           lease_owner = null, leased_at = null, lease_expires_at = null,
           heartbeat_at = null, request_deadline_at = null, updated_at = now()
       where execution_step_id = $1 and lease_owner = $2`,
      [input.executionStepId, input.workerId, state, decision.retryAt, input.errorCode, input.errorSummary],
    );
    if (decision.action === "RECONCILE") {
      await client.query(
        `insert into public.platform_execution_steps
          (tenant_id, legacy_tenant_id, command_id, receipt_id, connection_id,
           provider, capability, step_kind, step_sequence, state, idempotency_key, input_digest)
         values ($1,$2,$3,$4,$5,$6,$7,'RECONCILIATION',$8,'PENDING',$9,$10)`,
        [
          step.tenant_id,
          step.legacy_tenant_id,
          step.command_id,
          step.receipt_id,
          step.connection_id,
          step.provider,
          step.capability,
          Number(step.step_sequence) + 1,
          `${step.idempotency_key}:reconciliation`,
          step.input_digest,
        ],
      );
    }
    if (decision.action === "DEAD_LETTER") {
      await client.query(
        `insert into public.p110_dead_letters
          (tenant_id, dead_letter_id, message_kind, message_ref, correlation_id,
           failure_class, error_code, error_summary, payload_hash, replay_policy)
         select $1, $2, 'OUTBOX', $3, receipt.correlation_id, $4, $5, $6, $7, 'AFTER_REPAIR'
         from public.p110_command_receipts receipt
         where receipt.tenant_id = $1 and receipt.receipt_id = $8
         on conflict (tenant_id, message_kind, message_ref) do nothing`,
        [
          step.legacy_tenant_id,
          `dead:${crypto.randomUUID()}`,
          input.executionStepId,
          input.failureClass,
          input.errorCode,
          input.errorSummary,
          step.input_digest,
          step.receipt_id,
        ],
      );
    }
    if (["RATE_LIMITED", "TRANSIENT_BEFORE_ACK"].includes(input.failureClass)) {
      const circuitKey = `connection:${step.connection_id ?? "none"}/capability:${step.capability}`;
      await client.query(
        `insert into public.integration_circuit_breakers
          (tenant_id, circuit_key, provider, connection_id, capability,
           transient_failure_count, failure_window_started_at, last_failure_at)
         values ($1,$2,$3,$4,$5,1,now(),now())
         on conflict (tenant_id, circuit_key) do update set
           transient_failure_count = case
             when integration_circuit_breakers.failure_window_started_at < now() - interval '60 seconds' then 1
             else least(5, integration_circuit_breakers.transient_failure_count + 1)
           end,
           failure_window_started_at = case
             when integration_circuit_breakers.failure_window_started_at < now() - interval '60 seconds' then now()
             else integration_circuit_breakers.failure_window_started_at
           end,
           last_failure_at = now(),
           state = case
             when integration_circuit_breakers.failure_window_started_at >= now() - interval '60 seconds'
              and integration_circuit_breakers.transient_failure_count + 1 >= 5 then 'OPEN'
             else 'CLOSED'
           end,
           opened_at = case
             when integration_circuit_breakers.failure_window_started_at >= now() - interval '60 seconds'
              and integration_circuit_breakers.transient_failure_count + 1 >= 5 then now()
             else null
           end,
           half_open_at = case
             when integration_circuit_breakers.failure_window_started_at >= now() - interval '60 seconds'
              and integration_circuit_breakers.transient_failure_count + 1 >= 5 then now() + interval '5 minutes'
             else null
           end,
           updated_at = now()`,
        [step.tenant_id, circuitKey, step.provider, step.connection_id, step.capability],
      );
    }
    return decision;
  });
}

export function executionRuntimeConstants() {
  return { leaseMs: EXECUTION_LEASE_MS };
}
