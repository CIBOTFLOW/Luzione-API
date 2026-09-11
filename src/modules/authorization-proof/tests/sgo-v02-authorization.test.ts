import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test, { before } from "node:test";

import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SGO_V02_AUTHORIZATION_SCOPE_VERSION,
  SGO_V02_CACHE_BINDING_VERSION,
  SgoV02AuthorizationError,
  createSgoV02CacheBinding,
  evaluateSgoV02Authorization,
  releaseSgoV02CachedResult,
  resolveSgoV02CredentialActor,
  sgoV02AuthorizationMatrix,
  sgoV02SurfaceKinds,
  validateSgoV02AuthorizationManifest,
  type SgoV02CredentialActorAttestation,
  type SgoV02ObjectScope,
  type SgoV02Operation,
} from "../sgoV02Authorization";

const NOW = "2026-09-11T19:30:00.000Z";
const EXPIRES = "2026-09-11T19:34:00.000Z";
const CONTEXT_SURFACE = "api.context.linked-evidence.v0.1-draft";
const ACTION_SURFACE = "api.action.sultan-reservation-effect.v1";
const ISSUER = "https://oidc.vercel.com/connor-spiegelmans-projects";
const AUDIENCE = "https://vercel.com/connor-spiegelmans-projects";
const OWNER = "connor-spiegelmans-projects";
const OWNER_ID = "team_ZB7I1yzyt3ywCXQtPCYn4kL9";
const KEY_ID = "sgo-v02-local-verification-key";
const DEPLOYMENT_ENV = process.env.VERCEL_ENV === "preview" ? "preview" : "production";
const payload = Object.freeze({ recordId: "case-001", title: "Private commercial context" });
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: KEY_ID,
  use: "sig",
} as crypto.JsonWebKey & { alg: string; kid: string; kty: "RSA"; use: string };
const loadJwks = async () => [publicJwk];

let uiCredentialActor: SgoV02CredentialActorAttestation | null = null;
let sultanCredentialActor: SgoV02CredentialActorAttestation | null = null;

