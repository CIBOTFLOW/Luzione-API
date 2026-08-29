import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { requireServiceActor, verifyVercelWorkloadToken } from "@/lib/api/actor";

const ISSUER = "https://oidc.vercel.com/connor-spiegelmans-projects";
const AUDIENCE = "https://vercel.com/connor-spiegelmans-projects";
const SUBJECT = "owner:connor-spiegelmans-projects:project:luzione_ui:environment:production";
const SULTAN_SUBJECT = "owner:connor-spiegelmans-projects:project:sultan-os:environment:production";
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

test("accepts the signed production identity of the Luzione UI project", async () => {
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

test("accepts the signed Sultan production workload but no preview or unknown project", async () => {
  assert.equal(await verifyVercelWorkloadToken(signedToken({
    project: "sultan-os",
    project_id: "prj_5nTisld8OnGiBhIxegGbUpWrZNp0",
    sub: SULTAN_SUBJECT,
  }), loadJwks), true);
  assert.equal(await verifyVercelWorkloadToken(signedToken({
    environment: "preview",
    project: "sultan-os",
    project_id: "prj_5nTisld8OnGiBhIxegGbUpWrZNp0",
    sub: "owner:connor-spiegelmans-projects:project:sultan-os:environment:preview",
  }), loadJwks), false);
  assert.equal(await verifyVercelWorkloadToken(signedToken({
    project: "unknown",
    project_id: "prj_unknown",
    sub: "owner:connor-spiegelmans-projects:project:unknown:environment:production",
  }), loadJwks), false);
});

test("binds the Sultan workload to its canonical agent and Luzione tenant", async () => {
  const previous = process.env.LUZIONE_API_SERVICE_TOKEN;
  delete process.env.LUZIONE_API_SERVICE_TOKEN;
  const sultanCaller = {
    actor: { actorId: "agent:sultan-os", actorType: "agent" as const },
    audience: AUDIENCE,
    environment: "production" as const,
    owner: "connor-spiegelmans-projects",
    ownerId: "team_ZB7I1yzyt3ywCXQtPCYn4kL9",
    project: "sultan-os",
    projectId: "prj_5nTisld8OnGiBhIxegGbUpWrZNp0",
    tenantId: "luzione",
  };
  const headers = new Headers({
    authorization: "Bearer signed-sultan-token",
    "x-luzione-actor": "agent:sultan-os",
    "x-luzione-actor-type": "agent",
    "x-luzione-tenant": "luzione",
  });
  try {
    assert.deepEqual(await requireServiceActor(headers, async () => sultanCaller), {
      actorId: "agent:sultan-os",
      actorType: "agent",
      source: "vercel-oidc",
      tenantId: "luzione",
    });
    const impersonated = new Headers(headers);
    impersonated.set("x-luzione-actor", "user:someone-else");
    await assert.rejects(
      requireServiceActor(impersonated, async () => sultanCaller),
      /workload actor is not authorized/i,
    );
    const crossTenant = new Headers(headers);
    crossTenant.set("x-luzione-tenant", "bravi");
    await assert.rejects(
      requireServiceActor(crossTenant, async () => sultanCaller),
      /workload tenant is not authorized/i,
    );
  } finally {
    if (previous === undefined) delete process.env.LUZIONE_API_SERVICE_TOKEN;
    else process.env.LUZIONE_API_SERVICE_TOKEN = previous;
  }
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
    "src/app/api/v1/platform-guarantees/route.ts",
    "src/app/api/v1/security/rls-readiness/route.ts",
  ]) {
    assert.match(readFileSync(path, "utf8"), /await requireServiceActor\(request\.headers\)/);
  }
  const actor = readFileSync("src/lib/api/actor.ts", "utf8");
  assert.match(actor, /projectId: "prj_WGbFwkzAYBij46rrVUqNPGEeWzCP"/);
  assert.match(actor, /projectId: "prj_5nTisld8OnGiBhIxegGbUpWrZNp0"/);
  assert.match(actor, /actorId: "agent:sultan-os"/);
  assert.match(actor, /tenantId !== vercelCaller\.tenantId/);
  assert.match(actor, /crypto\.verify/);
  assert.match(actor, /AbortSignal\.timeout\(JWKS_TIMEOUT_MS\)/);
});
