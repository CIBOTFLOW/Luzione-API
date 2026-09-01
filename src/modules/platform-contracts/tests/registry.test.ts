import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  contractRegistryViolations,
  platformCompatibilityLaw,
  platformContractRegistry,
} from "../registry";
import {
  mutationPathFindings,
  sourceOfTruthRegistry,
  truthRegistryViolations,
} from "../truthRegistry";

const requiredTruthEntities = [
  "Account",
  "Contact",
  "Lead",
  "Opportunity",
  "CommercialCase",
  "Proposal",
  "Quote",
  "Order",
  "TenantLicense",
  "ModuleEntitlement",
  "Product",
  "Supplier",
  "Shipment",
  "Task",
  "Approval",
  "Decision",
  "Workflow",
  "Memory",
  "AIGeneration",
];

test("contract registry has unique API-owned versions and does not promote draft contracts", () => {
  assert.deepEqual(contractRegistryViolations(), []);
  assert.ok(platformContractRegistry.length >= 10);
  assert.ok(platformContractRegistry.every((entry) => entry.ownerRepository === "CIBOTFLOW/Luzione-API"));
  assert.ok(platformContractRegistry
    .filter((entry) => entry.maturity === "PENDING_CHANGESET")
    .every((entry) => !entry.currentRuntime));
  for (const entry of platformContractRegistry) {
    for (const path of entry.sourcePaths) assert.ok(existsSync(path), `${entry.contractId}: ${path}`);
  }
});

test("compatibility law requires a new major and explicit consumer cutover for breaking changes", () => {
  assert.equal(platformCompatibilityLaw.additiveDefault, true);
  assert.ok(platformCompatibilityLaw.breakingChangeRequires.includes("new major contract version"));
  assert.ok(platformCompatibilityLaw.breakingChangeRequires.includes("consumer inventory"));
  assert.ok(platformCompatibilityLaw.breakingChangeRequires.includes("old-path retirement criteria"));
  assert.ok(platformCompatibilityLaw.consumerRules.some((rule) => /fail closed/i.test(rule)));
});

test("truth registry covers the required initial entities without claiming unresolved mutation owners", () => {
  assert.deepEqual(truthRegistryViolations(), []);
  const entities = new Set(sourceOfTruthRegistry.map((entry) => entry.entity));
  for (const entity of requiredTruthEntities) assert.ok(entities.has(entity), entity);
  const unresolved = sourceOfTruthRegistry.filter((entry) => entry.ownershipState === "UNRESOLVED");
  assert.ok(unresolved.length > 0);
  assert.ok(unresolved
    .filter((entry) => entry.semanticOwner.includes("unresolved"))
    .every((entry) => entry.mutationOwner === null));
});

test("Product is provider-authoritative while its P113 database representation remains a projection", () => {
  const product = sourceOfTruthRegistry.find((entry) => entry.entity === "Product");
  assert.equal(product?.canonicalStoreOrProvider, "external:shopify");
  assert.equal(product?.consistency, "PROVIDER_AUTHORITATIVE");
  assert.equal(product?.ownershipState, "PROJECTION_CONFIRMED");
  assert.equal(product?.rebuildable, true);
  assert.ok(product?.readModels.includes("public.p113_catalog_search_projections"));
});

test("duplicate and pending mutation paths remain explicit findings", () => {
  assert.ok(mutationPathFindings.some((item) => item.status === "DUPLICATE_DEFINITION"));
  assert.ok(mutationPathFindings.some((item) => item.status === "SEMANTIC_OWNER_CONFLICT"));
  assert.ok(mutationPathFindings.some((item) => item.status === "PENDING_MUTATION_PATH_COLLISION"));
});

test("registry validators reject known-bad duplicate and promoted-draft fixtures", () => {
  const firstContract = platformContractRegistry[0];
  assert.ok(contractRegistryViolations([firstContract, firstContract]).some((item) => item.startsWith("duplicate:")));
  const draft = platformContractRegistry.find((entry) => entry.maturity === "PENDING_CHANGESET");
  assert.ok(draft);
  assert.ok(contractRegistryViolations([{ ...draft, currentRuntime: true }]).some((item) => item.startsWith("pending-current:")));

  const firstTruth = sourceOfTruthRegistry[0];
  assert.ok(truthRegistryViolations([firstTruth, firstTruth]).some((item) => item.startsWith("duplicate:")));
  assert.ok(truthRegistryViolations([{
    ...firstTruth,
    canonicalStoreOrProvider: null,
    mutationOwner: null,
    ownershipState: "CONFIRMED",
  }]).some((item) => item.startsWith("incomplete-confirmed:")));
});

test("the existing public catalog publishes both registries additively", () => {
  const route = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(route, /contractVersion:\s*"1\.0"/);
  assert.match(route, /contractRegistry:/);
  assert.match(route, /sourceOfTruthRegistry:/);
  assert.match(route, /compatibilityNotices:/);
  assert.match(route, /DEPRECATED_AMBIGUOUS/);
  assert.match(route, /platformCompatibilityLaw/);
  assert.match(route, /mutationPathFindings/);
});
