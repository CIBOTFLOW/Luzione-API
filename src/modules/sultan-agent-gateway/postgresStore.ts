import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { LeadCommercialCaseStore } from "@/modules/lead-commercial-case/store";
import { OrderFulfillmentStore } from "@/modules/order-fulfillment/store";
import { listP113CatalogProjections } from "@/modules/catalog-projection/store";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION,
  canonicalClaimEvidenceBinding,
  canonicalReadbackHash,
  stage5AdmissionReceiptHash,
  stage5EvidenceRefsHash,
  type CanonicalReadbackReceipt,
  type Stage5AdmissionReceipt,
} from "@/modules/sultan-stage5/contracts";
import {
  LUZIONE_SULTAN_COMMAND_EXECUTION_V1,
  LUZIONE_SULTAN_COMMAND_PREPARATION_V1,
  LUZIONE_SULTAN_EFFECT_RECEIPT_V1,
  LUZIONE_SULTAN_READBACK_V1,
  SultanAgentGatewayError,
  type SultanCommandExecution,
  type SultanCommandPreparation,
  type SultanEffectReadback,
  type SultanEffectReceipt,
} from "@/modules/sultan-agent-gateway/contracts";
import type {
  AuthoritativeCaseSnapshot,
  BoundEvidence,
  CommercialCaseSnapshot,
  SultanAgentGatewayStore,
} from "@/modules/sultan-agent-gateway/service";

const INTERNAL_ACTION_SOURCE = "public.sultan_agent_internal_actions";

type ReservationRow = {
  admission_receipt_id: string | null;
  reservation_id: string;
  operation_id: string;
  run_id: string;
  tool_call_id: string;
  tool_id: string;
  tool_version: string;
  agent_id: string;
  agent_version: string;
  case_id: string;
  case_type: string;
  expected_version: string;
  effect_class: "A1" | "A2" | "A3";
  approval_mode: "BLOCKED" | "PER_COMMAND_HUMAN" | "POLICY_ENVELOPE";
  arguments_hash: string;
  command_hash: string;
  state: "PREPARED" | "EXECUTED" | "CANCELLED" | "RECONCILIATION_REQUIRED";
  preview: Record<string, unknown>;
  receipt_id: string | null;
  expires_at: Date | string;
  created_at: Date | string;
};

export class PostgresSultanAgentGatewayStore implements SultanAgentGatewayStore {
  private readonly commercialCases: LeadCommercialCaseStore;
  private readonly orderFulfillment: OrderFulfillmentStore;

  constructor(private readonly pool: Pool = databasePool()) {
    this.commercialCases = new LeadCommercialCaseStore(pool);
    this.orderFulfillment = new OrderFulfillmentStore(pool);
  }

