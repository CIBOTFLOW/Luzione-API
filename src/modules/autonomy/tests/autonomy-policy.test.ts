import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAutonomyPlan } from "../evaluator";
import { AutonomyRequestError, parseAutonomyEvaluationRequest } from "../parser";
import type {
  AutonomyActionPlan,
  AutonomyEvaluationContext,
  VerifiedAuthorityGrant,
} from "../types";

const NOW = "2026-08-28T12:00:00.000Z";

function plan(overrides: Partial<AutonomyActionPlan> = {}): AutonomyActionPlan {
  return {
    actionId: "action_1",
    actionVersion: "v1",
    capability: "analysis.read",
    controls: {
      budgetWithinLimit: true,
      dependenciesReady: true,
      evidenceComplete: true,
      idempotencyKey: "idem_1",
      killSwitchReady: true,
      providerReconciliationPlanned: true,
      readbackPlanned: true,
      rollbackPlanned: true,
      simulationPassed: true,
    },
    dataClassification: "INTERNAL",
    declaredEffectClass: "A0",
    purpose: "workflow-audit",
    ...overrides,
  };
}

function grant(overrides: Partial<VerifiedAuthorityGrant> = {}): VerifiedAuthorityGrant {
  return {
    actionId: "action_1",
    actionVersion: "v1",
    approvedBy: "human_1",
    capability: "task.internal.create",
    consumed: false,
    effectClassMaximum: "A1",
    expiresAt: "2026-08-28T13:00:00.000Z",
    grantId: "grant_1",
    granteeActorId: "agent_1",
    oneTime: false,
    purpose: "workflow-audit",
    source: "POLICY_GRANT",
    tenantId: "tenant_1",
    verification: "CANONICAL_STORE",
    ...overrides,
  };
}

function context(authorityGrant?: VerifiedAuthorityGrant): AutonomyEvaluationContext {
  return {
    actor: { actorId: "agent_1", actorType: "agent", tenantId: "tenant_1" },
    authorityGrant,
    now: NOW,
  };
}

test("A0 read-only analysis is allowed but never authorizes an external effect", () => {
  const evaluation = evaluateAutonomyPlan(plan(), context());
  assert.equal(evaluation.decision, "ALLOW");
  assert.equal(evaluation.actionAuthorized, true);
  assert.equal(evaluation.externalEffectsAuthorized, false);
});

test("unknown capabilities cannot inherit authority from model output", () => {
  const evaluation = evaluateAutonomyPlan(
    plan({ capability: "model.claims.superpower", declaredEffectClass: "A0" }),
    context(),
  );
  assert.equal(evaluation.decision, "SIMULATE_ONLY");
  assert.deepEqual(evaluation.reasonCodes, ["CAPABILITY_UNKNOWN"]);
});

test("clients and models cannot downgrade a registered effect class", () => {
  const evaluation = evaluateAutonomyPlan(
    plan({ capability: "email.send", declaredEffectClass: "A0" }),
    context(),
  );
  assert.equal(evaluation.decision, "BLOCK");
  assert.deepEqual(evaluation.reasonCodes, ["EFFECT_CLASS_MISMATCH"]);
});

test("constitution, authority, money, kill-switch and audit mutations stay prohibited", () => {
  for (const capability of [
    "authority.grant",
    "constitution.modify",
    "payment.execute",
    "kill_switch.disable",
    "audit.delete",
    "budget.guardrail.raise",
  ]) {
    const evaluation = evaluateAutonomyPlan(
      plan({ capability, declaredEffectClass: "A4" }),
      context(),
    );
    assert.equal(evaluation.decision, "BLOCK", capability);
    assert.deepEqual(evaluation.reasonCodes, ["PROHIBITED_CAPABILITY"], capability);
  }
});

test("A1 needs a canonical scoped grant even after every execution control passes", () => {
  const proposed = plan({ capability: "task.internal.create", declaredEffectClass: "A1" });
  assert.equal(evaluateAutonomyPlan(proposed, context()).decision, "REQUIRE_APPROVAL");
  assert.equal(evaluateAutonomyPlan(proposed, context(grant())).decision, "ALLOW");
});

test("cross-tenant, wrong-purpose, expired and consumed grants fail closed", () => {
  const proposed = plan({ capability: "task.internal.create", declaredEffectClass: "A1" });
  for (const badGrant of [
    grant({ tenantId: "tenant_2" }),
    grant({ purpose: "different-purpose" }),
    grant({ expiresAt: "2026-08-28T11:59:00.000Z" }),
    grant({ consumed: true }),
  ]) {
    assert.equal(evaluateAutonomyPlan(proposed, context(badGrant)).decision, "BLOCK");
  }
});

