import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SGO_V02_AUTHORIZATION_SCOPE_VERSION,
  SGO_V02_CACHE_BINDING_VERSION,
  SgoV02AuthorizationError,
  createSgoV02CacheBinding,
  evaluateSgoV02Authorization,
  releaseSgoV02CachedResult,
  sgoV02AuthorizationMatrix,
  sgoV02SurfaceKinds,
  validateSgoV02AuthorizationManifest,
  type SgoV02ObjectScope,
  type SgoV02Operation,
} from "../sgoV02Authorization";

const NOW = "2026-09-11T19:30:00.000Z";
const EXPIRES = "2026-09-11T19:34:00.000Z";
const CONTEXT_SURFACE = "api.context.linked-evidence.v0.1-draft";
const ACTION_SURFACE = "api.action.sultan-reservation-effect.v1";
const payload = Object.freeze({ recordId: "case-001", title: "Private commercial context" });

function actor(overrides: Partial<ApiActor> = {}): ApiActor {
  return Object.freeze({
    actorId: "user_owner",
    actorType: "user" as const,
    capabilities: Object.freeze(["sultan.canonical.readback.read", "sultan.command.execute", "sultan.effect.read"]),
    source: "vercel-oidc" as const,
    tenantId: "tenant-alpha",
    ...overrides,
  });
}

function scope(overrides: Partial<SgoV02ObjectScope> = {}): SgoV02ObjectScope {
  return Object.freeze({
    authorizationVersion: "authz:case-001:v4",
    contractVersion: SGO_V02_AUTHORIZATION_SCOPE_VERSION,
    objectId: "case-001",
    objectVersion: "commercial-case:case-001:v4",
    ownerActorId: "user_owner",
    permittedActorIds: Object.freeze([]),
    sourceRef: "authorization:commercial-cases/case-001@v4",
    tenantId: "tenant-alpha",
    ...overrides,
  });
}

function evaluate(input: {
  actor?: ApiActor;
  cacheBinding?: unknown;
  cachedPayloadHash?: string;
  objectScope?: unknown;
  operation?: SgoV02Operation;
  requestedObjectId?: string;
  surfaceId?: string;
}) {
  return evaluateSgoV02Authorization({
    actor: input.actor ?? actor(),
    cacheBinding: input.cacheBinding,
    cachedPayloadHash: input.cachedPayloadHash,
    now: NOW,
    objectScope: Object.hasOwn(input, "objectScope") ? input.objectScope : scope(),
    operation: input.operation ?? "READ",
    requestedObjectId: input.requestedObjectId ?? "case-001",
    surfaceId: input.surfaceId ?? CONTEXT_SURFACE,
  });
}

test("machine matrix pins exact admission, API proof rows and cross-repository holds", () => {
  const manifest = JSON.parse(readFileSync("engineering/execution/SGO_V02_AUTHORIZATION_MATRIX_V1.json", "utf8")) as unknown;
  assert.deepEqual(validateSgoV02AuthorizationManifest(manifest), {
    apiProofRows: 3, evidencePins: 13, integrationHolds: 3, surfaceKinds: 5,
  });
  assert.deepEqual(new Set(sgoV02AuthorizationMatrix.map((row) => row.surfaceKind)), new Set(sgoV02SurfaceKinds));
  const widened = { ...(manifest as Record<string, unknown>), runtime_route: "/api/v1/private" };
  assert.throws(() => validateSgoV02AuthorizationManifest(widened), /Unexpected fields/);
  const pinDrift = structuredClone(manifest) as { evidence_pins: Array<Record<string, unknown>> };
  pinDrift.evidence_pins[0].blob_sha = "f".repeat(40);
  assert.throws(() => validateSgoV02AuthorizationManifest(pinDrift), /Invalid SGO-V02 evidence pins/);
});

test("authorized owner can read context and resume or mutate the bounded action surface", () => {
  assert.equal(evaluate({ operation: "READ" }).decision, "ALLOW");
  for (const operation of ["READ", "RESUME", "MUTATE"] as const) {
    const result = evaluate({ operation, surfaceId: operation === "READ" ? CONTEXT_SURFACE : ACTION_SURFACE });
    assert.equal(result.releaseAllowed, true);
    assert.equal(result.effectAuthority, "NO_EFFECT");
    assert.equal(result.grantsAuthority, false);
  }
});

test("cross-tenant actor cannot read, resume, mutate or receive cached results", () => {
  const binding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: ACTION_SURFACE });
  for (const operation of ["READ", "RESUME", "MUTATE", "RECEIVE_CACHED_RESULT"] as const) {
    const result = evaluate({ actor: actor({ tenantId: "tenant-beta" }), cacheBinding: binding, cachedPayloadHash: sha256(payload), operation, surfaceId: ACTION_SURFACE });
    assert.equal(result.reasonCode, "TENANT_SCOPE_DENIED");
    assert.equal(result.releaseAllowed, false);
  }
});