  async requireStage5Admission(input: Parameters<SultanAgentGatewayStore["requireStage5Admission"]>[0]) {
    const client = await this.pool.connect();
    try {
      await begin(client, input.actor.tenantId);
      const admissionResult = await client.query<{ receipt: Stage5AdmissionReceipt }>(
        `select receipt
           from public.sultan_api_admission_receipts
          where tenant_id=$1 and admission_receipt_id=$2
          limit 1`,
        [input.actor.tenantId, input.call.admissionReceiptId],
      );
      const admission = admissionResult.rows[0]?.receipt;
      if (!admission) {
        throw new SultanAgentGatewayError("STAGE5_ADMISSION_REQUIRED", "The exact tenant-bound Stage 5 admission receipt was not found.", 403);
      }
      const evidenceResult = await client.query<{ receipt: CanonicalReadbackReceipt }>(
        `select receipt
           from public.sultan_canonical_readback_receipts
          where tenant_id=$1 and readback_receipt_id=any($2::text[])
          order by readback_receipt_id`,
        [input.actor.tenantId, admission.evidence.readbackReceiptIds],
      );
      await client.query("commit");
      verifyStage5AdmissionForTool(input, admission, evidenceResult.rows.map((row) => row.receipt));
      return admission;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readCase(actor: ApiActor, caseRef: Parameters<SultanAgentGatewayStore["readCase"]>[1]): Promise<AuthoritativeCaseSnapshot | null> {
    if (caseRef.caseType === "COMMERCIAL") {
      const value = await this.commercialCases.readCommercialCase(actor, caseRef.caseId) as CommercialCaseSnapshot | null;
      if (!value) return null;
      const sourceRef = `postgres:public.commercial_cases/${caseRef.caseId}@${value.objectVersion}`;
      return {
        caseType: "COMMERCIAL",
        objectVersion: value.objectVersion,
        observedAt: value.commercialCase.updatedAt,
        sourceOfTruth: value.sourceOfTruth,
        sourceRefs: [sourceRef],
        snapshot: value as unknown as Record<string, unknown>,
      };
    }
    if (caseRef.caseType === "FULFILLMENT") {
      const order = await this.orderFulfillment.readOrder(actor, caseRef.caseId);
      if (!order) return null;
      const intent = await this.readLatestFulfillmentIntent(actor, caseRef.caseId);
      const sourceRefs = [`postgres:public.orders/${caseRef.caseId}@${order.objectVersion}`];
      if (intent) sourceRefs.push(`postgres:public.order_fulfillment_intents/${intent.fulfillmentIntent.fulfillmentIntentId}@${intent.objectVersion}`);
      return {
        caseType: "FULFILLMENT",
        objectVersion: order.objectVersion,
        observedAt: order.order.updatedAt,
        sourceOfTruth: "orders+order_lines+order_fulfillment_intents",
        sourceRefs,
        snapshot: { order, fulfillmentIntent: intent },
      };
    }
    if (caseRef.caseType === "CATALOG_QUALITY") {
      const catalog = await listP113CatalogProjections({
        actor,
        cursor: null,
        limit: 5,
        productType: null,
        query: caseRef.caseId,
        quoteSelectable: null,
        status: null,
        vendor: null,
      });
      const selection = catalog.selections[0] as Record<string, unknown> | undefined;
      if (!selection) return null;
      const version = typeof catalog.readback.sourceVersion === "string" && catalog.readback.sourceVersion
        ? `catalog-projection:${catalog.readback.sourceVersion}`
        : `catalog-projection:${sha256(selection).slice(0, 24)}`;
      const observedAtValue = catalog.readback.freshness.observedAt;
      const observedAt = typeof observedAtValue === "string" && Number.isFinite(Date.parse(observedAtValue))
        ? new Date(observedAtValue).toISOString()
        : new Date(0).toISOString();
      return {
        caseType: "CATALOG_QUALITY",
        objectVersion: version,
        observedAt,
        sourceOfTruth: String(catalog.sourceOfTruth),
        sourceRefs: [`postgres:public.p113_catalog_search_projections/${caseRef.caseId}@${version}`],
        snapshot: { selection, coverage: catalog.coverage, readback: catalog.readback, latestRun: catalog.latestRun },
      };
    }
    return null;
  }

  async readEvidence(actor: ApiActor, caseRef: Parameters<SultanAgentGatewayStore["readEvidence"]>[1], toolId: string): Promise<BoundEvidence> {
    const observed = await this.readCase(actor, caseRef);
    if (!observed) return { freshness: "UNKNOWN", sourceRefs: [], evidence: {}, missingEvidence: ["authoritative case"] };
    if (caseRef.caseType === "COMMERCIAL") return await this.readCommercialEvidence(actor, observed, toolId);
    if (caseRef.caseType === "FULFILLMENT") return fulfillmentEvidence(observed);
    if (caseRef.caseType === "CATALOG_QUALITY") return catalogEvidence(observed);
    return { freshness: "UNKNOWN", sourceRefs: observed.sourceRefs, evidence: observed.snapshot, missingEvidence: ["supported pilot evidence adapter"] };
  }

  async prepareCommand(input: Parameters<SultanAgentGatewayStore["prepareCommand"]>[0]): Promise<SultanCommandPreparation> {
    const reservationId = `sultan-reservation-${sha256([input.actor.tenantId, input.call.operationId]).slice(0, 32)}`;
    const expiresAt = new Date(Date.parse(input.now) + 15 * 60_000).toISOString();
    const client = await this.pool.connect();
    try {
      await begin(client, input.actor.tenantId);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`sultan-command:${input.actor.tenantId}:${input.call.operationId}`]);
      const existing = await client.query<ReservationRow>(
        "select * from public.sultan_agent_command_reservations where tenant_id=$1 and operation_id=$2 for update",
        [input.actor.tenantId, input.call.operationId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].command_hash !== input.commandHash) throw new SultanAgentGatewayError("COMMAND_IDEMPOTENCY_CONFLICT", "The operation identity is already bound to another command.", 409);
        await client.query("commit");
        return preparationFromRow(existing.rows[0], true);
      }
      const inserted = await client.query<ReservationRow>(
        `insert into public.sultan_agent_command_reservations (
           tenant_id,reservation_id,admission_receipt_id,operation_id,run_id,tool_call_id,tool_id,tool_version,
           agent_id,agent_version,case_id,case_type,expected_version,effect_class,approval_mode,
           arguments_hash,command_hash,state,preview,expires_at,created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PREPARED',$18::jsonb,$19,$20)
         returning *`,
        [input.actor.tenantId, reservationId, input.call.admissionReceiptId, input.call.operationId, input.call.runId, input.call.toolCallId,
          input.call.toolId, input.call.toolVersion, input.call.agent.agentId, input.call.agent.agentVersion,
          input.call.caseRef.caseId, input.call.caseRef.caseType, input.observedCase.objectVersion,
          input.effectClass, input.approvalMode, input.call.argumentsHash, input.commandHash,
          JSON.stringify(input.preview), expiresAt, input.now],
      );
      await client.query("commit");
      return preparationFromRow(inserted.rows[0], false);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async executeCommand(input: Parameters<SultanAgentGatewayStore["executeCommand"]>[0]): Promise<SultanCommandExecution> {
    const client = await this.pool.connect();
    try {
      await begin(client, input.actor.tenantId);
      const result = await client.query<ReservationRow>(
        "select * from public.sultan_agent_command_reservations where tenant_id=$1 and reservation_id=$2 for update",
        [input.actor.tenantId, input.reservationId],
      );
      const reservation = result.rows[0];
      if (!reservation) throw new SultanAgentGatewayError("COMMAND_RESERVATION_NOT_FOUND", "The command reservation was not found.", 404);
      if (!reservation.admission_receipt_id) throw new SultanAgentGatewayError("STAGE5_ADMISSION_REQUIRED", "The reservation is not bound to a Stage 5 admission receipt.", 403);
      if (reservation.command_hash !== input.commandHash) throw new SultanAgentGatewayError("COMMAND_HASH_MISMATCH", "Execution does not match the reserved command.", 409);
      if (reservation.effect_class !== "A1" || reservation.approval_mode !== "PER_COMMAND_HUMAN") throw new SultanAgentGatewayError("COMMAND_EXECUTION_BLOCKED", "Only approved A1 internal actions may execute in this pilot.", 403);
      if (Date.parse(String(reservation.expires_at)) <= Date.parse(input.now)) throw new SultanAgentGatewayError("COMMAND_RESERVATION_EXPIRED", "The command reservation expired before execution.", 409);
      if (reservation.state === "EXECUTED" && reservation.receipt_id) {
        const replay = await this.readInternalActionTx(client, input.actor.tenantId, reservation.receipt_id, input.now);
        if (!replay) throw new SultanAgentGatewayError("COMMAND_READBACK_MISSING", "Executed command readback is missing; reconciliation is required.", 503);
        await client.query("commit");
        return executionFromReadback(reservation, replay, true);
      }
      if (reservation.state !== "PREPARED") throw new SultanAgentGatewayError("COMMAND_STATE_INVALID", "The command reservation is not executable.", 409);

      const actionId = `sultan-action-${sha256([input.actor.tenantId, reservation.reservation_id]).slice(0, 32)}`;
      const receiptId = `sultan-receipt-${sha256([input.actor.tenantId, actionId]).slice(0, 32)}`;
      await client.query(
        `insert into public.sultan_agent_internal_actions (
           tenant_id,action_id,receipt_id,reservation_id,operation_id,run_id,tool_call_id,tool_id,
           case_id,case_type,object_version,campaign_id,payload,state,approval_id,approved_by,
           approved_at,external_effect_authorized,provider_dispatch_authorized,created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'SOURCE_CONFIRMED',$14,$15,$16,false,false,$17)`,
        [input.actor.tenantId, actionId, receiptId, reservation.reservation_id, reservation.operation_id,
          reservation.run_id, reservation.tool_call_id, reservation.tool_id, reservation.case_id,
          reservation.case_type, reservation.expected_version, String(reservation.preview.campaignId ?? ""),
          JSON.stringify(reservation.preview), input.approvalAdmission.approvalId,
          input.approvalAdmission.operatorId, input.approvalAdmission.approvedAt, input.now],
      );
      await client.query(
        `update public.sultan_agent_command_reservations
            set state='EXECUTED', receipt_id=$3, approved_by=$4, approval_id=$5, executed_at=$6
          where tenant_id=$1 and reservation_id=$2`,
        [input.actor.tenantId, reservation.reservation_id, receiptId, input.approvalAdmission.operatorId, input.approvalAdmission.approvalId, input.now],
      );
      reservation.state = "EXECUTED";
      reservation.receipt_id = receiptId;
      const readback = await this.readInternalActionTx(client, input.actor.tenantId, receiptId, input.now);
      if (!readback) throw new SultanAgentGatewayError("COMMAND_READBACK_MISSING", "The internal action was not observed after execution.", 503);
      await client.query("commit");
      return executionFromReadback(reservation, readback, false);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readEffect(actor: ApiActor, receiptId: string, now: string): Promise<SultanEffectReadback | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const internal = await this.readInternalActionTx(client, actor.tenantId, receiptId, now);
      if (internal) {
        await client.query("commit");
        return internal;
      }
      const historical = await client.query(
        `select receipt.command_type, outbox.state, outbox.provider_acknowledgement_ref, outbox.source_readback_ref
           from public.p110_command_receipts receipt
           join public.p110_outbox_messages outbox on outbox.tenant_id=receipt.tenant_id and outbox.receipt_id=receipt.receipt_id
          where receipt.tenant_id=$1 and receipt.receipt_id=$2 and receipt.command_type='sultan.supplier_rfq_email.canary.send' limit 1`,
        [actor.tenantId, receiptId],
      );
      await client.query("commit");
      const row = historical.rows[0] as Record<string, unknown> | undefined;
      return row ? historicalReadback(receiptId, row, now) : null;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readCommercialEvidence(actor: ApiActor, observed: AuthoritativeCaseSnapshot, toolId: string): Promise<BoundEvidence> {
    const commercial = (observed.snapshot as unknown as CommercialCaseSnapshot).commercialCase;
    if (toolId === "luzione.missing_evidence.read") {
      const missingEvidence = commercialMissingEvidence(commercial);
      return { freshness: "FRESH", sourceRefs: observed.sourceRefs, evidence: { commercialCase: commercial }, missingEvidence };
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      if (toolId === "luzione.account_activity.read") {
        const present = await tableExists(client, "public.crm_activities");
        const rows = present ? await client.query(
          "select id,activity_type,notes,created_at from public.crm_activities where tenant_id=$1 and object_id in ($2,$3) order by created_at desc limit 20",
          [actor.tenantId, commercial.caseId, commercial.accountId ?? ""],
        ) : { rows: [] };
        await client.query("commit");
        return { freshness: "FRESH", sourceRefs: [...observed.sourceRefs, "postgres:public.crm_activities"], evidence: { activities: rows.rows }, missingEvidence: rows.rows.length ? [] : ["account activity history"] };
      }
      if (toolId === "luzione.proposal_evidence.read") {
        const rows = await client.query(
          `select proposal_document_version_id,artifact_hash,completeness_gate,created_at
             from public.commercial_case_proposal_document_versions
            where tenant_id=$1 and case_id=$2 order by created_at desc limit 5`,
          [actor.tenantId, commercial.caseId],
        );
        await client.query("commit");
        return { freshness: "FRESH", sourceRefs: [...observed.sourceRefs, "postgres:public.commercial_case_proposal_document_versions"], evidence: { proposalVersions: rows.rows }, missingEvidence: rows.rows.length ? [] : ["proposal evidence"] };
      }
      if (toolId === "luzione.supplier_facts.read") {
        const rows = await client.query(
          `select proposal_context_version_id,source_supplier_inquiry_version_id,lineage_refs,created_at
             from public.commercial_case_proposal_context_versions
            where tenant_id=$1 and case_id=$2 order by created_at desc limit 5`,
          [actor.tenantId, commercial.caseId],
        );
        await client.query("commit");
        return { freshness: "FRESH", sourceRefs: [...observed.sourceRefs, "postgres:public.commercial_case_proposal_context_versions"], evidence: { supplierContext: rows.rows }, missingEvidence: rows.rows.length ? [] : ["supplier facts"] };
      }
      await client.query("commit");
      return { freshness: "UNKNOWN", sourceRefs: observed.sourceRefs, evidence: {}, missingEvidence: ["implemented evidence tool"] };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readLatestFulfillmentIntent(actor: ApiActor, orderId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const result = await client.query(
        "select fulfillment_intent_id from public.order_fulfillment_intents where tenant_id=$1 and external_order_id=$2 order by created_at desc limit 1",
        [actor.tenantId, orderId],
      );
      await client.query("commit");
      const id = result.rows[0]?.fulfillment_intent_id;
      return id ? await this.orderFulfillment.readFulfillmentIntent(actor, String(id)) : null;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readInternalActionTx(client: PoolClient, tenantId: string, receiptId: string, now: string): Promise<SultanEffectReadback | null> {
    const result = await client.query(
      `select receipt_id,action_id,state from public.sultan_agent_internal_actions
        where tenant_id=$1 and receipt_id=$2 limit 1`,
      [tenantId, receiptId],
    );
    if (!result.rows[0]) return null;
    return {
      contractVersion: LUZIONE_SULTAN_READBACK_V1,
      receiptId,
      observedAt: now,
      state: "SOURCE_CONFIRMED",
      providerRef: null,
      sourceReadbackRef: `postgres:${INTERNAL_ACTION_SOURCE}/${String(result.rows[0].action_id)}`,
      authoritativeSource: INTERNAL_ACTION_SOURCE,
      businessFinal: false,
      deliveryProven: false,
      nextSafeAction: "Review the reversible internal action. No external provider effect occurred.",
    };
  }
}

function preparationFromRow(row: ReservationRow, idempotentReplay: boolean): SultanCommandPreparation {
  const executionAllowed = row.effect_class === "A1" && row.approval_mode === "PER_COMMAND_HUMAN";
  return {
    contractVersion: LUZIONE_SULTAN_COMMAND_PREPARATION_V1,
    admissionReceiptId: requiredAdmissionReceiptId(row),
    reservationId: row.reservation_id,
    operationId: row.operation_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    toolId: row.tool_id,
    toolVersion: row.tool_version,
    agent: { agentId: row.agent_id, agentVersion: row.agent_version },
    caseRef: { caseId: row.case_id, caseType: row.case_type as SultanCommandPreparation["caseRef"]["caseType"], expectedVersion: row.expected_version },
    effectClass: row.effect_class,
    approvalMode: row.approval_mode,
    commandHash: row.command_hash,
    argumentsHash: row.arguments_hash,
    state: row.state,
    preview: row.preview,
    expiresAt: new Date(row.expires_at).toISOString(),
    executionAllowed,
    nextSafeAction: executionAllowed
      ? "Obtain an exact signed human approval for this reservation, then resume the same run."
      : "A2 execution is disabled. Inspect readiness and denial evidence only; do not dispatch.",
    idempotentReplay,
  };
}

function requiredAdmissionReceiptId(row: ReservationRow) {
  if (!row.admission_receipt_id) throw new SultanAgentGatewayError("STAGE5_ADMISSION_REQUIRED", "The command reservation is not bound to Stage 5 admission evidence.", 403);
  return row.admission_receipt_id;
}

function verifyStage5AdmissionForTool(
  input: Parameters<SultanAgentGatewayStore["requireStage5Admission"]>[0],
  admission: Stage5AdmissionReceipt,
  readbacks: readonly CanonicalReadbackReceipt[],
) {
  const failures: string[] = [];
  if (admission.contractVersion !== SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION) failures.push("CONTRACT_VERSION_MISMATCH");
  if (admission.admissionReceiptId !== input.call.admissionReceiptId) failures.push("RECEIPT_ID_MISMATCH");
  if (admission.credentialActor.actorId !== input.actor.actorId
    || admission.credentialActor.actorType !== input.actor.actorType
    || admission.credentialActor.tenantId !== input.actor.tenantId
    || admission.credentialActor.source !== input.actor.source) failures.push("WORKLOAD_IDENTITY_MISMATCH");
  if (admission.operationId !== input.call.operationId) failures.push("OPERATION_MISMATCH");
  if (admission.runId !== input.call.runId) failures.push("RUN_MISMATCH");
  if (admission.logicalAgent.agentId !== input.call.agent.agentId
    || admission.logicalAgent.agentVersion !== input.call.agent.agentVersion) failures.push("AGENT_MISMATCH");
  if (admission.caseRef.caseId !== input.call.caseRef.caseId
    || admission.caseRef.caseType !== input.call.caseRef.caseType
    || admission.caseRef.expectedVersion !== input.call.caseRef.expectedVersion) failures.push("CASE_SCOPE_MISMATCH");
  if (admission.purpose !== input.call.purpose) failures.push("PURPOSE_MISMATCH");
  if (admission.requestedCapability !== input.requestedCapability) failures.push("CAPABILITY_MISMATCH");
  if (admission.requestedEffectClass !== input.effectClass) failures.push("EFFECT_CLASS_MISMATCH");
  const expectedStatus = input.effectClass === "A0" ? "ADMITTED_NO_EFFECT" : "SEPARATE_REVIEW_REQUIRED";
  if (admission.status !== expectedStatus || admission.externalEffectsAuthorized !== false) failures.push("ADMISSION_STATUS_MISMATCH");
  const expectedPhases = input.effectClass === "A0" ? new Set(["REASONING", "SIMULATION"]) : new Set(["ACTION_PREPARATION"]);
  if (!expectedPhases.has(admission.phase)) failures.push("PHASE_MISMATCH");
  const nowMillis = Date.parse(input.now);
  const decidedMillis = Date.parse(admission.decidedAt);
  if (!Number.isFinite(nowMillis) || !Number.isFinite(decidedMillis)
    || decidedMillis > nowMillis + 30_000 || nowMillis - decidedMillis > 5 * 60_000) failures.push("ADMISSION_STALE");

  const { idempotentReplay: _replay, receiptHash, ...admissionWithoutHash } = admission;
  void _replay;
  if (stage5AdmissionReceiptHash(admissionWithoutHash) !== receiptHash) failures.push("ADMISSION_HASH_MISMATCH");
  if (readbacks.length !== admission.evidence.readbackReceiptIds.length) failures.push("EVIDENCE_RECEIPT_MISSING");
  const verifiedReadbacks = readbacks.map((readback) => {
    const { idempotentReplay: _readbackReplay, readbackHash, ...readbackWithoutHash } = readback;
    void _readbackReplay;
    if (canonicalReadbackHash(readbackWithoutHash) !== readbackHash) failures.push("READBACK_HASH_MISMATCH");
    if (readback.tenantId !== input.actor.tenantId || readback.status !== "AVAILABLE"
      || !readback.freshUntil || Date.parse(readback.freshUntil) <= nowMillis) failures.push("READBACK_NOT_CURRENT");
    return {
      apiDeploymentSha: readback.apiDeploymentSha,
      claimEvidence: readback.claims.map((claim) => canonicalClaimEvidenceBinding(readback, claim)),
      consumerActorId: readback.consumer.actorId,
      consumerReleaseSha: readback.consumer.deploymentSha,
      freshUntil: readback.freshUntil,
      observedAt: readback.observedAt,
      readbackHash: readback.readbackHash,
      readbackReceiptId: readback.readbackReceiptId,
      sourceRefs: readback.provenance.sourceRefs,
      sourceVersion: readback.provenance.sourceVersion,
      status: readback.status,
      subjectId: readback.subjectId,
      subjectType: readback.subjectType,
      tenantId: readback.tenantId,
    };
  });
  if (stage5EvidenceRefsHash(verifiedReadbacks) !== admission.evidence.evidenceRefsHash) failures.push("EVIDENCE_HASH_MISMATCH");
  const expectedContextRefs = readbacks.map((readback) => ({
    freshness: "FRESH",
    integrityHash: readback.readbackHash,
    observedAt: readback.observedAt,
    sourceRef: `api:canonical-readback/${readback.readbackReceiptId}`,
    sourceVersion: readback.readbackHash,
  })).sort(contextRefOrder);
  const receivedContextRefs = input.call.contextRefs.map((reference) => ({ ...reference })).sort(contextRefOrder);
  if (JSON.stringify(expectedContextRefs) !== JSON.stringify(receivedContextRefs)) failures.push("TOOL_CONTEXT_EVIDENCE_MISMATCH");
  if (failures.length > 0) {
    throw new SultanAgentGatewayError("STAGE5_ADMISSION_MISMATCH", `Stage 5 admission failed closed: ${[...new Set(failures)].sort().join(",")}.`, 403);
  }
}

function contextRefOrder(left: { sourceRef: string }, right: { sourceRef: string }) {
  return left.sourceRef.localeCompare(right.sourceRef);
}

function executionFromReadback(reservation: ReservationRow, readback: SultanEffectReadback, idempotentReplay: boolean): SultanCommandExecution {
  const receipt: SultanEffectReceipt = {
    contractVersion: LUZIONE_SULTAN_EFFECT_RECEIPT_V1,
    receiptId: readback.receiptId,
    operationId: reservation.operation_id,
    toolCallId: reservation.tool_call_id,
    toolId: reservation.tool_id,
    effectClass: "A1",
    state: "SOURCE_CONFIRMED",
    idempotentReplay,
    providerRef: null,
    resultHash: sha256({ reservationId: reservation.reservation_id, receiptId: readback.receiptId, readback }),
    createdAt: readback.observedAt,
    businessFinal: false,
  };
  return {
    contractVersion: LUZIONE_SULTAN_COMMAND_EXECUTION_V1,
    reservationId: reservation.reservation_id,
    operationId: reservation.operation_id,
    commandHash: reservation.command_hash,
    state: "SOURCE_CONFIRMED",
    receipt,
    readback,
    idempotentReplay,
    nextSafeAction: readback.nextSafeAction,
  };
}

function fulfillmentEvidence(observed: AuthoritativeCaseSnapshot): BoundEvidence {
  const snapshot = observed.snapshot as { order?: { order?: Record<string, unknown> }; fulfillmentIntent?: unknown };
  const order = snapshot.order?.order ?? {};
  const missingEvidence: string[] = [];
  if (!snapshot.fulfillmentIntent) missingEvidence.push("fulfillment intent");
  if (!Array.isArray(order.lines) || order.lines.length === 0) missingEvidence.push("order lines");
  if (!order.customerId) missingEvidence.push("canonical customer binding");
  return { freshness: "FRESH", sourceRefs: observed.sourceRefs, evidence: observed.snapshot, missingEvidence };
}

function catalogEvidence(observed: AuthoritativeCaseSnapshot): BoundEvidence {
  const snapshot = observed.snapshot as { selection?: Record<string, unknown>; coverage?: Record<string, unknown>; readback?: Record<string, unknown> };
  const selection = snapshot.selection ?? {};
  const missingEvidence: string[] = [];
  if (!selection.title && !selection.name) missingEvidence.push("product title");
  if (!selection.vendor) missingEvidence.push("vendor");
  if (!selection.sku && !selection.shopifyVariantId) missingEvidence.push("variant identity");
  const freshnessState = snapshot.readback && typeof snapshot.readback.freshness === "object"
    ? (snapshot.readback.freshness as Record<string, unknown>).state
    : null;
  const freshness = freshnessState === "FRESH" ? "FRESH" : freshnessState === "STALE" ? "STALE" : "UNKNOWN";
  if (freshness !== "FRESH") missingEvidence.push("fresh Shopify catalog projection");
  return { freshness, sourceRefs: observed.sourceRefs, evidence: observed.snapshot, missingEvidence };
}

function commercialMissingEvidence(commercial: CommercialCaseSnapshot["commercialCase"]) {
  const missing: string[] = [];
  if (commercial.amount === null) missing.push("commercial amount");
  if (!commercial.accountId) missing.push("canonical account binding");
  if (!commercial.primaryContactId) missing.push("canonical primary contact binding");
  if (!commercial.owner) missing.push("commercial owner");
  if (!commercial.nextAction) missing.push("next action");
  return missing;
}

async function begin(client: PoolClient, tenantId: string) {
  await client.query("begin");
  await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
}

async function tableExists(client: PoolClient, table: string) {
  const result = await client.query("select to_regclass($1) is not null as present", [table]);
  return result.rows[0]?.present === true;
}

function historicalReadback(receiptId: string, row: Record<string, unknown>, now: string): SultanEffectReadback {
  const state = String(row.state);
  const accepted = state === "PROVIDER_ACKNOWLEDGED" || state === "SOURCE_CONFIRMED";
  const reconciliation = state === "RECONCILIATION_REQUIRED" || state === "DISPATCHED";
  return {
    contractVersion: LUZIONE_SULTAN_READBACK_V1,
    receiptId,
    observedAt: now,
    state: state === "SOURCE_CONFIRMED" ? "SOURCE_CONFIRMED" : accepted ? "PROVIDER_ACCEPTED" : reconciliation ? "RECONCILIATION_REQUIRED" : "NOT_DISPATCHED",
    providerRef: row.provider_acknowledgement_ref ? String(row.provider_acknowledgement_ref) : null,
    sourceReadbackRef: row.source_readback_ref ? String(row.source_readback_ref) : null,
    authoritativeSource: accepted ? "gmail.googleapis.com" : "public.p110_outbox_messages",
    businessFinal: false,
    deliveryProven: false,
    nextSafeAction: accepted ? "Treat this as provider acceptance only; delivery is not proven." : "Do not resend automatically; reconcile the historical operation.",
  };
}