test("A2 requires exact action-version human approval", () => {
  const proposed = plan({ capability: "record.internal.update", declaredEffectClass: "A2" });
  const approved = grant({
    capability: "record.internal.update",
    effectClassMaximum: "A2",
    oneTime: true,
    source: "HUMAN_APPROVAL",
  });
  assert.equal(evaluateAutonomyPlan(proposed, context(approved)).decision, "ALLOW");
  assert.equal(
    evaluateAutonomyPlan(proposed, context({ ...approved, actionVersion: "v0" })).decision,
    "BLOCK",
  );
  assert.equal(
    evaluateAutonomyPlan(proposed, context({ ...approved, oneTime: false })).decision,
    "BLOCK",
  );
});

test("A2 accepts an exact one-time canonical tenant policy grant", () => {
  const proposed = plan({ capability: "crm.stage.advance", declaredEffectClass: "A2" });
  const approved = grant({
    capability: "crm.stage.advance",
    effectClassMaximum: "A2",
    oneTime: true,
    source: "POLICY_GRANT",
  });
  assert.equal(evaluateAutonomyPlan(proposed, context(approved)).decision, "ALLOW");
});

test("A3 needs one-time human approval and provider reconciliation", () => {
  const proposed = plan({ capability: "email.send", declaredEffectClass: "A3" });
  const approved = grant({
    capability: "email.send",
    effectClassMaximum: "A3",
    oneTime: true,
    source: "HUMAN_APPROVAL",
  });
  const allowed = evaluateAutonomyPlan(proposed, context(approved));
  assert.equal(allowed.decision, "ALLOW");
  assert.equal(allowed.externalEffectsAuthorized, true);

  const noReconciliation = evaluateAutonomyPlan(
    { ...proposed, controls: { ...proposed.controls, providerReconciliationPlanned: false } },
    context(approved),
  );
  assert.equal(noReconciliation.decision, "BLOCK");
  assert.ok(noReconciliation.reasonCodes.includes("CONTROL_RECONCILIATION_MISSING"));
});

test("provider outage blocks an approved A3 plan instead of spending a model call or retrying blindly", () => {
  const proposed = plan({
    capability: "google.document.create",
    controls: { ...plan().controls, dependenciesReady: false },
    declaredEffectClass: "A3",
  });
  const approved = grant({
    capability: "google.document.create",
    effectClassMaximum: "A3",
    oneTime: true,
    source: "HUMAN_APPROVAL",
  });
  const evaluation = evaluateAutonomyPlan(proposed, context(approved));
  assert.equal(evaluation.decision, "BLOCK");
  assert.ok(evaluation.reasonCodes.includes("CONTROL_DEPENDENCY_MISSING"));
});

test("restricted data cannot be sent to an external provider", () => {
  const evaluation = evaluateAutonomyPlan(
    plan({
      capability: "email.send",
      dataClassification: "RESTRICTED",
      declaredEffectClass: "A3",
    }),
    context(),
  );
  assert.equal(evaluation.decision, "BLOCK");
  assert.deepEqual(evaluation.reasonCodes, ["DATA_POLICY_BLOCKED"]);
});

test("request parser rejects client-supplied authority and tenant claims", () => {
  const validBody = { plan: plan() };
  assert.deepEqual(parseAutonomyEvaluationRequest(validBody), plan());
  for (const injected of [
    { ...validBody, authority: { source: "model" } },
    { plan: { ...plan(), tenantId: "tenant_2" } },
    { plan: { ...plan(), roles: ["admin"] } },
  ]) {
    assert.throws(
      () => parseAutonomyEvaluationRequest(injected),
      (error) => error instanceof AutonomyRequestError && error.code === "CLIENT_AUTHORITY_REJECTED",
    );
  }
});

test("API boundary authenticates the actor and never accepts a grant from the body", () => {
  const route = readFileSync("src/app/api/v1/autonomy/evaluate/route.ts", "utf8");
  assert.match(route, /requireServiceActor\(request\.headers, "governance\.evaluate"\)/);
  assert.match(route, /parseAutonomyEvaluationRequest\(body\)/);
  assert.doesNotMatch(route, /authorityGrant:\s*body/);
  assert.match(route, /evaluatedOnly:\s*true/);
  assert.match(route, /externalEffectsAuthorized:\s*false/);
});
