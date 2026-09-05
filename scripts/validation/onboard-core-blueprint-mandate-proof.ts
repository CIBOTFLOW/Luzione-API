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
import { OnboardCoreDomainError, OnboardCoreStore } from "@/modules/onboard-core/store";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { TENANT_PACK_DRAFT_SCHEMA_DIGEST, TENANT_PACK_DRAFT_SCHEMA_PATH, TENANT_PACK_SOURCE_BINDING_VERSION } from "@/modules/onboard-core/sourceBinding";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const tenant = "onboard-proof-a";
const serviceActor: ApiActor = {
  actorId: "service:onboard-proof",
  actorType: "service",
  capabilities: ["onboarding.blueprint.propose", "onboarding.blueprint.read", "onboarding.mandate.issue", "onboarding.mandate.read"],
  source: "service-token",
  tenantId: tenant,
};
const humanActor: HumanApprovalSubject = {
  actorId: "user_onboard_approver",
  actorType: "user",
  capabilities: ["onboarding.blueprint.approve", "onboarding.blueprint.read"],
  authenticationRef: "supabase-session:proof-human",
  authenticatedAt: new Date().toISOString(),
  contractVersion: "LuzioneHumanApprovalSubject/v1",
  source: "supabase-user-jwt",
  tenantId: tenant,
};
const sourceBinding = {
  consumerEvidenceSha: "1".repeat(40), consumerImplementationSha: "2".repeat(40), consumerRepository: "CIBOTFLOW/Luzione-UI" as const,
  contractVersion: TENANT_PACK_SOURCE_BINDING_VERSION, evidenceDigest: "3".repeat(64), evidencePath: "evidence/onboard-proof.json",
  mapperDigest: "4".repeat(64), mapperPath: "src/onboarding/mapper.ts", sourceSchemaDigest: TENANT_PACK_DRAFT_SCHEMA_DIGEST,
  sourceSchemaPath: TENANT_PACK_DRAFT_SCHEMA_PATH,
};

function draft(version: string, field = "company name") {
  return {
    contractVersion: TENANT_PACK_DRAFT_VERSION,
    sections: {
      aiPolicies: ["no autonomous send"],
      approvals: ["human setup approval"],
      connectors: ["google workspace"],
      fields: [field, "email"],
      icp: ["mid market services"],
      retention: ["customer zero default"],
      roles: ["admin", "operator"],
      stages: ["new", "qualified"],
      terminology: { lead: "prospect" },
      workflows: ["lead qualification"],
    },
    sourcePackId: "tenant-pack-customer-zero",
    sourcePackVersion: version,
    tenantSlug: tenant,
  } as const;
}

function proposal(version: string, field?: string) {
  const proposedDraft = draft(version, field);
  return parseTenantBlueprintProposal({
    contractVersion: ONBOARD_CORE_API_VERSION,
    draft: proposedDraft,
    mappingVersion: TENANT_BLUEPRINT_MAPPING_VERSION,
    sourceBinding,
    sourceDigest: sha256(proposedDraft),
    sourceSchemaDigest: TENANT_PACK_DRAFT_SCHEMA_DIGEST,
  });
}

