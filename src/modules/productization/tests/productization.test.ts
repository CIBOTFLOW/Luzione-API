import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { workflowPacks } from "@/modules/workflows/catalog";
import { GET as getProductization } from "@/app/api/v1/productization/route";
import {
  customerProfiles,
  marketRollout,
  productCatalogViolations,
  productEditions,
  productModuleIds,
  productModules,
} from "../catalog";
import {
  evaluateLicensedModuleAccess,
  TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
  type TenantLicenseSnapshot,
} from "../licensing";
import {
  evaluateRoomPlanProposalAttachment,
  ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION,
  type RoomPlanProposalAttachment,
} from "../roomPlannerProposal";

const licenseSnapshot: TenantLicenseSnapshot = {
  contractVersion: TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION,
  editionId: "DESIGN_COMMERCE",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2027-08-01T00:00:00.000Z",
  integrity: "VERIFIED_CANONICAL_STORE",
  licenseId: "license-001",
  licenseVersion: 1,
  moduleEntitlements: [
    {
      accessMode: "INTERNAL_WRITE",
      enabled: true,
      limits: { seats: 25 },
      moduleId: "design.room-planner",
    },
  ],
  observedAt: "2026-09-01T00:00:00.000Z",
  snapshotExpiresAt: "2026-09-01T01:00:00.000Z",
  status: "ACTIVE",
  tenantId: "tenant-001",
};

const roomPlanAttachment: RoomPlanProposalAttachment = {
  artifactDigest: "a".repeat(64),
  attachmentId: "attachment-001",
  authority: {
    bindingAcceptanceAuthorized: false,
    customerSendAuthorized: false,
    pricingAuthoritative: false,
  },
  commercialCaseId: "case-001",
  contractVersion: ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION,
  generatedDocument: {
    assetId: "asset-001",
    documentId: "document-001",
    documentType: "CLIENT_PRESENTATION",
    version: 2,
  },
  integrationState: "REVIEWED",
  plannerProject: {
    projectId: "planner-project-001",
    projectVersion: 4,
    sourceSystem: "LUZIONE_ROOM_PLANNER",
  },
  proposalContextVersionId: "proposal-context-003",
  review: {
    decisionId: "review-001",
    reviewedAt: "2026-09-01T00:00:00.000Z",
    reviewerActorRef: "user:reviewer-001",
  },
  rooms: [
    {
      conceptId: "concept-001",
      roomId: "room-001",
      roomVersion: 3,
      selectedProducts: [
        {
          configurationSnapshotId: "configuration-002",
          quantity: 2,
          roomProductId: "room-product-001",
        },
      ],
    },
  ],
  tenantId: "tenant-001",
};

test("product catalog maps every customer profile, edition, dependency and workflow pack", () => {
  assert.deepEqual(productCatalogViolations(), []);
  assert.equal(new Set(productModules.map((module) => module.id)).size, productModuleIds.length);
  assert.deepEqual(
    marketRollout.originPhases.map((phase) => phase.countries.length),
    [7, 6],
  );
  assert.deepEqual(
    new Set(customerProfiles.map((profile) => profile.segment)),
    new Set(["INTERNATIONAL_DISTRIBUTOR", "PROCUREMENT_SHOP", "DESIGN_FIRM"]),
  );
  assert.deepEqual(productEditions.find((edition) => edition.editionId === "ENTERPRISE")?.moduleIds, productModuleIds);
  const workflowCodes = new Set(workflowPacks.map((pack) => pack.code));
  for (const productModule of productModules) {
    for (const workflowCode of productModule.workflowPackCodes) assert.ok(workflowCodes.has(workflowCode), workflowCode);
  }
  assert.equal(marketRollout.regulatoryDataLaw.aiMayCreateLegalFinality, false);
});

test("license evaluation is tenant-bound, freshness-bound and never grants business authority", () => {
  const allowed = evaluateLicensedModuleAccess({
    moduleId: "design.room-planner",
    now: "2026-09-01T00:30:00.000Z",
    requestedAccess: "INTERNAL_WRITE",
    snapshot: licenseSnapshot,
    tenantId: "tenant-001",
  });
  assert.equal(allowed.licensePermitsAccess, true);
  assert.deepEqual(allowed.reasonCodes, ["LICENSED"]);
  assert.equal(allowed.authorityGranted, false);
  assert.equal(allowed.externalEffectsAuthorized, false);

  const crossTenant = evaluateLicensedModuleAccess({
    moduleId: "design.room-planner",
    now: "2026-09-01T00:30:00.000Z",
    requestedAccess: "READ",
    snapshot: licenseSnapshot,
    tenantId: "tenant-002",
  });
  assert.equal(crossTenant.licensePermitsAccess, false);
  assert.ok(crossTenant.reasonCodes.includes("LICENSE_TENANT_MISMATCH"));

  const stale = evaluateLicensedModuleAccess({
    moduleId: "design.room-planner",
    now: "2026-09-01T02:00:00.000Z",
    requestedAccess: "READ",
    snapshot: licenseSnapshot,
    tenantId: "tenant-001",
  });
  assert.equal(stale.licensePermitsAccess, false);
  assert.ok(stale.reasonCodes.includes("LICENSE_SNAPSHOT_STALE"));

  const effect = evaluateLicensedModuleAccess({
    moduleId: "design.room-planner",
    now: "2026-09-01T00:30:00.000Z",
    requestedAccess: "EXTERNAL_EFFECT",
    snapshot: licenseSnapshot,
    tenantId: "tenant-001",
  });
  assert.equal(effect.licensePermitsAccess, false);
  assert.ok(effect.reasonCodes.includes("ACCESS_MODE_EXCEEDS_ENTITLEMENT"));

  const malformed = evaluateLicensedModuleAccess({
    moduleId: "design.room-planner",
    now: "2026-09-01T00:30:00.000Z",
    requestedAccess: "READ",
    snapshot: {
      ...licenseSnapshot,
      expiresAt: "not-a-timestamp",
      moduleEntitlements: [
        ...licenseSnapshot.moduleEntitlements,
        licenseSnapshot.moduleEntitlements[0],
      ],
    },
    tenantId: "tenant-001",
  });
  assert.equal(malformed.licensePermitsAccess, false);
  assert.ok(malformed.reasonCodes.includes("LICENSE_SNAPSHOT_INVALID"));
});

