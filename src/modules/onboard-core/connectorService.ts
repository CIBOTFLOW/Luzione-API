import "server-only";

import type { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { PostgresWorkflowDeliveryStore } from "@/lib/platform-guarantees/postgresWorkflowDeliveryStore";
import { createLifecycleCommandRequest, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import { ProviderAdapterRegistry } from "@/modules/provider-runtime/registry";
import { ProviderWorkerRuntime } from "@/modules/provider-runtime/runtime";
import { SandboxEchoProviderAdapter } from "@/modules/provider-runtime/sandboxEchoAdapter";
import { ConfiguredEffectAdmissionGate, PostgresEffectKillStateReader } from "@/modules/effect-admission/gate";
import { ONBOARD_CORE_POLICY_VERSION } from "./contracts";
import {
  CONNECTOR_SANDBOX_DESTINATION,
  CONNECTOR_SYNC_VALIDATION_VERSION,
  connectorValidationReservation,
  issueSyncReceipt,
  type ConnectorSyncValidationRequest,
} from "./connectorContracts";
import { OnboardCoreDomainError } from "./store";

type RuntimeFactory = (store: PostgresWorkflowDeliveryStore) => ProviderWorkerRuntime;

function defaultRuntime(store: PostgresWorkflowDeliveryStore) {
  return new ProviderWorkerRuntime(
    store,
    new ProviderAdapterRegistry([new SandboxEchoProviderAdapter()]),
    undefined,
    new ConfiguredEffectAdmissionGate(new PostgresEffectKillStateReader(databasePool())),
  );
}

async function readOutcome(pool: Pool, tenantId: string, outboxMessageId: string) {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query(
      `select outbox.state, outbox.provider_acknowledgement_ref, outbox.source_readback_ref,
              checkpoint.reconciliation_id, checkpoint.result reconciliation_result
         from public.p110_outbox_messages outbox
         left join lateral (
           select reconciliation_id, result
             from public.p110_reconciliation_checkpoints checkpoint
            where checkpoint.tenant_id = outbox.tenant_id
              and checkpoint.outbox_message_id = outbox.outbox_message_id
            order by checkpoint.checked_at desc, checkpoint.reconciliation_id desc
            limit 1
         ) checkpoint on true
        where outbox.tenant_id = $1 and outbox.outbox_message_id = $2
        limit 1`,
      [tenantId, outboxMessageId],
    );
    await client.query("commit");
    return result.rows[0] as Record<string, unknown> | undefined;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class ConnectorSyncValidationService {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(
    private readonly pool: Pool = databasePool(),
    private readonly runtimeFactory: RuntimeFactory = defaultRuntime,
  ) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
  }

  async execute(input: {
    actor: ApiActor;
    correlationId: string;
    request: ConnectorSyncValidationRequest;
    requestedAt: string;
  }) {
    if (input.actor.actorType !== "service") {
      throw new OnboardCoreDomainError("SERVICE_ACTOR_REQUIRED", "Connector validation requires a credential-bound service actor.", 403);
    }
    if (input.request.binding.tenantId !== input.actor.tenantId) {
      throw new OnboardCoreDomainError("TENANT_MISMATCH", "Connector Binding tenant must match the authenticated service actor.", 403);
    }
    const reservation = connectorValidationReservation(input.actor.tenantId, input.request);
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId: reservation.commandId,
      commandType: "onboarding.connector.sync_validation",
      correlationId: input.correlationId,
      delivery: {
        authorizationRef: null,
        destination: CONNECTOR_SANDBOX_DESTINATION,
        effectClass: "NO_EFFECT",
        maxAttempts: 1,
        payload: {
          bindingId: input.request.binding.bindingId,
          changes: input.request.validation.changes,
          connectorPayloadDigest: input.request.payloadDigest,
          cursorAfter: input.request.validation.cursorAfter,
          provider: input.request.binding.provider,
          scenario: input.request.validation.scenario,
        },
      },
      expectedObjectVersion: `connector-binding:${input.request.binding.bindingId}@${input.request.binding.cursor ?? "INITIAL"}`,
      idempotencyKey: reservation.idempotencyKey,
      payload: input.request,
      policyVersion: ONBOARD_CORE_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: input.request.binding.bindingId,
        objectType: "connector_sync_validation",
        objectVersion: reservation.objectVersion,
        ownerProject: "LUZIONE_API",
        sourceRefs: [
          input.request.binding.contractVersion,
          CONNECTOR_SYNC_VALIDATION_VERSION,
          `sha256:${input.request.payloadDigest}`,
        ],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const commandReceipt = await this.kernel.execute(request, async () => ({
      evidenceRefs: [
        `connector-binding:${input.request.binding.bindingId}`,
        `sandbox-validation:${input.request.operationKey}`,
      ],
      objectVersion: reservation.objectVersion,
    }));

    const deliveryStore = new PostgresWorkflowDeliveryStore(this.pool);
    const runtime = this.runtimeFactory(deliveryStore);
    const workerId = `onboard-connector:${reservation.commandId}`;
    await runtime.runDeliveryBatch({
      limit: 1,
      outboxMessageId: commandReceipt.outboxMessageId,
      tenantId: input.actor.tenantId,
      workerId,
    });
    await runtime.runReconciliationBatch({
      limit: 1,
      outboxMessageId: commandReceipt.outboxMessageId,
      tenantId: input.actor.tenantId,
      workerId,
    });

    const outcome = await readOutcome(this.pool, input.actor.tenantId, commandReceipt.outboxMessageId);
    if (!outcome) throw new OnboardCoreDomainError("CONNECTOR_READBACK_MISSING", "P110 connector validation readback is missing.", 503);
    const state = String(outcome.state);
    const sourceConfirmed = state === "SOURCE_CONFIRMED" && typeof outcome.source_readback_ref === "string";
    const acknowledged = typeof outcome.provider_acknowledgement_ref === "string";
    const reconciling = typeof outcome.reconciliation_id === "string";
    if (!sourceConfirmed && !acknowledged && !reconciling) {
      throw new OnboardCoreDomainError("CONNECTOR_VALIDATION_UNAVAILABLE", "Sandbox validation did not produce canonical acknowledgement or reconciliation evidence.", 503);
    }
    const finality = sourceConfirmed ? "SOURCE_CONFIRMED" : reconciling ? "RECONCILING" : "ACKNOWLEDGED";
    const syncReceipt = issueSyncReceipt({
      binding: input.request.binding,
      changes: input.request.validation.changes,
      cursorAfter: input.request.validation.cursorAfter,
      finality,
      providerAcknowledgementRef: acknowledged ? String(outcome.provider_acknowledgement_ref) : null,
      reconciliationRef: reconciling ? String(outcome.reconciliation_id) : null,
      sourceReadbackRef: sourceConfirmed ? String(outcome.source_readback_ref) : null,
    });
    return {
      commandReceipt,
      provider: {
        destination: CONNECTOR_SANDBOX_DESTINATION,
        mode: "SANDBOX" as const,
        reconciliationResult: outcome.reconciliation_result ? String(outcome.reconciliation_result) : null,
      },
      syncReceipt,
    };
  }
}
