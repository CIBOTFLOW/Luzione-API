import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ApiActor } from "@/lib/api/actor";
import type { VerifiedCanonicalReadbackRef } from "@/modules/sultan-stage5/contracts";
import type { TenantPolicySnapshot } from "@/modules/tenant-policy/types";
import { SULTAN_AGENT_CONTEXT_CONTRACT_VERSION, SULTAN_AGENT_INTENT_CONTRACT_VERSION } from "../contracts";
import {
  canonicalOrderContextHash,
  stage5CanonicalReadbackReceiptIds,
  verifySultanAgentContext,
  type SultanOrderReadback,
} from "../contextVerifier";
import { evaluateSultanAgentIntent } from "../evaluator";
import { parseSultanAgentIntent, SultanAgentIntentError } from "../parser";

const NOW = "2026-08-31T12:00:00.000Z";
const POLICY: TenantPolicySnapshot = {
  checksum: "test-checksum",
  code: "sultan.autonomy",
  defaultDecision: "BLOCK",
  maximumDataClassification: "CONFIDENTIAL",
  maximumEffectClass: "A3",
  policyDefinitionId: "policy-test-v1",
  rules: [
    { capability: "analysis.read", decision: "ALLOW", actorTypes: ["agent", "service"], purposes: [], maximumEffectClass: "A0" },
    { capability: "task.internal.create", decision: "ALLOW", actorTypes: ["agent"], purposes: [], maximumEffectClass: "A1" },
  ],
  tenantId: "luzione",
  version: 1,
};

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
    actorId: "agent.luzione.revenue-steward:v1",
    actorType: "agent",
    capabilities: ["sultan.agent.intent.evaluate", "analysis.read", "task.internal.create"],
    source: "service-token",
    tenantId: "luzione",
    ...overrides,
  };
}

function sultanWorkload(overrides: Partial<ApiActor> = {}): ApiActor {
  return {
    actorId: "service:sultan-os",
    actorType: "service",
    capabilities: ["sultan.agent.intent.evaluate", "analysis.read", "fulfillment.readiness.evaluate"],
    source: "vercel-oidc",
    tenantId: "luzione",
    ...overrides,
  };
}

function stage5Readback(
  suffix: string,
  subjectType: VerifiedCanonicalReadbackRef["subjectType"],
  overrides: Partial<VerifiedCanonicalReadbackRef> = {},
): VerifiedCanonicalReadbackRef {
  return {
    apiDeploymentSha: "a".repeat(40),
    claimEvidence: [{
      claimId: "validation.value",
      evidenceHash: suffix.repeat(64),
      evidenceRef: `s5read_${suffix.repeat(32)}/validation.value`,
    }],
    consumerActorId: "service:luzione-ui",
    consumerReleaseSha: "d".repeat(40),
    freshUntil: "2026-08-31T12:05:00.000Z",
    observedAt: NOW,
    readbackHash: suffix.repeat(64),
    readbackReceiptId: `s5read_${suffix.repeat(32)}`,
    sourceRefs: [`postgres:public.${subjectType.toLowerCase()}`],
    sourceVersion: `${subjectType.toLowerCase()}:subject-${suffix}:v1`,
    status: "AVAILABLE",
    subjectId: `subject-${suffix}`,
    subjectType,
    tenantId: "luzione",
    ...overrides,
  };
}

function stage5Context(readback: VerifiedCanonicalReadbackRef) {
  return {
    contextContractVersion: SULTAN_AGENT_CONTEXT_CONTRACT_VERSION,
    freshness: "FRESH" as const,
    integrityHash: readback.readbackHash,
    observedAt: readback.observedAt,
    sourceOwner: "CIBOTFLOW/Luzione-API" as const,
    sourceRef: `api:canonical-readback/${readback.readbackReceiptId}`,
    sourceVersion: readback.readbackHash,
  };
}