test("second unauthorized actor cannot read, resume, mutate or receive cached results", () => {
  const binding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: ACTION_SURFACE });
  for (const operation of ["READ", "RESUME", "MUTATE", "RECEIVE_CACHED_RESULT"] as const) {
    const result = evaluate({ actor: actor({ actorId: "user_intruder" }), cacheBinding: binding, cachedPayloadHash: sha256(payload), operation, surfaceId: ACTION_SURFACE });
    assert.equal(result.reasonCode, "ACTOR_SCOPE_DENIED");
    assert.equal(result.releaseAllowed, false);
  }
});

test("requested object mismatch, missing capability and unsupported operation fail closed", () => {
  assert.equal(evaluate({ requestedObjectId: "case-elsewhere" }).reasonCode, "OBJECT_SCOPE_DENIED");
  assert.equal(evaluate({ actor: actor({ capabilities: [] }) }).reasonCode, "CAPABILITY_DENIED");
  assert.equal(evaluate({ operation: "MUTATE", surfaceId: CONTEXT_SURFACE }).reasonCode, "OPERATION_NOT_SUPPORTED");
  assert.equal(evaluate({ surfaceId: "api.unknown.private-surface" }).reasonCode, "UNKNOWN_SURFACE");
});

test("exact actor-bound cache release succeeds without changing effect authority", () => {
  const binding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const release = releaseSgoV02CachedResult({ actor: actor(), cacheBinding: binding, cachedResult: payload, now: NOW, objectScope: scope(), requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE });
  assert.equal(release.decision.decision, "ALLOW");
  assert.equal(release.decision.effectAuthority, "NO_EFFECT");
  assert.deepEqual(release.result, payload);
});

test("another explicitly permitted actor still cannot receive the first actor cache entry", () => {
  const sharedScope = scope({ permittedActorIds: ["user_collaborator"] });
  const binding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: sharedScope, payload, surfaceId: CONTEXT_SURFACE });
  const release = releaseSgoV02CachedResult({ actor: actor({ actorId: "user_collaborator" }), cacheBinding: binding, cachedResult: payload, now: NOW, objectScope: sharedScope, requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE });
  assert.equal(release.decision.reasonCode, "CACHE_BINDING_MISMATCH");
  assert.equal(release.result, null);
});

test("cache binding rejects actor, tenant, surface, object, version, source, authorization and payload drift", () => {
  const binding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const mutations: Array<{ actor?: ApiActor; cachedResult?: unknown; objectScope?: SgoV02ObjectScope; surfaceId?: string }> = [
    { actor: actor({ actorId: "user_other" }), objectScope: scope({ permittedActorIds: ["user_other"] }) },
    { actor: actor({ tenantId: "tenant-beta" }), objectScope: scope({ tenantId: "tenant-beta" }) },
    { surfaceId: "api.context.stage5-canonical-readback.v1" },
    { objectScope: scope({ objectId: "case-002" }) },
    { objectScope: scope({ objectVersion: "commercial-case:case-001:v5" }) },
    { objectScope: scope({ sourceRef: "authorization:commercial-cases/case-001@shadow-v4" }) },
    { objectScope: scope({ authorizationVersion: "authz:case-001:v5" }) },
    { cachedResult: { ...payload, title: "tampered" } },
  ];
  for (const mutation of mutations) {
    const selectedScope = mutation.objectScope ?? scope();
    const release = releaseSgoV02CachedResult({ actor: mutation.actor ?? actor(), cacheBinding: binding, cachedResult: mutation.cachedResult ?? payload, now: NOW, objectScope: selectedScope, requestedObjectId: selectedScope.objectId, surfaceId: mutation.surfaceId ?? CONTEXT_SURFACE });
    assert.equal(release.decision.decision, "DENY");
    assert.equal(release.result, null);
  }
});

