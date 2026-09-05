import "server-only";

import type { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import {
  PostgresAtomicCommandStore,
  type CommandTransaction,
} from "@/lib/platform-guarantees/postgresCommandStore";
import type {
  ImportBatchV1,
  ImportReceiptV1,
  SetupMandateV1,
} from "@/modules/luzione-core-contracts/contracts";
import {
  createLifecycleCommandRequest,
  LifecycleCommandKernel,
} from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { ONBOARD_CORE_POLICY_VERSION } from "./contracts";
import {
  assertImportStatusFinality,
  importReservation,
  issueImportEvidence,
  type ImportDryRunRequest,
} from "./importContracts";
import { OnboardCoreDomainError } from "./store";
import { assertRuntimeWithinMandate } from "./runtimeLimit";

async function readOne(pool: Pool, tenantId: string, batchId: string) {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query(
      `select batch.canonical_batch, batch.object_version, batch.source_binding_digest,
              receipt.canonical_receipt, receipt.deadline_at, receipt.measured_runtime_ms,
              coalesce(jsonb_agg(jsonb_build_object(
                'sourceRowId', row.source_row_id,
                'matchKeyDigest', row.match_key_digest,
                'payloadDigest', row.payload_digest,
                'outcome', row.outcome,
                'reasonCode', row.reason_code,
                'exceptionRef', row.exception_ref,
                'reconciliationRef', row.reconciliation_ref
              ) order by row.source_row_id) filter (where row.source_row_id is not null), '[]'::jsonb) rows
         from public.onboarding_import_batches batch
         join public.onboarding_import_receipts receipt
           on receipt.tenant_id = batch.tenant_id and receipt.batch_id = batch.batch_id
         left join public.onboarding_import_rows row
           on row.tenant_id = batch.tenant_id and row.batch_id = batch.batch_id
        where batch.tenant_id = $1 and batch.batch_id = $2::uuid
        group by batch.canonical_batch, batch.object_version, batch.source_binding_digest,
                 receipt.canonical_receipt, receipt.deadline_at, receipt.measured_runtime_ms
        limit 1`,
      [tenantId, batchId],
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

function readback(row: Record<string, unknown>) {
  const batch = row.canonical_batch as ImportBatchV1;
  const receipt = row.canonical_receipt as ImportReceiptV1;
  assertImportStatusFinality(batch, receipt);
  return {
    batch,
    objectVersion: String(row.object_version),
    runtime: { deadlineAt: new Date(String(row.deadline_at)).toISOString(), elapsedMs: Number(row.measured_runtime_ms), measuredBy: "server-monotonic-clock" as const },
    receipt,
    rows: row.rows as Array<Record<string, unknown>>,
    sourceBindingDigest: String(row.source_binding_digest),
  };
}

export class OnboardImportStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(private readonly pool: Pool = databasePool(), private readonly monotonicNow: () => number = () => performance.now()) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
  }

  async readDryRun(actor: ApiActor, batchId: string) {
    const row = await readOne(this.pool, actor.tenantId, batchId);
    return row ? readback(row) : null;
  }

  async executeDryRun(input: {
    actor: ApiActor;
    correlationId: string;
    request: ImportDryRunRequest;
    requestedAt: string;
  }) {
    const reservation = importReservation(input.actor.tenantId, input.request);
    const jobStarted = this.monotonicNow();
    const command = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId: reservation.commandId,
      commandType: "onboarding.import.dry_run",
      correlationId: input.correlationId,
      expectedObjectVersion: input.request.expectedMandateObjectVersion,
      idempotencyKey: reservation.idempotencyKey,
      payload: input.request,
      policyVersion: ONBOARD_CORE_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: reservation.batchId,
        objectType: "import_batch",
        objectVersion: "ABSENT",
        ownerProject: "LUZIONE_API",
        sourceRefs: [
          `setup-mandate:${input.request.mandateId}`,
          `sha256:${input.request.source.digest}`,
          input.request.mappingVersion,
        ],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(command, async (transaction) => {
      const mandateResult = await transaction.client.query(
        `select mandate.canonical_mandate, mandate.object_version, mandate.expires_at,
                mandate.approval_ref, mandate.source_binding_digest,
                revocation.revocation_ref
           from public.onboarding_setup_mandates mandate
           left join lateral (
             select event.revocation_ref from public.onboarding_setup_mandate_revocations event
              where event.tenant_id=mandate.tenant_id and event.mandate_id=mandate.mandate_id
              limit 1
           ) revocation on true
          where mandate.tenant_id = $1 and mandate.mandate_id = $2::uuid
          for update of mandate`,
        [input.actor.tenantId, input.request.mandateId],
      );
      const mandateRow = mandateResult.rows[0] as Record<string, unknown> | undefined;
      if (!mandateRow) throw new OnboardCoreDomainError("MANDATE_NOT_FOUND", "Same-tenant Setup Mandate not found.", 404);
      if (String(mandateRow.object_version) !== input.request.expectedMandateObjectVersion) {
        throw new OnboardCoreDomainError("STALE_MANDATE", "Import expectedMandateObjectVersion is stale.", 409);
      }
      const mandate = mandateRow.canonical_mandate as SetupMandateV1;
      const requestedAt = Date.parse(input.requestedAt);
      if (!mandate.active || mandateRow.revocation_ref !== null || Date.parse(String(mandateRow.expires_at)) <= requestedAt) {
        throw new OnboardCoreDomainError("MANDATE_INACTIVE", "Import requires an active, unexpired, unrevoked Setup Mandate.", 403);
      }
      if (!mandate.allowedActions.includes("DRY_RUN_IMPORT") || mandate.effectCeiling !== "NO_EFFECT") {
        throw new OnboardCoreDomainError("MANDATE_AUTHORITY_DENIED", "Setup Mandate does not authorize a NO_EFFECT dry run.", 403);
      }
      if (String(mandateRow.source_binding_digest) !== input.request.sourceBindingDigest) {
        throw new OnboardCoreDomainError("L2_BINDING_MISMATCH", "Import does not bind the exact L2 mapper/evidence digest inherited by its Setup Mandate.", 409);
      }
      await transaction.client.query("select set_config('statement_timeout', $1, true)", [`${mandate.limits.maxRuntimeMinutes * 60_000}ms`]);
      const approval = await transaction.client.query(
        `select 1
           from public.onboarding_tenant_blueprint_approvals approved
          where approved.tenant_id = $1 and approved.approval_ref = $2 and approved.action = 'APPROVED'
            and not exists (
              select 1 from public.onboarding_tenant_blueprint_approvals superseded
               where superseded.tenant_id = approved.tenant_id
                 and superseded.blueprint_id = approved.blueprint_id
                 and superseded.action = 'SUPERSEDED'
                 and superseded.approval_ref = approved.approval_ref
            )
          limit 1`,
        [input.actor.tenantId, mandateRow.approval_ref],
      );
      if (!approval.rows.length) {
        throw new OnboardCoreDomainError("MANDATE_BLUEPRINT_SUPERSEDED", "Import Mandate refers to a superseded Blueprint approval.", 403);
      }
      const evidence = issueImportEvidence({ mandate, request: input.request, tenantId: input.actor.tenantId });
      assertImportStatusFinality(evidence.batch, evidence.receipt);
      const runtime = assertRuntimeWithinMandate({ elapsedMs: this.monotonicNow() - jobStarted, maxRuntimeMinutes: mandate.limits.maxRuntimeMinutes, startedAt: input.requestedAt });
      const objectVersion = `import-batch:${evidence.batch.batchId}@${sha256({ batch: evidence.batch, receipt: evidence.receipt })}`;
      await transaction.client.query(
        `insert into public.onboarding_import_batches
          (tenant_id, batch_id, mandate_id, expected_mandate_object_version, dedupe_key,
           source_digest, source_binding_digest, mapping_version, canonical_batch, object_version,
           created_by, created_by_type, created_at)
         values ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
        [
          input.actor.tenantId,
          evidence.batch.batchId,
          input.request.mandateId,
          input.request.expectedMandateObjectVersion,
          input.request.dedupeKey,
          input.request.source.digest,
          input.request.sourceBindingDigest,
          input.request.mappingVersion,
          JSON.stringify(evidence.batch),
          objectVersion,
          input.actor.actorId,
          input.actor.actorType,
          input.requestedAt,
        ],
      );
      for (const row of evidence.rows) {
        await transaction.client.query(
          `insert into public.onboarding_import_rows
            (tenant_id, batch_id, source_row_id, match_key_digest, payload_digest, outcome, reason_code,
             exception_ref, reconciliation_ref, created_at)
           values ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            input.actor.tenantId,
            evidence.batch.batchId,
            row.sourceRowId,
            row.matchKeyDigest,
            row.payloadDigest,
            row.outcome,
            row.reasonCode,
            row.exceptionRef,
            row.reconciliationRef,
            input.requestedAt,
          ],
        );
      }
      await transaction.client.query(
        `insert into public.onboarding_import_receipts
          (tenant_id, batch_id, canonical_receipt, finality, reconciliation_ref,
           object_version, source_binding_digest, measured_runtime_ms, deadline_at, created_at)
         values ($1,$2::uuid,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.actor.tenantId,
          evidence.batch.batchId,
          JSON.stringify(evidence.receipt),
          evidence.receipt.finality,
          evidence.receipt.reconciliationRef,
          objectVersion,
          input.request.sourceBindingDigest,
          runtime.elapsedMs,
          runtime.deadlineAt,
          input.requestedAt,
        ],
      );
      return {
        evidenceRefs: [
          `postgres:public.onboarding_import_batches/${evidence.batch.batchId}`,
          `postgres:public.onboarding_import_receipts/${evidence.batch.batchId}`,
          ...evidence.rows.flatMap((row) => [row.exceptionRef, row.reconciliationRef].filter((ref): ref is string => ref !== null)),
        ],
        objectVersion,
      };
    });
    const result = await this.readDryRun(input.actor, reservation.batchId);
    if (!result || (!receipt.idempotentReplay && result.objectVersion !== receipt.objectVersion)) {
      throw new OnboardCoreDomainError("READBACK_UNCONFIRMED", "Import dry-run readback could not be confirmed.", 503);
    }
    return { readback: result, receipt };
  }
}