function evaluate(intent: ReturnType<typeof parseSultanAgentIntent>, authenticatedActor = actor(), options: {
  policy?: TenantPolicySnapshot;
  verification?: "CANONICAL_READBACK" | "SYNTHETIC_SIMULATION" | "UNVERIFIED";
} = {}) {
  const kind = options.verification ?? "CANONICAL_READBACK";
  return evaluateSultanAgentIntent({
    actor: authenticatedActor,
    contextVerification: { kind, verifiedCount: kind === "CANONICAL_READBACK" ? 1 : 0 },
    intent,
    now: NOW,
    tenantPolicy: options.policy ?? POLICY,
  });
}

test("credential-bound agent may be admitted for fresh A0 read-only work only", () => {
  const intent = parseSultanAgentIntent(request());
  const decision = evaluate(intent);
  assert.equal(decision.status, "ADMIT_READ_ONLY");
  assert.equal(decision.agentDefinitionVerified, true);
  assert.equal(decision.autonomy.decision, "ALLOW");
  assert.equal(decision.businessStateMutated, false);
  assert.equal(decision.externalEffectsAuthorized, false);
});

test("generic Sultan service identity cannot impersonate a registered agent", () => {
  const intent = parseSultanAgentIntent(request());
  const decision = evaluate(intent, actor({ actorId: "service:sultan-os", actorType: "service" }));
  assert.equal(decision.status, "SIMULATE_ONLY");
  assert.equal(decision.agentDefinitionVerified, false);
  assert.ok(decision.reasonCodes.includes("AGENT_DEFINITION_NOT_BOUND_TO_CREDENTIAL"));
});

test("signed Sultan workload may delegate an exact registered Luzione steward for A0 reasoning", () => {
  const intent = parseSultanAgentIntent(request());
  const decision = evaluate(intent, sultanWorkload());
  assert.equal(decision.status, "ADMIT_READ_ONLY");
  assert.equal(decision.agentDefinitionVerified, true);
  assert.equal(decision.agent.binding, "VERCEL_WORKLOAD_DELEGATION");
  assert.equal(decision.agent.agentId, "agent.luzione.revenue-steward");
  assert.deepEqual(decision.actor, {
    actorId: "service:sultan-os",
    actorType: "service",
    tenantId: "luzione",
  });
  assert.equal(decision.tenantPolicy.allowedByPolicy, true);
  assert.equal(decision.businessStateMutated, false);
  assert.equal(decision.externalEffectsAuthorized, false);
});

test("signed Sultan workload cannot invent an agent or cross its registered case boundary", () => {
  const invented = parseSultanAgentIntent(request({
    agent: {
      agentId: "agent.luzione.unregistered-steward",
      agentVersion: "v1",
      authorityDomain: "LUZIONE",
    },
  }));
  const inventedDecision = evaluate(invented, sultanWorkload());
  assert.equal(inventedDecision.status, "BLOCKED");
  assert.ok(inventedDecision.reasonCodes.includes("AGENT_DELEGATION_NOT_REGISTERED"));

  const wrongCase = parseSultanAgentIntent(request({
    caseRef: { caseId: "order-1", caseType: "FULFILLMENT", expectedVersion: "v7" },
  }));
  const wrongCaseDecision = evaluate(wrongCase, sultanWorkload());
  assert.equal(wrongCaseDecision.status, "BLOCKED");
  assert.ok(wrongCaseDecision.reasonCodes.includes("AGENT_CASE_TYPE_NOT_DELEGATED"));
});

test("FEP and Sultan-internal agents cannot use the Luzione workload delegation boundary", () => {
  const base = request().intent;
  for (const agent of [
    { agentId: "agent.fep.case-steward", agentVersion: "v1", authorityDomain: "FEP" },
    { agentId: "agent.control.independent-critic", agentVersion: "v1", authorityDomain: "SULTAN_INTERNAL" },
  ]) {
    const intent = parseSultanAgentIntent(request({ agent }));
    const decision = evaluate(intent, sultanWorkload());
    assert.equal(decision.status, "BLOCKED");
    assert.ok(decision.reasonCodes.includes("AGENT_DELEGATION_NOT_REGISTERED"));
    assert.ok(decision.reasonCodes.includes("AUTHORITY_DOMAIN_MISMATCH"));
  }
  assert.equal(base.agent.authorityDomain, "LUZIONE");
});

