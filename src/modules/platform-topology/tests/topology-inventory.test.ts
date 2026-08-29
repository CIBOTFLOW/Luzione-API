import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

type Inventory = {
  cross_repo_handoffs: string[];
  deployables: Array<{ deployable_id: string; owner_repository: string }>;
  http_surfaces: Array<{
    effect: string;
    method: string;
    route_id: string;
    source_path: string;
  }>;
  ownership_findings: Array<{
    finding_id: string;
    severity: string;
    status: string;
  }>;
  pending_change_sets: Array<{ pull_request: number; state: string }>;
  repository: string;
  runtime_configuration_keys: string[];
  schema_version: number;
  semantic_ownership: Array<{ concept: string; owner: string }>;
  strongest_claim: {
    effect_authority: string;
    engineering_state: string;
    finality: string;
    release_evidence: string;
  };
};

const inventoryPath = "engineering/execution/LUZIONE_API_TOPOLOGY_INVENTORY_V1.json";
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as Inventory;

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function unique(values: readonly string[], label: string) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function exactSet(values: readonly string[], expected: readonly string[], label: string) {
  assert.deepEqual([...new Set(values)].sort(), [...new Set(expected)].sort(), label);
}

test("topology inventory has bounded evidence and canonical repository ownership", () => {
  assert.equal(inventory.schema_version, 1);
  assert.equal(inventory.repository, "CIBOTFLOW/Luzione-API");
  assert.equal(inventory.strongest_claim.engineering_state, "BOUNDED_PASS");
  assert.equal(inventory.strongest_claim.release_evidence, "LOCAL_PROVEN");
  assert.equal(inventory.strongest_claim.effect_authority, "NO_EFFECT");
  assert.equal(inventory.strongest_claim.finality, "BOUNDED_CLAIM");
  assert.ok(inventory.deployables.every((item) => item.owner_repository === inventory.repository));
});

test("every tracked API route file is represented and method records are unique", () => {
  const routeFiles = filesBelow("src/app/api/v1")
    .filter((path) => path.endsWith("/route.ts"))
    .map((path) => relative(".", path))
    .sort();
  const inventoriedFiles = [...new Set(inventory.http_surfaces.map((item) => item.source_path))].sort();
  exactSet(inventoriedFiles, routeFiles, "every route file must be inventoried exactly once or more by method");
  unique(inventory.http_surfaces.map((item) => `${item.method} ${item.route_id}`), "HTTP method/route IDs");
  assert.ok(inventory.http_surfaces.every((item) => item.effect.length > 0));
});

test("inventory proof is sensitive to omitted routes and duplicate evidence IDs", () => {
  const routeFiles = filesBelow("src/app/api/v1")
    .filter((path) => path.endsWith("/route.ts"))
    .map((path) => relative(".", path));
  const inventoriedFiles = [...new Set(inventory.http_surfaces.map((item) => item.source_path))];
  assert.throws(
    () => exactSet(inventoriedFiles.slice(1), routeFiles, "known-bad omitted route"),
    /known-bad omitted route/,
  );
  assert.throws(
    () => unique([inventory.ownership_findings[0].finding_id, inventory.ownership_findings[0].finding_id], "known-bad finding IDs"),
    /must be unique/,
  );
});

test("inventory records every runtime environment dependency visible in source", () => {
  const sourceFiles = [
    ...filesBelow("src").filter((path) => path.endsWith(".ts") || path.endsWith(".tsx")),
    "instrumentation.ts",
  ];
  const referenced = new Set<string>();
  for (const path of sourceFiles) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) referenced.add(match[1]);
  }
  const configured = new Set(inventory.runtime_configuration_keys);
  assert.deepEqual([...referenced].filter((key) => !configured.has(key)), []);
});

test("ownership findings and draft change sets cannot masquerade as resolved runtime truth", () => {
  unique(inventory.ownership_findings.map((item) => item.finding_id), "ownership finding IDs");
  assert.ok(inventory.ownership_findings.length >= 1);
  assert.ok(inventory.ownership_findings.every((item) => item.status === "OPEN"));
  assert.ok(inventory.ownership_findings.every((item) => ["MEDIUM", "HIGH"].includes(item.severity)));
  assert.ok(inventory.pending_change_sets.every((item) => item.state.includes("DRAFT")));
  assert.ok(inventory.pending_change_sets.some((item) => item.pull_request === 31));
});

test("cross-repository handoffs are parseable and remain unclaimed consumer evidence", () => {
  assert.deepEqual(inventory.cross_repo_handoffs.sort(), [
    "engineering/execution/handoffs/API_SE_001_LUZIONE_UI.json",
    "engineering/execution/handoffs/API_SE_001_SULTAN_OS.json",
  ]);
  for (const path of inventory.cross_repo_handoffs) {
    const handoff = JSON.parse(readFileSync(path, "utf8")) as {
      acceptance_proof_needed: string[];
      consumer_repository: string;
      producer_repository: string;
      producer_sha: string | null;
    };
    assert.equal(handoff.producer_repository, inventory.repository);
    assert.equal(handoff.producer_sha, null);
    assert.ok(["CIBOTFLOW/Luzione-UI", "CIBOTFLOW/Sultan-OS"].includes(handoff.consumer_repository));
    assert.ok(handoff.acceptance_proof_needed.length >= 1);
  }
});

test("semantic ownership includes API, UI, Sultan and canonical business truth", () => {
  const owners = new Set(inventory.semantic_ownership.map((item) => item.owner));
  assert.ok(owners.has("CIBOTFLOW/Luzione-API"));
  assert.ok(owners.has("CIBOTFLOW/Luzione-UI"));
  assert.ok(owners.has("CIBOTFLOW/Sultan-OS"));
  assert.ok(owners.has("canonical Postgres or explicitly named external provider"));
});
