import type { ApiActor } from "@/lib/api/actor";
import type {
  SultanAgentAuthorityDomain,
  SultanAgentCaseType,
  SultanAgentIntent,
} from "./contracts";

export const SULTAN_AGENT_DELEGATION_POLICY_VERSION = "luzione-sultan-agent-delegation/v0.1" as const;

type DelegatedAgentDefinition = {
  agentId: `agent.luzione.${string}`;
  agentVersion: `v${number}`;
  authorityDomain: SultanAgentAuthorityDomain;
  caseTypes: readonly SultanAgentCaseType[];
  capabilities: readonly string[];
};

const delegatedAgents: readonly DelegatedAgentDefinition[] = Object.freeze([
  Object.freeze({
    agentId: "agent.luzione.revenue-steward",
    agentVersion: "v1",
    authorityDomain: "LUZIONE",
    caseTypes: Object.freeze(["COMMERCIAL"] as const),
    capabilities: Object.freeze(["analysis.read"]),
  }),
  Object.freeze({
    agentId: "agent.luzione.fulfillment-steward",
    agentVersion: "v1",
    authorityDomain: "LUZIONE",
    caseTypes: Object.freeze(["FULFILLMENT"] as const),
    capabilities: Object.freeze(["analysis.read", "fulfillment.readiness.evaluate"]),
  }),
  Object.freeze({
    agentId: "agent.luzione.partner-network-steward",
    agentVersion: "v1",
    authorityDomain: "LUZIONE",
    caseTypes: Object.freeze(["PARTNER_RELATIONSHIP"] as const),
    capabilities: Object.freeze(["analysis.read", "partner.network.evaluate"]),
  }),
  Object.freeze({
    agentId: "agent.luzione.catalog-steward",
    agentVersion: "v1",
    authorityDomain: "LUZIONE",
    caseTypes: Object.freeze(["CATALOG_QUALITY"] as const),
    capabilities: Object.freeze(["analysis.read", "catalog.quality.evaluate"]),
  }),
  Object.freeze({
    agentId: "agent.luzione.account-relationship-steward",
    agentVersion: "v1",
    authorityDomain: "LUZIONE",
    caseTypes: Object.freeze(["ACCOUNT_RELATIONSHIP"] as const),
    capabilities: Object.freeze(["analysis.read", "account.health.evaluate"]),
  }),
  Object.freeze({
    agentId: "agent.luzione.economic-integrity-steward",
    agentVersion: "v1",
    authorityDomain: "LUZIONE",
    caseTypes: Object.freeze(["ECONOMIC_REVIEW"] as const),
    capabilities: Object.freeze(["analysis.read", "economic.integrity.evaluate"]),
  }),
]);

export type SultanAgentCredentialBinding = {
  binding: "DIRECT_CREDENTIAL" | "VERCEL_WORKLOAD_DELEGATION" | "UNVERIFIED";
  reasonCodes: readonly string[];
  verified: boolean;
};

export function evaluateSultanAgentCredentialBinding(input: {
  actor: ApiActor;
  intent: SultanAgentIntent;
}): SultanAgentCredentialBinding {
  const expectedDirectActorId = `${input.intent.agent.agentId}:${input.intent.agent.agentVersion}`;
  if (input.actor.actorType === "agent" && input.actor.actorId === expectedDirectActorId) {
    return Object.freeze({ binding: "DIRECT_CREDENTIAL", reasonCodes: Object.freeze([]), verified: true });
  }

  const signedSultanWorkload = input.actor.source === "vercel-oidc"
    && input.actor.actorType === "service"
    && input.actor.actorId === "service:sultan-os"
    && input.actor.tenantId === "luzione";
  if (!signedSultanWorkload) {
    return Object.freeze({
      binding: "UNVERIFIED",
      reasonCodes: Object.freeze(["AGENT_DEFINITION_NOT_BOUND_TO_CREDENTIAL"]),
      verified: false,
    });
  }

  const definition = delegatedAgents.find((candidate) =>
    candidate.agentId === input.intent.agent.agentId
    && candidate.agentVersion === input.intent.agent.agentVersion);
  const reasons: string[] = [];
  if (!definition) {
    reasons.push("AGENT_DELEGATION_NOT_REGISTERED");
  } else {
    if (definition.authorityDomain !== input.intent.agent.authorityDomain) {
      reasons.push("AGENT_DELEGATION_AUTHORITY_MISMATCH");
    }
    if (!definition.caseTypes.includes(input.intent.caseRef.caseType)) {
      reasons.push("AGENT_CASE_TYPE_NOT_DELEGATED");
    }
    if (!definition.capabilities.includes(input.intent.capability)) {
      reasons.push("AGENT_CAPABILITY_NOT_DELEGATED");
    }
  }

  return Object.freeze({
    binding: reasons.length === 0 ? "VERCEL_WORKLOAD_DELEGATION" : "UNVERIFIED",
    reasonCodes: Object.freeze(reasons),
    verified: reasons.length === 0,
  });
}
