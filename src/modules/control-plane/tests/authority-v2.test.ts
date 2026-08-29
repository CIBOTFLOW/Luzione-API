import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAuthorityV2 } from "../authorityV2";
import type { CapabilityContract, EffectAction, EffectEnvelope, ExactApproval } from "../types";

const envelope: EffectEnvelope = {
  actor: { identityId: "user:11111111-1111-4111-8111-111111111111", membershipRole: "Admin", principalType: "USER" },
  authorityClass: "A0",
  capability: "data.read",
  contractVersion: "luzione-authority/v2",
  correlationId: "correlation:golden-001",
  idempotencyKey: "idempotency:golden-001",
  policyDecisionId: "policy:golden-001",
  resourceScope: ["account:controlled"],
  tenantId: "22222222-2222-4222-8222-222222222222",
};

const action: EffectAction = {
  actionId: "action:golden",
  actionVersion: "v1",
  contentDigest: "a".repeat(64),
  provider: "postgres",
  readbackPlanned: true,
};

function capability(overrides: Partial<CapabilityContract> = {}): CapabilityContract {
  return {
    authorityClass: envelope.authorityClass,
    capability: envelope.capability,
    enabled: true,
    operationKind: "READ",
    provider: action.provider,
    providerEffect: false,
    ...overrides,
  };
}

test("A0 permits reads and rejects state changes", () => {
  assert.equal(evaluateAuthorityV2({ action, capability: capability(), envelope, now: "2026-08-28T00:00:00Z" }).code, "ALLOW_A0");
  assert.equal(evaluateAuthorityV2({
    action,
    capability: capability({ operationKind: "EXTERNAL", providerEffect: true }),
    envelope,
    now: "2026-08-28T00:00:00Z",
  }).allowed, false);
});

test("A1 permits internal work only", () => {
  const a1Envelope = { ...envelope, authorityClass: "A1" as const, capability: "task.internal.create" };
  const result = evaluateAuthorityV2({
    action,
    capability: capability({ authorityClass: "A1", capability: a1Envelope.capability, operationKind: "INTERNAL" }),
    envelope: a1Envelope,
    now: "2026-08-28T00:00:00Z",
  });
  assert.equal(result.code, "ALLOW_A1");
  assert.equal(result.externalEffectAuthorized, false);
});

test("A2 requires separate provider readback and compensation or safe reconciliation", () => {
  const a2Envelope = { ...envelope, authorityClass: "A2" as const, capability: "record.sync" };
  const a2Capability = capability({ authorityClass: "A2", capability: a2Envelope.capability, operationKind: "EXTERNAL", providerEffect: true });
  assert.equal(evaluateAuthorityV2({ action: { ...action, readbackPlanned: false }, capability: a2Capability, envelope: a2Envelope, now: "2026-08-28T00:00:00Z" }).code, "A2_READBACK_REQUIRED");
  assert.equal(evaluateAuthorityV2({ action, capability: a2Capability, envelope: a2Envelope, now: "2026-08-28T00:00:00Z" }).code, "A2_RECOVERY_REQUIRED");
  assert.equal(evaluateAuthorityV2({ action: { ...action, safeReconciliationPlanned: true }, capability: a2Capability, envelope: a2Envelope, now: "2026-08-28T00:00:00Z" }).code, "ALLOW_A2");
});

test("A3 binds actor, content/version, provider, scope, cost, and expiry exactly", () => {
  const a3Envelope: EffectEnvelope = {
    ...envelope,
    approvalId: "approval:golden-001",
    authorityClass: "A3",
    capability: "email.send",
    estimatedCost: { amount: "0.02", currency: "USD" },
  };
  const a3Action = { ...action, provider: "gmail" };
  const exactApproval: ExactApproval = {
    actionId: a3Action.actionId,
    actionVersion: a3Action.actionVersion,
    actorIdentityId: a3Envelope.actor.identityId,
    approvalId: a3Envelope.approvalId!,
    authorityClass: "A3",
    capability: a3Envelope.capability,
    contentDigest: a3Action.contentDigest,
    estimatedCost: a3Envelope.estimatedCost!,
    expiresAt: "2026-08-28T01:00:00Z",
    provider: a3Action.provider,
    resourceScope: a3Envelope.resourceScope,
    status: "APPROVED",
    tenantId: a3Envelope.tenantId,
  };
  const a3Capability = capability({ authorityClass: "A3", capability: a3Envelope.capability, operationKind: "EXTERNAL", provider: "gmail", providerEffect: true });
  assert.equal(evaluateAuthorityV2({ action: a3Action, approval: exactApproval, capability: a3Capability, envelope: a3Envelope, now: "2026-08-28T00:00:00Z" }).code, "ALLOW_A3");
  assert.equal(evaluateAuthorityV2({ action: a3Action, approval: { ...exactApproval, contentDigest: "b".repeat(64) }, capability: a3Capability, envelope: a3Envelope, now: "2026-08-28T00:00:00Z" }).code, "A3_APPROVAL_MISMATCH");
  assert.equal(evaluateAuthorityV2({ action: a3Action, approval: exactApproval, capability: a3Capability, envelope: a3Envelope, now: exactApproval.expiresAt }).code, "A3_APPROVAL_EXPIRED");
});

test("A4 is never grantable and model selection never changes authority", () => {
  const a4Envelope = { ...envelope, authorityClass: "A4" as const, capability: "authority.self-grant" };
  const a4Capability = capability({ authorityClass: "A4", capability: a4Envelope.capability, enabled: false, operationKind: "PROHIBITED" });
  assert.equal(evaluateAuthorityV2({ action, capability: a4Capability, envelope: a4Envelope, now: "2026-08-28T00:00:00Z", selectedModel: "gpt-5.6-sol" }).code, "BLOCK_A4");

  const withoutModel = evaluateAuthorityV2({ action, capability: capability(), envelope, now: "2026-08-28T00:00:00Z" });
  const withModel = evaluateAuthorityV2({ action, capability: capability(), envelope, now: "2026-08-28T00:00:00Z", selectedModel: "gpt-5.6-sol" });
  assert.deepEqual(withModel, withoutModel);
});