test("agent capability is constrained by credential and constitution", () => {
  const missingCredentialCapability = parseSultanAgentIntent(request({
    capability: "task.internal.create",
    declaredEffectClass: "A1",
  }));
  const denied = evaluate(missingCredentialCapability, actor({ capabilities: ["sultan.agent.intent.evaluate", "analysis.read"] }));
  assert.equal(denied.status, "BLOCKED");
  assert.ok(denied.reasonCodes.includes("AGENT_CAPABILITY_NOT_BOUND_TO_CREDENTIAL"));

  const shadow = evaluate(missingCredentialCapability);
  assert.equal(shadow.status, "SIMULATE_ONLY");
  assert.equal(shadow.autonomy.decision, "REQUIRE_APPROVAL");
  assert.equal(shadow.externalEffectsAuthorized, false);
});

test("stale canonical context forces abstention before agent reasoning", () => {
  const original = request().intent;
  const intent = parseSultanAgentIntent(request({
    sourceContext: [{ ...original.sourceContext[0], freshness: "STALE" }],
  }));
  const decision = evaluate(intent);
  assert.equal(decision.status, "ABSTAIN_STALE_CONTEXT");
  assert.ok(decision.reasonCodes.includes("SOURCE_CONTEXT_NOT_FRESH"));
});

test("FEP authority and synthetic context cannot leak into a Luzione shadow case", () => {
  const base = request().intent;
  const fep = parseSultanAgentIntent(request({
    agent: { ...base.agent, authorityDomain: "FEP" },
  }));
  assert.equal(evaluate(fep).status, "BLOCKED");

  const synthetic = parseSultanAgentIntent(request({
    sourceContext: [{ ...base.sourceContext[0], sourceOwner: "SYNTHETIC_LUZIONE" }],
  }));
  const decision = evaluate(synthetic, actor(), { verification: "SYNTHETIC_SIMULATION" });
  assert.equal(decision.status, "BLOCKED");
  assert.ok(decision.reasonCodes.includes("SYNTHETIC_CONTEXT_REQUIRES_SIMULATION"));
});

test("client-declared fresh context cannot be admitted without canonical verification", () => {
  const intent = parseSultanAgentIntent(request());
  const decision = evaluate(intent, actor(), { verification: "UNVERIFIED" });
  assert.equal(decision.status, "ABSTAIN_STALE_CONTEXT");
  assert.ok(decision.reasonCodes.includes("SOURCE_CONTEXT_NOT_CANONICALLY_VERIFIED"));
  assert.equal(decision.sourceContext.verifiedCount, 0);
});

test("canonical Order readback derives freshness and rejects version or hash drift", () => {
  const readback: SultanOrderReadback = {
    contractVersion: "luzione-order-fulfillment-intent/v0.1",
    objectVersion: "order:order-1:v1:screated",
    order: { orderId: "order-1", lines: [{ lineNumber: 1, quantity: 2 }], updatedAt: NOW },
    sourceOfTruth: "orders+order_lines",
  };
  const integrityHash = canonicalOrderContextHash(readback);
  const canonical = parseSultanAgentIntent(request({
    caseRef: { caseId: "order-1", caseType: "FULFILLMENT", expectedVersion: readback.objectVersion },
    sourceContext: [{
      ...request().intent.sourceContext[0],
      integrityHash,
      sourceRef: "api:orders:order-1",
      sourceVersion: readback.objectVersion,
    }],
  }));
  const current = verifySultanAgentContext({ intent: canonical, orderReadback: readback });
  assert.equal(current.verification.kind, "CANONICAL_READBACK");
  assert.equal(current.intent.sourceContext[0].freshness, "FRESH");

  const drifted = parseSultanAgentIntent(request({
    ...canonical,
    caseRef: canonical.caseRef,
    sourceContext: [{ ...canonical.sourceContext[0], freshness: "FRESH", integrityHash: "b".repeat(64) }],
  }));
  const stale = verifySultanAgentContext({ intent: drifted, orderReadback: readback });
  assert.equal(stale.intent.sourceContext[0].freshness, "STALE");
  assert.equal(stale.intent.sourceContext[0].integrityHash, integrityHash);
});

