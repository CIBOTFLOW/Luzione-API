import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { seedSupplierIdentityCommandsEnabledForTenant, seedSupplierIdentityReadsEnabledForTenant } from "@/lib/api/config";
import {
  SUPPLIER_PROFILE_COMMAND_VERSION,
  SeedSupplierIdentityContractError,
  parseSeedSupplierIdentityCommand,
  parseSupplierProfileV1,
} from "@/modules/seed-supplier-identity/contracts";
import {
  supplierEvidenceRefFixture,
  portalSupplierBindingActiveFixture,
  portalSupplierBindingCommandHttpResponsePositiveFixture,
  portalSupplierBindingReadHttpResponsePositiveFixture,
  portalSupplierBindingRecordCommandFixture,
  supplierFixtureAccountId,
  supplierFixtureAccountVersion,
  supplierFixtureProfileId,
  supplierFixtureTenantId,
  supplierProfileActivateCommandFixture,
  supplierProfileEligibleFixture,
  supplierProfileProposeCommandFixture,
  supplierProfileReadModelFixture,
  supplierProfileCommandHttpResponsePositiveFixture,
  supplierProfileReadHttpResponsePositiveFixture,
} from "@/modules/seed-supplier-identity/fixtures";
import { nextSupplierProfileStatus, supplierEligibilityDefects, supplierIdentityKnownBadDefects, supplierProfileVersion } from "@/modules/seed-supplier-identity/model";
import {
  PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION,
  parsePortalAccountAccessBindingCommand,
  parsePortalAccountAccessBindingV1,
  portalAccountAccessBindingId,
  portalAccountAccessBindingVersion,
  requirePortalAccountAccess,
  type PortalAccountAccessBindingV1,
} from "@/modules/seed-supplier-identity/portalAccessContracts";
import { parseSupplierProfileReadModel } from "@/modules/seed-supplier-identity/readModel";

function proposedProfile() {
  const value = structuredClone(supplierProfileEligibleFixture);
  value.authority = { ...value.authority, approvalRef: null, capability: "supplier_profile.propose", decision: "ALLOW", effectClass: "A1" };
  value.createdAt = "2026-09-05T17:30:00.000Z";
  value.updatedAt = "2026-09-05T17:30:00.000Z";
  value.data.decision = { action: "PROPOSE", decidedAt: value.updatedAt, humanActorId: null, humanAuthenticationRef: null, reason: null };
  value.mutation.expectedVersion = "ABSENT";
  value.resource.status = "PROPOSED";
  value.resource.version = supplierProfileVersion(supplierFixtureProfileId, 1);
  value.receipt.committedVersion = value.resource.version;
  return value;
}

test("A2S commands and SupplierProfile/v1 fixture preserve exact Account, evidence, authority and Timeline lineage", () => {
  assert.equal(parseSeedSupplierIdentityCommand(supplierProfileProposeCommandFixture).contractVersion, SUPPLIER_PROFILE_COMMAND_VERSION);
  assert.equal(parseSeedSupplierIdentityCommand(supplierProfileActivateCommandFixture).commandType, "supplier_profile.transition");
  const profile = parseSupplierProfileV1(supplierProfileEligibleFixture);
  assert.equal(profile.authority.decision, "REQUIRE_HUMAN");
  assert.equal(profile.authority.effectClass, "A2");
  assert.equal(profile.data.accountRef.accountVersion, supplierFixtureAccountVersion);
  const readModel = parseSupplierProfileReadModel(supplierProfileReadModelFixture);
  assert.equal(readModel.timelineEvent.data.aggregateRefs[0].version, profile.resource.version);
  assert.equal(readModel.timelineEvent.receipt.receiptId, profile.receipt.receiptId);
  assert.equal(supplierProfileReadHttpResponsePositiveFixture.result.metadata.supplierIdentityContractProducerSha, readModel.metadata.supplierIdentityContractProducerSha);
  assert.equal(supplierProfileCommandHttpResponsePositiveFixture.result.readback.supplierProfile.resource.version, profile.resource.version);
  assert.equal(parsePortalAccountAccessBindingCommand(portalSupplierBindingRecordCommandFixture).commandType, "portal_account_access_binding.record");
  assert.equal(parsePortalAccountAccessBindingV1(portalSupplierBindingReadHttpResponsePositiveFixture.result).version, portalSupplierBindingActiveFixture.version);
  assert.equal(portalSupplierBindingCommandHttpResponsePositiveFixture.result.timelineEvent.receipt.receiptId, portalSupplierBindingActiveFixture.receipt.receiptId);
});

