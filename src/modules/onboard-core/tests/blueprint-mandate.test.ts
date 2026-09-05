import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { onboardingCoreEnabledForTenant } from "@/lib/api/config";
import {
  ONBOARD_CORE_API_VERSION,
  TENANT_BLUEPRINT_MAPPING_VERSION,
  TENANT_PACK_DRAFT_VERSION,
  OnboardCoreContractError,
  blueprintDraftObjectVersion,
  blueprintIdempotencyKey,
  issueApprovedBlueprint,
  issueDraftBlueprint,
  issueSetupMandate,
  parseSetupMandateRequest,
  parseTenantBlueprintApprovalRequest,
  parseTenantBlueprintProposal,
} from "../contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

const draft = {
  contractVersion: TENANT_PACK_DRAFT_VERSION,
  sections: {
    aiPolicies: ["no autonomous send"],
    approvals: ["human setup approval"],
    connectors: ["google workspace"],
    fields: ["company name", "email"],
    icp: ["mid market services"],
    retention: ["customer zero default"],
    roles: ["admin", "operator"],
    stages: ["new", "qualified"],
    terminology: { lead: "prospect" },
    workflows: ["lead qualification"],
  },
  sourcePackId: "tenant-pack-customer-zero",
  sourcePackVersion: "1.0.0",
  tenantSlug: "tenant-customer-zero",
} as const;

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: ONBOARD_CORE_API_VERSION,
    draft,
    mappingVersion: TENANT_BLUEPRINT_MAPPING_VERSION,
    sourceDigest: sha256(draft),
    sourceSchemaDigest: "a".repeat(64),
    ...overrides,
  };
}

function expectCode(callback: () => unknown, code: string) {
  assert.throws(callback, (error: unknown) => error instanceof OnboardCoreContractError && error.code === code);
}

test("L2 DRAFT input maps to L1-issued canonical identity, refs, policies, and stable reservation", () => {
  const parsed = parseTenantBlueprintProposal(proposal());
  const blueprint = issueDraftBlueprint("tenant-customer-zero", parsed);
  assert.equal(blueprint.contractVersion, "TenantBlueprint/v1");
  assert.equal(blueprint.tenantId, "tenant-customer-zero");
  assert.equal(blueprint.approval.state, "DRAFT");
  assert.equal(blueprint.approval.approvalRef, null);
  assert.deepEqual(blueprint.sections.fields, ["field:company-name", "field:email"]);
  assert.deepEqual(blueprint.sections.connectors, ["connector:google-workspace"]);
  assert.deepEqual(blueprint.sections.retention, ["retention-policy:customer-zero-default"]);
  assert.deepEqual(blueprint.sections.aiPolicies, ["ai-policy:no-autonomous-send"]);
  assert.match(blueprint.blueprintId, /^[0-9a-f-]{36}$/);
  assert.equal(issueDraftBlueprint("tenant-customer-zero", parsed).blueprintId, blueprint.blueprintId);
  assert.equal(blueprintIdempotencyKey("tenant-customer-zero", parsed), blueprintIdempotencyKey("tenant-customer-zero", parsed));
  assert.match(blueprintDraftObjectVersion(blueprint, parsed.sourceDigest), /:draft@[a-f0-9]{64}$/);
});

test("proposal is strict, digest-bound, versioned, tenant-bound, and denies client authority fields", () => {
  expectCode(() => parseTenantBlueprintProposal({ ...proposal(), actorId: "forged" }), "FIELD_SET_MISMATCH");
  expectCode(() => parseTenantBlueprintProposal(proposal({ contractVersion: "wrong" })), "WRONG_VERSION");
  expectCode(() => parseTenantBlueprintProposal(proposal({ mappingVersion: "TenantBlueprintMap/v2" })), "WRONG_MAPPING_VERSION");
  expectCode(() => parseTenantBlueprintProposal(proposal({ sourceDigest: "b".repeat(64) })), "SOURCE_DIGEST_MISMATCH");
  const changedDraft = { ...draft, sections: { ...draft.sections, fields: ["changed"] } };
  const changed = parseTenantBlueprintProposal(proposal({ draft: changedDraft, sourceDigest: sha256(changedDraft) }));
  assert.notEqual(
    blueprintIdempotencyKey("tenant-customer-zero", parseTenantBlueprintProposal(proposal())),
    blueprintIdempotencyKey("tenant-customer-zero", changed),
  );
  expectCode(
    () => issueDraftBlueprint("tenant-other", parseTenantBlueprintProposal(proposal())),
    "TENANT_MISMATCH",
  );
});

test("approval request carries no caller-issued approval identity and supersession is explicit", () => {
  const blueprint = issueDraftBlueprint("tenant-customer-zero", parseTenantBlueprintProposal(proposal()));
  const approval = parseTenantBlueprintApprovalRequest({
    blueprintId: blueprint.blueprintId,
    contractVersion: ONBOARD_CORE_API_VERSION,
    decision: "APPROVE",
    expectedObjectVersion: blueprintDraftObjectVersion(blueprint, sha256(draft)),
    supersedesApprovalRef: null,
  });
  assert.equal(approval.decision, "APPROVE");
  expectCode(() => parseTenantBlueprintApprovalRequest({ ...approval, approvalRef: "client:forged" }), "FIELD_SET_MISMATCH");
  expectCode(() => parseTenantBlueprintApprovalRequest({ ...approval, decision: "SUPERSEDE_AND_APPROVE" }), "APPROVAL_LINEAGE_INVALID");
});

