import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { connectorRevocationEnabledForTenant } from "@/lib/api/config";
import { databasePool } from "@/lib/db";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { PostgresWorkflowDeliveryStore } from "@/lib/platform-guarantees/postgresWorkflowDeliveryStore";
import { ConfiguredEffectAdmissionGate, PostgresEffectKillStateReader } from "@/modules/effect-admission/gate";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { createLifecycleCommandRequest, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import { ProviderAdapterRegistry } from "@/modules/provider-runtime/registry";
import { ProviderWorkerRuntime } from "@/modules/provider-runtime/runtime";
import { CONNECTOR_REVOCATION_RECEIPT_VERSION, ConnectorRevocationContractError, parseConnectorRevocationReceipt } from "../contracts";
import {
  CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1,
  CONNECTOR_CREDENTIAL_HANDLE_V2,
  CONNECTOR_REVOCATION_POLICY_V2,
  CONNECTOR_REVOCATION_RECEIPT_V2,
  CONNECTOR_REVOCATION_REQUEST_V2,
  CONNECTOR_REVOCATION_V2_DESTINATION,
  ConnectorRevocationV2Error,
  assertRevocationTupleMatchesV2,
  assertSelectorMatchesCanonicalResolution,
  classifyRevocationOutcomeV2,
  issueConnectorRevocationReceiptV2,
  parseCanonicalConnectorBindingResolutionV1,
  parseConnectorRevocationReceiptV2,
  revocationReservationV2,
  type CanonicalConnectorBindingResolutionV1,
  type ConnectorRevocationReceiptV2,
  type ConnectorRevocationRequestV2,
  type RevocationKillPairV2,
} from "./contracts";
import { ConnectorRevocationV2EmulatorAdapter } from "./emulatorAdapter";
import { RevocationPhaseKillGuardV2, type RevocationKillReaderV2 } from "./killGuard";
import { UnavailableCanonicalConnectorBindingResolver, type CanonicalConnectorBindingResolver } from "./resolver";

type RuntimeFactoryV2 = (store: PostgresWorkflowDeliveryStore, pool: Pool, guard: RevocationPhaseKillGuardV2) => ProviderWorkerRuntime;

function defaultRuntime(store: PostgresWorkflowDeliveryStore, pool: Pool, guard: RevocationPhaseKillGuardV2) {
  return new ProviderWorkerRuntime(
    store,
    new ProviderAdapterRegistry([new ConnectorRevocationV2EmulatorAdapter(guard)]),
    ({ destination, mode, tenantId }) => mode === "SANDBOX"
      && destination === CONNECTOR_REVOCATION_V2_DESTINATION
      && connectorRevocationEnabledForTenant(tenantId),
    new ConfiguredEffectAdmissionGate(new PostgresEffectKillStateReader(pool)),
  );
}

function parseStoredReceipt(value: unknown) {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      throw new ConnectorRevocationV2Error("READBACK_INVALID", "Stored connector revocation receipt is not valid JSON.", 503);
    }
  }
  const version = decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? (decoded as Record<string, unknown>).contractVersion
    : null;
  if (version === CONNECTOR_REVOCATION_RECEIPT_V2) return parseConnectorRevocationReceiptV2(decoded);
  if (version === CONNECTOR_REVOCATION_RECEIPT_VERSION) {
    try {
      return parseConnectorRevocationReceipt(decoded);
    } catch (error) {
      if (error instanceof ConnectorRevocationContractError) throw error;
      throw new ConnectorRevocationV2Error("READBACK_INVALID", "Stored v1 connector revocation receipt is invalid.", 503);
    }
  }
  throw new ConnectorRevocationV2Error("READBACK_WRONG_VERSION", "Stored connector revocation receipt version is not admitted.", 503);
}

function parseStoredV2Receipt(value: unknown) {
  const receipt = parseStoredReceipt(value);
  if (receipt.contractVersion !== CONNECTOR_REVOCATION_RECEIPT_V2) {
    throw new ConnectorRevocationV2Error("REPLAY_VERSION_CONFLICT", "A v2 reservation cannot reuse a v1 receipt.", 409);
  }
  return receipt;
}

