import assert from "node:assert/strict";
import test from "node:test";

import { assertNoRawSecrets, parseCreateConnection, parseCommand } from "../request";

test("connection parser rejects browser tenant selection and nested raw credentials", () => {
  assert.throws(() => parseCreateConnection({
    adapterVersion: "v1",
    authMethod: "NONE",
    displayName: "Postgres",
    provider: "postgres",
    scopes: [],
    tenantId: "browser-choice",
  }), /resolved from the authenticated membership/);
  assert.throws(() => assertNoRawSecrets({ nested: { apiKey: "plaintext" } }), /Raw credential field/);
});

test("connection parser accepts opaque legacy references without inspecting credential material", () => {
  const parsed = parseCreateConnection({
    adapterVersion: "legacy-v1",
    authMethod: "LEGACY",
    displayName: "Existing Gmail",
    legacySourceRef: "connected_accounts:old-id",
    provider: "gmail",
    scopes: ["mail.read"],
    secretRef: "legacy:connected_accounts/old-id",
  });
  assert.equal(parsed.secretRef, "legacy:connected_accounts/old-id");
});

test("command parser rejects secret-bearing payloads and malformed content digests", () => {
  const base = {
    action: {
      actionId: "action:1",
      actionVersion: "v1",
      contentDigest: "a".repeat(64),
      provider: "postgres",
      readbackPlanned: true,
    },
    commandType: "test.command",
    envelope: {
      actor: { identityId: "user:11111111-1111-4111-8111-111111111111", membershipRole: "Admin", principalType: "USER" },
      authorityClass: "A0",
      capability: "data.read",
      contractVersion: "luzione-authority/v2",
      correlationId: "correlation:test-001",
      idempotencyKey: "idempotency:test-001",
      policyDecisionId: "policy:test-001",
      resourceScope: ["record:1"],
      tenantId: "22222222-2222-4222-8222-222222222222",
    },
    payload: {},
    target: { objectId: "1", objectType: "record", objectVersion: "v1", ownerProject: "Luzione-API" },
  };
  assert.throws(() => parseCommand({ ...base, payload: { accessToken: "raw" } }), /Raw credential field/);
  assert.throws(() => parseCommand({ ...base, action: { ...base.action, contentDigest: "short" } }), /SHA-256/);
  assert.equal(parseCommand(base).envelope.contractVersion, "luzione-authority/v2");
});