test("L1 issues a bounded expiring NO_EFFECT mandate from exact approval", () => {
  const blueprint = issueDraftBlueprint("tenant-customer-zero", parseTenantBlueprintProposal(proposal()));
  const approved = issueApprovedBlueprint(blueprint, {
    approvalRef: "approval:human-20260905",
    approvedAt: "2026-09-05T12:00:00.000Z",
  });
  const mandate = issueSetupMandate({
    approvalRef: "approval:human-20260905",
    approvedBlueprint: approved,
    requestedAt: "2026-09-05T12:01:00.000Z",
  });
  assert.equal(mandate.effectCeiling, "NO_EFFECT");
  assert.equal(mandate.expiresAt, "2026-09-06T12:01:00.000Z");
  assert.equal(mandate.allowedActions.includes("APPLY_TENANT_CONFIGURATION"), false);
  assert.equal(mandate.prohibitedActions.includes("CREATE_OR_READ_CREDENTIAL"), true);
  assert.deepEqual(parseSetupMandateRequest({
    blueprintId: blueprint.blueprintId,
    blueprintVersion: blueprint.version,
    contractVersion: ONBOARD_CORE_API_VERSION,
    expectedBlueprintObjectVersion: "tenant-blueprint:approved-version",
    profile: "NO_EFFECT_IMPORT_AND_CONNECTOR_VALIDATION",
  }).profile, "NO_EFFECT_IMPORT_AND_CONNECTOR_VALIDATION");
  expectCode(() => parseSetupMandateRequest({
    blueprintId: blueprint.blueprintId,
    blueprintVersion: blueprint.version,
    contractVersion: ONBOARD_CORE_API_VERSION,
    expectedBlueprintObjectVersion: "tenant-blueprint:approved-version",
    profile: "LIVE_EFFECT",
  }), "AUTHORITY_DENIED");
});

test("onboarding mutation gate requires global exact true plus exact feature and tenant admission", () => {
  const original = { ...process.env };
  try {
    process.env.DATABASE_URL = "postgres://configured.invalid/db";
    process.env.LUZIONE_API_SERVICE_TOKEN = "configured";
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "true";
    process.env.LUZIONE_API_ONBOARDING_CORE_ENABLED = "true";
    process.env.LUZIONE_API_ONBOARDING_CORE_TENANTS = "tenant-customer-zero";
    assert.equal(onboardingCoreEnabledForTenant("tenant-customer-zero"), true);
    assert.equal(onboardingCoreEnabledForTenant("tenant-other"), false);
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "TRUE";
    assert.equal(onboardingCoreEnabledForTenant("tenant-customer-zero"), false);
  } finally {
    process.env = original;
  }
});

test("routes are authenticated, tenant/server-derived, default-off, and publish no provider effect", () => {
  for (const path of [
    "src/app/api/v1/onboarding/tenant-blueprints/route.ts",
    "src/app/api/v1/onboarding/tenant-blueprints/approvals/route.ts",
    "src/app/api/v1/onboarding/setup-mandates/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireServiceActor\(request\.headers/);
    assert.match(source, /bindAuthenticatedRequestIdentity\(identity, actor/);
    assert.doesNotMatch(source, /tenantId\s*:\s*(body|proposal|approval|mandateRequest)\./);
  }
  const mutations = [
    readFileSync("src/app/api/v1/onboarding/tenant-blueprints/route.ts", "utf8"),
    readFileSync("src/app/api/v1/onboarding/tenant-blueprints/approvals/route.ts", "utf8"),
    readFileSync("src/app/api/v1/onboarding/setup-mandates/route.ts", "utf8"),
  ].join("\n");
  assert.match(mutations, /onboardingCoreEnabledForTenant\(actor\.tenantId\)/);
  assert.doesNotMatch(mutations, /ProviderWorkerRuntime|fetch\(|secret-ref:|LIVE_EFFECT/);
});

test("migration is tenant-RLS, append-only, P110-dependent and exactly reversible", () => {
  const migration = readFileSync("supabase/migrations/20260905040000_onboard_core_blueprints_mandates.sql", "utf8");
  const rollback = readFileSync("scripts/validation/rollback-onboard-core-blueprints-mandates.sql", "utf8");
  assert.match(migration, /requires the P110 command ledger baseline/);
  assert.equal((migration.match(/force row level security/g) ?? []).length, 3);
  assert.equal((migration.match(/append_only/g) ?? []).length, 3);
  assert.match(migration, /actor_type text not null check \(actor_type = 'user'\)/);
  for (const relation of [
    "onboarding_tenant_blueprint_drafts",
    "onboarding_tenant_blueprint_approvals",
    "onboarding_setup_mandates",
  ]) assert.match(rollback, new RegExp(`drop table if exists public\\.${relation}`));
});
