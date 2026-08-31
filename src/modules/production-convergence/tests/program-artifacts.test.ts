import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const requiredProgramFiles = [
  "architecture/production-convergence/PROGRAM.md",
  "architecture/production-convergence/OBJECT_OWNERSHIP.yaml",
  "architecture/production-convergence/CAPABILITY_REGISTRY.yaml",
  "architecture/production-convergence/DEPENDENCY_GRAPH.yaml",
  "architecture/production-convergence/MIGRATION_OWNERSHIP.md",
  "architecture/production-convergence/API_PC_013_OWNERSHIP_MANIFEST.json",
  "architecture/production-convergence/RELEASE_GATES.md",
  "architecture/production-convergence/CROSS_SYSTEM_JOURNEYS.md",
  "engineering/production-convergence/QUEUE.md",
  "engineering/production-convergence/CURRENT_HANDOFF.md",
  "engineering/production-convergence/DEPENDENCIES.md",
  "engineering/production-convergence/RISKS.md",
  "contracts/contract-manifest.v0.1.json",
  "contracts/openapi/luzione-api-v0.1.yaml",
];

function jsonArtifact(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("program artifacts exist and the human queue cannot become a second scheduler", () => {
  for (const path of requiredProgramFiles) assert.ok(existsSync(path), path);
  const program = readFileSync("architecture/production-convergence/PROGRAM.md", "utf8");
  const queueView = readFileSync("engineering/production-convergence/QUEUE.md", "utf8");
  assert.match(program, /Canonical live scheduler: `engineering\/execution\/NEXT_WORK\.json`/);
  assert.match(queueView, /non-authoritative human view/i);
  assert.match(queueView, /only live scheduler is `engineering\/execution\/NEXT_WORK\.json`/);
});

test("ownership registry names every first-journey object and binds reconciled current-writer evidence", () => {
  const registry = jsonArtifact("architecture/production-convergence/OBJECT_OWNERSHIP.yaml") as {
    objects: Array<{ currentOwner: string; migrationState: string; object: string; targetMutationOwner: string }>;
  };
  const byObject = new Map(registry.objects.map((item) => [item.object, item]));
  for (const object of ["Lead", "CommercialCase", "Proposal", "Quote", "Order", "FulfillmentIntent"]) {
    assert.ok(byObject.has(object), object);
    assert.equal(byObject.get(object)?.targetMutationOwner, "CIBOTFLOW/Luzione-API");
  }
  assert.equal(byObject.get("Lead")?.currentOwner, "CIBOTFLOW/Luzione-UI");
  assert.equal(byObject.get("Lead")?.migrationState, "API_DARK_PATH_TRANSFER_PENDING");
  assert.equal(byObject.get("CommercialCase")?.currentOwner, "CIBOTFLOW/Luzione-UI");
  assert.equal(byObject.get("CommercialCase")?.migrationState, "API_DARK_PATH_TRANSFER_PENDING");
  assert.equal(byObject.get("Proposal")?.currentOwner, "CIBOTFLOW/Luzione-UI");
  assert.match(byObject.get("Proposal")?.migrationState ?? "", /API_DARK_PATH_TRANSFER_PENDING/);
  assert.equal(byObject.get("Quote")?.currentOwner, "CIBOTFLOW/Luzione-UI");
  assert.equal(byObject.get("Quote")?.migrationState, "API_DARK_PATH_TRANSFER_PENDING");
  assert.equal(byObject.get("Product")?.currentOwner, "external:shopify");
  assert.equal(new Set(registry.objects.map((item) => item.object)).size, registry.objects.length);
});

test("dependency graph resolves every edge and preserves consumer/provider evidence boundaries", () => {
  const graph = jsonArtifact("architecture/production-convergence/DEPENDENCY_GRAPH.yaml") as {
    edges: Array<{ from: string; state: string; to: string }>;
    nodes: Array<{ id: string }>;
  };
  const ids = new Set(graph.nodes.map((item) => item.id));
  assert.ok(graph.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to)));
  assert.ok(graph.edges.filter((edge) => ["luzione-ui", "sultan-os"].includes(edge.from))
    .every((edge) => edge.state === "UNVERIFIED_CONSUMER"));
  assert.equal(graph.edges.find((edge) => edge.to === "gmail-drive-airtable")?.state, "CONFIGURATION_NOT_REACHABILITY");
});

test("contract v0.1 manifest and JSON-compatible OpenAPI publish the same bounded release", () => {
  const manifest = jsonArtifact("contracts/contract-manifest.v0.1.json") as {
    artifacts: Record<string, string>;
    components: string[];
    mutationAuthority: string;
    releaseVersion: string;
  };
  const openApi = jsonArtifact("contracts/openapi/luzione-api-v0.1.yaml") as {
    info: { version: string };
    paths: Record<string, unknown>;
  };
  assert.equal(manifest.releaseVersion, "luzione-api-contract/v0.1");
  assert.equal(manifest.mutationAuthority, "DISABLED_BY_DEFAULT");
  assert.ok(manifest.components.includes("luzione-release-identity/v0.1"));
  for (const path of Object.values(manifest.artifacts)) assert.ok(existsSync(path), path);
  assert.equal(openApi.info.version, "0.1.0");
  assert.deepEqual(Object.keys(openApi.paths).sort(), [
    "/api/v1/catalog",
    "/api/v1/commands/fulfillment-intents",
    "/api/v1/commands/orders",
    "/api/v1/commands/proposal-reviews",
    "/api/v1/commands/quote-approvals",
    "/api/v1/commands/quotes",
    "/api/v1/healthz",
    "/api/v1/livez",
    "/api/v1/provider-operations",
    "/api/v1/readyz",
    "/api/v1/release",
  ]);
});
