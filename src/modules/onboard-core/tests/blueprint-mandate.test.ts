import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { onboardingCoreEnabledForTenant } from "@/lib/api/config";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  ONBOARD_CORE_API_VERSION, SETUP_MANDATE_REVOCATION_VERSION, TENANT_BLUEPRINT_MAPPING_VERSION,
  TENANT_PACK_DRAFT_VERSION, OnboardCoreContractError, admitProposalSourceBinding,
  blueprintIdempotencyKey, issueDraftBlueprint, parseSetupMandateRevocationRequest, parseTenantBlueprintProposal,
} from "../contracts";
import { verifySupabaseHumanApprovalToken, type HumanJwk } from "../humanApproval";
import {
  TENANT_PACK_DRAFT_SCHEMA_DIGEST, TENANT_PACK_DRAFT_SCHEMA_PATH, TENANT_PACK_SOURCE_BINDING_VERSION,
  tenantPackSourceBindingDigest,
  type TenantPackSourceBindingV1,
} from "../sourceBinding";

const draft = {
  contractVersion: TENANT_PACK_DRAFT_VERSION,
  sections: {
    aiPolicies: ["no autonomous send"], approvals: ["human setup approval"], connectors: ["google workspace"],
    fields: ["company name", "email"], icp: ["mid market services"], retention: ["customer zero default"],
    roles: ["admin", "operator"], stages: ["new", "qualified"], terminology: { lead: "prospect" }, workflows: ["lead qualification"],
  },
  sourcePackId: "tenant-pack-customer-zero", sourcePackVersion: "1.0.0", tenantSlug: "tenant-customer-zero",
} as const;

const sourceBinding = {
  consumerEvidenceSha: "1".repeat(40), consumerImplementationSha: "2".repeat(40),
  consumerRepository: "CIBOTFLOW/Luzione-UI" as const, contractVersion: TENANT_PACK_SOURCE_BINDING_VERSION,
  evidenceDigest: "3".repeat(64), evidencePath: "evidence/tenant-pack-v1.json",
  mapperDigest: "4".repeat(64), mapperPath: "src/contracts/onboarding/tenant-pack-mapper.ts",
  sourceSchemaDigest: TENANT_PACK_DRAFT_SCHEMA_DIGEST, sourceSchemaPath: TENANT_PACK_DRAFT_SCHEMA_PATH,
} satisfies TenantPackSourceBindingV1;

function proposal(overrides: Record<string, unknown> = {}) {
  return { contractVersion: ONBOARD_CORE_API_VERSION, draft, mappingVersion: TENANT_BLUEPRINT_MAPPING_VERSION, sourceBinding, sourceDigest: sha256(draft), sourceSchemaDigest: TENANT_PACK_DRAFT_SCHEMA_DIGEST, ...overrides };
}
function expectCode(callback: () => unknown, code: string) {
  assert.throws(callback, (error: unknown) => error instanceof OnboardCoreContractError && error.code === code);
}

test("v2 Blueprint identity and reservation content-bind exact admitted schema and L2 evidence", () => {
  const previous = process.env.LUZIONE_API_ONBOARDING_L2_BINDINGS;
  process.env.LUZIONE_API_ONBOARDING_L2_BINDINGS = JSON.stringify([{ ...sourceBinding, sourcePackId: draft.sourcePackId, sourcePackVersion: draft.sourcePackVersion, tenantId: draft.tenantSlug }]);
  try {
    const parsed = parseTenantBlueprintProposal(proposal());
    const admitted = admitProposalSourceBinding(draft.tenantSlug, parsed);
    assert.equal(admitted.digest, tenantPackSourceBindingDigest(sourceBinding));
    const blueprint = issueDraftBlueprint(draft.tenantSlug, parsed);
    const changed = parseTenantBlueprintProposal(proposal({ sourceBinding: { ...sourceBinding, evidenceDigest: "5".repeat(64) } }));
    assert.notEqual(blueprintIdempotencyKey(draft.tenantSlug, parsed), blueprintIdempotencyKey(draft.tenantSlug, changed));
    assert.throws(() => admitProposalSourceBinding(draft.tenantSlug, changed), /differs from the admitted exact record/);
    assert.match(blueprint.blueprintId, /^[0-9a-f-]{36}$/);
  } finally {
    if (previous === undefined) delete process.env.LUZIONE_API_ONBOARDING_L2_BINDINGS;
    else process.env.LUZIONE_API_ONBOARDING_L2_BINDINGS = previous;
  }
});

test("schema bytes, surplus fields, wrong schema and old versions fail closed", () => {
  const rawDigest = crypto.createHash("sha256").update(readFileSync(TENANT_PACK_DRAFT_SCHEMA_PATH)).digest("hex");
  assert.equal(rawDigest, TENANT_PACK_DRAFT_SCHEMA_DIGEST);
  expectCode(() => parseTenantBlueprintProposal({ ...proposal(), actorId: "forged" }), "FIELD_SET_MISMATCH");
  expectCode(() => parseTenantBlueprintProposal(proposal({ contractVersion: "LuzioneOnboardCoreApi/v1" })), "WRONG_VERSION");
  expectCode(() => parseTenantBlueprintProposal(proposal({ mappingVersion: "TenantBlueprintMap/v1" })), "WRONG_MAPPING_VERSION");
  expectCode(() => parseTenantBlueprintProposal(proposal({ sourceSchemaDigest: "a".repeat(64) })), "SOURCE_SCHEMA_DIGEST_MISMATCH");
});