test("SupplierProfile parser rejects false authority, malformed hashes/timestamps/IDs, status drift and incomplete lineage", () => {
  for (const mutate of [
    (value: ReturnType<typeof proposedProfile>) => { value.authority.effectClass = "A2"; },
    (value: ReturnType<typeof proposedProfile>) => { value.authority.decision = "DENY"; },
    (value: ReturnType<typeof proposedProfile>) => { value.authority.capability = "supplier_profile.transition"; },
    (value: ReturnType<typeof proposedProfile>) => { value.mutation.payloadHash = "not-a-sha"; },
    (value: ReturnType<typeof proposedProfile>) => { value.updatedAt = "2026-02-30T17:30:00.000Z"; value.data.decision.decidedAt=value.updatedAt; },
    (value: ReturnType<typeof proposedProfile>) => { value.resource.id = ` ${value.resource.id}`; },
    (value: ReturnType<typeof proposedProfile>) => { value.resource.version = `${value.resource.version}junk`; value.receipt.committedVersion=value.resource.version; },
    (value: ReturnType<typeof proposedProfile>) => { value.resource.status = "ARCHIVED"; },
    (value: ReturnType<typeof proposedProfile>) => { value.receipt.observedAt = value.updatedAt; },
    (value: ReturnType<typeof proposedProfile>) => { value.sourceRefs = [...value.sourceRefs, value.sourceRefs[1]]; },
    (value: ReturnType<typeof proposedProfile>) => { value.sourceRefs = value.sourceRefs.slice(1); },
    (value: ReturnType<typeof proposedProfile>) => { value.data.evidenceRefs[0].ownerProject = "LUZIONE_CRM"; },
  ]) {
    const value = proposedProfile();
    mutate(value);
    assert.throws(() => parseSupplierProfileV1(value), (error: unknown) => error instanceof SeedSupplierIdentityContractError);
  }
  const transition = structuredClone(supplierProfileEligibleFixture);
  transition.authority.decision = "ALLOW";
  assert.throws(() => parseSupplierProfileV1(transition), (error: unknown) => error instanceof SeedSupplierIdentityContractError && error.code === "HUMAN_APPROVAL_REQUIRED");
  const expiredActivation = structuredClone(supplierProfileEligibleFixture);
  expiredActivation.resource.status = "EXPIRED";
  assert.throws(() => parseSupplierProfileV1(expiredActivation));
  const skippedPrior = structuredClone(supplierProfileEligibleFixture);
  skippedPrior.mutation.expectedVersion = supplierProfileVersion(supplierFixtureProfileId, 7);
  assert.throws(() => parseSupplierProfileV1(skippedPrior), /immediately prior/);
});

test("eligibility fails closed for missing capability, stale Account, non-eligible state and validity closure", () => {
  const base = { accountVersionActual: supplierFixtureAccountVersion, accountVersionExpected: supplierFixtureAccountVersion, capability: "RFQ_RESPONSE" as const, capabilities: supplierProfileEligibleFixture.data.capabilities, observedAt: "2026-09-05T17:31:00.000Z", status: "ELIGIBLE" as const, validFrom: supplierProfileEligibleFixture.data.validFrom, validUntil: supplierProfileEligibleFixture.data.validUntil };
  assert.deepEqual(supplierEligibilityDefects(base), []);
  assert.deepEqual(supplierEligibilityDefects({ ...base, accountVersionActual: "account:stale:v1", capability: "FULFILLMENT_UPDATE", observedAt: base.validUntil, status: "SUSPENDED" }), ["ACCOUNT_VERSION_STALE", "SUPPLIER_NOT_ELIGIBLE", "CAPABILITY_NOT_APPROVED", "VALIDITY_WINDOW_CLOSED"]);
  assert.deepEqual(supplierEligibilityDefects({ ...base, observedAt: "2026-02-30T09:00:00.000Z" }), ["INVALID_VALIDITY_TIMESTAMP"]);
  assert.throws(() => nextSupplierProfileStatus({ action: "ACTIVATE", currentStatus: "PROPOSED", hasIdentityConflict: false, requestedAt: "not-a-date", validUntil: base.validUntil }), /canonical RFC3339/);
});

