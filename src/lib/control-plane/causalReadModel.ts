import "server-only";

import { databasePool } from "@/lib/db";
import type { CanonicalActor } from "@/lib/control-plane/actor";
import { ControlPlaneStoreError } from "@/lib/control-plane/store";

export const LUZIONE_CAUSAL_RECEIPT_V1 = "luzione-causal-receipt/v1" as const;

type CommandRow = {
  receipt_id: string;
  command_id: string;
  command_type: string;
  correlation_id: string;
  state: string;
  requested_at: Date | string;
  committed_at: Date | string | null;
  source_confirmed_at: Date | string | null;
  source_readback_ref: string | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  authority_contract_version: string;
  authority_class: string;
  capability: string;
  policy_decision_id: string;
  approval_id: string | null;
};

type StepRow = {
  execution_step_id: string;
  step_kind: string;
  step_sequence: number;
  state: string;
  provider: string;
  capability: string;
  provider_request_ref: string | null;
  source_readback_ref: string | null;
  attempt_count: number;
  max_attempts: number;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

type AuditRow = {
  audit_event_id: string;
  event_type: string;
  execution_step_id: string | null;
  correlation_id: string;
  occurred_at: Date | string;
};

type EffectRow = {
  effect_receipt_id: string;
  execution_step_id: string;
  provider: string;
  capability: string;
  authority_contract_version: string;
  provider_request_ref: string;
  source_readback_ref: string;
  actual_cost: unknown;
  adapter_version: string;
  correlation_id: string;
  created_at: Date | string;
};

function timestamp(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export async function getCommandCausalReceipt(actor: CanonicalActor, commandId: string) {
  const client = await databasePool().connect();
  try {
    await client.query("begin read only");
    const commandResult = await client.query<CommandRow>(
      `select receipt_id, command_id, command_type, correlation_id, state,
              requested_at, committed_at, source_confirmed_at, source_readback_ref,
              last_error_code, last_error_summary, authority_contract_version,
              authority_class, capability, policy_decision_id, approval_id
       from public.p110_command_receipts
       where canonical_tenant_id = $1 and command_id = $2`,
      [actor.tenantId, commandId],
    );
    if (commandResult.rows.length !== 1) {
      throw new ControlPlaneStoreError("COMMAND_NOT_FOUND", "Command not found for the active tenant.", 404);
    }

    const [stepsResult, auditResult, effectResult] = await Promise.all([
      client.query<StepRow>(
        `select execution_step_id::text, step_kind, step_sequence, state, provider, capability,
                provider_request_ref, source_readback_ref, attempt_count, max_attempts,
                last_error_code, last_error_summary, created_at, updated_at, completed_at
         from public.platform_execution_steps
         where tenant_id = $1 and command_id = $2
         order by step_sequence asc, created_at asc`,
        [actor.tenantId, commandId],
      ),
      client.query<AuditRow>(
        `select audit_event_id::text, event_type, execution_step_id::text,
                correlation_id, occurred_at
         from public.platform_audit_events
         where tenant_id = $1 and command_id = $2
         order by occurred_at asc, audit_event_id asc`,
        [actor.tenantId, commandId],
      ),
      client.query<EffectRow>(
        `select effect_receipt_id::text, execution_step_id::text, provider, capability,
                authority_contract_version, provider_request_ref, source_readback_ref,
                actual_cost, adapter_version, correlation_id, created_at
         from public.platform_effect_receipts
         where tenant_id = $1 and command_id = $2
         order by created_at asc`,
        [actor.tenantId, commandId],
      ),
    ]);
    await client.query("commit");

    const command = commandResult.rows[0];
    const steps = stepsResult.rows.map((row) => ({
      executionStepId: row.execution_step_id,
      stepKind: row.step_kind,
      stepSequence: row.step_sequence,
      state: row.state,
      provider: row.provider,
      capability: row.capability,
      providerRequestRef: row.provider_request_ref,
      sourceReadbackRef: row.source_readback_ref,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      failure: row.last_error_code
        ? { code: row.last_error_code, summary: row.last_error_summary }
        : null,
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
      completedAt: timestamp(row.completed_at),
    }));
    const effectReceipts = effectResult.rows.map((row) => ({
      effectReceiptId: row.effect_receipt_id,
      executionStepId: row.execution_step_id,
      provider: row.provider,
      capability: row.capability,
      authorityContractVersion: row.authority_contract_version,
      providerRequestRef: row.provider_request_ref,
      sourceReadbackRef: row.source_readback_ref,
      actualCost: row.actual_cost,
      adapterVersion: row.adapter_version,
      correlationId: row.correlation_id,
      createdAt: timestamp(row.created_at),
    }));

    const providerAcknowledged = steps.some((step) => Boolean(step.providerRequestRef));
    const sourceReadbackConfirmed = Boolean(command.source_readback_ref)
      || steps.some((step) => Boolean(step.sourceReadbackRef))
      || effectReceipts.some((receipt) => Boolean(receipt.sourceReadbackRef));

    return {
      contractVersion: LUZIONE_CAUSAL_RECEIPT_V1,
      tenantId: actor.tenantId,
      command: {
        receiptId: command.receipt_id,
        commandId: command.command_id,
        commandType: command.command_type,
        correlationId: command.correlation_id,
        state: command.state,
        requestedAt: timestamp(command.requested_at),
        committedAt: timestamp(command.committed_at),
        sourceConfirmedAt: timestamp(command.source_confirmed_at),
        sourceReadbackRef: command.source_readback_ref,
        failure: command.last_error_code
          ? { code: command.last_error_code, summary: command.last_error_summary }
          : null,
        authority: {
          contractVersion: command.authority_contract_version,
          authorityClass: command.authority_class,
          capability: command.capability,
          policyDecisionId: command.policy_decision_id,
          approvalId: command.approval_id,
        },
      },
      causalState: {
        intentRecorded: true,
        providerAcknowledged,
        sourceReadbackConfirmed,
        businessOutcomeConfirmed: sourceReadbackConfirmed,
      },
      executionSteps: steps,
      auditEvents: auditResult.rows.map((row) => ({
        auditEventId: row.audit_event_id,
        eventType: row.event_type,
        executionStepId: row.execution_step_id,
        correlationId: row.correlation_id,
        occurredAt: timestamp(row.occurred_at),
      })),
      effectReceipts,
      disclosure: {
        rawProviderPayloadIncluded: false,
        rawProviderReadbackIncluded: false,
        rawAuditEvidenceIncluded: false,
        businessSuccessRequiresSourceReadback: true,
      },
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original read-model failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
