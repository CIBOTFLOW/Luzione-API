import assert from "node:assert/strict";
import { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import {
  ONBOARD_CORE_API_VERSION,
  TENANT_BLUEPRINT_MAPPING_VERSION,
  TENANT_PACK_DRAFT_VERSION,
  parseSetupMandateRequest,
  parseTenantBlueprintApprovalRequest,
  parseTenantBlueprintProposal,
} from "@/modules/onboard-core/contracts";
import {
  ONBOARD_IMPORT_MAPPING_VERSION,
  importSourceDigest,
  parseImportDryRunRequest,
} from "@/modules/onboard-core/importContracts";
import { OnboardImportStore } from "@/modules/onboard-core/importStore";
import { OnboardCoreDomainError, OnboardCoreStore } from "@/modules/onboard-core/store";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const tenant = "onboard-import-proof-a";
const serviceActor: ApiActor = {
  actorId: "service:onboard-import-proof",
  actorType: "service",
  capabilities: [],
  source: "service-token",
  tenantId: tenant,
};
const humanActor: ApiActor = { ...serviceActor, actorId: "user:onboard-import-approver", actorType: "user" };

function blueprintProposal() {
  const draft = {
    contractVersion: TENANT_PACK_DRAFT_VERSION,
    sections: {
      aiPolicies: ["no autonomous send"], approvals: ["human setup approval"], connectors: ["google workspace"],
      fields: ["company name", "email"], icp: ["mid market services"], retention: ["customer zero default"],
      roles: ["admin"], stages: ["new"], terminology: { lead: "prospect" }, workflows: ["lead qualification"],
    },
    sourcePackId: "tenant-pack-import-proof",
    sourcePackVersion: "1.0.0",
    tenantSlug: tenant,
  } as const;
  return parseTenantBlueprintProposal({
    contractVersion: ONBOARD_CORE_API_VERSION,
    draft,
    mappingVersion: TENANT_BLUEPRINT_MAPPING_VERSION,
    sourceDigest: sha256(draft),
    sourceSchemaDigest: "a".repeat(64),
  });
}

function dryRun(input: { dedupeKey: string; mandateId: string; mandateVersion: string; changed?: boolean }) {
  const rows = [
    { outcome: "ACCEPTED", payloadDigest: sha256({ company: input.changed ? "Changed" : "A" }), reasonCode: null, sourceRowId: "row-1" },
    { outcome: "REJECTED", payloadDigest: sha256({ company: "B" }), reasonCode: "INVALID_EMAIL", sourceRowId: "row-2" },
    { outcome: "CONFLICT", payloadDigest: sha256({ company: "C" }), reasonCode: "DUPLICATE_EXTERNAL_ID", sourceRowId: "row-3" },
  ] as const;
  const source = { consentRef: "consent:import-proof", digest: "pending", kind: "CSV" as const, provenanceRef: "synthetic:import-proof" };
  return parseImportDryRunRequest({
    contractVersion: ONBOARD_CORE_API_VERSION,
    dedupeKey: input.dedupeKey,
    expectedMandateObjectVersion: input.mandateVersion,
    mandateId: input.mandateId,
    mappingVersion: ONBOARD_IMPORT_MAPPING_VERSION,
    rows,
    source: { ...source, digest: importSourceDigest({ mappingVersion: ONBOARD_IMPORT_MAPPING_VERSION, rows, source }) },
  });
}

async function main() {
  const pool = new Pool({ connectionString });
  const core = new OnboardCoreStore(pool);
  const imports = new OnboardImportStore(pool);
  const now = new Date();
  try {
    const draft = await core.proposeBlueprint({ actor: serviceActor, correlationId: "correlation-import-blueprint", proposal: blueprintProposal(), requestedAt: now.toISOString() });
    const approved = await core.approveBlueprint({
      actor: humanActor,
      approval: parseTenantBlueprintApprovalRequest({
        blueprintId: draft.readback.blueprint.blueprintId,
        contractVersion: ONBOARD_CORE_API_VERSION,
        decision: "APPROVE",
        expectedObjectVersion: draft.readback.objectVersion,
        supersedesApprovalRef: null,
      }),
      correlationId: "correlation-import-approval",
      requestedAt: new Date(now.getTime() + 1_000).toISOString(),
    });
    const mandate = await core.issueMandate({
      actor: serviceActor,
      correlationId: "correlation-import-mandate",
      mandateRequest: parseSetupMandateRequest({
        blueprintId: approved.readback.blueprint.blueprintId,
        blueprintVersion: approved.readback.blueprint.version,
        contractVersion: ONBOARD_CORE_API_VERSION,
        expectedBlueprintObjectVersion: approved.readback.objectVersion,
        profile: "NO_EFFECT_IMPORT_AND_CONNECTOR_VALIDATION",
      }),
      requestedAt: new Date(now.getTime() + 2_000).toISOString(),
    });
    const request = dryRun({ dedupeKey: "import-proof-1", mandateId: mandate.readback.mandate.mandateId, mandateVersion: mandate.readback.objectVersion });
    const result = await imports.executeDryRun({ actor: serviceActor, correlationId: "correlation-import-1", request, requestedAt: new Date(now.getTime() + 3_000).toISOString() });
    assert.equal(result.readback.batch.status, "RECONCILIATION_REQUIRED");
    assert.equal(result.readback.receipt.finality, "RECONCILIATION_REQUIRED");
    assert.equal(result.readback.receipt.effectMode, result.readback.batch.effectMode);
    assert.equal(result.readback.rows.length, 3);
    assert.equal(result.readback.rows.filter((row) => row.exceptionRef).length, 2);
    assert.equal(result.readback.rows.filter((row) => row.reconciliationRef).length, 1);

    const replay = await imports.executeDryRun({ actor: serviceActor, correlationId: "correlation-import-replay", request, requestedAt: new Date(now.getTime() + 4_000).toISOString() });
    assert.equal(replay.receipt.idempotentReplay, true);
    assert.equal(replay.receipt.receiptId, result.receipt.receiptId);
    await assert.rejects(
      () => imports.executeDryRun({
        actor: serviceActor,
        correlationId: "correlation-import-changed",
        request: dryRun({ changed: true, dedupeKey: "import-proof-1", mandateId: mandate.readback.mandate.mandateId, mandateVersion: mandate.readback.objectVersion }),
        requestedAt: new Date(now.getTime() + 5_000).toISOString(),
      }),
      (error: unknown) => error instanceof IdempotencyConflictError,
    );
    await assert.rejects(
      () => imports.executeDryRun({
        actor: serviceActor,
        correlationId: "correlation-import-stale",
        request: dryRun({ dedupeKey: "import-proof-stale", mandateId: mandate.readback.mandate.mandateId, mandateVersion: "stale" }),
        requestedAt: new Date(now.getTime() + 6_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "STALE_MANDATE",
    );
    await assert.rejects(
      () => imports.executeDryRun({
        actor: serviceActor,
        correlationId: "correlation-import-expired",
        request: dryRun({ dedupeKey: "import-proof-expired", mandateId: mandate.readback.mandate.mandateId, mandateVersion: mandate.readback.objectVersion }),
        requestedAt: new Date(Date.parse(mandate.readback.mandate.expiresAt) + 1_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "MANDATE_INACTIVE",
    );
    const revokedMandateId = "99999999-9999-4999-8999-999999999999";
    const revokedMandate = { ...mandate.readback.mandate, mandateId: revokedMandateId };
    await pool.query(
      `insert into public.onboarding_setup_mandates
        (tenant_id, mandate_id, blueprint_id, blueprint_version, approval_ref,
         canonical_mandate, object_version, expires_at, revoked_at, revocation_ref,
         created_by, created_by_type, created_at)
       values ($1,$2::uuid,$3::uuid,$4,$5,$6::jsonb,'setup-mandate:revoked-proof',
         $7,$8,'revocation:proof',$9,'service',$10)`,
      [
        tenant,
        revokedMandateId,
        revokedMandate.blueprintRef.blueprintId,
        revokedMandate.blueprintRef.version,
        revokedMandate.approvalRef,
        JSON.stringify(revokedMandate),
        revokedMandate.expiresAt,
        new Date(now.getTime() + 7_000).toISOString(),
        serviceActor.actorId,
        new Date(now.getTime() + 2_000).toISOString(),
      ],
    );
    assert.equal((await core.readMandate(serviceActor, revokedMandateId))?.mandate.active, false);
    await assert.rejects(
      () => imports.executeDryRun({
        actor: serviceActor,
        correlationId: "correlation-import-revoked",
        request: dryRun({ dedupeKey: "import-proof-revoked", mandateId: revokedMandateId, mandateVersion: "setup-mandate:revoked-proof" }),
        requestedAt: new Date(now.getTime() + 8_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "MANDATE_INACTIVE",
    );
    assert.equal(await imports.readDryRun({ ...serviceActor, tenantId: "onboard-import-proof-b" }, result.readback.batch.batchId), null);
    await assert.rejects(
      () => pool.query("update public.onboarding_import_rows set outcome='ACCEPTED' where tenant_id=$1", [tenant]),
      /append-only/,
    );

    const evidence = (await pool.query(
      `select
        (select count(*)::int from public.onboarding_import_batches where tenant_id=$1) batches,
        (select count(*)::int from public.onboarding_import_rows where tenant_id=$1) rows,
        (select count(*)::int from public.onboarding_import_receipts where tenant_id=$1) import_receipts,
        (select count(*)::int from public.p110_command_receipts where tenant_id=$1) command_receipts,
        (select count(*)::int from public.p110_idempotency_conflicts where tenant_id=$1) conflicts`,
      [tenant],
    )).rows[0];
    assert.deepEqual(evidence, { batches: 1, command_receipts: 4, conflicts: 1, import_receipts: 1, rows: 3 });
    process.stdout.write(`${JSON.stringify({
      contractVersions: ["ImportBatch/v1", "ImportReceipt/v1", ONBOARD_IMPORT_MAPPING_VERSION],
      evidence,
      result: "PASS",
    })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