test("Portal Account binding requires exact organization, membership, grant, revocation and does not create eligibility", () => {
  const organizationId = "portal-org-1";
  const bindingId = portalAccountAccessBindingId(supplierFixtureTenantId, organizationId, supplierFixtureAccountId);
  const membershipRef = { id: "membership-1", status: "ACTIVE" as const, version: "membership:membership-1:v3" };
  const objectGrantRef = { id: "grant-1", status: "ACTIVE" as const, version: "grant:grant-1:v2" };
  const record = parsePortalAccountAccessBindingCommand({ accountId: supplierFixtureAccountId, accountVersion: supplierFixtureAccountVersion, bindingId, commandId: "portal-binding-record-1", commandType: "portal_account_access_binding.record", contractVersion: PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION, evidenceRefs: [supplierEvidenceRefFixture], expectedVersion: "ABSENT", idempotencyKey: "portal-binding-record-idem-1", membershipRef, objectGrantRef, organizationId });
  assert.equal(record.commandType, "portal_account_access_binding.record");
  const binding: PortalAccountAccessBindingV1 = { accountRef: { accountId: supplierFixtureAccountId, accountVersion: supplierFixtureAccountVersion }, authority: { decision: "REQUIRE_HUMAN", effectClass: "A2", humanActorId: "user-approver", humanAuthenticationRef: "supabase-session:approval", workloadActorId: "service:luzione-supplier-portal" }, bindingId, contractVersion: "PortalOrganizationAccountAccessBinding/v1", createdAt: "2026-09-05T17:30:00.000Z", evidenceRefs: [{ ...supplierEvidenceRefFixture, ownerProject: "LUZIONE_PROCUREMENT" }], membershipRef, objectGrantRef, organizationId, receipt: { committedVersion: portalAccountAccessBindingVersion(bindingId, 1), finality: "DOMAIN_COMMITTED", payloadHash: "a".repeat(64), receiptId: "receipt-portal-binding-1" }, revocationRef: null, status: "ACTIVE", tenantId: supplierFixtureTenantId, version: portalAccountAccessBindingVersion(bindingId, 1) };
  assert.equal(parsePortalAccountAccessBindingV1(binding).authority.workloadActorId, "service:luzione-supplier-portal");
  assert.deepEqual(requirePortalAccountAccess({ binding, membershipRef, objectGrantRef, observedTenantId: supplierFixtureTenantId, organizationId }), binding.accountRef);
  assert.throws(() => requirePortalAccountAccess({ binding: { ...binding, status: "REVOKED", revocationRef: "revocation-1" }, membershipRef, objectGrantRef, observedTenantId: supplierFixtureTenantId, organizationId }));
  assert.throws(() => parsePortalAccountAccessBindingCommand({ ...record, membershipRef: { ...membershipRef, status: "REVOKED" } }), /Initial Portal binding/);
  for (const hostile of [
    { ...binding, bindingId: `${binding.bindingId}-wrong` },
    { ...binding, authority: { ...binding.authority, workloadActorId: "service:forged" } },
    { ...binding, receipt: { ...binding.receipt, payloadHash: "bad" } },
    { ...binding, createdAt: "2026-02-30T17:30:00.000Z" },
    { ...binding, version: portalAccountAccessBindingVersion(binding.bindingId, 3), receipt: { ...binding.receipt, committedVersion: portalAccountAccessBindingVersion(binding.bindingId, 3) } },
    { ...binding, status: "REVOKED", revocationRef: null },
  ]) assert.throws(() => parsePortalAccountAccessBindingV1(hostile));
});

test("known-bad tenant, stale and self-approval controls are detected", () => {
  assert.deepEqual(supplierIdentityKnownBadDefects({ actualVersion: "supplier:v2", expectedVersion: "supplier:v1", humanActorId: "user-a", proposalActorId: "user-a", query: "select * from seed_supplier_profile_versions where supplier_profile_id=$2" }), ["TENANT_PREDICATE_MISSING", "STALE_VERSION_ACCEPTED", "PORTAL_SELF_APPROVAL_ACCEPTED"]);
  assert.deepEqual(supplierIdentityKnownBadDefects({ actualVersion: "supplier:v1", expectedVersion: "supplier:v1", humanActorId: "user-b", proposalActorId: "user-a", query: "select * from seed_supplier_profile_versions where tenant_id=$1 and supplier_profile_id=$2" }), []);
});

