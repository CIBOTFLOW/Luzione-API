import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { connectorRevocationEnabledForTenant } from "@/lib/api/config";
import { databasePool } from "@/lib/db";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { PostgresWorkflowDeliveryStore } from "@/lib/platform-guarantees/postgresWorkflowDeliveryStore";
import { ConfiguredEffectAdmissionGate, PostgresEffectKillStateReader } from "@/modules/effect-admission/gate";
import type { EffectKillState } from "@/modules/effect-admission/contracts";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { createLifecycleCommandRequest, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import { ProviderAdapterRegistry } from "@/modules/provider-runtime/registry";
import { ProviderWorkerRuntime } from "@/modules/provider-runtime/runtime";
import {
  CONNECTOR_REVOCATION_DESTINATION,
  CONNECTOR_REVOCATION_POLICY_VERSION,
  ConnectorRevocationContractError,
  assertRevocationTupleMatches,
  classifyRevocationOutcome,
  issueConnectorRevocationReceipt,
  parseConnectorRevocationReceipt,
  revocationReservation,
  type ConnectorRevocationReceiptV1,
  type ConnectorRevocationRequestV1,
} from "./contracts";
import { ConnectorRevocationEmulatorAdapter } from "./emulatorAdapter";

export const CONNECTOR_REVOCATION_CONTAINMENT_DESTINATION = "sandbox.connector-revocation-containment";

type RuntimeFactory = (store: PostgresWorkflowDeliveryStore, pool: Pool) => ProviderWorkerRuntime;
type KillReader = { read(input: { destination: string; tenantId: string }): Promise<EffectKillState> };

function defaultRuntime(store: PostgresWorkflowDeliveryStore, pool: Pool) {
  return new ProviderWorkerRuntime(
    store,
    new ProviderAdapterRegistry([new ConnectorRevocationEmulatorAdapter()]),
    ({ destination, mode, tenantId }) => mode === "SANDBOX"
      && destination === CONNECTOR_REVOCATION_DESTINATION
      && connectorRevocationEnabledForTenant(tenantId),
    new ConfiguredEffectAdmissionGate(new PostgresEffectKillStateReader(pool)),
  );
}

function assertAvailableAndOpen(state: EffectKillState, boundary: string) {
  if (!state.stateAvailable) {
    throw new ConnectorRevocationContractError("KILL_STATE_UNAVAILABLE", `${boundary} kill state is unavailable; revocation fails closed.`, 503);
  }
  if (state.activeKillRefs.length) {
    throw new ConnectorRevocationContractError("ACTIVE_KILL_SWITCH", `${boundary} kill state blocks revocation.`, 409);
  }
  return state.killVersion;
}

function rowReceipt(value: unknown) {
  if (typeof value === "string") {
    try {
      return parseConnectorRevocationReceipt(JSON.parse(value));
    } catch (error) {
      if (error instanceof ConnectorRevocationContractError) throw error;
      throw new ConnectorRevocationContractError("READBACK_INVALID", "Stored connector revocation receipt is invalid.", 503);
    }
  }
  return parseConnectorRevocationReceipt(value);
}

async function insertReceipt(client: PoolClient, receipt: ConnectorRevocationReceiptV1) {
  const result = await client.query(
    `insert into public.connector_revocation_receipts
      (tenant_id,receipt_id,receipt_digest,prior_receipt_id,binding_id,binding_contract_version,
       connector_provider,provider_account_ref,credential_handle_ref,credential_handle_version,
       operation_kind,operation_key,payload_digest,containment_kill_version,normal_kill_version,
       request_actor_id,request_actor_class,human_actor_id,human_authentication_ref,command_receipt_ref,
       provider_acknowledgement_ref,source_readback_ref,reconciliation_ref,reconciliation_result,
       remote_finality,local_credential_disposition,recovery_state,zero_effect,canonical_receipt,recorded_at)
     values ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,true,$28::jsonb,$29)
     on conflict (tenant_id,receipt_id) do nothing
     returning canonical_receipt`,
    [
      receipt.tenantId, receipt.receiptId, receipt.receiptDigest, receipt.priorReceiptId,
      receipt.binding.bindingId, receipt.binding.bindingContractVersion, receipt.binding.connectorProvider,
      receipt.binding.providerAccountRef, receipt.binding.credentialHandle.reference,
      receipt.binding.credentialHandle.version, receipt.operation.kind, receipt.operation.key,
      receipt.operation.payloadDigest, receipt.containmentKillVersion, receipt.normalKillVersion,
      receipt.actor.requestActorId, receipt.actor.requestActorClass, receipt.actor.humanActorId,
      receipt.actor.humanAuthenticationRef, receipt.commandReceiptRef,
      receipt.acknowledgement.providerAcknowledgementRef, receipt.acknowledgement.sourceReadbackRef,
      receipt.reconciliation.reconciliationRef, receipt.reconciliation.result, receipt.remoteFinality,
      receipt.localCredentialDisposition, receipt.recoveryState, JSON.stringify(receipt), receipt.recordedAt,
    ],
  );
  if (result.rows.length) return rowReceipt(result.rows[0].canonical_receipt);
  const existing = await client.query(
    `select canonical_receipt from public.connector_revocation_receipts
      where tenant_id=$1 and receipt_id=$2 and receipt_digest=$3`,
    [receipt.tenantId, receipt.receiptId, receipt.receiptDigest],
  );
  if (!existing.rows.length) throw new ConnectorRevocationContractError("APPEND_CONFLICT", "Existing receipt does not match the exact immutable packet.", 409);
  return rowReceipt(existing.rows[0].canonical_receipt);
}

function baseReceipt(input: {
  actor: ApiActor;
  containmentKillVersion: string;
  human: HumanApprovalSubject;
  normalKillVersion: string;
  priorReceiptId: string | null;
  recordedAt: string;
  request: ConnectorRevocationRequestV1;
}) {
  const reservation = revocationReservation(input.actor.tenantId, input.request);
  return {
    actor: {
      humanActorId: input.human.actorId,
      humanAuthenticationRef: input.human.authenticationRef,
      requestActorClass: "service" as const,
      requestActorId: input.actor.actorId,
    },
    binding: {
      bindingContractVersion: input.request.binding.contractVersion,
      bindingId: input.request.binding.bindingId,
      connectorProvider: input.request.binding.provider,
      credentialHandle: input.request.credentialHandle,
      providerAccountRef: input.request.providerAccountRef,
    },
    commandReceiptRef: `p110-command:${reservation.commandId}`,
    containmentKillVersion: input.containmentKillVersion,
    normalKillVersion: input.normalKillVersion,
    operation: { kind: input.request.operation.kind, key: input.request.operationKey, payloadDigest: input.request.payloadDigest },
    priorReceiptId: input.priorReceiptId,
    recordedAt: new Date(input.recordedAt).toISOString(),
    tenantId: input.actor.tenantId,
  };
}

async function readOutboxOutcome(pool: Pool, tenantId: string, outboxMessageId: string) {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    const result = await client.query(
      `select outbox.state,outbox.provider_acknowledgement_ref,outbox.source_readback_ref,outbox.last_error_code,
              checkpoint.reconciliation_id,checkpoint.result reconciliation_result
         from public.p110_outbox_messages outbox
         left join lateral (
           select reconciliation_id,result from public.p110_reconciliation_checkpoints checkpoint
            where checkpoint.tenant_id=outbox.tenant_id and checkpoint.outbox_message_id=outbox.outbox_message_id
            order by checked_at desc,reconciliation_id desc limit 1
         ) checkpoint on true
        where outbox.tenant_id=$1 and outbox.outbox_message_id=$2 limit 1`,
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

export class ConnectorRevocationService {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;
  private readonly killReader: KillReader;

  constructor(
    private readonly pool: Pool = databasePool(),
    private readonly runtimeFactory: RuntimeFactory = defaultRuntime,
    killReader?: KillReader,
  ) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
    this.killReader = killReader ?? new PostgresEffectKillStateReader(pool);
  }

  async execute(input: {
    actor: ApiActor;
    correlationId: string;
    human: HumanApprovalSubject;
    request: ConnectorRevocationRequestV1;
    requestedAt: string;
  }) {
    if (input.actor.actorType !== "service") throw new ConnectorRevocationContractError("SERVICE_ACTOR_REQUIRED", "Revocation transport requires a credential-bound service actor.", 403);
    if (input.human.actorType !== "user" || input.human.actorId === input.actor.actorId) throw new ConnectorRevocationContractError("DISTINCT_HUMAN_REQUIRED", "Revocation authority requires a distinct authenticated human subject.", 403);
    if (input.actor.tenantId !== input.human.tenantId || input.actor.tenantId !== input.request.binding.tenantId) throw new ConnectorRevocationContractError("TENANT_MISMATCH", "Service, human, and ConnectorBinding tenants must match.", 403);
    const humanCapability = input.request.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE"
      ? "connector.revocation.forward_recovery"
      : "connector.revocation.request";
    if (!input.human.capabilities.includes(humanCapability)) throw new ConnectorRevocationContractError("HUMAN_AUTHORITY_DENIED", "The authenticated human lacks the exact revocation capability.", 403);

    const containmentState = await this.killReader.read({ destination: CONNECTOR_REVOCATION_CONTAINMENT_DESTINATION, tenantId: input.actor.tenantId });
    const normalState = await this.killReader.read({ destination: CONNECTOR_REVOCATION_DESTINATION, tenantId: input.actor.tenantId });
    const containmentKillVersion = assertAvailableAndOpen(containmentState, "Containment");
    const normalKillVersion = assertAvailableAndOpen(normalState, "Normal");
    const reservation = revocationReservation(input.actor.tenantId, input.request);
    let acceptedReceipt: ConnectorRevocationReceiptV1 | null = null;
    const lifecycleRequest = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: "service", roles: [] },
      causationId: input.request.expectedPriorReceiptId,
      commandId: reservation.commandId,
      commandType: `connector.revocation.${input.request.operation.kind.toLowerCase()}`,
      correlationId: input.correlationId,
      delivery: {
        authorizationRef: input.human.authenticationRef,
        destination: CONNECTOR_REVOCATION_DESTINATION,
        effectClass: "NO_EFFECT",
        maxAttempts: 1,
        payload: {
          bindingId: input.request.binding.bindingId,
          connectorProvider: input.request.binding.provider,
          containmentKillVersion,
          credentialHandle: input.request.credentialHandle,
          humanAuthorityRef: input.human.authenticationRef,
          normalKillVersion,
          operation: input.request.operation.kind,
          payloadDigest: input.request.payloadDigest,
          providerAccountRef: input.request.providerAccountRef,
          scenario: input.request.operation.scenario,
        },
      },
      expectedObjectVersion: input.request.expectedPriorReceiptId ?? "ABSENT",
      idempotencyKey: reservation.idempotencyKey,
      payload: { human: input.human, request: input.request },
      policyVersion: CONNECTOR_REVOCATION_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: input.request.binding.bindingId,
        objectType: "connector_revocation",
        objectVersion: reservation.objectVersion,
        ownerProject: "LUZIONE_API",
        sourceRefs: [input.request.binding.contractVersion, input.request.contractVersion, input.request.credentialHandle.contractVersion],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const commandReceipt = await this.kernel.execute(lifecycleRequest, async (transaction) => {
      if (input.request.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE") {
        const priorResult = await transaction.client.query(
          `select canonical_receipt from public.connector_revocation_receipts
            where tenant_id=$1 and receipt_id=$2`,
          [input.actor.tenantId, input.request.expectedPriorReceiptId],
        );
        if (!priorResult.rows.length) throw new ConnectorRevocationContractError("PRIOR_RECEIPT_NOT_FOUND", "Exact same-tenant prior receipt was not found.", 404);
        const prior = rowReceipt(priorResult.rows[0].canonical_receipt);
        assertRevocationTupleMatches(prior, input.actor.tenantId, input.request);
        if (!["AMBIGUITY_EXHAUSTED", "BLOCKED", "REMOTE_REVOKE_FAILED", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"].includes(prior.remoteFinality)) {
          throw new ConnectorRevocationContractError("FORWARD_RECOVERY_NOT_ELIGIBLE", "Forward recovery requires a terminal non-success remote finality.", 409);
        }
        acceptedReceipt = issueConnectorRevocationReceipt({
          ...baseReceipt({ ...input, containmentKillVersion, normalKillVersion, priorReceiptId: prior.receiptId, recordedAt: input.requestedAt }),
          acknowledgement: prior.acknowledgement,
          localCredentialDisposition: "ERASURE_AUTHORIZED_NO_EFFECT",
          reconciliation: prior.reconciliation,
          recoveryState: "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT",
          remoteFinality: prior.remoteFinality,
        });
      } else {
        acceptedReceipt = issueConnectorRevocationReceipt({
          ...baseReceipt({ ...input, containmentKillVersion, normalKillVersion, priorReceiptId: null, recordedAt: input.requestedAt }),
          acknowledgement: { providerAcknowledgementRef: null, sourceReadbackRef: null },
          localCredentialDisposition: "RETAINED",
          reconciliation: { reconciliationRef: null, result: "NOT_ATTEMPTED" },
          recoveryState: "NORMAL",
          remoteFinality: "REQUESTED",
        });
      }
      await insertReceipt(transaction.client, acceptedReceipt);
      return { evidenceRefs: [acceptedReceipt.receiptId, `human-authority:${input.human.authenticationRef}`], objectVersion: acceptedReceipt.receiptId };
    });

    if (!acceptedReceipt) {
      acceptedReceipt = await this.readLatestByOperation(input.actor.tenantId, input.request.operationKey);
    }
    if (commandReceipt.idempotentReplay && acceptedReceipt.remoteFinality !== "REQUESTED") {
      return { commandReceipt, receipt: acceptedReceipt };
    }

    const deliveryStore = new PostgresWorkflowDeliveryStore(this.pool);
    const runtime = this.runtimeFactory(deliveryStore, this.pool);
    const workerId = `connector-revocation:${reservation.commandId.slice(-64)}`;
    await runtime.runDeliveryBatch({ limit: 1, outboxMessageId: commandReceipt.outboxMessageId, tenantId: input.actor.tenantId, workerId });
    await runtime.runReconciliationBatch({ limit: 1, outboxMessageId: commandReceipt.outboxMessageId, tenantId: input.actor.tenantId, workerId });
    if (input.request.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE") {
      return { commandReceipt, receipt: acceptedReceipt };
    }
    const outcome = await readOutboxOutcome(this.pool, input.actor.tenantId, commandReceipt.outboxMessageId);
    if (!outcome) throw new ConnectorRevocationContractError("P110_READBACK_MISSING", "Canonical P110 readback is unavailable.", 503);
    const classified = classifyRevocationOutcome({
      lastErrorCode: typeof outcome.last_error_code === "string" ? outcome.last_error_code : null,
      providerAcknowledgementRef: typeof outcome.provider_acknowledgement_ref === "string" ? outcome.provider_acknowledgement_ref : null,
      reconciliationRef: typeof outcome.reconciliation_id === "string" ? outcome.reconciliation_id : null,
      reconciliationResult: typeof outcome.reconciliation_result === "string" ? outcome.reconciliation_result : null,
      sourceReadbackRef: typeof outcome.source_readback_ref === "string" ? outcome.source_readback_ref : null,
      state: String(outcome.state),
    });
    const finalReceipt = issueConnectorRevocationReceipt({
      ...baseReceipt({ ...input, containmentKillVersion, normalKillVersion, priorReceiptId: acceptedReceipt.receiptId, recordedAt: new Date(Date.parse(input.requestedAt) + 1).toISOString() }),
      ...classified,
    });
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id',$1,true)", [input.actor.tenantId]);
      await insertReceipt(client, finalReceipt);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return { commandReceipt, receipt: finalReceipt };
  }

  async readById(tenantId: string, receiptId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
      const result = await client.query(
        `select canonical_receipt from public.connector_revocation_receipts
          where tenant_id=$1 and receipt_id=$2 limit 1`,
        [tenantId, receiptId],
      );
      await client.query("commit");
      if (!result.rows.length) throw new ConnectorRevocationContractError("RECEIPT_NOT_FOUND", "Same-tenant connector revocation receipt not found.", 404);
      return rowReceipt(result.rows[0].canonical_receipt);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readLatestByOperation(tenantId: string, operationKey: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
      const result = await client.query(
        `select canonical_receipt from public.connector_revocation_receipts
          where tenant_id=$1 and operation_key=$2 order by recorded_at desc,receipt_id desc limit 1`,
        [tenantId, operationKey],
      );
      await client.query("commit");
      if (!result.rows.length) throw new ConnectorRevocationContractError("REPLAY_RECEIPT_MISSING", "P110 replay receipt has no matching revocation readback.", 503);
      return rowReceipt(result.rows[0].canonical_receipt);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