test("pre-inference policy verifies exact Stage 5 canonical receipts across supported subjects", () => {
  const order = stage5Readback("a", "ORDER");
  const account = stage5Readback("b", "ACCOUNT");
  const intent = parseSultanAgentIntent(request({
    sourceContext: [stage5Context(order), stage5Context(account)],
  }));
  assert.deepEqual(stage5CanonicalReadbackReceiptIds(intent), [order.readbackReceiptId, account.readbackReceiptId]);
  const verified = verifySultanAgentContext({
    canonicalReadbacks: [account, order],
    intent,
    now: NOW,
    orderReadback: null,
    stage5Pins: { maximumEvidenceAgeMs: 300_000, uiDeploymentSha: "d".repeat(40) },
    tenantId: "luzione",
  });
  assert.equal(verified.verification.kind, "CANONICAL_READBACK");
  assert.equal(verified.verification.verifiedCount, 2);
  assert.deepEqual(verified.intent.sourceContext.map((context) => context.freshness), ["FRESH", "FRESH"]);
  assert.deepEqual(verified.intent.sourceContext.map((context) => context.sourceVersion), [order.readbackHash, account.readbackHash]);
  const decision = evaluateSultanAgentIntent({
    actor: sultanWorkload(),
    contextVerification: verified.verification,
    intent: verified.intent,
    now: NOW,
    tenantPolicy: POLICY,
  });
  assert.equal(decision.status, "ADMIT_READ_ONLY");
  assert.equal(decision.sourceContext.synthetic, false);
  assert.equal(decision.sourceContext.verifiedCount, 2);
});

