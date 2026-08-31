import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ApiActor } from "@/lib/api/actor";
import { SULTAN_AGENT_CONTEXT_CONTRACT_VERSION, SULTAN_AGENT_INTENT_CONTRACT_VERSION } from "../contracts";
import { evaluateSultanAgentIntent } from "../evaluator";
import { parseSultanAgentIntent, SultanAgentIntentError } from "../parser";

const NOW = "2026-08-31T12:00:00.000Z";

function request(overrides: Record<string, unknown> = {}) {
  return {
    intent: {
      actionId: "action-1",
      actionVersion: "v1",
      agent: {
        agentId: "agent.luzione.revenue-steward",
        agentVersion: "v1",
        authorityDomain: "LUZIONE",
      },
      capability: "analysis.read",
      caseRef: { caseId: "commercial-case-1", caseType: "COMMERCIAL", expectedVersion: "v7" },
      controls: {
        budgetWithinLimit: true,
        dependenciesReady: true,
        evidenceComplete: true,
        idempotencyKey: "idem-1",
        killSwitchReady: true,
        providerReconciliationPlanned: true,
        readbackPlanned: true,
        rollbackPlanned: true,
        simulationPassed: true,
      },
      dataClassification: "INTERNAL",
      declaredEffectClass: "A0",
      intentContractVersion: SULTAN_AGENT_INTENT_CONTRACT_VERSION,
      purpose: "commercial-case-stewardship",
      runMode: "SHADOW",
      sourceContext: [{
        contextContractVersion: SULTAN_AGENT_CONTEXT_CONTRACT_VERSION,
        freshness: "FRESH",
        integrityHash: "a".repeat(64),
        observedAt: NOW,
        sourceOwner: "CIBOTFLOW/Luzione-API",
        sourceRef: "api:commercial-cases:commercial-case-1",
        sourceVersion: "v7",
      }],
      workOrderId: "work-order-1",
      ...overrides,
    },
  };
}

function actor(overrides: Partial<ApiActor> = {}): ApiActor {
  return {
    actorId: "agent.luzione.revenue-steward@v1",
    actorType: "agent",
    capabilities: ["sultan.agent.intent.evaluate", "analysis.read", "task.internal.create"],
    source: "service-token",
    tenantId: "luzione",
    ...overrides,
  };
}

test("credential-bound agent may be admitted for fresh A0 read-only work only", () => {
  const intent = parseSultanAgentIntent(request());
  const decision = evaluateSultanAgentIntent({ actor: actor(), intent, now: NOW });
  assert.equal(decision.status, "ADMIT_READ_ONLY");
  assert.equal(decision.agentDefinitionVerified, true);
  assert.equal(decision.autonomy.decision, "ALLOW");
  assert.equal(decision.businessStateMutated, false);
  assert.equal(decision.externalEffectsAuthorized, false);
});

test("generic Sultan service identity cannot impersonate a registered agent", () => {
  const intent = parseSultanAgentIntent(request());
  const decision = evaluateSultanAgentIntent({
    actor: actor({ actorId: "service:sultan-os", actorType: "service" }),
    intent,
    now: NOW,
  });
  assert.equal(decision.status, "SIMULATE_ONLY");
  assert.equal(decision.agentDefinitionVerified, false);
  assert.ok(decision.reasonCodes.includes("AGENT_DEFINITION_NOT_BOUND_TO_CREDENTIAL"));
});

test("agent capability is constrained by credential and constitution", () => {
  const missingCredentialCapability = parseSultanAgentIntent(request({
    capability: "task.internal.create",
    declaredEffectClass: "A1",
  }));
  const denied = evaluateSultanAgentIntent({
    actor: actor({ capabilities: ["sultan.agent.intent.evaluate", "analysis.read"] }),
    intent: missingCredentialCapability,
    now: NOW,
  });
  assert.equal(denied.status, "BLOCKED");
  assert.ok(denied.reasonCodes.includes("AGENT_CAPABILITY_NOT_BOUND_TO_CREDENTIAL"));

  const shadow = evaluateSultanAgentIntent({ actor: actor(), intent: missingCredentialCapability, now: NOW });
  assert.equal(shadow.status, "SIMULATE_ONLY");
  assert.equal(shadow.autonomy.decision, "REQUIRE_APPROVAL");
  assert.equal(shadow.externalEffectsAuthorized, false);
});