test("room planner attachment requires exact proposal context and human-reviewed immutable evidence", () => {
  const accepted = evaluateRoomPlanProposalAttachment({
    attachment: roomPlanAttachment,
    expectedCommercialCaseId: "case-001",
    expectedProposalContextVersionId: "proposal-context-003",
    expectedTenantId: "tenant-001",
  });
  assert.equal(accepted.attachable, true);
  assert.equal(accepted.authorityGranted, false);
  assert.equal(accepted.customerSendAuthorized, false);
  assert.equal(accepted.pricingAuthoritative, false);

  const mismatch = evaluateRoomPlanProposalAttachment({
    attachment: { ...roomPlanAttachment, proposalContextVersionId: "proposal-context-stale" },
    expectedCommercialCaseId: "case-001",
    expectedProposalContextVersionId: "proposal-context-003",
    expectedTenantId: "tenant-001",
  });
  assert.equal(mismatch.attachable, false);
  assert.ok(mismatch.reasonCodes.includes("PROPOSAL_CONTEXT_VERSION_MISMATCH"));

  const unreviewed = evaluateRoomPlanProposalAttachment({
    attachment: { ...roomPlanAttachment, integrationState: "DRAFT", review: null },
    expectedCommercialCaseId: "case-001",
    expectedProposalContextVersionId: "proposal-context-003",
    expectedTenantId: "tenant-001",
  });
  assert.equal(unreviewed.attachable, false);
  assert.ok(unreviewed.reasonCodes.includes("HUMAN_REVIEW_REQUIRED"));
});

test("schemas and public productization route expose definitions without tenant entitlements", async () => {
  const catalogSchema = JSON.parse(readFileSync(
    "contracts/productization/product-catalog-v0.1.schema.json",
    "utf8",
  )) as {
    $defs: { moduleId: { enum: string[] } };
    properties: { contractVersion: { const: string } };
  };
  const licenseSchema = JSON.parse(readFileSync(
    "contracts/productization/tenant-license-entitlement-v0.1.schema.json",
    "utf8",
  )) as { properties: { contractVersion: { const: string } } };
  const roomPlanSchema = JSON.parse(readFileSync(
    "contracts/productization/room-plan-proposal-attachment-v0.1.schema.json",
    "utf8",
  )) as { properties: { contractVersion: { const: string } } };
  assert.equal(licenseSchema.properties.contractVersion.const, TENANT_LICENSE_ENTITLEMENT_CONTRACT_VERSION);
  assert.equal(roomPlanSchema.properties.contractVersion.const, ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION);
  assert.equal(catalogSchema.properties.contractVersion.const, "luzione-product-catalog/v0.1");
  assert.deepEqual(catalogSchema.$defs.moduleId.enum, productModuleIds);

  const response = getProductization(new Request("https://api.luzione.com/api/v1/productization"));
  const body = await response.json() as {
    licensing: { tenantEntitlementsExposed: boolean };
    productCatalog: { customerProfiles: unknown[]; modules: unknown[] };
  };
  assert.equal(response.status, 200);
  assert.equal(body.licensing.tenantEntitlementsExposed, false);
  assert.equal(body.productCatalog.modules.length, productModules.length);
  assert.equal(body.productCatalog.customerProfiles.length, customerProfiles.length);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("canonical license persistence is forced-RLS, runtime-read-only and credential-bound", () => {
  const migration = readFileSync(
    "supabase/migrations/20260901090000_tenant_product_license_versions.sql",
    "utf8",
  );
  const readService = readFileSync("src/lib/productization/licenseReadService.ts", "utf8");
  const route = readFileSync("src/app/api/v1/licensing/entitlements/route.ts", "utf8");
  assert.match(migration, /create table if not exists public\.tenant_product_license_versions/);
  assert.match(migration, /create table if not exists public\.tenant_product_module_entitlements/);
  assert.match(migration, /tenant_product_license_versions force row level security/);
  assert.match(migration, /tenant_product_module_entitlements force row level security/);
  assert.match(migration, /revoke all on table public\.tenant_product_license_versions from service_role/);
  assert.match(migration, /grant select on table[\s\S]*to luzione_api_runtime/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|truncate)[^;]*tenant_product_/i);
  assert.match(readService, /begin read only/);
  assert.match(readService, /set_config\('app\.tenant_id'/);
  assert.match(readService, /where tenant_id = \$1/);
  assert.match(route, /requireServiceActor\(request\.headers, "license\.entitlement\.read"\)/);
  assert.match(route, /getAll\("moduleId"\)/);
  assert.doesNotMatch(route, /export async function POST/);
});