async function insertReceiptV2(client: PoolClient, receipt: ConnectorRevocationReceiptV2) {
  const resolution = receipt.bindingResolution;
  const selectedKill = receipt.killEvidence.beforeExecuteOrDisposition
    ?? receipt.killEvidence.beforeCredentialHold
    ?? receipt.killEvidence.accepted;
  const result = await client.query(
    `insert into public.connector_revocation_receipts
      (tenant_id,receipt_id,receipt_digest,prior_receipt_id,binding_id,binding_contract_version,binding_version,
       connector_provider,provider_account_ref,destination,credential_handle_ref,credential_handle_version,
       credential_handle_contract_version,credential_generation,credential_handle_digest,binding_resolution_digest,
       binding_owner_readback_ref,operation_kind,operation_key,payload_digest,containment_kill_version,normal_kill_version,
       request_actor_id,request_actor_class,human_actor_id,human_authentication_ref,command_receipt_ref,
       provider_acknowledgement_ref,source_readback_ref,reconciliation_ref,reconciliation_result,
       remote_finality,local_credential_disposition,recovery_state,zero_effect,canonical_receipt,recorded_at)
     values ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
             $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,true,$35::jsonb,$36)
     on conflict (tenant_id,receipt_id) do nothing
     returning canonical_receipt`,
    [
      receipt.tenantId, receipt.receiptId, receipt.receiptDigest, receipt.priorReceiptId,
      resolution.binding.bindingId, resolution.binding.contractVersion, resolution.bindingVersion,
      resolution.binding.provider, resolution.providerAccountRef, resolution.destination,
      resolution.credentialHandle.reference, resolution.credentialHandle.version,
      resolution.credentialHandle.contractVersion, resolution.credentialHandle.generation,
      resolution.credentialHandle.handleDigest, resolution.resolutionDigest, resolution.ownerReadbackRef,
      receipt.operation.kind, receipt.operation.key, receipt.operation.payloadDigest,
      selectedKill.containmentKillVersion, selectedKill.normalKillVersion,
      receipt.actor.requestActorId, receipt.actor.requestActorClass, receipt.actor.humanActorId,
      receipt.actor.humanAuthenticationRef, receipt.commandReceiptRef,
      receipt.acknowledgement.providerAcknowledgementRef, receipt.acknowledgement.sourceReadbackRef,
      receipt.reconciliation.reconciliationRef, receipt.reconciliation.result, receipt.remoteFinality,
      receipt.localCredentialDisposition, receipt.recoveryState, JSON.stringify(receipt), receipt.recordedAt,
    ],
  );
  if (result.rows.length) return parseStoredV2Receipt(result.rows[0].canonical_receipt);
  const existing = await client.query(
    `select canonical_receipt from public.connector_revocation_receipts
      where tenant_id=$1 and receipt_id=$2 and receipt_digest=$3`,
    [receipt.tenantId, receipt.receiptId, receipt.receiptDigest],
  );
  if (!existing.rows.length) throw new ConnectorRevocationV2Error("APPEND_CONFLICT", "Existing receipt does not match the exact immutable v2 packet.", 409);
  return parseStoredV2Receipt(existing.rows[0].canonical_receipt);
}