async function main() {
  process.env.LUZIONE_API_ONBOARDING_L2_BINDINGS = JSON.stringify([
    { ...sourceBinding, sourcePackId: "tenant-pack-customer-zero", sourcePackVersion: "1.0.0", tenantId: tenant },
    { ...sourceBinding, sourcePackId: "tenant-pack-customer-zero", sourcePackVersion: "2.0.0", tenantId: tenant },
  ]);
  const pool = new Pool({ connectionString });
  const store = new OnboardCoreStore(pool);
  const now = new Date();
  try {
    const first = await store.proposeBlueprint({
      actor: serviceActor,
      correlationId: "correlation-onboard-proposal-1",
      proposal: proposal("1.0.0"),
      requestedAt: now.toISOString(),
    });
    assert.equal(first.readback.blueprint.approval.state, "DRAFT");
    assert.equal(first.readback.blueprint.tenantId, tenant);
    assert.equal(first.receipt.idempotentReplay, false);

    const replay = await store.proposeBlueprint({
      actor: serviceActor,
      correlationId: "correlation-onboard-proposal-replay",
      proposal: proposal("1.0.0"),
      requestedAt: new Date(now.getTime() + 1_000).toISOString(),
    });
    assert.equal(replay.receipt.idempotentReplay, true);
    assert.equal(replay.receipt.receiptId, first.receipt.receiptId);

    await assert.rejects(
      () => store.proposeBlueprint({
        actor: serviceActor,
        correlationId: "correlation-onboard-proposal-conflict",
        proposal: proposal("1.0.0", "changed under same version"),
        requestedAt: new Date(now.getTime() + 2_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "BLUEPRINT_VERSION_CONFLICT",
    );

    assert.equal(await store.readBlueprint({ ...serviceActor, tenantId: "onboard-proof-b" }, first.readback.blueprint.blueprintId), null);
    await assert.rejects(
      () => store.approveBlueprint({
        actor: serviceActor,
        approval: parseTenantBlueprintApprovalRequest({
          blueprintId: first.readback.blueprint.blueprintId,
          contractVersion: ONBOARD_CORE_API_VERSION,
          decision: "APPROVE",
          expectedObjectVersion: first.readback.objectVersion,
          supersedesApprovalRef: null,
        }),
        correlationId: "correlation-client-approval-denied",
        human: { ...humanActor, tenantId: "onboard-proof-b" },
        requestedAt: new Date(now.getTime() + 3_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "HUMAN_APPROVAL_REQUIRED",
    );

    const approved = await store.approveBlueprint({
      actor: serviceActor,
      approval: parseTenantBlueprintApprovalRequest({
        blueprintId: first.readback.blueprint.blueprintId,
        contractVersion: ONBOARD_CORE_API_VERSION,
        decision: "APPROVE",
        expectedObjectVersion: first.readback.objectVersion,
        supersedesApprovalRef: null,
      }),
      correlationId: "correlation-human-approval-1",
      human: humanActor,
      requestedAt: new Date(now.getTime() + 4_000).toISOString(),
    });
    assert.equal(approved.readback.blueprint.approval.state, "APPROVED");
    assert.ok(approved.readback.blueprint.approval.approvalRef);

    const second = await store.proposeBlueprint({
      actor: serviceActor,
      correlationId: "correlation-onboard-proposal-2",
      proposal: proposal("2.0.0", "legal name"),
      requestedAt: new Date(now.getTime() + 5_000).toISOString(),
    });
    await assert.rejects(
      () => store.approveBlueprint({
        actor: serviceActor,
        approval: parseTenantBlueprintApprovalRequest({
          blueprintId: second.readback.blueprint.blueprintId,
          contractVersion: ONBOARD_CORE_API_VERSION,
          decision: "SUPERSEDE_AND_APPROVE",
          expectedObjectVersion: "stale",
          supersedesApprovalRef: approved.readback.blueprint.approval.approvalRef,
        }),
        correlationId: "correlation-stale-approval",
        human: humanActor,
        requestedAt: new Date(now.getTime() + 6_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "STALE_BLUEPRINT",
    );
    const superseding = await store.approveBlueprint({
      actor: serviceActor,
      approval: parseTenantBlueprintApprovalRequest({
        blueprintId: second.readback.blueprint.blueprintId,
        contractVersion: ONBOARD_CORE_API_VERSION,
        decision: "SUPERSEDE_AND_APPROVE",
        expectedObjectVersion: second.readback.objectVersion,
        supersedesApprovalRef: approved.readback.blueprint.approval.approvalRef,
      }),
      correlationId: "correlation-human-approval-2",
      human: humanActor,
      requestedAt: new Date(now.getTime() + 7_000).toISOString(),
    });
    assert.equal(superseding.readback.blueprint.approval.state, "APPROVED");
    assert.equal((await store.readBlueprint(serviceActor, first.readback.blueprint.blueprintId))?.blueprint.approval.state, "SUPERSEDED");

    const staleMandateRequest = parseSetupMandateRequest({
      blueprintId: first.readback.blueprint.blueprintId,
      blueprintVersion: first.readback.blueprint.version,
      contractVersion: ONBOARD_CORE_API_VERSION,
      expectedBlueprintObjectVersion: approved.readback.objectVersion,
      profile: "NO_EFFECT_IMPORT_AND_CONNECTOR_VALIDATION",
    });
    await assert.rejects(
      () => store.issueMandate({
        actor: serviceActor,
        correlationId: "correlation-superseded-mandate",
        mandateRequest: staleMandateRequest,
        requestedAt: new Date(now.getTime() + 8_000).toISOString(),
      }),
      (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "APPROVED_BLUEPRINT_REQUIRED",
    );

    const mandateRequest = parseSetupMandateRequest({
      blueprintId: second.readback.blueprint.blueprintId,
      blueprintVersion: second.readback.blueprint.version,
      contractVersion: ONBOARD_CORE_API_VERSION,
      expectedBlueprintObjectVersion: superseding.readback.objectVersion,
      profile: "NO_EFFECT_IMPORT_AND_CONNECTOR_VALIDATION",
    });
    const mandate = await store.issueMandate({
      actor: serviceActor,
      correlationId: "correlation-mandate",
      mandateRequest,
      requestedAt: new Date(now.getTime() + 9_000).toISOString(),
    });
    assert.equal(mandate.readback.mandate.effectCeiling, "NO_EFFECT");
    assert.equal(mandate.readback.mandate.active, true);
    const mandateReplay = await store.issueMandate({
      actor: serviceActor,
      correlationId: "correlation-mandate-replay",
      mandateRequest,
      requestedAt: new Date(now.getTime() + 10_000).toISOString(),
    });
    assert.equal(mandateReplay.receipt.idempotentReplay, true);
    assert.equal(mandateReplay.receipt.receiptId, mandate.receipt.receiptId);

    await assert.rejects(
      () => pool.query("update public.onboarding_tenant_blueprint_drafts set source_pack_id='overwrite' where tenant_id=$1", [tenant]),
      /append-only/,
    );
    const evidence = (await pool.query(
      `select
        (select count(*)::int from public.onboarding_tenant_blueprint_drafts where tenant_id=$1) drafts,
        (select count(*)::int from public.onboarding_tenant_blueprint_approvals where tenant_id=$1 and action='APPROVED') approved,
        (select count(*)::int from public.onboarding_tenant_blueprint_approvals where tenant_id=$1 and action='SUPERSEDED') superseded,
        (select count(*)::int from public.onboarding_setup_mandates where tenant_id=$1) mandates,
        (select count(*)::int from public.p110_command_receipts where tenant_id=$1) receipts`,
      [tenant],
    )).rows[0];
    assert.deepEqual(evidence, { approved: 2, drafts: 2, mandates: 1, receipts: 5, superseded: 1 });
    process.stdout.write(`${JSON.stringify({
      contractVersions: ["TenantBlueprint/v1", "SetupMandate/v1", ONBOARD_CORE_API_VERSION, TENANT_BLUEPRINT_MAPPING_VERSION],
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