test("stale canonical context forces abstention before agent reasoning", () => {
  const original = request().intent;
  const intent = parseSultanAgentIntent(request({
    sourceContext: [{ ...original.sourceContext[0], freshness: "STALE" }],
  }));
  const decision = evaluateSultanAgentIntent({ actor: actor(), intent, now: NOW });
  assert.equal(decision.status, "ABSTAIN_STALE_CONTEXT");
  assert.ok(decision.reasonCodes.includes("SOURCE_CONTEXT_NOT_FRESH"));
});

test("FEP authority and synthetic context cannot leak into a Luzione shadow case", () => {
  const base = request().intent;
  const fep = parseSultanAgentIntent(request({
    agent: { ...base.agent, authorityDomain: "FEP" },
  }));
  assert.equal(evaluateSultanAgentIntent({ actor: actor(), intent: fep, now: NOW }).status, "BLOCKED");

  const synthetic = parseSultanAgentIntent(request({
    sourceContext: [{ ...base.sourceContext[0], sourceOwner: "SYNTHETIC_LUZIONE" }],
  }));
  const decision = evaluateSultanAgentIntent({ actor: actor(), intent: synthetic, now: NOW });
  assert.equal(decision.status, "BLOCKED");
  assert.ok(decision.reasonCodes.includes("SYNTHETIC_CONTEXT_REQUIRES_SIMULATION"));
});

test("parser rejects caller-supplied tenant, actor, role, approval, and authority claims", () => {
  for (const injected of [
    { ...request(), tenantId: "other" },
    { ...request(), actorId: "admin" },
    { ...request(), authorityGrant: { approved: true } },
    { intent: { ...request().intent, roles: ["admin"] } },
    { intent: { ...request().intent, approval: { approved: true } } },
  ]) {
    assert.throws(
      () => parseSultanAgentIntent(injected),
      (error) => error instanceof SultanAgentIntentError && error.code === "CLIENT_AUTHORITY_REJECTED",
    );
  }
});

test("HTTP route is evaluation-only and never accepts a body grant", () => {
  const route = readFileSync("src/app/api/v1/sultan/agent-intents/evaluate/route.ts", "utf8");
  assert.match(route, /requireServiceActor\(request\.headers, "sultan\.agent\.intent\.evaluate"\)/);
  assert.match(route, /parseSultanAgentIntent\(body\)/);
  assert.doesNotMatch(route, /authorityGrant:\s*body/);
  assert.match(route, /businessStateMutated:\s*false/);
  assert.match(route, /externalEffectsAuthorized:\s*false/);
});

test("manifest, schemas and runtime publish the same exact contract versions", () => {
  const manifest = JSON.parse(readFileSync("contracts/contract-manifest.v0.1.json", "utf8")) as {
    artifacts: Record<string, string>;
    components: string[];
  };
  const expected = [
    ["sultanAgentContext", SULTAN_AGENT_CONTEXT_CONTRACT_VERSION],
    ["sultanAgentIntent", SULTAN_AGENT_INTENT_CONTRACT_VERSION],
    ["sultanAgentPolicyDecision", "luzione-sultan-agent-policy/v0.1"],
    ["sultanAgentOutcome", "luzione-sultan-agent-outcome/v0.1"],
  ] as const;
  for (const [artifact, version] of expected) {
    const path = manifest.artifacts[artifact];
    assert.ok(path, artifact);
    const schema = JSON.parse(readFileSync(path, "utf8")) as {
      properties: Record<string, { const?: string }>;
    };
    assert.ok(Object.values(schema.properties).some((property) => property.const === version), version);
    assert.ok(manifest.components.includes(version), version);
  }
});
