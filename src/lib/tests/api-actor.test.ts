import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bindCredentialActor, verifyVercelWorkloadToken } from "@/lib/api/actor";

const ISSUER = "https://oidc.vercel.com/connor-spiegelmans-projects";
const AUDIENCE = "https://vercel.com/connor-spiegelmans-projects";
const SUBJECT = "owner:connor-spiegelmans-projects:project:luzione_ui:environment:production";
const KEY_ID = "test-vercel-key";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: KEY_ID,
  use: "sig",
} as crypto.JsonWebKey & { alg: string; kid: string; kty: "RSA"; use: string };

function signedToken(
  payloadOverrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({
    alg: "RS256",
    kid: KEY_ID,
    typ: "JWT",
    ...headerOverrides,
  })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    aud: AUDIENCE,
    environment: "production",
    exp: now + 600,
    iat: now - 5,
    iss: ISSUER,
    owner: "connor-spiegelmans-projects",
    owner_id: "team_ZB7I1yzyt3ywCXQtPCYn4kL9",
    project: "luzione_ui",
    project_id: "prj_WGbFwkzAYBij46rrVUqNPGEeWzCP",
    sub: SUBJECT,
    ...payloadOverrides,
  })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

const loadJwks = async () => [publicJwk];

test("accepts only the signed production identity of the Luzione UI project", async () => {
  assert.equal(await verifyVercelWorkloadToken(signedToken(), loadJwks), true);
  assert.equal(await verifyVercelWorkloadToken(
    signedToken({ project_id: "prj_wrong" }),
    loadJwks,
  ), false);
  assert.equal(await verifyVercelWorkloadToken(
    signedToken({ environment: "preview" }),
    loadJwks,
  ), false);
  assert.equal(await verifyVercelWorkloadToken(
    signedToken({ aud: "https://attacker.example" }),
    loadJwks,
  ), false);
});

test("rejects expired, algorithm-confused, unknown-key and tampered tokens", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifyVercelWorkloadToken(
    signedToken({ exp: now - 120 }),
    loadJwks,
  ), false);
  assert.equal(await verifyVercelWorkloadToken(
    signedToken({}, { alg: "HS256" }),
    loadJwks,
  ), false);
  assert.equal(await verifyVercelWorkloadToken(
    signedToken({}, { kid: "unknown" }),
    loadJwks,
  ), false);
  const token = signedToken();
  const [header, payload, signature] = token.split(".");
  const tamperedSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  assert.equal(await verifyVercelWorkloadToken(
    `${header}.${payload}.${tamperedSignature}`,
    loadJwks,
  ), false);
});

test("all protected API routes await the asynchronous workload identity boundary", () => {
  for (const path of [
    "src/app/api/v1/catalog/shopify/projections/route.ts",
    "src/app/api/v1/commands/commercial-cases/route.ts",
    "src/app/api/v1/commands/leads/route.ts",
    "src/app/api/v1/commands/proposal-reviews/route.ts",
    "src/app/api/v1/commands/quote-approvals/route.ts",
    "src/app/api/v1/commands/quotes/route.ts",
    "src/app/api/v1/commands/orders/route.ts",
    "src/app/api/v1/commands/fulfillment-intents/route.ts",
    "src/app/api/v1/platform-guarantees/route.ts",
    "src/app/api/v1/security/rls-readiness/route.ts",
  ]) {
    assert.match(readFileSync(path, "utf8"), /await requireServiceActor\(request\.headers, "[a-z._]+"\)/);
  }
  const actor = readFileSync("src/lib/api/actor.ts", "utf8");
  assert.match(actor, /projectId: "prj_WGbFwkzAYBij46rrVUqNPGEeWzCP"/);
  assert.match(actor, /bindCredentialActor\(headers, source, identity, requiredCapability\)/);
  assert.match(actor, /crypto\.verify/);
  assert.match(actor, /AbortSignal\.timeout\(JWKS_TIMEOUT_MS\)/);
});

test("credential identity is server-bound and matching legacy headers cannot select it", () => {
  const identity = {
    actorId: "service:luzione-ui",
    actorType: "service" as const,
    capabilities: ["catalog.projection.read"],
    tenantId: "luzione",
  };
  const actor = bindCredentialActor(new Headers({
    "x-luzione-actor": identity.actorId,
    "x-luzione-actor-type": identity.actorType,
    "x-luzione-tenant": identity.tenantId,
  }), "vercel-oidc", identity, "catalog.projection.read");
  assert.deepEqual(actor, {
    ...identity,
    capabilities: ["catalog.projection.read"],
    source: "vercel-oidc",
  });
});

test("credential identity denies cross-tenant assertions and missing capabilities", () => {
  const identity = {
    actorId: "service:luzione-ui",
    actorType: "service" as const,
    capabilities: ["catalog.projection.read"],
    tenantId: "luzione",
  };
  assert.throws(
    () => bindCredentialActor(
      new Headers({ "x-luzione-tenant": "another-tenant" }),
      "vercel-oidc",
      identity,
      "catalog.projection.read",
    ),
    /do not match the authenticated credential/,
  );
  assert.throws(
    () => bindCredentialActor(new Headers(), "vercel-oidc", identity, "catalog.projection.ingest"),
    /lacks the required capability/,
  );
});

test("governance evaluation never manufactures a canonical authority grant", () => {
  const route = readFileSync("src/app/api/v1/governance/evaluate/route.ts", "utf8");
  assert.doesNotMatch(route, /verification:\s*"CANONICAL_STORE"/);
  assert.doesNotMatch(route, /crypto\.randomUUID/);
  assert.match(route, /evaluateAutonomyPlan\(plan/);
});