function signedWorkloadToken(project: "luzione_ui" | "sultan-os", overrides: Record<string, unknown> = {}) {
  const projectId = project === "luzione_ui"
    ? "prj_WGbFwkzAYBij46rrVUqNPGEeWzCP"
    : "prj_5nTisld8OnGiBhIxegGbUpWrZNp0";
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: KEY_ID, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({
    aud: AUDIENCE,
    environment: DEPLOYMENT_ENV,
    exp: now + 600,
    iat: now - 5,
    iss: ISSUER,
    owner: OWNER,
    owner_id: OWNER_ID,
    project,
    project_id: projectId,
    sub: `owner:${OWNER}:project:${project}:environment:${DEPLOYMENT_ENV}`,
    ...overrides,
  })).toString("base64url");
  const signingInput = `${header}.${body}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

before(async () => {
  uiCredentialActor = await resolveSgoV02CredentialActor({
    bearerToken: signedWorkloadToken("luzione_ui"),
    loadJwks,
  });
  sultanCredentialActor = await resolveSgoV02CredentialActor({
    bearerToken: signedWorkloadToken("sultan-os"),
    loadJwks,
  });
  assert.equal(uiCredentialActor?.actor.actorId, "service:luzione-ui");
  assert.equal(sultanCredentialActor?.actor.actorId, "service:sultan-os");
});

function attestation(actor: "ui" | "sultan" = "ui") {
  const selected = actor === "ui" ? uiCredentialActor : sultanCredentialActor;
  if (!selected) throw new Error("Credential actor fixture was not verified.");
  return selected;
}

function scope(overrides: Partial<SgoV02ObjectScope> = {}): SgoV02ObjectScope {
  return Object.freeze({
    authorizationVersion: "authz:case-001:v4",
    contractVersion: SGO_V02_AUTHORIZATION_SCOPE_VERSION,
    objectId: "case-001",
    objectVersion: "commercial-case:case-001:v4",
    ownerActorId: "service:luzione-ui",
    permittedActorIds: Object.freeze([]),
    sourceRef: "authorization:commercial-cases/case-001@v4",
    surfaceId: CONTEXT_SURFACE,
    tenantId: "luzione",
    ...overrides,
  });
}

function actionScope(overrides: Partial<SgoV02ObjectScope> = {}) {
  return scope({ ownerActorId: "service:sultan-os", surfaceId: ACTION_SURFACE, ...overrides });
}

function evaluate(input: {
  actorAttestation?: unknown;
  cacheBinding?: unknown;
  cachedPayloadHash?: string;
  objectScope?: unknown;
  operation?: SgoV02Operation;
  requestedObjectId?: string;
  surfaceId?: string;
}) {
  const surfaceId = input.surfaceId ?? CONTEXT_SURFACE;
  return evaluateSgoV02Authorization({
    actorAttestation: Object.hasOwn(input, "actorAttestation")
      ? input.actorAttestation
      : attestation(surfaceId === ACTION_SURFACE ? "sultan" : "ui"),
    cacheBinding: input.cacheBinding,
    cachedPayloadHash: input.cachedPayloadHash,
    now: NOW,
    objectScope: Object.hasOwn(input, "objectScope")
      ? input.objectScope
      : surfaceId === ACTION_SURFACE ? actionScope() : scope(),
    operation: input.operation ?? "READ",
    requestedObjectId: input.requestedObjectId ?? "case-001",
    surfaceId,
  });
}

test("machine matrix pins credential boundaries, API proof rows and end-user integration holds", () => {
  const manifest = JSON.parse(readFileSync("engineering/execution/SGO_V02_AUTHORIZATION_MATRIX_V1.json", "utf8")) as unknown;
  assert.deepEqual(validateSgoV02AuthorizationManifest(manifest), {
    apiProofRows: 3, evidencePins: 13, integrationHolds: 3, surfaceKinds: 5,
  });
  assert.deepEqual(new Set(sgoV02AuthorizationMatrix.map((row) => row.surfaceKind)), new Set(sgoV02SurfaceKinds));
  assert.equal(sgoV02AuthorizationMatrix.filter((row) => row.actorBoundary === "VERCEL_WORKLOAD_SERVICE_ONLY").length, 3);
  assert.equal(sgoV02AuthorizationMatrix.filter((row) => row.actorBoundary === "END_USER_INTEGRATION_HOLD").length, 3);
  const widened = { ...(manifest as Record<string, unknown>), runtime_route: "/api/v1/private" };
  assert.throws(() => validateSgoV02AuthorizationManifest(widened), /Unexpected fields/);
  const pinDrift = structuredClone(manifest) as { evidence_pins: Array<Record<string, unknown>> };
  pinDrift.evidence_pins[0].blob_sha = "f".repeat(40);
  assert.throws(() => validateSgoV02AuthorizationManifest(pinDrift), /Invalid SGO-V02 evidence pins/);
});

test("only pinned signed workload credentials produce credited API actors", async () => {
  assert.deepEqual({
    actorId: attestation("ui").actor.actorId,
    actorType: attestation("ui").actor.actorType,
    source: attestation("ui").actor.source,
    tenantId: attestation("ui").actor.tenantId,
  }, { actorId: "service:luzione-ui", actorType: "service", source: "vercel-oidc", tenantId: "luzione" });
  assert.deepEqual({
    actorId: attestation("sultan").actor.actorId,
    actorType: attestation("sultan").actor.actorType,
    source: attestation("sultan").actor.source,
    tenantId: attestation("sultan").actor.tenantId,
  }, { actorId: "service:sultan-os", actorType: "service", source: "vercel-oidc", tenantId: "luzione" });
  assert.equal(await resolveSgoV02CredentialActor({
    bearerToken: signedWorkloadToken("luzione_ui", { project_id: "prj_fictional" }),
    loadJwks,
  }), null);
});

test("caller-constructed or copied actors cannot be credited as authenticated proof", () => {
  const fictionalActor = {
    actorId: "user_owner",
    actorType: "user",
    capabilities: ["sultan.canonical.readback.read"],
    source: "vercel-oidc",
    tenantId: "luzione",
  };
  assert.equal(evaluate({ actorAttestation: fictionalActor }).reasonCode, "INVALID_AUTHORIZATION_INPUT");
  assert.equal(evaluate({ actorAttestation: { ...attestation("ui") } }).reasonCode, "INVALID_AUTHORIZATION_INPUT");
});

test("credential-bound services can read context and resume or mutate only their bounded rows", () => {
  assert.equal(evaluate({ operation: "READ" }).decision, "ALLOW");
  for (const operation of ["READ", "RESUME", "MUTATE"] as const) {
    const result = evaluate({ operation, surfaceId: operation === "READ" ? CONTEXT_SURFACE : ACTION_SURFACE });
    assert.equal(result.releaseAllowed, true);
    assert.equal(result.effectAuthority, "NO_EFFECT");
    assert.equal(result.grantsAuthority, false);
  }
});

test("credential-bound actors cannot cross a server-resolved tenant for any operation", () => {
  const contextBinding = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const actionBinding = createSgoV02CacheBinding({ actorAttestation: attestation("sultan"), createdAt: NOW, expiresAt: EXPIRES, objectScope: actionScope(), payload, surfaceId: ACTION_SURFACE });
  const cases = [
    { actorAttestation: attestation("ui"), binding: contextBinding, objectScope: scope({ tenantId: "tenant-beta" }), operation: "READ" as const, surfaceId: CONTEXT_SURFACE },
    { actorAttestation: attestation("sultan"), binding: actionBinding, objectScope: actionScope({ tenantId: "tenant-beta" }), operation: "RESUME" as const, surfaceId: ACTION_SURFACE },
    { actorAttestation: attestation("sultan"), binding: actionBinding, objectScope: actionScope({ tenantId: "tenant-beta" }), operation: "MUTATE" as const, surfaceId: ACTION_SURFACE },
    { actorAttestation: attestation("ui"), binding: contextBinding, objectScope: scope({ tenantId: "tenant-beta" }), operation: "RECEIVE_CACHED_RESULT" as const, surfaceId: CONTEXT_SURFACE },
  ];
  for (const item of cases) {
    const result = evaluate({ actorAttestation: item.actorAttestation, cacheBinding: item.binding, cachedPayloadHash: sha256(payload), objectScope: item.objectScope, operation: item.operation, surfaceId: item.surfaceId });
    assert.equal(result.reasonCode, "TENANT_SCOPE_DENIED");
    assert.equal(result.releaseAllowed, false);
  }
});

test("the second real credential actor cannot cross object ownership for any operation", () => {
  const binding = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const cases = [
    { actorAttestation: attestation("sultan"), objectScope: scope(), operation: "READ" as const, surfaceId: CONTEXT_SURFACE },
    { actorAttestation: attestation("ui"), objectScope: actionScope(), operation: "RESUME" as const, surfaceId: ACTION_SURFACE },
    { actorAttestation: attestation("ui"), objectScope: actionScope(), operation: "MUTATE" as const, surfaceId: ACTION_SURFACE },
    { actorAttestation: attestation("sultan"), cacheBinding: binding, cachedPayloadHash: sha256(payload), objectScope: scope(), operation: "RECEIVE_CACHED_RESULT" as const, surfaceId: CONTEXT_SURFACE },
  ];
  for (const item of cases) {
    const result = evaluate(item);
    assert.equal(result.reasonCode, "ACTOR_SCOPE_DENIED");
    assert.equal(result.releaseAllowed, false);
  }
});

test("object, surface, capability and operation mismatches fail closed", () => {
  assert.equal(evaluate({ requestedObjectId: "case-elsewhere" }).reasonCode, "OBJECT_SCOPE_DENIED");
  assert.equal(evaluate({ objectScope: scope({ surfaceId: "api.context.stage5-canonical-readback.v1" }) }).reasonCode, "OBJECT_SCOPE_DENIED");
  assert.equal(evaluate({ actorAttestation: attestation("ui"), objectScope: scope({ ownerActorId: "service:luzione-ui", surfaceId: ACTION_SURFACE }), operation: "MUTATE", surfaceId: ACTION_SURFACE }).reasonCode, "CAPABILITY_DENIED");
  assert.equal(evaluate({ operation: "MUTATE", surfaceId: CONTEXT_SURFACE }).reasonCode, "OPERATION_NOT_SUPPORTED");
  assert.equal(evaluate({ surfaceId: "api.unknown.private-surface" }).reasonCode, "UNKNOWN_SURFACE");
});

test("exact credential-actor cache release succeeds without changing effect authority", () => {
  const binding = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const release = releaseSgoV02CachedResult({ actorAttestation: attestation("ui"), cacheBinding: binding, cachedResult: payload, now: NOW, objectScope: scope(), requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE });
  assert.equal(release.decision.decision, "ALLOW");
  assert.equal(release.decision.effectAuthority, "NO_EFFECT");
  assert.deepEqual(release.result, payload);
});

test("another permitted credential actor still cannot receive the first actor cache entry", () => {
  const sharedScope = scope({ permittedActorIds: ["service:sultan-os"] });
  const binding = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: sharedScope, payload, surfaceId: CONTEXT_SURFACE });
  const release = releaseSgoV02CachedResult({ actorAttestation: attestation("sultan"), cacheBinding: binding, cachedResult: payload, now: NOW, objectScope: sharedScope, requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE });
  assert.equal(release.decision.reasonCode, "CACHE_BINDING_MISMATCH");
  assert.equal(release.result, null);
});

test("cache binding rejects actor, tenant, surface, object, version, source, authorization and payload drift", () => {
  const binding = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const mutations: Array<{ actorAttestation?: SgoV02CredentialActorAttestation; cachedResult?: unknown; objectScope?: SgoV02ObjectScope; surfaceId?: string }> = [
    { actorAttestation: attestation("sultan"), objectScope: scope({ permittedActorIds: ["service:sultan-os"] }) },
    { objectScope: scope({ tenantId: "tenant-beta" }) },
    { objectScope: scope({ surfaceId: "api.context.stage5-canonical-readback.v1" }), surfaceId: "api.context.stage5-canonical-readback.v1" },
    { objectScope: scope({ objectId: "case-002" }) },
    { objectScope: scope({ objectVersion: "commercial-case:case-001:v5" }) },
    { objectScope: scope({ sourceRef: "authorization:commercial-cases/case-001@shadow-v4" }) },
    { objectScope: scope({ authorizationVersion: "authz:case-001:v5" }) },
    { cachedResult: { ...payload, title: "tampered" } },
  ];
  for (const mutation of mutations) {
    const selectedScope = mutation.objectScope ?? scope();
    const release = releaseSgoV02CachedResult({ actorAttestation: mutation.actorAttestation ?? attestation("ui"), cacheBinding: binding, cachedResult: mutation.cachedResult ?? payload, now: NOW, objectScope: selectedScope, requestedObjectId: selectedScope.objectId, surfaceId: mutation.surfaceId ?? CONTEXT_SURFACE });
    assert.equal(release.decision.decision, "DENY");
    assert.equal(release.result, null);
  }
});

test("binding tampering, missing binding, expiry and future issue time deny release", () => {
  const binding = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  assert.equal(evaluate({ operation: "RECEIVE_CACHED_RESULT" }).reasonCode, "CACHE_BINDING_REQUIRED");
  assert.equal(evaluate({ cacheBinding: { ...binding, bindingHash: "f".repeat(64) }, cachedPayloadHash: sha256(payload), operation: "RECEIVE_CACHED_RESULT" }).reasonCode, "CACHE_BINDING_INVALID");
  assert.equal(evaluateSgoV02Authorization({ actorAttestation: attestation("ui"), cacheBinding: binding, cachedPayloadHash: sha256(payload), now: EXPIRES, objectScope: scope(), operation: "RECEIVE_CACHED_RESULT", requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE }).reasonCode, "CACHE_BINDING_EXPIRED");
  const future = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: "2026-09-11T19:31:00.000Z", expiresAt: "2026-09-11T19:34:00.000Z", objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  assert.equal(evaluate({ cacheBinding: future, cachedPayloadHash: sha256(payload), operation: "RECEIVE_CACHED_RESULT" }).reasonCode, "CACHE_BINDING_EXPIRED");
});

test("malformed scope/cache and cyclic payloads deny without throwing or disclosure", () => {
  assert.equal(evaluate({ objectScope: null }).reasonCode, "INVALID_AUTHORIZATION_INPUT");
  assert.equal(evaluate({ objectScope: { ...scope(), attackerAuthority: true } }).reasonCode, "INVALID_AUTHORIZATION_INPUT");
  assert.equal(evaluate({ cacheBinding: null, cachedPayloadHash: sha256(payload), operation: "RECEIVE_CACHED_RESULT" }).reasonCode, "CACHE_BINDING_INVALID");
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const binding = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const malformedRelease = releaseSgoV02CachedResult({ actorAttestation: attestation("ui"), cacheBinding: binding, cachedResult: cyclic, now: NOW, objectScope: scope(), requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE });
  assert.equal(malformedRelease.decision.reasonCode, "INVALID_AUTHORIZATION_INPUT");
  assert.equal(malformedRelease.result, null);
  assert.throws(() => createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload: cyclic, surfaceId: CONTEXT_SURFACE }), (error) => error instanceof SgoV02AuthorizationError && error.code === "INVALID_CACHE_INPUT");
});

test("end-user integration holds cannot be promoted by credentials, scope or cache-shaped payload", () => {
  for (const row of sgoV02AuthorizationMatrix.filter((item) => item.authorizationMode === "INTEGRATION_HOLD")) {
    for (const operation of ["READ", "RESUME", "MUTATE", "RECEIVE_CACHED_RESULT"] as const) {
      const result = evaluate({ cacheBinding: { contractVersion: SGO_V02_CACHE_BINDING_VERSION, authority: "ALLOW" }, cachedPayloadHash: sha256(payload), operation, surfaceId: row.surfaceId });
      assert.equal(result.decision, "INTEGRATION_HOLD");
      assert.equal(result.releaseAllowed, false);
    }
  }
});

test("cache creation, denial and expiry recovery remain credential-bound", () => {
  assert.throws(() => createSgoV02CacheBinding({ actorAttestation: attestation("sultan"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE }), (error) => error instanceof SgoV02AuthorizationError && error.code === "CACHE_BINDING_DENIED");
  assert.throws(() => createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: "2026-09-11T19:40:00.000Z", objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE }), (error) => error instanceof SgoV02AuthorizationError && error.code === "INVALID_CACHE_WINDOW");
  const oldBinding = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: NOW, expiresAt: EXPIRES, objectScope: scope(), payload, surfaceId: CONTEXT_SURFACE });
  const changedScope = scope({ authorizationVersion: "authz:case-001:v5", objectVersion: "commercial-case:case-001:v5" });
  const later = "2026-09-11T19:35:00.000Z";
  const denied = releaseSgoV02CachedResult({ actorAttestation: attestation("sultan"), cacheBinding: oldBinding, cachedResult: payload, now: later, objectScope: changedScope, requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE });
  assert.equal(denied.result, null);
  assert.doesNotMatch(JSON.stringify(denied), /Private commercial context/);
  const replacement = createSgoV02CacheBinding({ actorAttestation: attestation("ui"), createdAt: later, expiresAt: "2026-09-11T19:39:00.000Z", objectScope: changedScope, payload, surfaceId: CONTEXT_SURFACE });
  assert.deepEqual(releaseSgoV02CachedResult({ actorAttestation: attestation("ui"), cacheBinding: replacement, cachedResult: payload, now: later, objectScope: changedScope, requestedObjectId: "case-001", surfaceId: CONTEXT_SURFACE }).result, payload);
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
