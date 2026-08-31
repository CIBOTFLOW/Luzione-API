import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TABLE_OBJECT_REGISTRY_SOURCE_VERSION,
  TABLE_OBJECT_REGISTRY_VERSION,
  tableObjectRegistry,
  tableObjectRegistryCoverage,
  tableObjectRegistryViolations,
  type TableObjectDescriptor,
} from "../tableObjectRegistry";

const expectedSupplierPortalSurfaces = [
  "public.portal_activity_events",
  "public.portal_command_receipts",
  "public.portal_designer_catalog_items",
  "public.portal_designer_issue_proposals",
  "public.portal_designer_order_snapshots",
  "public.portal_designer_update_commands",
  "public.portal_lead_partner_identities",
  "public.portal_memberships",
  "public.portal_object_grants",
  "public.portal_package_line_allocations",
  "public.portal_package_versions",
  "public.portal_partner_organizations",
  "public.portal_product_logistics_versions",
  "public.portal_profiles",
  "public.portal_quote_request_lines",
  "public.portal_quote_requests",
  "public.portal_shipment_assignments",
  "public.portal_shipments",
  "public.portal_supplier_assignments",
  "public.portal_supplier_payable_snapshots",
  "public.portal_supplier_update_commands",
  "public.portal_trade_document_versions",
].sort();

test("table object registry explicitly approves the 22 observed Supplier Portal browser surfaces", () => {
  assert.equal(TABLE_OBJECT_REGISTRY_VERSION, "luzione-table-object-registry/v1");
  assert.deepEqual(tableObjectRegistryViolations(), []);
  assert.deepEqual(
    tableObjectRegistry.map((entry) => entry.qualifiedName).sort(),
    expectedSupplierPortalSurfaces,
  );
  assert.ok(tableObjectRegistry.every((entry) =>
    entry.capabilityOwner === "CIBOTFLOW/Luzione-Supplier-Portal" &&
    entry.physicalSchemaOwner === "CIBOTFLOW/Luzione-UI" &&
    entry.authorityStatus === "CAPABILITY_OWNER_APPROVED"));
  assert.ok(tableObjectRegistry.every((entry) => entry.sourceVersion === TABLE_OBJECT_REGISTRY_SOURCE_VERSION));
});

test("browser posture is bounded by authenticated RLS and retirement stays fail closed", () => {
  assert.ok(tableObjectRegistry.every((entry) =>
    !entry.securityPosture.anonAccess &&
    entry.securityPosture.authenticatedAccess &&
    entry.securityPosture.rls === "ENABLED" &&
    entry.securityPosture.policyCount > 0 &&
    entry.securityPosture.serviceRoleAccess));
  assert.ok(tableObjectRegistry.every((entry) =>
    entry.lifecycle === "REVIEW" &&
    !entry.retirementGate.allowed &&
    entry.canonicalSuccessor === null &&
    entry.retirementGate.requiredEvidence.some((item) => /quarantine simulation/i.test(item))));
});

test("coverage reports the bounded declaration without pretending the 713-table estate is fully mapped", () => {
  assert.equal(tableObjectRegistryCoverage.observedEstateTableCount, 713);
  assert.equal(tableObjectRegistryCoverage.declaredObjectCount, 22);
  assert.equal(tableObjectRegistryCoverage.undeclaredObjectCount, 691);
  assert.equal(tableObjectRegistryCoverage.fullEstateMapped, false);
  assert.equal(tableObjectRegistryCoverage.metadataOnly, true);
  assert.equal(tableObjectRegistryCoverage.tableContentsRead, false);
});

test("validator rejects duplicate, unknown authority, unsafe browser and unsafe retirement fixtures", () => {
  const first = tableObjectRegistry[0];
  assert.ok(tableObjectRegistryViolations([first, first]).some((item) => item.startsWith("duplicate:")));

  const unknownAuthority = {
    ...first,
    authorityStatus: "CLIENT_ASSERTED",
  } as unknown as TableObjectDescriptor;
  assert.ok(tableObjectRegistryViolations([unknownAuthority]).some((item) =>
    item.startsWith("unknown-authority-status:")));

  const unsafeBrowser = {
    ...first,
    securityPosture: { ...first.securityPosture, policyCount: 0 },
  };
  assert.ok(tableObjectRegistryViolations([unsafeBrowser]).some((item) =>
    item.startsWith("unsafe-browser-boundary:")));

  const unsafeRetirement = {
    ...first,
    retirementGate: { ...first.retirementGate, allowed: true },
  };
  assert.ok(tableObjectRegistryViolations([unsafeRetirement]).some((item) =>
    item.startsWith("unsafe-retirement:")));
});

test("machine-readable schema is strict and the existing catalog publishes the registry additively", () => {
  const schema = JSON.parse(readFileSync(
    "contracts/objects/luzione-table-object-registry-v1.schema.json",
    "utf8",
  )) as {
    additionalProperties: boolean;
    properties: Record<string, unknown>;
    required: string[];
  };
  assert.equal(schema.additionalProperties, false);
  for (const field of [
    "qualifiedName", "physicalSchemaOwner", "capabilityOwner", "domain", "dataRole",
    "authorityStatus", "lifecycle", "canonicalSuccessor", "sourceVersion", "projectionOf",
    "reconciliationPosture", "securityPosture", "freshness", "evidenceRefs", "retirementGate",
  ]) {
    assert.ok(schema.required.includes(field), field);
    assert.ok(field in schema.properties, field);
  }

  const route = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(route, /tableObjectRegistry:/);
  assert.match(route, /TABLE_OBJECT_REGISTRY_VERSION/);
  assert.match(route, /tableObjectRegistryCoverage/);
});
