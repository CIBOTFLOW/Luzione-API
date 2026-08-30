import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCausalNavigation,
  causalGraphViolations,
  causalNavigationLaw,
  type CausalEvidenceNode,
} from "../navigation";

function node(kind: CausalEvidenceNode["kind"], index: number, overrides: Partial<CausalEvidenceNode> = {}): CausalEvidenceNode {
  return {
    authoritative: kind === "READBACK",
    correlationId: "corr-1",
    evidenceRef: `${kind.toLowerCase()}:${index}`,
    kind,
    nodeId: `${kind.toLowerCase()}-${index}`,
    observedAt: `2026-08-30T00:0${index}:00.000Z`,
    requestId: "request-1",
    sourceReadbackRef: kind === "READBACK" ? "shopify:gid/version-2" : null,
    summary: `${kind} evidence`,
    tenantId: "tenant-1",
    traceId: "1".repeat(32),
    ...overrides,
  };
}

test("authorized navigation explains a causal chain through source readback", () => {
  const nodes = [node("REQUEST", 1), node("EXECUTION", 2), node("EVENT", 3), node("READBACK", 4)];
  const edges = [
    { fromNodeId: nodes[0].nodeId, relation: "CAUSED" as const, toNodeId: nodes[1].nodeId },
    { fromNodeId: nodes[1].nodeId, relation: "CAUSED" as const, toNodeId: nodes[2].nodeId },
    { fromNodeId: nodes[2].nodeId, relation: "CONFIRMED_BY" as const, toNodeId: nodes[3].nodeId },
  ];
  const result = buildCausalNavigation({ actorId: "actor-1", edges, nodes, purpose: "explain-order-state", rootNodeId: nodes[0].nodeId, tenantId: "tenant-1" });
  assert.equal(result.timeline.length, 4);
  assert.match(result.why, /Authoritative readback/);
  assert.match(result.whatChangesIt, /newer authorized command/);
});

test("cross-tenant evidence is denied before navigation", () => {
  const nodes = [node("REQUEST", 1), node("EVENT", 2, { tenantId: "tenant-2" })];
  assert.throws(() => buildCausalNavigation({ actorId: "actor-1", edges: [], nodes, purpose: "explain", rootNodeId: nodes[0].nodeId, tenantId: "tenant-1" }), /Cross-tenant/);
});

test("missing nodes, cycles, false readback and authoritative traces fail closed", () => {
  const request = node("REQUEST", 1);
  assert.ok(causalGraphViolations([request], [{ fromNodeId: request.nodeId, relation: "CAUSED", toNodeId: "missing" }]).some((item) => item.startsWith("missing-edge-node:")));
  assert.ok(causalGraphViolations([request], [{ fromNodeId: request.nodeId, relation: "CAUSED", toNodeId: request.nodeId }]).includes("causal-cycle"));
  assert.ok(causalGraphViolations([node("READBACK", 2, { authoritative: false, sourceReadbackRef: null })], []).some((item) => item.startsWith("invalid-readback:")));
  assert.ok(causalGraphViolations([node("TRACE", 3, { authoritative: true })], []).some((item) => item.startsWith("trace-claimed-authority:")));
});

test("catalog publishes navigation law without pretending traces are truth", () => {
  assert.equal(causalNavigationLaw.graphIsTruthStore, false);
  assert.equal(causalNavigationLaw.traceIsBusinessTruth, false);
  const catalog = readFileSync("src/app/api/v1/catalog/route.ts", "utf8");
  assert.match(catalog, /causalNavigation:/);
  assert.match(catalog, /causalNavigationLaw/);
});
