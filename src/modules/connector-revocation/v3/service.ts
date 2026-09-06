import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { PostgresEffectKillStateReader } from "@/modules/effect-admission/gate";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { createLifecycleCommandRequest, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  CONNECTOR_REVOCATION_RECEIPT_V2,
  parseConnectorRevocationReceiptV2,
  type ConnectorRevocationRequestV2,
} from "../v2/contracts";
import { RevocationPhaseKillGuardV2, type RevocationKillReaderV2 } from "../v2/killGuard";
import {
  CONNECTOR_BINDING_READBACK_V1,
  CONNECTOR_REVOCATION_POLICY_V3,
  CONNECTOR_REVOCATION_READBACK_V1,
  CONNECTOR_REVOCATION_RECEIPT_V3,
  CONNECTOR_REVOCATION_REQUEST_V3,
  ConnectorRevocationV3Error,
  assertLocatorFree,
  assertSelectorMatchesBindingReadbackV1,
  issueConnectorRevocationReceiptV3,
  parseConnectorBindingReadbackV1,
  parseConnectorRevocationReadbackV1,
  parseConnectorRevocationReceiptV3,
  projectConnectorRevocationReadbackV1,
  revocationReservationV3,
  type ConnectorRevocationReadbackV1,
  type ConnectorRevocationReceiptV3,
  type ConnectorRevocationRequestV3,
} from "./contracts";
import { UnavailableConnectorBindingReadbackResolverV1, type ConnectorBindingReadbackResolverV1 } from "./resolver";

function decodeStoredJson(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { throw new ConnectorRevocationV3Error("READBACK_INVALID", "Stored connector revocation evidence is invalid.", 503); }
}

function parseStoredV3(value: unknown) {
  const parsed = parseConnectorRevocationReceiptV3(decodeStoredJson(value));
  assertLocatorFree(parsed, "storedReceipt");
  return parsed;
}

async function insertReceiptV3(client: PoolClient, receipt: ConnectorRevocationReceiptV3, rawBodyDigest: string) {
  const readback = projectConnectorRevocationReadbackV1(receipt);
  const selectedKill = receipt.killEvidence.beforeExecuteOrDisposition ?? receipt.killEvidence.beforeCredentialHold ?? receipt.killEvidence.accepted;
  const result = await client.query(
    `insert into public.connector_revocation_receipts
      (tenant_id,receipt_id,receipt_digest,prior_receipt_id,binding_id,binding_contract_version,binding_version,
       connector_provider,provider_account_ref,destination,credential_handle_ref,credential_handle_version,
       credential_handle_contract_version,credential_generation,credential_handle_digest,binding_resolution_digest,
       binding_owner_readback_ref,operation_kind,operation_key,payload_digest,containment_kill_version,normal_kill_version,
       request_actor_id,request_actor_class,human_actor_id,human_authentication_ref,command_receipt_ref,
       provider_acknowledgement_ref,source_readback_ref,reconciliation_ref,reconciliation_result,
       remote_finality,local_credential_disposition,recovery_state,zero_effect,canonical_receipt,recorded_at,
       binding_readback_contract_version,binding_head_digest,credential_content_digest,public_readback_id,
       public_readback_digest,request_raw_digest,canonical_readback)
     values ($1,$2,$3,null,$4::uuid,$5,$6,$7,$8,$9,null,null,null,$10,null,null,null,$11,$12,$13,$14,$15,
             $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,true,$28::jsonb,$29,$30,$31,$32,$33,$34,$35,$36::jsonb)
     on conflict (tenant_id,receipt_id) do nothing returning canonical_readback`,
    [
      receipt.tenantId, receipt.receiptId, receipt.receiptDigest, receipt.bindingReadback.bindingId,
      CONNECTOR_BINDING_READBACK_V1, receipt.bindingReadback.bindingVersion, receipt.bindingReadback.provider,
      receipt.bindingReadback.providerAccountRef, receipt.bindingReadback.destination, receipt.bindingReadback.credential.generation,
      receipt.operation.kind, receipt.operation.key, receipt.operation.payloadDigest,
      selectedKill.containmentKillVersion, selectedKill.normalKillVersion,
      receipt.actor.requestActorId, receipt.actor.requestActorClass, receipt.actor.humanActorId,
      receipt.actor.humanAuthenticationRef, receipt.commandReceiptRef,
      receipt.acknowledgement.providerAcknowledgementRef, receipt.acknowledgement.sourceReadbackRef,
      receipt.reconciliation.reconciliationRef, receipt.reconciliation.result, receipt.remoteFinality,
      receipt.localCredentialDisposition, receipt.recoveryState, JSON.stringify(receipt), receipt.recordedAt,
      CONNECTOR_BINDING_READBACK_V1, receipt.bindingReadback.bindingHeadDigest,
      receipt.bindingReadback.credential.contentBindingDigest, readback.readbackId, readback.projectionDigest,
      rawBodyDigest, JSON.stringify(readback),
    ],
  );
  if (result.rows.length) return parseConnectorRevocationReadbackV1(result.rows[0].canonical_readback);
  const existing = await client.query(
    `select canonical_readback from public.connector_revocation_receipts
      where tenant_id=$1 and receipt_id=$2 and receipt_digest=$3 and request_raw_digest=$4`,
    [receipt.tenantId, receipt.receiptId, receipt.receiptDigest, rawBodyDigest],
  );
  if (!existing.rows.length) throw new ConnectorRevocationV3Error("APPEND_CONFLICT", "Existing receipt does not match the exact immutable v3 packet.", 409);
  return parseConnectorRevocationReadbackV1(existing.rows[0].canonical_readback);
}

