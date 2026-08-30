export const PLATFORM_CAUSAL_NAVIGATION_VERSION = "luzione-causal-navigation/v1";

export type CausalNodeKind = "ACTION_INTENT" | "DECISION" | "EVENT" | "EXECUTION" | "READBACK" | "RECOVERY" | "RELEASE" | "REQUEST" | "TRACE";

export type CausalEvidenceNode = {
  authoritative: boolean;
  correlationId: string;
  evidenceRef: string;
  kind: CausalNodeKind;
  nodeId: string;
  observedAt: string;
  requestId: string;
  sourceReadbackRef: string | null;
  summary: string;
  tenantId: string;
  traceId: string;
};

export type CausalEdge = {
  fromNodeId: string;
  relation: "CAUSED" | "CONFIRMED_BY" | "RECOVERED_BY" | "RELEASED_BY" | "TRACED_BY";
  toNodeId: string;
};

export const causalNavigationLaw = Object.freeze({
  graphIsTruthStore: false,
  providerAcknowledgementIsFinality: false,
  sourceReadbackRequiredForConfirmedOutcome: true,
  tenantAuthorizationRequired: true,
  traceIsBusinessTruth: false,
});

export function causalGraphViolations(nodes: readonly CausalEvidenceNode[], edges: readonly CausalEdge[]) {
  const violations: string[] = [];
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.nodeId)) violations.push(`duplicate-node:${node.nodeId}`);
    ids.add(node.nodeId);
    if (!Number.isFinite(Date.parse(node.observedAt))) violations.push(`invalid-observed-at:${node.nodeId}`);
    if (node.kind === "READBACK" && (!node.authoritative || !node.sourceReadbackRef)) violations.push(`invalid-readback:${node.nodeId}`);
    if (node.kind === "TRACE" && node.authoritative) violations.push(`trace-claimed-authority:${node.nodeId}`);
  }
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) violations.push(`missing-edge-node:${edge.fromNodeId}:${edge.toNodeId}`);
    adjacency.set(edge.fromNodeId, [...(adjacency.get(edge.fromNodeId) ?? []), edge.toNodeId]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((adjacency.get(id) ?? []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  if ([...ids].some(visit)) violations.push("causal-cycle");
  return violations;
}

export function buildCausalNavigation(input: {
  actorId: string;
  edges: readonly CausalEdge[];
  nodes: readonly CausalEvidenceNode[];
  purpose: string;
  rootNodeId: string;
  tenantId: string;
}) {
  if (!input.actorId.trim() || !input.purpose.trim() || !input.tenantId.trim()) throw new Error("Authenticated actor, tenant and purpose are required.");
  const violations = causalGraphViolations(input.nodes, input.edges);
  if (violations.length) throw new Error(`Invalid causal graph: ${violations.join(",")}`);
  const root = input.nodes.find((node) => node.nodeId === input.rootNodeId);
  if (!root) throw new Error("Root causal node is missing.");
  const crossTenant = input.nodes.find((node) => node.tenantId !== input.tenantId);
  if (crossTenant) throw new Error(`Cross-tenant causal evidence denied:${crossTenant.nodeId}`);
  const reachable = new Set([root.nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of input.edges) {
      if (reachable.has(edge.fromNodeId) && !reachable.has(edge.toNodeId)) {
        reachable.add(edge.toNodeId);
        changed = true;
      }
    }
  }
  const timeline = input.nodes
    .filter((node) => reachable.has(node.nodeId))
    .slice()
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.nodeId.localeCompare(right.nodeId));
  const confirmedReadback = timeline.find((node) => node.kind === "READBACK" && node.authoritative);
  return {
    actorId: input.actorId,
    contractVersion: PLATFORM_CAUSAL_NAVIGATION_VERSION,
    correlationIds: [...new Set(timeline.map((node) => node.correlationId))].sort(),
    evidenceLinks: timeline.map((node) => ({ evidenceRef: node.evidenceRef, kind: node.kind, nodeId: node.nodeId })),
    purpose: input.purpose,
    rootNodeId: root.nodeId,
    tenantId: input.tenantId,
    timeline,
    traceIds: [...new Set(timeline.map((node) => node.traceId))].sort(),
    whatChangesIt: confirmedReadback
      ? "A newer authorized command and authoritative source readback with preserved lineage."
      : "Authoritative source readback or an explicit recovery/reconciliation receipt.",
    why: confirmedReadback
      ? `Authoritative readback ${confirmedReadback.sourceReadbackRef} confirms the current outcome.`
      : `The current chain ends at ${timeline.at(-1)?.kind ?? root.kind}; business finality is not confirmed.`,
  };
}