test("pre-inference policy rejects forged, cross-tenant, stale, duplicate, and mixed receipt evidence", () => {
  const canonical = stage5Readback("c", "OPPORTUNITY");
  const intent = parseSultanAgentIntent(request({ sourceContext: [stage5Context(canonical)] }));
  for (const candidate of [
    { ...canonical, readbackHash: "d".repeat(64) },
    { ...canonical, sourceVersion: null },
    { ...canonical, tenantId: "other" },
    { ...canonical, consumerActorId: "service:sultan-os" as const },
    { ...canonical, consumerReleaseSha: "e".repeat(40) },
  ]) {
    const result = verifySultanAgentContext({
      canonicalReadbacks: [candidate],
      intent,
      now: NOW,
      orderReadback: null,
      stage5Pins: { maximumEvidenceAgeMs: 300_000, uiDeploymentSha: "d".repeat(40) },
      tenantId: "luzione",
    });
    assert.equal(result.verification.kind, "UNVERIFIED");
    assert.equal(result.intent.sourceContext[0].freshness, "STALE");
  }
  const forgedContextVersion = parseSultanAgentIntent(request({
    sourceContext: [{ ...stage5Context(canonical), sourceVersion: "e".repeat(64) }],
  }));
  const forgedVersion = verifySultanAgentContext({
    canonicalReadbacks: [canonical],
    intent: forgedContextVersion,
    now: NOW,
    orderReadback: null,
    stage5Pins: { maximumEvidenceAgeMs: 300_000, uiDeploymentSha: "d".repeat(40) },
    tenantId: "luzione",
  });
  assert.equal(forgedVersion.verification.kind, "UNVERIFIED");
  assert.equal(forgedVersion.intent.sourceContext[0].freshness, "STALE");
  const stale = verifySultanAgentContext({
    canonicalReadbacks: [{ ...canonical, freshUntil: "2026-08-31T11:59:59.000Z" }],
    intent,
    now: NOW,
    orderReadback: null,
    stage5Pins: { maximumEvidenceAgeMs: 300_000, uiDeploymentSha: "d".repeat(40) },
    tenantId: "luzione",
  });
  assert.equal(stale.verification.kind, "CANONICAL_READBACK");
  assert.equal(stale.intent.sourceContext[0].freshness, "STALE");

  const aged = stage5Readback("e", "COMMITMENT", {
    observedAt: "2026-08-31T11:59:58.000Z",
    freshUntil: "2026-08-31T12:05:00.000Z",
  });
  const agedIntent = parseSultanAgentIntent(request({ sourceContext: [stage5Context(aged)] }));
  const ageBounded = verifySultanAgentContext({
    canonicalReadbacks: [aged],
    intent: agedIntent,
    now: NOW,
    orderReadback: null,
    stage5Pins: { maximumEvidenceAgeMs: 1_000, uiDeploymentSha: "d".repeat(40) },
    tenantId: "luzione",
  });
  assert.equal(ageBounded.verification.kind, "CANONICAL_READBACK");
  assert.equal(ageBounded.intent.sourceContext[0].freshness, "STALE");

  const duplicateIntent = parseSultanAgentIntent(request({
    sourceContext: [stage5Context(canonical), stage5Context(canonical)],
  }));
  assert.equal(stage5CanonicalReadbackReceiptIds(duplicateIntent), null);

  const mixedIntent = parseSultanAgentIntent(request({
    sourceContext: [
      stage5Context(canonical),
      { ...stage5Context(canonical), sourceOwner: "SYNTHETIC_LUZIONE" },
    ],
  }));
  const mixed = verifySultanAgentContext({ intent: mixedIntent, orderReadback: null });
  assert.equal(mixed.verification.kind, "UNVERIFIED");
  const mixedDecision = evaluateSultanAgentIntent({
    actor: sultanWorkload(),
    contextVerification: mixed.verification,
    intent: mixed.intent,
    now: NOW,
    tenantPolicy: POLICY,
  });
  assert.equal(mixedDecision.sourceContext.synthetic, false);
  assert.ok(mixedDecision.reasonCodes.includes("MIXED_CONTEXT_CLASSES_DENIED"));
  assert.notEqual(mixedDecision.status, "ADMIT_READ_ONLY");
});

test("unsupported or missing API context is replaced with unknown freshness", () => {
  const intent = parseSultanAgentIntent(request());
  const result = verifySultanAgentContext({ intent, orderReadback: null });
  assert.equal(result.verification.kind, "UNVERIFIED");
  assert.equal(result.intent.sourceContext[0].freshness, "UNKNOWN");
});

test("active tenant policy denial blocks an otherwise constitutional plan", () => {
  const intent = parseSultanAgentIntent(request());
  const deniedPolicy: TenantPolicySnapshot = {
    ...POLICY,
    policyDefinitionId: "policy-denied-v2",
    rules: [{ capability: "analysis.read", decision: "ALLOW", actorTypes: ["agent"], purposes: ["different-purpose"], maximumEffectClass: "A0" }],
    version: 2,
  };
  const decision = evaluate(intent, actor(), { policy: deniedPolicy });
  assert.equal(decision.status, "BLOCKED");
  assert.equal(decision.tenantPolicy.allowedByPolicy, false);
  assert.ok(decision.reasonCodes.includes("PURPOSE_NOT_ALLOWED"));
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
  assert.match(route, /readAdmissionEvidence\(actor\.tenantId, stage5ReceiptIds\)/);
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
  const policySchema = JSON.parse(readFileSync("contracts/sultan/agent-policy-decision-v0.1.schema.json", "utf8")) as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assert.ok(policySchema.required.includes("agent"));
  assert.ok(policySchema.required.includes("tenantPolicy"));
  assert.ok(policySchema.properties.agent);
});
