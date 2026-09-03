import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { AdmissionEvaluation } from "./policy";
import {
  buildCanonicalReadbackReceipt,
  buildOutcomeObservationReceipt,
  deriveOutcomeClassification,
  unavailableCanonicalReadback,
  verifyCanonicalReadbackReceiptIntegrity,
  verifyOutcomeObservationReceipt,
  verifyStage5AdmissionReceiptIntegrity,
  type DerivedCanonicalReadback,
} from "./runtime";
import {
  canonicalClaimEvidenceBinding,
  canonicalReadbackHash,
  outcomeObservationHash,
  type CanonicalClaim,
  type CanonicalReadbackReceipt,
  type CanonicalReadbackRequest,
  type OutcomeObservationReceipt,
  type OutcomeObservationRequest,
  type Stage5AdmissionReceipt,
  type Stage5Pins,
  type VerifiedCanonicalReadbackRef,
} from "./contracts";

export class SultanStage5StoreError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "SultanStage5StoreError";
  }
}

type ReceiptRow<T> = {
  request_hash: string;
  receipt: T;
};

export class PostgresSultanStage5Store {
  constructor(private readonly pool: Pool = databasePool()) {}

  async readAdmissionEvidence(tenantId: string, receiptIds: readonly string[]): Promise<VerifiedCanonicalReadbackRef[]> {
    const client = await this.pool.connect();
    try {
      await beginRead(client, tenantId);
      const result = await client.query<ReceiptRow<CanonicalReadbackReceipt>>(
        `select request_hash,receipt
           from public.sultan_canonical_readback_receipts
          where tenant_id=$1 and readback_receipt_id=any($2::text[])
          order by readback_receipt_id`,
        [tenantId, receiptIds],
      );
      const readbacks: VerifiedCanonicalReadbackRef[] = [];
      for (const { receipt, request_hash: requestHash } of result.rows) {
        if (!receiptIds.includes(receipt.readbackReceiptId)) throw exactReadbackFailure("CANONICAL_READBACK");
        await assertPersistedCanonicalReadback(client, tenantId, receipt, requestHash);
        const { idempotentReplay, readbackHash, ...hashMaterial } = receipt;
        void idempotentReplay;
        if (canonicalReadbackHash(hashMaterial) !== readbackHash) {
          throw new SultanStage5StoreError(
            "CANONICAL_READBACK_INTEGRITY_FAILED",
            "Stored canonical readback receipt integrity failed closed.",
            503,
          );
        }
        readbacks.push({
          apiDeploymentSha: receipt.apiDeploymentSha,
          claimEvidence: Object.freeze(receipt.claims.map((claim) =>
            canonicalClaimEvidenceBinding(receipt, claim))),
          consumerActorId: receipt.consumer.actorId,
          consumerReleaseSha: receipt.consumer.deploymentSha,
          freshUntil: receipt.freshUntil,
          observedAt: receipt.observedAt,
          readbackHash: receipt.readbackHash,
          readbackReceiptId: receipt.readbackReceiptId,
          sourceRefs: receipt.provenance.sourceRefs,
          sourceVersion: receipt.provenance.sourceVersion,
          status: receipt.status,
          subjectId: receipt.subjectId,
          subjectType: receipt.subjectType,
          tenantId: receipt.tenantId,
        });
      }
      await client.query("commit");
      return readbacks;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAdmission(actor: ApiActor, evaluation: AdmissionEvaluation): Promise<Stage5AdmissionReceipt> {
    const client = await this.pool.connect();
    try {
      await beginWrite(client, actor.tenantId);
      await lock(client, `sultan-stage5-admission:${actor.tenantId}:${evaluation.receipt.idempotencyKey}`);
      const existing = await client.query<ReceiptRow<Stage5AdmissionReceipt>>(
        `select request_hash,receipt
           from public.sultan_api_admission_receipts
          where tenant_id=$1 and idempotency_key=$2
          for update`,
        [actor.tenantId, evaluation.receipt.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== evaluation.requestHash) {
          await this.recordConflict(client, actor.tenantId, "ADMISSION", evaluation.receipt.idempotencyKey, existing.rows[0].request_hash, evaluation.requestHash);
          await client.query("commit");
          throw new SultanStage5StoreError("ADMISSION_IDEMPOTENCY_CONFLICT", "The admission idempotency key is bound to different material.", 409);
        }
        await assertPersistedAdmission(
          client,
          actor.tenantId,
          existing.rows[0].receipt,
          evaluation.requestHash,
        );
        await client.query("commit");
        return Object.freeze({ ...existing.rows[0].receipt, idempotentReplay: true });
      }
      await client.query(
        `insert into public.sultan_api_admission_receipts (
           tenant_id,admission_receipt_id,idempotency_key,operation_id,run_id,interaction_id,
           status,phase,credential_actor_id,logical_agent_id,logical_agent_version,case_id,
           case_type,requested_capability,requested_effect_class,participation_contract_sha,
           sultan_deployment_sha,grounding_assembler_deployment_sha,api_deployment_sha,context_hash,grounding_packet_hash,
           participant_set_hash,interaction_receipt_hash,evidence_refs_hash,policy_version,request_hash,receipt_hash,
           requested_at,decided_at,external_effects_authorized,receipt
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
           $22,$23,$24,$25,$26,$27,$28,$29,false,$30::jsonb
         )`,
        [
          actor.tenantId, evaluation.receipt.admissionReceiptId, evaluation.receipt.idempotencyKey,
          evaluation.receipt.operationId, evaluation.receipt.runId, evaluation.receipt.interactionId,
          evaluation.receipt.status, evaluation.receipt.phase, actor.actorId,
          evaluation.receipt.logicalAgent.agentId, evaluation.receipt.logicalAgent.agentVersion,
          evaluation.receipt.caseRef.caseId, evaluation.receipt.caseRef.caseType,
          evaluation.receipt.requestedCapability, evaluation.receipt.requestedEffectClass,
          evaluation.receipt.participation.contractSha, evaluation.receipt.participation.sultanDeploymentSha,
          evaluation.receipt.participation.groundingAssemblerDeploymentSha, evaluation.receipt.apiDeploymentSha,
          evaluation.receipt.participation.contextHash, evaluation.receipt.participation.groundingPacketHash,
          evaluation.receipt.participation.participantSetHash, evaluation.receipt.interactionReceiptHash,
          evaluation.receipt.evidence.evidenceRefsHash,
          evaluation.receipt.policyVersion, evaluation.requestHash, evaluation.receipt.receiptHash,
          evaluation.receipt.requestedAt, evaluation.receipt.decidedAt,
          JSON.stringify(evaluation.receipt),
        ],
      );
      for (const [ordinal, evidence] of evaluation.receipt.evidence.consumedEvidence.entries()) {
        await client.query(
          `insert into public.sultan_api_admission_evidence_refs (
             tenant_id,admission_receipt_id,admission_receipt_hash,readback_receipt_id,
             readback_hash,claim_id,evidence_ref,evidence_hash,ordinal
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            actor.tenantId, evaluation.receipt.admissionReceiptId, evaluation.receipt.receiptHash,
            evidence.readbackReceiptId, evidence.readbackHash, evidence.claimId,
            evidence.evidenceRef, evidence.evidenceHash, ordinal,
          ],
        );
      }
      await assertPersistedAdmission(
        client,
        actor.tenantId,
        evaluation.receipt,
        evaluation.requestHash,
      );
      await client.query("commit");
      return evaluation.receipt;
    } catch (error) {
      if (!(error instanceof SultanStage5StoreError && error.code === "ADMISSION_IDEMPOTENCY_CONFLICT")) {
        await client.query("rollback").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async createCanonicalReadback(input: {
    actor: ApiActor;
    now: string;
    pins: Stage5Pins;
    request: CanonicalReadbackRequest;
  }): Promise<CanonicalReadbackReceipt> {
    const expectedConsumerSha = input.actor.actorId === "service:luzione-ui"
      ? input.pins.uiDeploymentSha
      : input.actor.actorId === "service:sultan-os"
        ? input.pins.sultanDeploymentSha
        : null;
    if (!expectedConsumerSha || input.request.consumerDeploymentSha !== expectedConsumerSha) {
      throw new SultanStage5StoreError("CONSUMER_DEPLOYMENT_SHA_MISMATCH", "The readback consumer deployment SHA is not the registered exact pin.", 403);
    }
    const requestHash = sha256(input.request);
    const client = await this.pool.connect();
    try {
      await beginWrite(client, input.actor.tenantId);
      await lock(client, `sultan-stage5-readback:${input.actor.tenantId}:${input.request.idempotencyKey}`);
      const existing = await client.query<ReceiptRow<CanonicalReadbackReceipt>>(
        `select request_hash,receipt
           from public.sultan_canonical_readback_receipts
          where tenant_id=$1 and idempotency_key=$2
          for update`,
        [input.actor.tenantId, input.request.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) {
          await this.recordConflict(client, input.actor.tenantId, "READBACK", input.request.idempotencyKey, existing.rows[0].request_hash, requestHash);
          await client.query("commit");
          throw new SultanStage5StoreError("READBACK_IDEMPOTENCY_CONFLICT", "The readback idempotency key is bound to another query.", 409);
        }
        await assertPersistedCanonicalReadback(
          client,
          input.actor.tenantId,
          existing.rows[0].receipt,
          requestHash,
        );
        await client.query("commit");
        return Object.freeze({ ...existing.rows[0].receipt, idempotentReplay: true });
      }
      const derived = await deriveCanonicalReadback(
        client,
        input.actor.tenantId,
        input.request,
        input.now,
        input.pins.maximumEvidenceAgeMs,
      );
      const receipt = buildCanonicalReadbackReceipt({
        actor: input.actor,
        apiDeploymentSha: input.pins.apiDeploymentSha,
        derived,
        request: input.request,
      });
      await client.query(
        `insert into public.sultan_canonical_readback_receipts (
           tenant_id,readback_receipt_id,idempotency_key,consumer_actor_id,consumer_deployment_sha,
           subject_type,subject_id,status,source_version,observed_at,fresh_until,request_hash,
           readback_hash,receipt
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
        [
          input.actor.tenantId, receipt.readbackReceiptId, receipt.idempotencyKey,
          receipt.consumer.actorId, receipt.consumer.deploymentSha, receipt.subjectType,
          receipt.subjectId, receipt.status, receipt.provenance.sourceVersion, receipt.observedAt,
          receipt.freshUntil, requestHash, receipt.readbackHash, JSON.stringify(receipt),
        ],
      );
      await assertPersistedCanonicalReadback(
        client,
        input.actor.tenantId,
        receipt,
        requestHash,
      );
      await client.query("commit");
      return receipt;
    } catch (error) {
      if (!(error instanceof SultanStage5StoreError && error.code === "READBACK_IDEMPOTENCY_CONFLICT")) {
        await client.query("rollback").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async recordOutcome(input: {
    actor: ApiActor;
    apiDeploymentSha: string;
    now: string;
    request: OutcomeObservationRequest;
  }): Promise<OutcomeObservationReceipt> {
    const requestHash = sha256(input.request);
    const client = await this.pool.connect();
    try {
      await beginWrite(client, input.actor.tenantId);
      await lock(client, `sultan-stage5-outcome:${input.actor.tenantId}:${input.request.idempotencyKey}`);
      const existing = await client.query<ReceiptRow<OutcomeObservationReceipt>>(
        `select request_hash,receipt from public.sultan_outcome_observations
          where tenant_id=$1 and idempotency_key=$2 for update`,
        [input.actor.tenantId, input.request.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) {
          await this.recordConflict(client, input.actor.tenantId, "OUTCOME", input.request.idempotencyKey, existing.rows[0].request_hash, requestHash);
          await client.query("commit");
          throw new SultanStage5StoreError("OUTCOME_IDEMPOTENCY_CONFLICT", "The outcome idempotency key is bound to another observation.", 409);
        }
        await assertPersistedOutcome(
          client,
          input.actor.tenantId,
          existing.rows[0].receipt,
          requestHash,
        );
        await assertPersistedOutcomeParents(client, input.actor.tenantId, existing.rows[0].receipt);
        await client.query("commit");
        return Object.freeze({ ...existing.rows[0].receipt, idempotentReplay: true });
      }
      const admissionResult = await client.query<ReceiptRow<Stage5AdmissionReceipt>>(
        `select request_hash,receipt from public.sultan_api_admission_receipts
          where tenant_id=$1 and admission_receipt_id=$2 limit 1`,
        [input.actor.tenantId, input.request.admissionReceiptId],
      );
      const readbackResult = await client.query<ReceiptRow<CanonicalReadbackReceipt>>(
        `select request_hash,receipt from public.sultan_canonical_readback_receipts
          where tenant_id=$1 and readback_receipt_id=$2 limit 1`,
        [input.actor.tenantId, input.request.readbackReceiptId],
      );
      const admission = admissionResult.rows[0]?.receipt;
      const readback = readbackResult.rows[0]?.receipt;
      if (!admission || admission.status === "DENIED") {
        throw new SultanStage5StoreError("ADMISSION_RECEIPT_NOT_ELIGIBLE", "No eligible tenant-bound admission receipt was found.", 404);
      }
      if (!readback) throw new SultanStage5StoreError("READBACK_RECEIPT_NOT_FOUND", "No tenant-bound canonical readback receipt was found.", 404);
      await assertPersistedAdmission(
        client,
        input.actor.tenantId,
        admission,
        admissionResult.rows[0].request_hash,
      );
      await assertPersistedCanonicalReadback(
        client,
        input.actor.tenantId,
        readback,
        readbackResult.rows[0].request_hash,
      );
      if (!verifyStage5AdmissionReceiptIntegrity(admission)) {
        throw new SultanStage5StoreError("ADMISSION_RECEIPT_INTEGRITY_FAILED", "Stored admission receipt integrity failed closed.", 503);
      }
      if (!verifyCanonicalReadbackReceiptIntegrity(readback)) {
        throw new SultanStage5StoreError("CANONICAL_READBACK_INTEGRITY_FAILED", "Stored canonical readback receipt integrity failed closed.", 503);
      }
      if (admission.outcomeExpectation
        && (readback.subjectId !== admission.outcomeExpectation.subjectId
          || readback.subjectType !== admission.outcomeExpectation.subjectType)) {
        throw new SultanStage5StoreError("OUTCOME_SUBJECT_MISMATCH", "Outcome evidence does not bind the exact admitted canonical subject.", 409);
      }
      if (Date.parse(readback.observedAt) < Date.parse(admission.decidedAt)) {
        throw new SultanStage5StoreError("OUTCOME_READBACK_PRECEDES_ADMISSION", "Outcome evidence must be observed after the admitted interaction.", 409);
      }
      if (input.request.mode === "SUPERSEDE") {
        const prior = await client.query<{ admission_receipt_id: string; receipt: OutcomeObservationReceipt; request_hash: string }>(
          `select admission_receipt_id,receipt,request_hash from public.sultan_outcome_observations
            where tenant_id=$1 and observation_id=$2 limit 1`,
          [input.actor.tenantId, input.request.supersedesObservationId],
        );
        if (!prior.rows[0] || prior.rows[0].admission_receipt_id !== admission.admissionReceiptId) {
          throw new SultanStage5StoreError("SUPERSEDED_OBSERVATION_MISMATCH", "The prior observation does not bind the same admission receipt.", 409);
        }
        if (prior.rows[0].receipt.observationId !== input.request.supersedesObservationId) {
          throw new SultanStage5StoreError("SUPERSEDED_OBSERVATION_INTEGRITY_FAILED", "The superseded observation identity failed closed.", 503);
        }
        await assertPersistedOutcome(
          client,
          input.actor.tenantId,
          prior.rows[0].receipt,
          prior.rows[0].request_hash,
        );
        await assertPersistedOutcomeParents(client, input.actor.tenantId, prior.rows[0].receipt);
        if (prior.rows[0].receipt.evidence.readbackHash === readback.readbackHash
          || Date.parse(prior.rows[0].receipt.observedAt) >= Date.parse(readback.observedAt)) {
          throw new SultanStage5StoreError("SUPERSESSION_REQUIRES_NEWER_EVIDENCE", "Supersession requires a newer, different canonical readback.", 409);
        }
      }
      const classification = deriveOutcomeClassification({ admission, readback, request: input.request });
      const receipt = buildOutcomeObservationReceipt({
        actor: input.actor,
        admission,
        apiDeploymentSha: input.apiDeploymentSha,
        classification,
        observedAt: readback.observedAt,
        readback,
        request: input.request,
      });
      await client.query(
        `insert into public.sultan_outcome_observations (
           tenant_id,observation_id,idempotency_key,admission_receipt_id,readback_receipt_id,
           classification,supersedes_observation_id,observer_actor_id,request_hash,receipt_hash,
           observed_at,receipt
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          input.actor.tenantId, receipt.observationId, receipt.idempotencyKey,
          receipt.admissionReceiptId, receipt.evidence.readbackReceiptId,
          receipt.classification, receipt.supersedesObservationId, input.actor.actorId,
          requestHash, receipt.receiptHash, receipt.observedAt, JSON.stringify(receipt),
        ],
      );
      const persistedOutcome = await assertPersistedOutcome(
        client,
        input.actor.tenantId,
        receipt,
        requestHash,
      );
      if (!verifyOutcomeObservationReceipt({
        admission,
        expectedApiDeploymentSha: input.apiDeploymentSha,
        readback,
        receipt: persistedOutcome,
      })) {
        throw new SultanStage5StoreError(
          "OUTCOME_EXACT_READBACK_FAILED",
          "Persisted outcome failed exact parent-lineage and classification recomputation.",
          503,
        );
      }
      await client.query("commit");
      return receipt;
    } catch (error) {
      if (!(error instanceof SultanStage5StoreError && error.code === "OUTCOME_IDEMPOTENCY_CONFLICT")) {
        await client.query("rollback").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async readAdmission(tenantId: string, receiptId: string) {
    const client = await this.pool.connect();
    try {
      await beginRead(client, tenantId);
      const result = await client.query<ReceiptRow<Stage5AdmissionReceipt>>(
        `select request_hash,receipt
           from public.sultan_api_admission_receipts
          where tenant_id=$1 and admission_receipt_id=$2
          limit 1`,
        [tenantId, receiptId],
      );
      const row = result.rows[0];
      if (row) {
        if (row.receipt.admissionReceiptId !== receiptId) throw exactReadbackFailure("ADMISSION");
        await assertPersistedAdmission(client, tenantId, row.receipt, row.request_hash);
      }
      await client.query("commit");
      return row?.receipt ?? null;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readCanonicalReadback(tenantId: string, receiptId: string) {
    const client = await this.pool.connect();
    try {
      await beginRead(client, tenantId);
      const result = await client.query<ReceiptRow<CanonicalReadbackReceipt>>(
        `select request_hash,receipt
           from public.sultan_canonical_readback_receipts
          where tenant_id=$1 and readback_receipt_id=$2
          limit 1`,
        [tenantId, receiptId],
      );
      const row = result.rows[0];
      if (row) {
        if (row.receipt.readbackReceiptId !== receiptId) throw exactReadbackFailure("CANONICAL_READBACK");
        await assertPersistedCanonicalReadback(client, tenantId, row.receipt, row.request_hash);
      }
      await client.query("commit");
      return row?.receipt ?? null;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readOutcome(tenantId: string, observationId: string) {
    const client = await this.pool.connect();
    try {
      await beginRead(client, tenantId);
      const result = await client.query<ReceiptRow<OutcomeObservationReceipt>>(
        `select request_hash,receipt
           from public.sultan_outcome_observations
          where tenant_id=$1 and observation_id=$2
          limit 1`,
        [tenantId, observationId],
      );
      const row = result.rows[0];
      if (row) {
        if (row.receipt.observationId !== observationId) throw exactReadbackFailure("OUTCOME");
        await assertPersistedOutcome(client, tenantId, row.receipt, row.request_hash);
      }
      await client.query("commit");
      return row?.receipt ?? null;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordConflict(
    client: PoolClient,
    tenantId: string,
    scope: "ADMISSION" | "OUTCOME" | "READBACK",
    idempotencyKey: string,
    existingHash: string,
    receivedHash: string,
  ) {
    await client.query(
      `insert into public.sultan_stage5_idempotency_conflicts (
         tenant_id,conflict_id,scope,idempotency_key,existing_request_hash,received_request_hash
       ) values ($1,$2,$3,$4,$5,$6)`,
      [tenantId, `s5conf_${sha256([tenantId, scope, idempotencyKey, receivedHash]).slice(0, 32)}`, scope, idempotencyKey, existingHash, receivedHash],
    );
  }
}

function exactReadbackFailure(scope: "ADMISSION" | "CANONICAL_READBACK" | "OUTCOME") {
  return new SultanStage5StoreError(
    `${scope}_EXACT_READBACK_FAILED`,
    `${scope} stored identifier does not match its requested immutable receipt.`,
    503,
  );
}

async function deriveCanonicalReadback(
  client: PoolClient,
  tenantId: string,
  request: CanonicalReadbackRequest,
  now: string,
  maximumEvidenceAgeMs: number,
): Promise<DerivedCanonicalReadback> {
  const freshUntil = new Date(Date.parse(now) + maximumEvidenceAgeMs).toISOString();
  if (request.subjectType === "ORDER") return orderReadback(client, tenantId, request.subjectId, now, freshUntil);
  if (request.subjectType === "LOGISTICS") return logisticsReadback(client, tenantId, request.subjectId, now, freshUntil);
  if (request.subjectType === "ECONOMIC_CALCULATION") return economicReadback(client, tenantId, request.subjectId, now, freshUntil);
  const optional = OPTIONAL_CANONICAL_PROFILES[request.subjectType];
  if (!optional) return unavailableCanonicalReadback("SOURCE_UNAVAILABLE", now);
  const columnsPresent = await hasColumns(client, optional.table, optional.requiredColumns);
  if (columnsPresent === "MISSING_TABLE") return unavailableCanonicalReadback("SOURCE_UNAVAILABLE", now);
  if (columnsPresent === "MISSING_COLUMNS") return unavailableCanonicalReadback("SCHEMA_MISMATCH", now);
  const result = await client.query(optional.sql, [tenantId, request.subjectId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return unavailableCanonicalReadback("NOT_FOUND", now);
  return available(now, freshUntil, optional.sourceRefs, `${request.subjectType.toLowerCase()}:${request.subjectId}:v${sourceToken(row.version)}`, optional.claims(row));
}

async function orderReadback(client: PoolClient, tenantId: string, subjectId: string, now: string, freshUntil: string) {
  const result = await client.query(
    `select o.external_order_id,o.status,o.currency,o.total_cents,o.subtotal_cents,
            o.discounts_cents,o.tax_cents,o.shipping_cents,o.version,o.updated_at,
            coalesce(sum(l.quantity),0)::text as total_units,
            count(l.id)::int as line_count
       from public.orders o
       left join public.order_lines l on l.tenant_id=o.tenant_id and l.order_id=o.id
      where o.tenant_id=$1 and o.external_order_id=$2
      group by o.id limit 1`,
    [tenantId, subjectId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return unavailableCanonicalReadback("NOT_FOUND", now);
  const subtotal = exactInteger(row.subtotal_cents);
  const discounts = exactInteger(row.discounts_cents);
  const tax = exactInteger(row.tax_cents);
  const shipping = exactInteger(row.shipping_cents);
  const calculatedTotal = addIntegers(subtotal, -discounts, tax, shipping);
  const claims: CanonicalClaim[] = [
    fact("order.status", row.status),
    fact("order.currency", row.currency),
    money("order.totalCents", exactInteger(row.total_cents), "FACT"),
    money("order.subtotalCents", subtotal, "FACT"),
    money("order.discountsCents", discounts, "FACT"),
    money("order.taxCents", tax, "FACT"),
    money("order.shippingCents", shipping, "FACT"),
    money("order.calculatedTotalCents", calculatedTotal, "CALCULATION"),
    integer("order.lineCount", Number(row.line_count), "FACT"),
    numeric("order.totalUnits", row.total_units, "CALCULATION", "units"),
    timestampClaim("order.updatedAt", row.updated_at),
  ];
  return available(now, freshUntil, ["postgres:public.orders", "postgres:public.order_lines"], `order:${subjectId}:v${sourceToken(row.version)}:s${sourceToken(row.status)}`, claims);
}

async function logisticsReadback(client: PoolClient, tenantId: string, subjectId: string, now: string, freshUntil: string) {
  const result = await client.query(
    `select i.fulfillment_intent_id,i.state,i.effect_class,i.dispatch_authorized,
            i.provider_acknowledged,i.source_confirmed,i.line_intents,i.created_at,
            i.resulting_order_version
       from public.order_fulfillment_intents i
      where i.tenant_id=$1 and i.external_order_id=$2
      order by i.created_at desc limit 1`,
    [tenantId, subjectId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return unavailableCanonicalReadback("NOT_FOUND", now);
  const lines = Array.isArray(row.line_intents) ? row.line_intents as Array<Record<string, unknown>> : [];
  const totalUnits = lines.reduce((sum, line) => sum + exactInteger(line.quantity), 0);
  return available(now, freshUntil, ["postgres:public.order_fulfillment_intents"], sourceToken(row.resulting_order_version), [
    fact("logistics.intentId", row.fulfillment_intent_id),
    fact("logistics.state", row.state),
    fact("logistics.effectClass", row.effect_class),
    booleanClaim("logistics.dispatchAuthorized", row.dispatch_authorized),
    booleanClaim("logistics.providerAcknowledged", row.provider_acknowledged),
    booleanClaim("logistics.sourceConfirmed", row.source_confirmed),
    integer("logistics.lineCount", lines.length, "CALCULATION"),
    integer("logistics.totalUnits", totalUnits, "CALCULATION", "units"),
    timestampClaim("logistics.intentCreatedAt", row.created_at),
  ]);
}

async function economicReadback(client: PoolClient, tenantId: string, subjectId: string, now: string, freshUntil: string) {
  const result = await client.query(
    `select q.external_quote_id,q.status,q.currency,q.subtotal_cents,q.fully_landed_cost_cents,
            q.economics_version,q.updated_at,
            coalesce(sum(l.quantity*l.unit_price_cents),0)::text as calculated_subtotal_cents,
            case when coalesce(sum(l.quantity*l.unit_price_cents),0)=0 then null
                 else round(((coalesce(sum(l.quantity*l.unit_price_cents),0)-coalesce(q.fully_landed_cost_cents,0))
                   /coalesce(sum(l.quantity*l.unit_price_cents),0))*100,4)::text end as calculated_margin_percent
       from public.quotes q
       left join public.quote_lines l on l.quote_id=q.id
      where q.tenant_id=$1 and (q.external_quote_id=$2 or q.id::text=$2)
      group by q.id limit 1`,
    [tenantId, subjectId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return unavailableCanonicalReadback("NOT_FOUND", now);
  const claims: CanonicalClaim[] = [
    fact("economics.quoteStatus", row.status),
    fact("economics.currency", row.currency),
    money("economics.recordedSubtotalCents", exactInteger(row.subtotal_cents), "FACT"),
    money("economics.calculatedSubtotalCents", row.calculated_subtotal_cents, "CALCULATION"),
    timestampClaim("economics.updatedAt", row.updated_at),
  ];
  if (row.fully_landed_cost_cents !== null) claims.push(money("economics.fullyLandedCostCents", exactInteger(row.fully_landed_cost_cents), "FACT"));
  if (row.calculated_margin_percent !== null) claims.push(numeric("economics.calculatedMarginPercent", row.calculated_margin_percent, "CALCULATION", "percent"));
  return available(now, freshUntil, ["postgres:public.quotes", "postgres:public.quote_lines"], `quote:${subjectId}:e${sourceToken(row.economics_version)}:s${sourceToken(row.status)}`, claims);
}

const OPTIONAL_CANONICAL_PROFILES: Partial<Record<CanonicalReadbackRequest["subjectType"], {
  claims(row: Record<string, unknown>): CanonicalClaim[];
  requiredColumns: readonly string[];
  sourceRefs: readonly string[];
  sql: string;
  table: string;
}>> = {
  SHIPMENT: {
    table: "shipments",
    requiredColumns: ["tenant_id", "id", "status", "carrier", "tracking_number", "version", "updated_at"],
    sourceRefs: ["postgres:public.shipments"],
    sql: "select id,status,carrier,tracking_number,version,updated_at from public.shipments where tenant_id=$1 and id::text=$2 limit 1",
    claims: (row) => [fact("shipment.status", row.status), fact("shipment.carrier", row.carrier), fact("shipment.trackingNumber", row.tracking_number), timestampClaim("shipment.updatedAt", row.updated_at)],
  },
  ACCOUNT: {
    table: "accounts",
    requiredColumns: ["tenant_id", "id", "name", "status", "version", "updated_at"],
    sourceRefs: ["postgres:public.accounts"],
    sql: "select id,name,status,version,updated_at from public.accounts where tenant_id=$1 and id::text=$2 limit 1",
    claims: (row) => [fact("account.name", row.name), fact("account.status", row.status), timestampClaim("account.updatedAt", row.updated_at)],
  },
  OPPORTUNITY: {
    table: "opportunities",
    requiredColumns: ["tenant_id", "id", "account_id", "stage", "amount_cents", "currency", "probability_percent", "version", "updated_at"],
    sourceRefs: ["postgres:public.opportunities"],
    sql: "select id,account_id,stage,amount_cents,currency,probability_percent,version,updated_at from public.opportunities where tenant_id=$1 and id::text=$2 limit 1",
    claims: (row) => [fact("opportunity.accountId", row.account_id), fact("opportunity.stage", row.stage), money("opportunity.amountCents", row.amount_cents, "FACT"), fact("opportunity.currency", row.currency), numeric("opportunity.probabilityPercent", row.probability_percent, "FACT", "percent"), timestampClaim("opportunity.updatedAt", row.updated_at)],
  },
  COMMITMENT: {
    table: "commitments",
    requiredColumns: ["tenant_id", "id", "subject_type", "subject_id", "status", "due_at", "fulfilled_at", "version", "updated_at"],
    sourceRefs: ["postgres:public.commitments"],
    sql: "select id,subject_type,subject_id,status,due_at,fulfilled_at,version,updated_at from public.commitments where tenant_id=$1 and id::text=$2 limit 1",
    claims: (row) => [fact("commitment.subjectType", row.subject_type), fact("commitment.subjectId", row.subject_id), fact("commitment.status", row.status), timestampClaim("commitment.dueAt", row.due_at), timestampClaim("commitment.fulfilledAt", row.fulfilled_at), timestampClaim("commitment.updatedAt", row.updated_at)],
  },
  FEP_ALLOCATION: {
    table: "fep_allocations",
    requiredColumns: ["tenant_id", "id", "status", "amount_cents", "currency", "version", "updated_at"],
    sourceRefs: ["postgres:public.fep_allocations"],
    sql: "select id,status,amount_cents,currency,version,updated_at from public.fep_allocations where tenant_id=$1 and id::text=$2 limit 1",
    claims: (row) => [fact("fepAllocation.status", row.status), money("fepAllocation.amountCents", row.amount_cents, "FACT"), fact("fepAllocation.currency", row.currency), timestampClaim("fepAllocation.updatedAt", row.updated_at)],
  },
};

function available(now: string, freshUntil: string, sourceRefs: readonly string[], sourceVersion: string, claims: readonly CanonicalClaim[]): DerivedCanonicalReadback {
  return Object.freeze({
    claims: Object.freeze(claims),
    freshUntil,
    observedAt: now,
    sourceRefs: Object.freeze([...sourceRefs]),
    sourceVersion,
    status: "AVAILABLE",
  });
}

async function hasColumns(client: PoolClient, table: string, required: readonly string[]) {
  const present = await client.query<{ present: boolean }>("select to_regclass($1) is not null as present", [`public.${table}`]);
  if (!present.rows[0]?.present) return "MISSING_TABLE" as const;
  const result = await client.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema='public' and table_name=$1",
    [table],
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  return required.every((column) => columns.has(column)) ? "PRESENT" as const : "MISSING_COLUMNS" as const;
}

function fact(claimId: string, value: unknown): CanonicalClaim {
  if (value === null) return { claimId, kind: "FACT", unit: null, value: null, valueType: "STRING" };
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > 2_048) {
    throw new Error(`${claimId} is not a bounded canonical string.`);
  }
  return { claimId, kind: "FACT", unit: null, value, valueType: "STRING" };
}

function booleanClaim(claimId: string, value: unknown): CanonicalClaim {
  if (value === null) return { claimId, kind: "FACT", unit: null, value: null, valueType: "BOOLEAN" };
  if (typeof value !== "boolean") throw new Error(`${claimId} is not a canonical boolean.`);
  return { claimId, kind: "FACT", unit: null, value, valueType: "BOOLEAN" };
}

function integer(claimId: string, value: number, kind: CanonicalClaim["kind"], unit: string | null = null): CanonicalClaim {
  if (!Number.isSafeInteger(value)) throw new Error(`${claimId} is not a safe canonical integer.`);
  return { claimId, kind, unit, value, valueType: "INTEGER" };
}

function money(claimId: string, value: unknown, kind: CanonicalClaim["kind"]): CanonicalClaim {
  if (value === null) return { claimId, kind, unit: "minor_currency_unit", value: null, valueType: "MONEY_MINOR" };
  if ((typeof value !== "number" || !Number.isSafeInteger(value))
    && (typeof value !== "string" || !/^-?(0|[1-9][0-9]{0,14})$/.test(value))) {
    throw new Error(`${claimId} is not an exact bounded minor-currency integer.`);
  }
  return { claimId, kind, unit: "minor_currency_unit", value, valueType: "MONEY_MINOR" };
}

function numeric(claimId: string, value: unknown, kind: CanonicalClaim["kind"], unit: string | null): CanonicalClaim {
  if (value === null) return { claimId, kind, unit, value: null, valueType: "NUMBER" };
  if ((typeof value !== "number" || !Number.isSafeInteger(value))
    && (typeof value !== "string" || !/^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,6})?$/.test(value))) {
    throw new Error(`${claimId} is not an exact bounded canonical number.`);
  }
  return { claimId, kind, unit, value, valueType: "NUMBER" };
}

function sourceToken(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 512) return value;
  throw new Error("Canonical source version contains a missing or invalid component.");
}

function timestampClaim(claimId: string, value: unknown): CanonicalClaim {
  if (value === null || value === undefined) return { claimId, kind: "FACT", unit: null, value: null, valueType: "TIMESTAMP" };
  const parsed = value instanceof Date
    ? value.getTime()
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${claimId} is not a canonical timestamp.`);
  return { claimId, kind: "FACT", unit: null, value: new Date(parsed).toISOString(), valueType: "TIMESTAMP" };
}

function exactInteger(value: unknown): number {
  const normalized = String(value);
  if (!/^-?(0|[1-9][0-9]{0,14})$/.test(normalized)) throw new Error("Canonical integer exceeds the exact bounded range.");
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw new Error("Canonical integer exceeds the safe range.");
  return parsed;
}

function addIntegers(...values: number[]) {
  const result = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(result)) throw new Error("Deterministic calculation exceeds the safe range.");
  return result;
}

async function beginWrite(client: PoolClient, tenantId: string) {
  await client.query("begin");
  await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
}

async function beginRead(client: PoolClient, tenantId: string) {
  await client.query("begin read only");
  await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
}

async function lock(client: PoolClient, key: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
}

async function assertPersistedCanonicalReadback(
  client: PoolClient,
  tenantId: string,
  expected: CanonicalReadbackReceipt,
  expectedRequestHash: string,
) {
  const result = await client.query<{
    api_deployment_sha: string;
    consumer_actor_id: string;
    consumer_deployment_sha: string;
    fresh_until: Date | string | null;
    idempotency_key: string;
    observed_at: Date | string;
    readback_hash: string;
    receipt: CanonicalReadbackReceipt;
    request_hash: string;
    source_version: string | null;
    status: string;
    subject_id: string;
    subject_type: string;
    tenant_id: string;
  }>(
    `select api_deployment_sha,consumer_actor_id,consumer_deployment_sha,fresh_until,
            idempotency_key,observed_at,readback_hash,receipt,request_hash,source_version,
            status,subject_id,subject_type,tenant_id
       from public.sultan_canonical_readback_receipts
      where tenant_id=$1 and readback_receipt_id=$2
      limit 1`,
    [tenantId, expected.readbackReceiptId],
  );
  const row = result.rows[0];
  const indexed = row ? {
    apiDeploymentSha: row.api_deployment_sha,
    consumerActorId: row.consumer_actor_id,
    consumerDeploymentSha: row.consumer_deployment_sha,
    freshUntil: timestampIso(row.fresh_until),
    idempotencyKey: row.idempotency_key,
    observedAt: timestampIso(row.observed_at),
    readbackHash: row.readback_hash,
    sourceVersion: row.source_version,
    status: row.status,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    tenantId: row.tenant_id,
  } : null;
  const expectedIndexed = {
    apiDeploymentSha: expected.apiDeploymentSha,
    consumerActorId: expected.consumer.actorId,
    consumerDeploymentSha: expected.consumer.deploymentSha,
    freshUntil: expected.freshUntil,
    idempotencyKey: expected.idempotencyKey,
    observedAt: expected.observedAt,
    readbackHash: expected.readbackHash,
    sourceVersion: expected.provenance.sourceVersion,
    status: expected.status,
    subjectId: expected.subjectId,
    subjectType: expected.subjectType,
    tenantId,
  };
  if (!row
    || row.readback_hash !== expected.readbackHash
    || row.request_hash !== expectedRequestHash
    || sha256(indexed) !== sha256(expectedIndexed)
    || sha256(row.receipt) !== sha256(expected)
    || !verifyCanonicalReadbackReceiptIntegrity(row.receipt)) {
    throw new SultanStage5StoreError(
      "CANONICAL_READBACK_EXACT_READBACK_FAILED",
      "Canonical readback persistence did not return the exact hash-bound receipt.",
      503,
    );
  }
  return row.receipt;
}

async function assertPersistedAdmission(
  client: PoolClient,
  tenantId: string,
  expected: Stage5AdmissionReceipt,
  expectedRequestHash: string,
) {
  const parent = await client.query<{
    api_deployment_sha: string;
    case_id: string;
    case_type: string;
    context_hash: string;
    credential_actor_id: string;
    decided_at: Date | string;
    evidence_refs_hash: string;
    external_effects_authorized: boolean;
    grounding_assembler_deployment_sha: string;
    grounding_packet_hash: string;
    idempotency_key: string;
    interaction_id: string;
    interaction_receipt_hash: string;
    logical_agent_id: string;
    logical_agent_version: string;
    operation_id: string;
    participant_set_hash: string;
    participation_contract_sha: string;
    phase: string;
    policy_version: string;
    receipt: Stage5AdmissionReceipt;
    receipt_hash: string;
    request_hash: string;
    requested_at: Date | string;
    requested_capability: string;
    requested_effect_class: string;
    run_id: string;
    status: string;
    sultan_deployment_sha: string;
    tenant_id: string;
  }>(
    `select api_deployment_sha,case_id,case_type,context_hash,credential_actor_id,
            decided_at,evidence_refs_hash,external_effects_authorized,
            grounding_assembler_deployment_sha,grounding_packet_hash,idempotency_key,
            interaction_id,interaction_receipt_hash,logical_agent_id,logical_agent_version,
            operation_id,participant_set_hash,participation_contract_sha,phase,policy_version,
            receipt,receipt_hash,request_hash,requested_at,requested_capability,
            requested_effect_class,run_id,status,sultan_deployment_sha,tenant_id
       from public.sultan_api_admission_receipts
      where tenant_id=$1 and admission_receipt_id=$2
      limit 1`,
    [tenantId, expected.admissionReceiptId],
  );
  const evidence = await client.query<{
    claim_id: string;
    evidence_hash: string;
    evidence_ref: string;
    ordinal: number;
    readback_hash: string;
    readback_receipt_id: string;
  }>(
    `select claim_id,evidence_hash,evidence_ref,ordinal,readback_hash,readback_receipt_id
       from public.sultan_api_admission_evidence_refs
      where tenant_id=$1 and admission_receipt_id=$2
      order by ordinal`,
    [tenantId, expected.admissionReceiptId],
  );
  const row = parent.rows[0];
  const expectedEvidence = expected.evidence.consumedEvidence.map((item, ordinal) => ({
    claim_id: item.claimId,
    evidence_hash: item.evidenceHash,
    evidence_ref: item.evidenceRef,
    ordinal,
    readback_hash: item.readbackHash,
    readback_receipt_id: item.readbackReceiptId,
  }));
  const indexed = row ? {
    apiDeploymentSha: row.api_deployment_sha,
    caseId: row.case_id,
    caseType: row.case_type,
    contextHash: row.context_hash,
    credentialActorId: row.credential_actor_id,
    decidedAt: timestampIso(row.decided_at),
    evidenceRefsHash: row.evidence_refs_hash,
    externalEffectsAuthorized: row.external_effects_authorized,
    groundingAssemblerDeploymentSha: row.grounding_assembler_deployment_sha,
    groundingPacketHash: row.grounding_packet_hash,
    idempotencyKey: row.idempotency_key,
    interactionId: row.interaction_id,
    interactionReceiptHash: row.interaction_receipt_hash,
    logicalAgentId: row.logical_agent_id,
    logicalAgentVersion: row.logical_agent_version,
    operationId: row.operation_id,
    participantSetHash: row.participant_set_hash,
    participationContractSha: row.participation_contract_sha,
    phase: row.phase,
    policyVersion: row.policy_version,
    receiptHash: row.receipt_hash,
    requestedAt: timestampIso(row.requested_at),
    requestedCapability: row.requested_capability,
    requestedEffectClass: row.requested_effect_class,
    runId: row.run_id,
    status: row.status,
    sultanDeploymentSha: row.sultan_deployment_sha,
    tenantId: row.tenant_id,
  } : null;
  const expectedIndexed = {
    apiDeploymentSha: expected.apiDeploymentSha,
    caseId: expected.caseRef.caseId,
    caseType: expected.caseRef.caseType,
    contextHash: expected.participation.contextHash,
    credentialActorId: expected.credentialActor.actorId,
    decidedAt: expected.decidedAt,
    evidenceRefsHash: expected.evidence.evidenceRefsHash,
    externalEffectsAuthorized: false,
    groundingAssemblerDeploymentSha: expected.participation.groundingAssemblerDeploymentSha,
    groundingPacketHash: expected.participation.groundingPacketHash,
    idempotencyKey: expected.idempotencyKey,
    interactionId: expected.interactionId,
    interactionReceiptHash: expected.interactionReceiptHash,
    logicalAgentId: expected.logicalAgent.agentId,
    logicalAgentVersion: expected.logicalAgent.agentVersion,
    operationId: expected.operationId,
    participantSetHash: expected.participation.participantSetHash,
    participationContractSha: expected.participation.contractSha,
    phase: expected.phase,
    policyVersion: expected.policyVersion,
    receiptHash: expected.receiptHash,
    requestedAt: expected.requestedAt,
    requestedCapability: expected.requestedCapability,
    requestedEffectClass: expected.requestedEffectClass,
    runId: expected.runId,
    status: expected.status,
    sultanDeploymentSha: expected.participation.sultanDeploymentSha,
    tenantId,
  };
  if (!row
    || row.receipt_hash !== expected.receiptHash
    || row.request_hash !== expectedRequestHash
    || sha256(indexed) !== sha256(expectedIndexed)
    || sha256(row.receipt) !== sha256(expected)
    || sha256(evidence.rows) !== sha256(expectedEvidence)
    || !verifyStage5AdmissionReceiptIntegrity(row.receipt)) {
    throw new SultanStage5StoreError(
      "ADMISSION_EXACT_READBACK_FAILED",
      "Admission persistence did not return the exact parent receipt and consumed-evidence lineage.",
      503,
    );
  }
}

async function assertPersistedOutcome(
  client: PoolClient,
  tenantId: string,
  expected: OutcomeObservationReceipt,
  expectedRequestHash: string,
) {
  const result = await client.query<{
    admission_api_deployment_sha: string;
    admission_receipt_hash: string;
    admission_receipt_id: string;
    classification: string;
    idempotency_key: string;
    observed_at: Date | string;
    observer_actor_id: string;
    observation_id: string;
    readback_api_deployment_sha: string;
    readback_hash: string;
    readback_receipt_id: string;
    receipt: OutcomeObservationReceipt;
    receipt_hash: string;
    request_hash: string;
    supersedes_observation_id: string | null;
    tenant_id: string;
  }>(
    `select admission_api_deployment_sha,admission_receipt_hash,admission_receipt_id,
            classification,idempotency_key,observed_at,observer_actor_id,observation_id,
            readback_api_deployment_sha,readback_hash,readback_receipt_id,receipt,
            receipt_hash,request_hash,supersedes_observation_id,tenant_id
       from public.sultan_outcome_observations
      where tenant_id=$1 and observation_id=$2
      limit 1`,
    [tenantId, expected.observationId],
  );
  const row = result.rows[0];
  const { idempotentReplay, receiptHash, ...hashMaterial } = row?.receipt ?? expected;
  void idempotentReplay;
  const indexed = row ? {
    admissionApiDeploymentSha: row.admission_api_deployment_sha,
    admissionReceiptHash: row.admission_receipt_hash,
    admissionReceiptId: row.admission_receipt_id,
    classification: row.classification,
    idempotencyKey: row.idempotency_key,
    observedAt: timestampIso(row.observed_at),
    observerActorId: row.observer_actor_id,
    observationId: row.observation_id,
    readbackApiDeploymentSha: row.readback_api_deployment_sha,
    readbackHash: row.readback_hash,
    readbackReceiptId: row.readback_receipt_id,
    receiptHash: row.receipt_hash,
    supersedesObservationId: row.supersedes_observation_id,
    tenantId: row.tenant_id,
  } : null;
  const expectedIndexed = {
    admissionApiDeploymentSha: expected.admissionLineage.apiDeploymentSha,
    admissionReceiptHash: expected.admissionLineage.admissionReceiptHash,
    admissionReceiptId: expected.admissionReceiptId,
    classification: expected.classification,
    idempotencyKey: expected.idempotencyKey,
    observedAt: expected.observedAt,
    observerActorId: expected.observer.actorId,
    observationId: expected.observationId,
    readbackApiDeploymentSha: expected.evidence.apiDeploymentSha,
    readbackHash: expected.evidence.readbackHash,
    readbackReceiptId: expected.evidence.readbackReceiptId,
    receiptHash: expected.receiptHash,
    supersedesObservationId: expected.supersedesObservationId,
    tenantId,
  };
  if (!row
    || row.receipt_hash !== expected.receiptHash
    || row.request_hash !== expectedRequestHash
    || sha256(indexed) !== sha256(expectedIndexed)
    || sha256(row.receipt) !== sha256(expected)
    || outcomeObservationHash(hashMaterial) !== receiptHash) {
    throw new SultanStage5StoreError(
      "OUTCOME_EXACT_READBACK_FAILED",
      "Outcome persistence did not return the exact hash-bound receipt.",
      503,
    );
  }
  return row.receipt;
}

async function assertPersistedOutcomeParents(
  client: PoolClient,
  tenantId: string,
  outcome: OutcomeObservationReceipt,
) {
  const [admissionResult, readbackResult] = await Promise.all([
    client.query<ReceiptRow<Stage5AdmissionReceipt>>(
      `select request_hash,receipt
         from public.sultan_api_admission_receipts
        where tenant_id=$1 and admission_receipt_id=$2
        limit 1`,
      [tenantId, outcome.admissionReceiptId],
    ),
    client.query<ReceiptRow<CanonicalReadbackReceipt>>(
      `select request_hash,receipt
         from public.sultan_canonical_readback_receipts
        where tenant_id=$1 and readback_receipt_id=$2
        limit 1`,
      [tenantId, outcome.evidence.readbackReceiptId],
    ),
  ]);
  const admission = admissionResult.rows[0]?.receipt;
  const readback = readbackResult.rows[0]?.receipt;
  if (!admission || !readback) {
    throw new SultanStage5StoreError(
      "OUTCOME_PARENT_RECEIPT_NOT_FOUND",
      "Persisted outcome parent receipt lineage is missing.",
      503,
    );
  }
  await assertPersistedAdmission(client, tenantId, admission, admissionResult.rows[0].request_hash);
  await assertPersistedCanonicalReadback(client, tenantId, readback, readbackResult.rows[0].request_hash);
  if (!verifyOutcomeObservationReceipt({
    admission,
    expectedApiDeploymentSha: outcome.apiDeploymentSha,
    readback,
    receipt: outcome,
  })) {
    throw new SultanStage5StoreError(
      "OUTCOME_PARENT_LINEAGE_INTEGRITY_FAILED",
      "Persisted outcome failed exact parent-lineage and classification recomputation.",
      503,
    );
  }
}

function timestampIso(value: Date | string | null) {
  return value === null ? null : new Date(value).toISOString();
}
