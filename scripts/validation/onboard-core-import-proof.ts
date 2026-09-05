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
  ONBOARD_IMPORT_MAPPING_VERSION_V2,
  importSourceDigest,
  parseImportDryRunRequest,
} from "@/modules/onboard-core/importContracts";
import { OnboardImportStore } from "@/modules/onboard-core/importStore";
import { OnboardCoreDomainError, OnboardCoreStore } from "@/modules/onboard-core/store";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { TENANT_PACK_DRAFT_SCHEMA_DIGEST, TENANT_PACK_DRAFT_SCHEMA_PATH, TENANT_PACK_SOURCE_BINDING_VERSION, tenantPackSourceBindingDigest } from "@/modules/onboard-core/sourceBinding";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import type { TenantPackSourceBindingV1 } from "@/modules/onboard-core/sourceBinding";

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
const humanActor: HumanApprovalSubject = { actorId: "user_onboard_import_approver", actorType: "user", authenticationRef: "supabase-session:proof-import", authenticatedAt: new Date().toISOString(), capabilities: ["onboarding.blueprint.approve", "onboarding.mandate.revoke"], contractVersion: "LuzioneHumanApprovalSubject/v1", source: "supabase-user-jwt", tenantId: tenant };
const sourceBinding = {
  consumerEvidenceSha: "1".repeat(40), consumerImplementationSha: "2".repeat(40), consumerRepository: "CIBOTFLOW/Luzione-UI" as const,
  contractVersion: TENANT_PACK_SOURCE_BINDING_VERSION, evidenceDigest: "3".repeat(64), evidencePath: "evidence/import-proof.json",
  mapperDigest: "4".repeat(64), mapperPath: "src/onboarding/import-mapper.ts", sourceSchemaDigest: TENANT_PACK_DRAFT_SCHEMA_DIGEST,
  sourceSchemaPath: TENANT_PACK_DRAFT_SCHEMA_PATH,
} satisfies TenantPackSourceBindingV1;
const sourceBindingDigest = tenantPackSourceBindingDigest(sourceBinding);

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
    sourceBinding,
    sourceDigest: sha256(draft),
    sourceSchemaDigest: TENANT_PACK_DRAFT_SCHEMA_DIGEST,
  });
}

function dryRun(input: { dedupeKey: string; mandateId: string; mandateVersion: string; changed?: boolean }) {
  const rows = [
    { matchKeyDigest: sha256({ key: "a" }), payloadDigest: sha256({ company: input.changed ? "Changed" : "A" }), sourceRowId: "row-1" },
    { matchKeyDigest: null, payloadDigest: sha256({ company: "B" }), sourceRowId: "row-2" },
    { matchKeyDigest: sha256({ key: "conflict" }), payloadDigest: sha256({ company: "C" }), sourceRowId: "row-3" },
    { matchKeyDigest: sha256({ key: "conflict" }), payloadDigest: sha256({ company: "D" }), sourceRowId: "row-4" },
  ] as const;
  const source = { consentRef: "consent:import-proof", digest: "pending", kind: "CSV" as const, provenanceRef: "synthetic:import-proof" };
  return parseImportDryRunRequest({
    contractVersion: ONBOARD_CORE_API_VERSION,
    dedupeKey: input.dedupeKey,
    expectedMandateObjectVersion: input.mandateVersion,
    mandateId: input.mandateId,
    mappingVersion: ONBOARD_IMPORT_MAPPING_VERSION_V2,
    rows,
    sourceBindingDigest,
    source: { ...source, digest: importSourceDigest({ mappingVersion: ONBOARD_IMPORT_MAPPING_VERSION_V2, rows, source, sourceBindingDigest }) },
  });
}

async function main() {
  process.env.LUZIONE_API_ONBOARDING_L2_BINDINGS = JSON.stringify([{ ...sourceBinding, sourcePackId: "tenant-pack-import-proof", sourcePackVersion: "1.0.0", tenantId: tenant }]);
  const pool = new Pool({ connectionString });
  const core = new OnboardCoreStore(pool);
  const imports = new OnboardImportStore(pool);
  const now = new Date();
  try {
    const draft = await core.proposeBlueprint({ actor: serviceActor, correlationId: "correlation-import-blueprint", proposal: blueprintProposal(), requestedAt: now.toISOString() });
    const approved = await core.approveBlueprint({
      actor: serviceActor,
      approval: parseTenantBlueprintApprovalRequest({
        blueprintId: draft.readback.blueprint.blueprintId,
        contractVersion: ONBOARD_CORE_API_VERSION,
        decision: "APPROVE",
        expectedObjectVersion: draft.readback.objectVersion,
        supersedesApprovalRef: null,
      }),
      correlationId: "correlation-import-approval",
      human: humanActor,
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
    assert.equal(result.readback.rows.length, 4);
    assert.equal(result.readback.rows.filter((row) => row.exceptionRef).length, 3);
    assert.equal(result.readback.rows.filter((row) => row.reconciliationRef).length, 2);

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
    const revokedMandateId = mandate.readback.mandate.mandateId;
    await core.revokeMandate({ actor: serviceActor, correlationId: "correlation-import-revocation", human: humanActor, requestedAt: new Date(now.getTime() + 7_000).toISOString(), revocation: { contractVersion: ONBOARD_CORE_API_VERSION, expectedMandateObjectVersion: mandate.readback.objectVersion, mandateId: revokedMandateId, reasonCode: "SECURITY_HOLD", revocationVersion: "SetupMandateRevocation/v1" } });
    assert.equal((await core.readMandate(serviceActor, revokedMandateId))?.mandate.active, false);
    await assert.rejects(
      () => imports.executeDryRun({
        actor: serviceActor,
        correlationId: "correlation-import-revoked",
        request: dryRun({ dedupeKey: "import-proof-revoked", mandateId: revokedMandateId, mandateVersion: mandate.readback.objectVersion }),
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
    assert.deepEqual(evidence, { batches: 1, command_receipts: 5, conflicts: 1, import_receipts: 1, rows: 4 });
    process.stdout.write(`${JSON.stringify({
      contractVersions: ["ImportBatch/v1", "ImportReceipt/v1", ONBOARD_IMPORT_MAPPING_VERSION_V2],
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