export class ConnectorRevocationServiceV3 {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;
  private readonly killReader: RevocationKillReaderV2;

  constructor(
    private readonly pool: Pool = databasePool(),
    killReader?: RevocationKillReaderV2,
    private readonly resolver: ConnectorBindingReadbackResolverV1 = new UnavailableConnectorBindingReadbackResolverV1(),
  ) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
    this.killReader = killReader ?? new PostgresEffectKillStateReader(pool);
  }

  async execute(input: {
    actor: ApiActor;
    correlationId: string;
    human: HumanApprovalSubject;
    rawBodyDigest: string;
    request: ConnectorRevocationRequestV3;
    requestedAt: string;
  }) {
    this.assertAuthority(input.actor, input.human, input.request.operation.kind);
    if (!/^[a-f0-9]{64}$/.test(input.rawBodyDigest)) throw new ConnectorRevocationV3Error("RAW_BODY_DIGEST_INVALID", "The route must supply the exact raw UTF-8 request digest.");
    await this.assertNoLegacyReservationAlias(input.actor.tenantId, input.request.operationKey);
    const resolved = await this.resolver.resolveCurrent({ bindingId: input.request.selector.bindingId, tenantId: input.actor.tenantId });
    if (!resolved) throw new ConnectorRevocationV3Error("CANONICAL_BINDING_NOT_FOUND", "No current same-tenant canonical connector binding readback was found.", 404);
    const bindingReadback = parseConnectorBindingReadbackV1(resolved);
    assertSelectorMatchesBindingReadbackV1(input.request.selector, bindingReadback, input.actor.tenantId);
    const guard = new RevocationPhaseKillGuardV2(this.killReader, input.actor.tenantId);
    const accepted = await guard.accepted();
    const reservation = revocationReservationV3(input.actor.tenantId, input.request, bindingReadback);
    let acceptedReadback: ConnectorRevocationReadbackV1 | null = null;
    const lifecycle = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: "service", roles: [] },
      causationId: input.request.expectedPriorReadbackId,
      commandId: reservation.commandId,
      commandType: `connector.revocation.v3.${input.request.operation.kind.toLowerCase()}`,
      correlationId: input.correlationId,
      expectedObjectVersion: input.request.expectedPriorReadbackId ?? "ABSENT",
      idempotencyKey: reservation.idempotencyKey,
      payload: { bindingReadback, human: input.human, rawBodyDigest: input.rawBodyDigest, request: input.request },
      policyVersion: CONNECTOR_REVOCATION_POLICY_V3,
      requestedAt: input.requestedAt,
      stepId: null,
      target: { objectId: bindingReadback.bindingId, objectType: "connector_revocation", objectVersion: reservation.objectVersion, ownerProject: "LUZIONE_API", sourceRefs: [CONNECTOR_BINDING_READBACK_V1, CONNECTOR_REVOCATION_REQUEST_V3, CONNECTOR_REVOCATION_RECEIPT_V3, CONNECTOR_REVOCATION_READBACK_V1] },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const commandReceipt = await this.kernel.execute(lifecycle, async (transaction) => {
      let priorReadbackId: string | null = null;
      let acknowledgement = { providerAcknowledgementRef: null, sourceReadbackRef: null } as ConnectorRevocationReceiptV3["acknowledgement"];
      let reconciliation = { reconciliationRef: null, result: "NOT_ATTEMPTED" as const } as ConnectorRevocationReceiptV3["reconciliation"];
      let remoteFinality: ConnectorRevocationReceiptV3["remoteFinality"] = "REQUESTED";
      let recoveryState: ConnectorRevocationReceiptV3["recoveryState"] = "NORMAL";
      let localCredentialDisposition: ConnectorRevocationReceiptV3["localCredentialDisposition"] = "RETAINED";
      if (input.request.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE") {
        const prior = await this.readStoredV3ByPublicId(transaction.client, input.actor.tenantId, input.request.expectedPriorReadbackId!);
        if (!["AMBIGUITY_EXHAUSTED", "BLOCKED", "REMOTE_REVOKE_FAILED", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"].includes(prior.remoteFinality)) throw new ConnectorRevocationV3Error("FORWARD_RECOVERY_NOT_ELIGIBLE", "Forward recovery requires a terminal non-success remote finality.", 409);
        if (prior.bindingReadback.bindingHeadDigest !== bindingReadback.bindingHeadDigest || prior.operation.selector.bindingId !== input.request.selector.bindingId) throw new ConnectorRevocationV3Error("REVOCATION_TUPLE_MISMATCH", "Forward recovery cannot change canonical binding lineage.", 409);
        await guard.recheckBeforeExecuteOrDisposition();
        priorReadbackId = input.request.expectedPriorReadbackId;
        acknowledgement = prior.acknowledgement;
        reconciliation = prior.reconciliation;
        remoteFinality = prior.remoteFinality;
        recoveryState = "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT";
        localCredentialDisposition = "ERASURE_AUTHORIZED_NO_EFFECT";
      }
      const receipt = issueConnectorRevocationReceiptV3({
        acknowledgement,
        actor: { humanActorId: input.human.actorId, humanAuthenticationRef: input.human.authenticationRef, requestActorClass: "service", requestActorId: input.actor.actorId },
        bindingReadback,
        commandReceiptRef: `p110-command:${reservation.commandId}`,
        killEvidence: { accepted, beforeCredentialHold: guard.beforeCredentialHold, beforeExecuteOrDisposition: guard.beforeExecuteOrDisposition },
        localCredentialDisposition,
        operation: { key: input.request.operationKey, kind: input.request.operation.kind, payloadDigest: input.request.payloadDigest, selector: input.request.selector },
        priorReadbackId,
        reconciliation,
        recordedAt: new Date(input.requestedAt).toISOString(),
        recoveryState,
        remoteFinality,
        tenantId: input.actor.tenantId,
      });
      acceptedReadback = await insertReceiptV3(transaction.client, receipt, input.rawBodyDigest);
      return { evidenceRefs: [acceptedReadback.readbackId, bindingReadback.ownerReadbackId, `human-authority:${input.human.authenticationRef}`], objectVersion: acceptedReadback.readbackId };
    });
    if (!acceptedReadback) acceptedReadback = await this.readLatestV3ByOperation(input.actor.tenantId, input.request.operationKey);
    return { commandReceipt, readback: acceptedReadback };
  }

  async replayLegacyV2(input: { actor: ApiActor; human: HumanApprovalSubject; rawBodyDigest: string; request: ConnectorRevocationRequestV2 }) {
    this.assertAuthority(input.actor, input.human, input.request.operation.kind);
    const reservationKey = `connector-revocation:${sha256({ operationKey: input.request.operationKey, tenantId: input.actor.tenantId })}`;
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [input.actor.tenantId]);
      const rows = await client.query(
        `select r.canonical_receipt,c.payload_hash
           from public.connector_revocation_receipts r
           join public.p110_command_receipts c on c.tenant_id=r.tenant_id and c.idempotency_key=$3
          where r.tenant_id=$1 and r.operation_key=$2
          order by r.recorded_at desc,r.receipt_id desc limit 1`,
        [input.actor.tenantId, input.request.operationKey, reservationKey],
      );
      if (!rows.rows.length) throw new ConnectorRevocationV3Error("VERSION_RETIRED", "ConnectorRevocationRequest/v2 permits exact existing replay only.", 409);
      const storedRow = decodeStoredJson(rows.rows[0].canonical_receipt);
      const storedVersion = storedRow && typeof storedRow === "object" ? (storedRow as Record<string, unknown>).contractVersion : null;
      if (storedVersion !== CONNECTOR_REVOCATION_RECEIPT_V2) throw new ConnectorRevocationV3Error("VERSION_ALIAS_DENIED", "A legacy reservation cannot alias another contract version.", 409);
      const receipt = parseConnectorRevocationReceiptV2(storedRow);
      const selectorMatches = JSON.stringify(receipt.operation.selector) === JSON.stringify(input.request.selector);
      const expectedPayloadHash = sha256({ human: input.human, rawBodyDigest: input.rawBodyDigest, request: input.request, resolution: receipt.bindingResolution });
      if (!selectorMatches || receipt.operation.payloadDigest !== input.request.payloadDigest || receipt.actor.humanActorId !== input.human.actorId || receipt.actor.humanAuthenticationRef !== input.human.authenticationRef || rows.rows[0].payload_hash !== expectedPayloadHash) throw new ConnectorRevocationV3Error("REPLAY_CONTENT_CONFLICT", "Legacy replay differs in semantic, raw, owner, or human-authority content.", 409);
      await client.query("commit");
      return { idempotentReplay: true as const, readback: projectConnectorRevocationReadbackV1(receipt) };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async readById(tenantId: string, identifier: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
      const result = await client.query(
        `select canonical_receipt,canonical_readback from public.connector_revocation_receipts
          where tenant_id=$1 and (public_readback_id=$2 or receipt_id=$2) limit 1`,
        [tenantId, identifier],
      );
      await client.query("commit");
      if (!result.rows.length) throw new ConnectorRevocationV3Error("READBACK_NOT_FOUND", "Same-tenant connector revocation readback was not found.", 404);
      const projected = projectConnectorRevocationReadbackV1(decodeStoredJson(result.rows[0].canonical_receipt));
      if (result.rows[0].canonical_readback !== null) {
        const stored = parseConnectorRevocationReadbackV1(decodeStoredJson(result.rows[0].canonical_readback));
        if (stored.projectionDigest !== projected.projectionDigest) throw new ConnectorRevocationV3Error("READBACK_DIGEST_MISMATCH", "Stored readback does not match immutable receipt evidence.", 503);
      }
      return projected;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private assertAuthority(actor: ApiActor, human: HumanApprovalSubject, kind: ConnectorRevocationRequestV3["operation"]["kind"] | ConnectorRevocationRequestV2["operation"]["kind"]) {
    if (actor.actorType !== "service") throw new ConnectorRevocationV3Error("SERVICE_ACTOR_REQUIRED", "Revocation transport requires a credential-bound service actor.", 403);
    if (human.actorType !== "user" || human.actorId === actor.actorId) throw new ConnectorRevocationV3Error("DISTINCT_HUMAN_REQUIRED", "Revocation authority requires a distinct authenticated human subject.", 403);
    if (actor.tenantId !== human.tenantId) throw new ConnectorRevocationV3Error("TENANT_MISMATCH", "Service and human tenants must match.", 403);
    const capability = kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE" ? "connector.revocation.forward_recovery" : "connector.revocation.request";
    if (!human.capabilities.includes(capability)) throw new ConnectorRevocationV3Error("HUMAN_AUTHORITY_DENIED", "The authenticated human lacks the exact revocation capability.", 403);
  }

  private async assertNoLegacyReservationAlias(tenantId: string, operationKey: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
      const result = await client.query(`select canonical_receipt->>'contractVersion' version from public.connector_revocation_receipts where tenant_id=$1 and operation_key=$2 order by recorded_at desc limit 1`, [tenantId, operationKey]);
      await client.query("commit");
      if (result.rows.length && result.rows[0].version !== CONNECTOR_REVOCATION_RECEIPT_V3) throw new ConnectorRevocationV3Error("VERSION_ALIAS_DENIED", "A legacy reservation cannot alias or downgrade a v3 operation key.", 409);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private async readStoredV3ByPublicId(client: PoolClient, tenantId: string, readbackId: string) {
    const result = await client.query(`select canonical_receipt from public.connector_revocation_receipts where tenant_id=$1 and public_readback_id=$2 limit 1`, [tenantId, readbackId]);
    if (!result.rows.length) throw new ConnectorRevocationV3Error("PRIOR_READBACK_NOT_FOUND", "Exact same-tenant prior readback was not found.", 404);
    return parseStoredV3(result.rows[0].canonical_receipt);
  }

  private async readLatestV3ByOperation(tenantId: string, operationKey: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
      const result = await client.query(`select canonical_receipt from public.connector_revocation_receipts where tenant_id=$1 and operation_key=$2 order by recorded_at desc,receipt_id desc limit 1`, [tenantId, operationKey]);
      await client.query("commit");
      if (!result.rows.length) throw new ConnectorRevocationV3Error("REPLAY_READBACK_MISSING", "P110 replay has no matching v3 readback.", 503);
      return projectConnectorRevocationReadbackV1(parseStoredV3(result.rows[0].canonical_receipt));
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
