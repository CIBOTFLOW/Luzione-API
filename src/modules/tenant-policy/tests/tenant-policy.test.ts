import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AutonomyActionPlan } from "@/modules/autonomy/types";
import { evaluateTenantPolicy } from "../evaluator";
import { parseTenantPolicySnapshot } from "../parser";

const policy = parseTenantPolicySnapshot({
  checksum: "sha256:test",
  code: "sultan.autonomy",
  compiled_json: {
    defaultDecision: "APPROVAL",
    maximumDataClassification: "CONFIDENTIAL",
    maximumEffectClass: "A3",
    rules: [
      { capability: "lead.score", decision: "ALLOW", actorTypes: ["agent"], purposes: [], maximumEffectClass: "A1" },
      { capability: "email.send", decision: "APPROVAL", actorTypes: ["agent"], purposes: [], maximumEffectClass: "A3" },
    ],
  },
  policy_definition_id: "policy_1",
  tenant_id: "tenant_1",
  version: 1,
});

function plan(capability: string, effect: AutonomyActionPlan["declaredEffectClass"]): AutonomyActionPlan {
  return {
    actionId: "action_1", actionVersion: "v1", capability, purpose: "growth",
    dataClassification: "INTERNAL", declaredEffectClass: effect,
    controls: { budgetWithinLimit: true, dependenciesReady: true, evidenceComplete: true, idempotencyKey: "idem", killSwitchReady: true, providerReconciliationPlanned: true, readbackPlanned: true, rollbackPlanned: true, simulationPassed: true },
  };
}

test("explicit liberal tenant rule allows a bounded AI capability", () => {
  const decision = evaluateTenantPolicy({ actorType: "agent", plan: plan("lead.score", "A1"), policy });
  assert.equal(decision.allowedByPolicy, true);
});

test("external effects still require approval even in a liberal policy", () => {
  const decision = evaluateTenantPolicy({ actorType: "agent", plan: plan("email.send", "A3"), policy });
  assert.equal(decision.allowedByPolicy, false);
  assert.ok(decision.reasonCodes.includes("TENANT_APPROVAL_REQUIRED"));
});

test("unknown capabilities inherit approval, never broad authority", () => {
  const decision = evaluateTenantPolicy({ actorType: "agent", plan: plan("unknown.action", "A1"), policy });
  assert.equal(decision.allowedByPolicy, false);
  assert.ok(decision.reasonCodes.includes("NO_EXPLICIT_CAPABILITY_RULE"));
});

test("governance API classifies authentication failures as unauthorized", () => {
  const route = readFileSync("src/app/api/v1/governance/evaluate/route.ts", "utf8");
  assert.match(route, /error instanceof CanonicalActorError/);
  assert.match(route, /\? error\.status/);
});