function baseReceipt(input: {
  actor: ApiActor;
  acceptedKill: RevocationKillPairV2;
  guard: RevocationPhaseKillGuardV2;
  human: HumanApprovalSubject;
  priorReceiptId: string | null;
  recordedAt: string;
  request: ConnectorRevocationRequestV2;
  resolution: CanonicalConnectorBindingResolutionV1;
}) {
  const reservation = revocationReservationV2(input.actor.tenantId, input.request, input.resolution);
  return {
    actor: {
      humanActorId: input.human.actorId,
      humanAuthenticationRef: input.human.authenticationRef,
      requestActorClass: "service" as const,
      requestActorId: input.actor.actorId,
    },
    bindingResolution: input.resolution,
    commandReceiptRef: `p110-command:${reservation.commandId}`,
    killEvidence: {
      accepted: input.acceptedKill,
      beforeCredentialHold: input.guard.beforeCredentialHold,
      beforeExecuteOrDisposition: input.guard.beforeExecuteOrDisposition,
    },
    operation: {
      key: input.request.operationKey,
      kind: input.request.operation.kind,
      payloadDigest: input.request.payloadDigest,
      selector: input.request.selector,
    },
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

export class ConnectorRevocationServiceV2 {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;
  private readonly killReader: RevocationKillReaderV2;

  constructor(
    private readonly pool: Pool = databasePool(),
    private readonly runtimeFactory: RuntimeFactoryV2 = defaultRuntime,
    killReader?: RevocationKillReaderV2,
    private readonly resolver: CanonicalConnectorBindingResolver = new UnavailableCanonicalConnectorBindingResolver(),
  ) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
    this.killReader = killReader ?? new PostgresEffectKillStateReader(pool);
  }

  async execute(input: {
    actor: ApiActor;
    correlationId: string;
    human: HumanApprovalSubject;
    rawBodyDigest: string;
    request: ConnectorRevocationRequestV2;
    requestedAt: string;
  }) {
    if (input.actor.actorType !== "service") throw new ConnectorRevocationV2Error("SERVICE_ACTOR_REQUIRED", "Revocation transport requires a credential-bound service actor.", 403);
    if (input.human.actorType !== "user" || input.human.actorId === input.actor.actorId) throw new ConnectorRevocationV2Error("DISTINCT_HUMAN_REQUIRED", "Revocation authority requires a distinct authenticated human subject.", 403);
    if (input.actor.tenantId !== input.human.tenantId) throw new ConnectorRevocationV2Error("TENANT_MISMATCH", "Service and human tenants must match.", 403);
    const humanCapability = input.request.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE"
      ? "connector.revocation.forward_recovery"
      : "connector.revocation.request";
    if (!input.human.capabilities.includes(humanCapability)) throw new ConnectorRevocationV2Error("HUMAN_AUTHORITY_DENIED", "The authenticated human lacks the exact revocation capability.", 403);

    if (!/^[a-f0-9]{64}$/.test(input.rawBodyDigest)) throw new ConnectorRevocationV2Error("RAW_BODY_DIGEST_INVALID", "The route must supply the exact raw UTF-8 request digest.");
    const resolved = await this.resolver.resolveCurrent({ bindingId: input.request.selector.bindingId, tenantId: input.actor.tenantId });
    if (!resolved) throw new ConnectorRevocationV2Error("CANONICAL_BINDING_NOT_FOUND", "No current same-tenant canonical ConnectorBinding was found.", 404);
    const resolution = parseCanonicalConnectorBindingResolutionV1(resolved);
    assertSelectorMatchesCanonicalResolution(input.request.selector, resolution, input.actor.tenantId);

    const guard = new RevocationPhaseKillGuardV2(this.killReader, input.actor.tenantId);
    const acceptedKill = await guard.accepted();
    const reservation = revocationReservationV2(input.actor.tenantId, input.request, resolution);
    let acceptedReceipt: ConnectorRevocationReceiptV2 | null = null;
    const lifecycleRequest = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: "service", roles: [] },
      causationId: input.request.expectedPriorReceiptId,
      commandId: reservation.commandId,
      commandType: `connector.revocation.v2.${input.request.operation.kind.toLowerCase()}`,
      correlationId: input.correlationId,
      delivery: {
        authorizationRef: input.human.authenticationRef,
        destination: input.request.operation.kind === "REQUEST_REMOTE_REVOCATION"
          ? CONNECTOR_REVOCATION_V2_DESTINATION
          : "internal.connector-revocation-disposition",
        effectClass: "NO_EFFECT",
        maxAttempts: 1,
        payload: {
          bindingId: resolution.binding.bindingId,
          bindingResolutionDigest: resolution.resolutionDigest,
          connectorProvider: resolution.binding.provider,
          credentialGeneration: resolution.credentialHandle.generation,
          credentialHandleDigest: resolution.credentialHandle.handleDigest,
          humanAuthorityRef: input.human.authenticationRef,
          operation: input.request.operation.kind,
          payloadDigest: input.request.payloadDigest,
          providerAccountRef: resolution.providerAccountRef,
          rawBodyDigest: input.rawBodyDigest,
          scenario: input.request.operation.scenario,
        },
      },
      expectedObjectVersion: input.request.expectedPriorReceiptId ?? "ABSENT",
      idempotencyKey: reservation.idempotencyKey,
      payload: { human: input.human, rawBodyDigest: input.rawBodyDigest, request: input.request, resolution },
      policyVersion: CONNECTOR_REVOCATION_POLICY_V2,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: resolution.binding.bindingId,
        objectType: "connector_revocation",
        objectVersion: reservation.objectVersion,
        ownerProject: "LUZIONE_API",
        sourceRefs: [
          input.request.contractVersion,
          resolution.binding.contractVersion,
          resolution.contractVersion,
          resolution.credentialHandle.contractVersion,
          CONNECTOR_REVOCATION_RECEIPT_V2,
        ],
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
        if (!priorResult.rows.length) throw new ConnectorRevocationV2Error("PRIOR_RECEIPT_NOT_FOUND", "Exact same-tenant prior receipt was not found.", 404);
        const prior = parseStoredV2Receipt(priorResult.rows[0].canonical_receipt);
        assertRevocationTupleMatchesV2(prior, input.actor.tenantId, input.request, resolution);
        if (!["AMBIGUITY_EXHAUSTED", "BLOCKED", "REMOTE_REVOKE_FAILED", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"].includes(prior.remoteFinality)) {
          throw new ConnectorRevocationV2Error("FORWARD_RECOVERY_NOT_ELIGIBLE", "Forward recovery requires a terminal non-success remote finality.", 409);
        }
        await guard.recheckBeforeExecuteOrDisposition();
        acceptedReceipt = issueConnectorRevocationReceiptV2({
          ...baseReceipt({ ...input, acceptedKill, guard, priorReceiptId: prior.receiptId, recordedAt: input.requestedAt, resolution }),
          acknowledgement: prior.acknowledgement,
          localCredentialDisposition: "ERASURE_AUTHORIZED_NO_EFFECT",
          reconciliation: prior.reconciliation,
          recoveryState: "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT",
          remoteFinality: prior.remoteFinality,
        });
      } else {
        acceptedReceipt = issueConnectorRevocationReceiptV2({
          ...baseReceipt({ ...input, acceptedKill, guard, priorReceiptId: null, recordedAt: input.requestedAt, resolution }),
          acknowledgement: { providerAcknowledgementRef: null, sourceReadbackRef: null },
          localCredentialDisposition: "RETAINED",
          reconciliation: { reconciliationRef: null, result: "NOT_ATTEMPTED" },
          recoveryState: "NORMAL",
          remoteFinality: "REQUESTED",
        });
      }
      await insertReceiptV2(transaction.client, acceptedReceipt);
      return { evidenceRefs: [acceptedReceipt.receiptId, resolution.ownerReadbackRef, `human-authority:${input.human.authenticationRef}`], objectVersion: acceptedReceipt.receiptId };
    });

    if (!acceptedReceipt) acceptedReceipt = await this.readLatestV2ByOperation(input.actor.tenantId, input.request.operationKey);
    if (commandReceipt.idempotentReplay && acceptedReceipt.remoteFinality !== "REQUESTED") return { commandReceipt, receipt: acceptedReceipt };
    if (input.request.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE") return { commandReceipt, receipt: acceptedReceipt };

    const deliveryStore = new PostgresWorkflowDeliveryStore(this.pool);
    const runtime = this.runtimeFactory(deliveryStore, this.pool, guard);
    const workerId = `connector-revocation-v2:${reservation.commandId.slice(-64)}`;
    await runtime.runDeliveryBatch({ limit: 1, outboxMessageId: commandReceipt.outboxMessageId, tenantId: input.actor.tenantId, workerId });
    await runtime.runReconciliationBatch({ limit: 1, outboxMessageId: commandReceipt.outboxMessageId, tenantId: input.actor.tenantId, workerId });
    const outcome = await readOutboxOutcome(this.pool, input.actor.tenantId, commandReceipt.outboxMessageId);
    if (!outcome) throw new ConnectorRevocationV2Error("P110_READBACK_MISSING", "Canonical P110 readback is unavailable.", 503);
    const classified = classifyRevocationOutcomeV2({
      lastErrorCode: typeof outcome.last_error_code === "string" ? outcome.last_error_code : null,
      providerAcknowledgementRef: typeof outcome.provider_acknowledgement_ref === "string" ? outcome.provider_acknowledgement_ref : null,
      reconciliationRef: typeof outcome.reconciliation_id === "string" ? outcome.reconciliation_id : null,
      reconciliationResult: typeof outcome.reconciliation_result === "string" ? outcome.reconciliation_result : null,
      sourceReadbackRef: typeof outcome.source_readback_ref === "string" ? outcome.source_readback_ref : null,
      state: String(outcome.state),
    });
    const finalReceipt = issueConnectorRevocationReceiptV2({
      ...baseReceipt({ ...input, acceptedKill, guard, priorReceiptId: acceptedReceipt.receiptId, recordedAt: new Date(Date.parse(input.requestedAt) + 1).toISOString(), resolution }),
      ...classified,
    });
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id',$1,true)", [input.actor.tenantId]);
      await insertReceiptV2(client, finalReceipt);
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
      if (!result.rows.length) throw new ConnectorRevocationV2Error("RECEIPT_NOT_FOUND", "Same-tenant connector revocation receipt not found.", 404);
      return parseStoredReceipt(result.rows[0].canonical_receipt);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readLatestV2ByOperation(tenantId: string, operationKey: string) {
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
      if (!result.rows.length) throw new ConnectorRevocationV2Error("REPLAY_RECEIPT_MISSING", "P110 replay receipt has no matching v2 revocation readback.", 503);
      return parseStoredV2Receipt(result.rows[0].canonical_receipt);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export const CONNECTOR_REVOCATION_V2_SOURCE_VERSIONS = Object.freeze([
  CONNECTOR_REVOCATION_REQUEST_V2,
  CONNECTOR_REVOCATION_RECEIPT_V2,
  CONNECTOR_CREDENTIAL_HANDLE_V2,
  CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1,
]);