test("read-model Timeline projection rejects wrong receipt, source, actor, timestamp and padded tenant", () => {
  for (const mutate of [
    (value: typeof supplierProfileReadModelFixture) => { value.timelineEvent.receipt.receiptId = "receipt-other"; },
    (value: typeof supplierProfileReadModelFixture) => { value.timelineEvent.sourceRefs[0].version = "supplier-profile:stale:v0"; },
    (value: typeof supplierProfileReadModelFixture) => { value.timelineEvent.data.actorId = "user-other"; },
    (value: typeof supplierProfileReadModelFixture) => { value.timelineEvent.updatedAt = "2026-02-30T17:31:00.000Z"; },
    (value: typeof supplierProfileReadModelFixture) => { value.metadata.tenantId = ` ${value.metadata.tenantId}`; },
  ]) {
    const value=structuredClone(supplierProfileReadModelFixture);
    mutate(value);
    assert.throws(()=>parseSupplierProfileReadModel(value));
  }
});

test("migration enforces immutable versions, exact deferred P110 integrity, forced RLS, human access approval and guarded rollback", () => {
  const migration = readFileSync("supabase/migrations/20260905171927_seed_supplier_identity_a2s.sql", "utf8");
  const rollback = readFileSync("scripts/validation/rollback-seed-supplier-identity-a2s.sql", "utf8");
  for (const table of ["seed_supplier_profile_versions", "seed_supplier_portal_account_binding_versions"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(migration, new RegExp(`create policy ${table}_runtime_tenant[\\s\\S]*to luzione_api_runtime`));
  }
  assert.match(migration, /create constraint trigger seed_supplier_profile_versions_receipt_integrity[\s\S]*deferrable initially deferred/);
  assert.match(migration, /receipt\.payload_hash is distinct from new\.command_payload_hash/);
  assert.match(migration, /receipt\.state is distinct from 'DOMAIN_COMMITTED'/);
  assert.match(migration, /receipt\.actor_id is distinct from new\.created_by/);
  assert.match(migration, /new\.created_at <= prior_row\.created_at/);
  assert.match(migration, /new\.created_by = new\.proposal_actor_id/);
  assert.match(migration, /workload_actor_id text not null check \(workload_actor_id='service:luzione-supplier-portal'\)/);
  assert.match(migration, /human_authentication_ref text not null/);
  assert.match(migration, /created_by_type text not null check \(created_by_type='user'\)/);
  assert.match(migration, /unique \(tenant_id,organization_id,version\)/);
  assert.match(migration, /prior_row\.membership_ref->>'id' is distinct from new\.membership_ref->>'id'/);
  assert.match(migration, /command_payload jsonb not null/);
  assert.doesNotMatch(migration, /auth\.role\(|user_metadata|security definer/i);
  assert.doesNotMatch(migration, /grant[^;]*(update|delete|truncate)[^;]*luzione_api_runtime/i);
  assert.match(rollback, /rollback refused/);
  assert.match(rollback, /portal_account_access_binding\.revoke/);
});

test("routes separate default-off canonical-read admission from command admission and introduce no effect/provider path", () => {
  const sources = [
    readFileSync("src/app/api/v1/supplier-profiles/commands/route.ts", "utf8"),
    readFileSync("src/app/api/v1/supplier-profiles/[supplierProfileId]/route.ts", "utf8"),
    readFileSync("src/app/api/v1/accounts/[accountId]/supplier-profile/route.ts", "utf8"),
    readFileSync("src/app/api/v1/supplier-portal-account-bindings/commands/route.ts", "utf8"),
    readFileSync("src/app/api/v1/supplier-portal-account-bindings/[bindingId]/route.ts", "utf8"),
  ].join("\n");
  assert.equal((sources.match(/seedSupplierIdentityCommandsEnabledForTenant/g) ?? []).length, 4);
  assert.equal((sources.match(/seedSupplierIdentityReadsEnabledForTenant/g) ?? []).length, 6);
  const config = readFileSync("src/lib/api/config.ts", "utf8");
  assert.match(config, /seedSupplierIdentityCommandsEnabledForTenant[\s\S]*runtimeConfig\(\)\.mutationsEnabled/);
  const readGate = config.match(/export function seedSupplierIdentityReadsEnabledForTenant[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(readGate, /config\.databaseConfigured/);
  assert.doesNotMatch(readGate, /serviceTokenConfigured|mutationsEnabled/);
  assert.match(sources, /requireHumanApprovalSubject/);
  assert.doesNotMatch(sources, /RFQ_SEND|PO_RELEASE|providerAcknowledgement|fetch\(/);
  const ownerStores = `${readFileSync("src/modules/seed-supplier-identity/store.ts", "utf8")}\n${readFileSync("src/modules/seed-supplier-identity/portalAccessBinding.ts", "utf8")}`;
  assert.match(ownerStores, /parseTimelineEventV1/);
  assert.match(ownerStores, /SUPPLIER_PROFILE_TRANSPORT_AUTHORITY_REQUIRED/);
  assert.match(ownerStores, /human:\$\{human\.authenticationRef}/);
  assert.match(ownerStores, /workload:\$\{input\.actor\.actorId}/);
  assert.doesNotMatch(ownerStores, /for update/i, "advisory-locked append-only stores must not require UPDATE table grants");
  const actorSource = readFileSync("src/lib/api/actor.ts", "utf8");
  assert.doesNotMatch(actorSource, /actorId: "service:luzione-supplier-portal"/, "Portal workload has no admitted Vercel credential mapping in A2S");
});

test("canonical read admission is independent of mutation admission and all A2S gates fail closed by default", () => {
  const keys = [
    "DATABASE_URL",
    "LUZIONE_API_MUTATIONS_ENABLED",
    "LUZIONE_API_SEED_SUPPLIER_IDENTITY_COMMANDS_ENABLED",
    "LUZIONE_API_SEED_SUPPLIER_IDENTITY_COMMAND_TENANTS",
    "LUZIONE_API_SEED_SUPPLIER_IDENTITY_READS_ENABLED",
    "LUZIONE_API_SEED_SUPPLIER_IDENTITY_READ_TENANTS",
    "LUZIONE_API_SERVICE_TOKEN",
  ] as const;
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(seedSupplierIdentityReadsEnabledForTenant("tenant-a"), false);
    assert.equal(seedSupplierIdentityCommandsEnabledForTenant("tenant-a"), false);
    Object.assign(process.env, {
      DATABASE_URL: "postgres://configured",
      LUZIONE_API_MUTATIONS_ENABLED: "false",
      LUZIONE_API_SEED_SUPPLIER_IDENTITY_COMMANDS_ENABLED: "true",
      LUZIONE_API_SEED_SUPPLIER_IDENTITY_COMMAND_TENANTS: "tenant-a",
      LUZIONE_API_SEED_SUPPLIER_IDENTITY_READS_ENABLED: "true",
      LUZIONE_API_SEED_SUPPLIER_IDENTITY_READ_TENANTS: "tenant-a",
    });
    assert.equal(seedSupplierIdentityReadsEnabledForTenant("tenant-a"), true);
    assert.equal(seedSupplierIdentityReadsEnabledForTenant("tenant-b"), false);
    assert.equal(seedSupplierIdentityCommandsEnabledForTenant("tenant-a"), false);
    process.env.LUZIONE_API_SERVICE_TOKEN = "configured";
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "true";
    assert.equal(seedSupplierIdentityCommandsEnabledForTenant("tenant-a"), true);
  } finally {
    for (const key of keys) {
      const value = prior[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("A2S additive evidence manifest seals current artifacts without rewriting historical bundles", () => {
  const manifest = JSON.parse(readFileSync("engineering/execution/seed-supplier-identity-a2s/SEED_SUPPLIER_IDENTITY_A2S_ARTIFACT_DIGESTS_V1.json", "utf8")) as {
    artifacts: Array<{ path: string; sha256: string }>;
    base_sha: string;
    implementation_sha: string;
  };
  assert.equal(manifest.base_sha, "5cc727ac0cfb3f8f7fa75015246486bf7f7089f5");
  assert.equal(manifest.implementation_sha, "6467b989db7422c45935dcec3ad334b4fe99ce5f");
  for (const artifact of manifest.artifacts) {
    assert.equal(createHash("sha256").update(readFileSync(artifact.path)).digest("hex"), artifact.sha256, artifact.path);
  }
  assert.equal(createHash("sha256").update(readFileSync("engineering/execution/seed-procurement-a3/SEED_PROCUREMENT_A3_ARTIFACT_DIGESTS_V1.json")).digest("hex"), "f836268c84cc7f5e8d3fbfd75e43fed2e2ec5c627e96849e20a2773fd233e7cf");
});
