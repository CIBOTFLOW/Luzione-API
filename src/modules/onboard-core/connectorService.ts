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
import type { SetupMandateV1 } from "@/modules/luzione-core-contracts/contracts";
import {
  CONNECTOR_SANDBOX_DESTINATION,
  CONNECTOR_SYNC_VALIDATION_VERSION,
  connectorValidationReservation,
  classifyConnectorOutcome,
  type ConnectorSyncValidationRequest,
} from "./connectorContracts";
import { OnboardCoreDomainError } from "./store";
import { runtimeDeadline } from "./runtimeLimit";

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
              outbox.last_error_code, checkpoint.reconciliation_id, checkpoint.result reconciliation_result
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

async function readReplayMandateDeadline(input: {
  now: number;
  pool: Pool;
  request: ConnectorSyncValidationRequest;
  requestedAt: string;
  tenantId: string;
}) {
  const client = await input.pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [input.tenantId]);
    const result = await client.query(
      `select mandate.canonical_mandate, mandate.object_version, mandate.expires_at,
              mandate.source_binding_digest, revocation.revocation_ref,
              exists (
                select 1 from public.onboarding_tenant_blueprint_approvals approved
                 where approved.tenant_id=mandate.tenant_id and approved.approval_ref=mandate.approval_ref and approved.action='APPROVED'
                   and not exists (select 1 from public.onboarding_tenant_blueprint_approvals superseded
                     where superseded.tenant_id=approved.tenant_id and superseded.blueprint_id=approved.blueprint_id
                       and superseded.action='SUPERSEDED' and superseded.approval_ref=approved.approval_ref)
              ) approval_active
         from public.onboarding_setup_mandates mandate
         left join lateral (select event.revocation_ref from public.onboarding_setup_mandate_revocations event
           where event.tenant_id=mandate.tenant_id and event.mandate_id=mandate.mandate_id limit 1) revocation on true
        where mandate.tenant_id=$1 and mandate.mandate_id=$2::uuid limit 1`,
      [input.tenantId, input.request.mandateId],
    );
    await client.query("commit");
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new OnboardCoreDomainError("MANDATE_NOT_FOUND", "Same-tenant Setup Mandate not found for replay.", 404);
    const mandate = row.canonical_mandate as SetupMandateV1;
    if (String(row.object_version) !== input.request.expectedMandateObjectVersion) throw new OnboardCoreDomainError("STALE_MANDATE", "Connector replay Mandate version is stale.", 409);
    if (String(row.source_binding_digest) !== input.request.sourceBindingDigest) throw new OnboardCoreDomainError("L2_BINDING_MISMATCH", "Connector replay L2 binding differs from its Mandate.", 409);
    if (!mandate.active || row.revocation_ref !== null || row.approval_active !== true
      || Date.parse(String(row.expires_at)) <= input.now || mandate.effectCeiling !== "NO_EFFECT"
      || !mandate.allowedActions.includes("VALIDATE_CONNECTOR_READBACK")) {
      throw new OnboardCoreDomainError("MANDATE_AUTHORITY_DENIED", "Connector replay requires the same currently active Mandate authority.", 403);
    }
    const runtime = runtimeDeadline(input.requestedAt, mandate.limits.maxRuntimeMinutes);
    return Date.parse(String(row.expires_at)) < Date.parse(runtime) ? new Date(String(row.expires_at)).toISOString() : runtime;
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
    private readonly wallNow: () => number = () => Date.now(),
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
    let mandateDeadline = "";
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
          mandateId: input.request.mandateId,
          provider: input.request.binding.provider,
          scenario: input.request.validation.scenario,
          sourceBindingDigest: input.request.sourceBindingDigest,
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
    const commandReceipt = await this.kernel.execute(request, async (transaction) => {
      const mandateResult = await transaction.client.query(
        `select mandate.canonical_mandate, mandate.object_version, mandate.expires_at,
                mandate.source_binding_digest, mandate.approval_ref, revocation.revocation_ref
           from public.onboarding_setup_mandates mandate
           left join lateral (
             select event.revocation_ref from public.onboarding_setup_mandate_revocations event
              where event.tenant_id=mandate.tenant_id and event.mandate_id=mandate.mandate_id limit 1
           ) revocation on true
          where mandate.tenant_id=$1 and mandate.mandate_id=$2::uuid
          for update of mandate`,
        [input.actor.tenantId, input.request.mandateId],
      );
      const row = mandateResult.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new OnboardCoreDomainError("MANDATE_NOT_FOUND", "Same-tenant Setup Mandate not found.", 404);
      if (String(row.object_version) !== input.request.expectedMandateObjectVersion) throw new OnboardCoreDomainError("STALE_MANDATE", "Connector validation expectedMandateObjectVersion is stale.", 409);
      if (String(row.source_binding_digest) !== input.request.sourceBindingDigest) throw new OnboardCoreDomainError("L2_BINDING_MISMATCH", "Connector validation does not bind the exact L2 mapper/evidence digest inherited by its Setup Mandate.", 409);
      const mandate = row.canonical_mandate as SetupMandateV1;
      if (!mandate.active || row.revocation_ref !== null || Date.parse(String(row.expires_at)) <= this.wallNow()
        || mandate.effectCeiling !== "NO_EFFECT" || !mandate.allowedActions.includes("VALIDATE_CONNECTOR_READBACK")) {
        throw new OnboardCoreDomainError("MANDATE_AUTHORITY_DENIED", "Connector validation requires an active, unexpired, unrevoked NO_EFFECT Setup Mandate with VALIDATE_CONNECTOR_READBACK.", 403);
      }
      const approval = await transaction.client.query(
        `select 1 from public.onboarding_tenant_blueprint_approvals approved
          where approved.tenant_id=$1 and approved.approval_ref=$2 and approved.action='APPROVED'
            and not exists (select 1 from public.onboarding_tenant_blueprint_approvals superseded
              where superseded.tenant_id=approved.tenant_id and superseded.blueprint_id=approved.blueprint_id
                and superseded.action='SUPERSEDED' and superseded.approval_ref=approved.approval_ref)
          limit 1`,
        [input.actor.tenantId, row.approval_ref],
      );
      if (!approval.rows.length) throw new OnboardCoreDomainError("MANDATE_BLUEPRINT_SUPERSEDED", "Connector validation Mandate refers to a superseded approval.", 403);
      mandateDeadline = runtimeDeadline(input.requestedAt, mandate.limits.maxRuntimeMinutes);
      const expiresAt = new Date(String(row.expires_at)).toISOString();
      if (Date.parse(expiresAt) < Date.parse(mandateDeadline)) mandateDeadline = expiresAt;
      await transaction.client.query("select set_config('statement_timeout', $1, true)", [`${mandate.limits.maxRuntimeMinutes * 60_000}ms`]);
      return {
        evidenceRefs: [`connector-binding:${input.request.binding.bindingId}`, `setup-mandate:${input.request.mandateId}`, `l2-binding:${input.request.sourceBindingDigest}`, `sandbox-validation:${input.request.operationKey}`],
        objectVersion: reservation.objectVersion,
      };
    });
    if (!mandateDeadline) {
      mandateDeadline = await readReplayMandateDeadline({ now: this.wallNow(), pool: this.pool, request: input.request, requestedAt: input.requestedAt, tenantId: input.actor.tenantId });
    }

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
    if (!mandateDeadline || this.wallNow() >= Date.parse(mandateDeadline)) {
      throw new OnboardCoreDomainError("MANDATE_RUNTIME_EXCEEDED", "Connector validation exceeded its active Mandate deadline; no success receipt is available.", 409);
    }

    const outcome = await readOutcome(this.pool, input.actor.tenantId, commandReceipt.outboxMessageId);
    if (!outcome) throw new OnboardCoreDomainError("CONNECTOR_READBACK_MISSING", "P110 connector validation readback is missing.", 503);
    const validationOutcome = classifyConnectorOutcome({
      binding: input.request.binding,
      changes: input.request.validation.changes,
      cursorAfter: input.request.validation.cursorAfter,
      lastErrorCode: typeof outcome.last_error_code === "string" ? outcome.last_error_code : null,
      providerAcknowledgementRef: typeof outcome.provider_acknowledgement_ref === "string" ? outcome.provider_acknowledgement_ref : null,
      reconciliationRef: typeof outcome.reconciliation_id === "string" ? outcome.reconciliation_id : null,
      reconciliationResult: typeof outcome.reconciliation_result === "string" ? outcome.reconciliation_result : null,
      sourceReadbackRef: typeof outcome.source_readback_ref === "string" ? outcome.source_readback_ref : null,
      state: String(outcome.state),
    });
    return {
      commandReceipt,
      deadlineAt: mandateDeadline,
      provider: {
        destination: CONNECTOR_SANDBOX_DESTINATION,
        mode: "SANDBOX" as const,
        reconciliationResult: outcome.reconciliation_result ? String(outcome.reconciliation_result) : null,
      },
      validationOutcome,
    };
  }
}