test("binding hash tampering, missing binding, expiry and future issue time deny release", () => {
  const binding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  assert.equal(evaluate({ operation: "RECEIVE_CACHED_RESULT" }).reasonCode, "CACHE_BINDING_REQUIRED");
  assert.equal(evaluate({ cacheBinding: { ...binding, bindingHash: "f".repeat(64) }, cachedPayloadHash: sha256(payload), operation: "RECEIVE_CACHED_RESULT" }).reasonCode, "CACHE_BINDING_INVALID");
  assert.equal(evaluateSgoV02Authorization({ actor: actor(), cacheBinding: binding, cachedPayloadHash: sha256(payload), now: EXPIRES, objectScope: scope(), operation: "RECEIVE_CACHED_RESULT", requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE }).reasonCode, "CACHE_BINDING_EXPIRED");
  const future = createSgoV02CacheBinding({ actor: actor(), createdAt: "2026-09-11T19:31:00.000Z", expiresAt: "2026-09-11T19:34:00.000Z", objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  assert.equal(evaluate({ cacheBinding: future, cachedPayloadHash: sha256(payload), operation: "RECEIVE_CACHED_RESULT" }).reasonCode, "CACHE_BINDING_EXPIRED");
});

test("malformed actor, object scope and cache envelope return denials instead of throwing", () => {
  assert.equal(evaluate({ actor: { ...actor(), tenantId: "" } }).reasonCode, "INVALID_AUTHORIZATION_INPUT");
  assert.equal(evaluate({ objectScope: null }).reasonCode, "INVALID_AUTHORIZATION_INPUT");
  assert.equal(evaluate({ objectScope: { ...scope(), attackerAuthority: true } }).reasonCode, "INVALID_AUTHORIZATION_INPUT");
  assert.equal(evaluate({ cacheBinding: null, cachedPayloadHash: sha256(payload), operation: "RECEIVE_CACHED_RESULT" }).reasonCode, "CACHE_BINDING_INVALID");
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const binding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const malformedRelease = releaseSgoV02CachedResult({ actor: actor(), cacheBinding: binding, cachedResult: cyclic, now: NOW, objectScope: scope(), requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE });
  assert.equal(malformedRelease.decision.reasonCode, "INVALID_AUTHORIZATION_INPUT");
  assert.equal(malformedRelease.result, null);
  assert.throws(() => createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload: cyclic, surfaceId: CONTEXT_SURFACE }), (error) => error instanceof SgoV02AuthorizationError && error.code === "INVALID_CACHE_INPUT");
});

test("integration holds cannot be promoted by credentials, object scope or a cache-shaped payload", () => {
  for (const row of sgoV02AuthorizationMatrix.filter((item) => item.authorizationMode === "INTEGRATION_HOLD")) {
    for (const operation of ["READ", "RESUME", "MUTATE", "RECEIVE_CACHED_RESULT"] as const) {
      const result = evaluate({ cacheBinding: { contractVersion: SGO_V02_CACHE_BINDING_VERSION, authority: "ALLOW" }, cachedPayloadHash: sha256(payload), operation, surfaceId: row.surfaceId });
      assert.equal(result.decision, "INTEGRATION_HOLD");
      assert.equal(result.releaseAllowed, false);
    }
  }
});

test("denied cached-result helper returns null and never echoes the private payload", () => {
  const binding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const release = releaseSgoV02CachedResult({ actor: actor({ actorId: "user_intruder" }), cacheBinding: binding, cachedResult: payload, now: NOW, objectScope: scope(), requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE });
  assert.equal(release.result, null);
  assert.doesNotMatch(JSON.stringify(release), /Private commercial context/);
});

test("cache binding cannot be created without read authority or within an unsafe window", () => {
  assert.throws(() => createSgoV02CacheBinding({ actor: actor({ actorId: "user_intruder" }), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE }), (error) => error instanceof SgoV02AuthorizationError && error.code === "CACHE_BINDING_DENIED");
  assert.throws(() => createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: "2026-09-11T19:40:00.000Z", objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE }), (error) => error instanceof SgoV02AuthorizationError && error.code === "INVALID_CACHE_WINDOW");
});

test("expired cache recovers only through a new authorized read and exact replacement binding", () => {
  const oldBinding = createSgoV02CacheBinding({ actor: actor(), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const changedScope = scope({ authorizationVersion: "authz:case-001:v5", objectVersion: "commercial-case:case-001:v5" });
  const later = "2026-09-11T19:35:00.000Z";
  assert.equal(releaseSgoV02CachedResult({ actor: actor(), cacheBinding: oldBinding, cachedResult: payload, now: later, objectScope: changedScope, requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE }).result, null);
  const replacement = createSgoV02CacheBinding({ actor: actor(), createdAt: later, expiresAt: "2026-09-11T19:39:00.000Z", objectScope: changedScope, payload, surfaceId: CONTEXT_SURFACE });
  assert.deepEqual(releaseSgoV02CachedResult({ actor: actor(), cacheBinding: replacement, cachedResult: payload, now: later, objectScope: changedScope, requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE }).result, payload);
});

test("existing API object responses remain no-store and V02 mounts no route", () => {
  const http = readFileSync("src/lib/api/http.ts", "utf8");
  assert.match(http, /options\.cacheControl \?\? "no-store"/);
  for (const path of ["src/app/api/v1/sultan/canonical-readbacks/route.ts", "src/app/api/v1/sultan/commands/execute/route.ts", "src/app/api/v1/sultan/effects/[receiptId]/readback/route.ts"]) {
    const route = readFileSync(path, "utf8");
    assert.match(route, /apiResponse\(/);
    assert.doesNotMatch(route, /cacheControl\s*:/);
  }
  const source = readFileSync("src/modules/authorization-proof/sgoV02Authorization.ts", "utf8");
  assert.doesNotMatch(source, /from ["']next\/server["']/);
  assert.doesNotMatch(source, /export async function (?:GET|POST|PUT|PATCH|DELETE)/);
});
