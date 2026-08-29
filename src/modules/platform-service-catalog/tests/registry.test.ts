import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  dependencyCatalog,
  dependencyGraph,
  runbookRegistry,
  serviceCatalog,
  serviceCatalogViolations,
} from "../registry";

test("service catalog publishes real API deployables without invented production releases", () => {
  assert.deepEqual(serviceCatalogViolations(), []);
  assert.deepEqual(serviceCatalog.map((item) => item.serviceId).sort(), ["luzione-api-nextjs", "luzione-api-schema-bundle"]);
  assert.ok(serviceCatalog.every((item) => item.repository === "CIBOTFLOW/Luzione-API"));
  assert.ok(serviceCatalog.every((item) => item.lastObservedReleaseSha === null));
  assert.ok(serviceCatalog.every((item) => existsSync(item.deployableRef)));
});

test("dependency graph resolves every service edge and labels consumers unverified", () => {
  const nodeIds = new Set(dependencyGraph.nodes.map((node) => node.id));
  assert.ok(dependencyGraph.edges.every((edge) => nodeIds.has(edge.serviceId) && nodeIds.has(edge.dependencyId)));
  assert.ok(dependencyCatalog
    .filter((item) => item.kind === "CONSUMER")
    .every((item) => item.observedState === "UNVERIFIED_CONSUMER"));
  assert.equal(dependencyCatalog.find((item) => item.dependencyId === "shopify-source")?.observedState, "INDIRECT_SOURCE");
});

test("runbook records resolve to bounded operational documents", () => {
  for (const runbook of runbookRegistry) {
    assert.ok(existsSync(runbook.path), runbook.path);
    const source = readFileSync(runbook.path, "utf8");
    assert.match(source, /Containment/);
    assert.match(source, /Verification/);
    assert.match(source, /Escalation/);
  }
});

test("public catalog exposes service, dependency and runbook registries additively", () => {
  const route = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(route, /serviceCatalog:/);
  assert.match(route, /dependencyGraph/);
  assert.match(route, /runbookRegistry/);
});