test("raw Tenant Pack strings are schema-valid before canonicalization and cannot collide", () => {
  const schema = JSON.parse(readFileSync(TENANT_PACK_DRAFT_SCHEMA_PATH, "utf8")) as {
    $defs: { boundedText: { maxLength: number }; stableId: { maxLength: number; pattern: string } };
  };
  assert.equal(schema.$defs.boundedText.maxLength, 200);
  assert.equal(schema.$defs.stableId.maxLength, 200);

  const exactUnicodeBound = "🟢".repeat(200);
  const exactUnicodeDraft = {
    ...draft,
    sections: { ...draft.sections, aiPolicies: [exactUnicodeBound] },
  };
  assert.equal(Array.from(exactUnicodeBound).length, 200);
  assert.equal(
    parseTenantBlueprintProposal(proposal({ draft: exactUnicodeDraft, sourceDigest: sha256(exactUnicodeDraft) }))
      .draft.sections.aiPolicies[0],
    exactUnicodeBound,
  );

  const overlongValue = draft.sections.aiPolicies[0].padStart(201, " ");
  const overlongDraft = {
    ...draft,
    sections: { ...draft.sections, aiPolicies: [overlongValue] },
  };
  assert.equal(overlongValue.length, 201);
  assert.notEqual(sha256(overlongDraft), sha256(draft));
  expectCode(
    () => parseTenantBlueprintProposal(proposal({ draft: overlongDraft })),
    "INVALID_REQUEST",
  );

  const whitespaceIdDraft = { ...draft, sourcePackId: `${draft.sourcePackId} ` };
  assert.notEqual(sha256(whitespaceIdDraft), sha256(draft));
  assert.equal(new RegExp(schema.$defs.stableId.pattern).test(whitespaceIdDraft.sourcePackId), false);
  expectCode(
    () => parseTenantBlueprintProposal(proposal({ draft: whitespaceIdDraft })),
    "INVALID_REQUEST",
  );

  assert.equal(parseTenantBlueprintProposal(proposal()).draft.sourcePackId, draft.sourcePackId);
});

test("separate signed Supabase user subject derives authority only from app_metadata", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "proof-key", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    app_metadata: { luzione_capabilities: ["onboarding.blueprint.approve"], luzione_tenant_id: draft.tenantSlug },
    aud: "authenticated", exp: now + 300, iat: now, is_anonymous: false,
    iss: "https://proof.supabase.co/auth/v1", role: "authenticated",
    session_id: "11111111-1111-4111-8111-111111111111", sub: "22222222-2222-4222-8222-222222222222",
    user_metadata: { luzione_capabilities: ["forged"] },
  })).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256" as const, kid: "proof-key", kty: "RSA" as const, use: "sig" } satisfies HumanJwk;
  const loader = async () => [jwk];
  const subject = await verifySupabaseHumanApprovalToken(`${header}.${payload}.${signature}`, "https://proof.supabase.co/auth/v1", "onboarding.blueprint.approve", loader);
  assert.equal(subject?.tenantId, draft.tenantSlug);
  assert.deepEqual(subject?.capabilities, ["onboarding.blueprint.approve"]);
  assert.equal(await verifySupabaseHumanApprovalToken(`${header}.${payload}.${signature}`, "https://proof.supabase.co/auth/v1", "forged", loader), null);
});

test("revocation is strict, versioned, append-only in storage and human-separated in routes", () => {
  const revocation = parseSetupMandateRevocationRequest({ contractVersion: ONBOARD_CORE_API_VERSION, expectedMandateObjectVersion: "setup-mandate:proof@v1", mandateId: "55555555-5555-4555-8555-555555555555", reasonCode: "SECURITY_HOLD", revocationVersion: SETUP_MANDATE_REVOCATION_VERSION });
  assert.equal(revocation.reasonCode, "SECURITY_HOLD");
  const route = readFileSync("src/app/api/v1/onboarding/setup-mandates/revocations/route.ts", "utf8");
  const store = readFileSync("src/modules/onboard-core/store.ts", "utf8");
  assert.match(route, /requireHumanApprovalSubject/);
  assert.match(store, /DISTINCT_HUMAN_APPROVER_REQUIRED/);
  assert.match(store, /onboarding_setup_mandate_revocations/);
  assert.doesNotMatch(store, /update public\.onboarding_setup_mandates\s+set revoked/);
});

test("all mutations remain exact-default-off and migration is tenant RLS, append-only and reversible", () => {
  const previous = { ...process.env };
  try {
    process.env.DATABASE_URL = "postgres://configured.invalid/db"; process.env.LUZIONE_API_SERVICE_TOKEN = "configured";
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "true"; process.env.LUZIONE_API_ONBOARDING_CORE_ENABLED = "true";
    process.env.LUZIONE_API_ONBOARDING_CORE_TENANTS = draft.tenantSlug;
    assert.equal(onboardingCoreEnabledForTenant(draft.tenantSlug), true);
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "TRUE";
    assert.equal(onboardingCoreEnabledForTenant(draft.tenantSlug), false);
  } finally { process.env = previous; }
  const migration = readFileSync("supabase/migrations/20260905050000_onboard_core_correction_01.sql", "utf8");
  const rollback = readFileSync("scripts/validation/rollback-onboard-core-correction-01.sql", "utf8");
  assert.match(migration, /onboarding_setup_mandate_revocations_append_only/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all.*service_role/);
  assert.match(rollback, /ONBOARD_CORE_CORRECTION_REVERSE_BLOCKED_V2_PROVENANCE/);
  assert.match(rollback, /drop table if exists public\.onboarding_setup_mandate_revocations/);
  assert.ok(rollback.indexOf("ONBOARD_CORE_CORRECTION_REVERSE_BLOCKED_V2_PROVENANCE")
    < rollback.indexOf("drop table if exists public.onboarding_setup_mandate_revocations"));
});
