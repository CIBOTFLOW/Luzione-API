import crypto from "node:crypto";

export type ApiActor = {
  actorId: string;
  actorType: "agent" | "service" | "user";
  capabilities: readonly string[];
  source: "service-token" | "vercel-oidc";
  tenantId: string;
};

export const AUTHORITY_SUBJECT_CONTRACT_VERSION = "luzione-authority-subject/v0.1";

export type CredentialActorIdentity = {
  actorId: string;
  actorType: ApiActor["actorType"];
  capabilities: readonly string[];
  tenantId: string;
};

type JsonObject = Record<string, unknown>;

type VercelJwk = crypto.JsonWebKey & {
  alg?: string;
  kid: string;
  kty: "RSA";
  use?: string;
};

type JwksLoader = (issuer: string, forceRefresh?: boolean) => Promise<readonly VercelJwk[]>;

const VERCEL_CALLER = Object.freeze({
  actorId: "service:luzione-ui",
  actorType: "service" as const,
  audience: "https://vercel.com/connor-spiegelmans-projects",
  environment: "production",
  owner: "connor-spiegelmans-projects",
  ownerId: "team_ZB7I1yzyt3ywCXQtPCYn4kL9",
  project: "luzione_ui",
  projectId: "prj_WGbFwkzAYBij46rrVUqNPGEeWzCP",
  tenantId: "luzione",
  capabilities: Object.freeze([
    "catalog.projection.read",
    "governance.constitution.read",
    "governance.evaluate",
    "license.entitlement.read",
    "platform.guarantees.read",
    "security.rls.read",
  ]),
});

const ALLOWED_VERCEL_ISSUERS = new Set([
  "https://oidc.vercel.com",
  `https://oidc.vercel.com/${VERCEL_CALLER.owner}`,
]);
const CLOCK_SKEW_SECONDS = 30;
const JWKS_CACHE_MS = 5 * 60 * 1000;
const JWKS_FORCED_REFRESH_COOLDOWN_MS = 30_000;
const JWKS_MAX_BYTES = 256 * 1024;
const JWKS_TIMEOUT_MS = 4_000;
const jwksCache = new Map<string, {
  expiresAt: number;
  fetchedAt: number;
  keys: readonly VercelJwk[];
}>();

function safeEqual(received: string, expected: string) {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && crypto.timingSafeEqual(receivedBytes, expectedBytes);
}

function jsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeJwtPart(value: string): JsonObject | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16_384) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return jsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validJwk(value: unknown): value is VercelJwk {
  if (!jsonObject(value)) return false;
  return value.kty === "RSA"
    && typeof value.kid === "string"
    && value.kid.length > 0
    && value.kid.length <= 256
    && typeof value.n === "string"
    && value.n.length <= 2_048
    && typeof value.e === "string"
    && value.e.length <= 32;
}

async function loadVercelJwks(issuer: string, forceRefresh = false): Promise<readonly VercelJwk[]> {
  const cached = jwksCache.get(issuer);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;
  if (forceRefresh && cached && cached.fetchedAt > Date.now() - JWKS_FORCED_REFRESH_COOLDOWN_MS) {
    return cached.keys;
  }

  const response = await fetch(`${issuer}/.well-known/jwks`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Vercel workload identity verification failed.");
  const rawBody = await response.text();
  if (Buffer.byteLength(rawBody, "utf8") > JWKS_MAX_BYTES) {
    throw new Error("Vercel workload identity verification failed.");
  }
  const body: unknown = JSON.parse(rawBody);
  const keys = jsonObject(body) && Array.isArray(body.keys)
    ? body.keys.filter(validJwk).slice(0, 20)
    : [];
  if (keys.length === 0) throw new Error("Vercel workload identity verification failed.");
  const immutableKeys = Object.freeze(keys.map((key) => Object.freeze({ ...key })));
  const fetchedAt = Date.now();
  jwksCache.set(issuer, {
    expiresAt: fetchedAt + JWKS_CACHE_MS,
    fetchedAt,
    keys: immutableKeys,
  });
  return immutableKeys;
}

function claimEquals(payload: JsonObject, name: string, expected: string) {
  return typeof payload[name] === "string" && payload[name] === expected;
}

function validAudience(value: unknown) {
  if (typeof value === "string") return value === VERCEL_CALLER.audience;
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string")
    && value.includes(VERCEL_CALLER.audience);
}

function validLifetime(payload: JsonObject) {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return false;
  if (payload.exp < now - CLOCK_SKEW_SECONDS) return false;
  if (payload.nbf !== undefined
    && (typeof payload.nbf !== "number" || payload.nbf > now + CLOCK_SKEW_SECONDS)) return false;
  if (typeof payload.iat !== "number"
    || !Number.isFinite(payload.iat)
    || payload.iat > now + CLOCK_SKEW_SECONDS
    || payload.exp <= payload.iat) return false;
  return true;
}

function validVercelClaims(payload: JsonObject, issuer: string) {
  const subject = `owner:${VERCEL_CALLER.owner}:project:${VERCEL_CALLER.project}:environment:${VERCEL_CALLER.environment}`;
  return claimEquals(payload, "iss", issuer)
    && validAudience(payload.aud)
    && claimEquals(payload, "sub", subject)
    && claimEquals(payload, "owner", VERCEL_CALLER.owner)
    && claimEquals(payload, "owner_id", VERCEL_CALLER.ownerId)
    && claimEquals(payload, "project", VERCEL_CALLER.project)
    && claimEquals(payload, "project_id", VERCEL_CALLER.projectId)
    && claimEquals(payload, "environment", VERCEL_CALLER.environment)
    && validLifetime(payload);
}

export async function verifyVercelWorkloadToken(
  token: string,
  loadJwks: JwksLoader = loadVercelJwks,
) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return false;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);
  if (!header || !payload) return false;
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 256) return false;
  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  if (!ALLOWED_VERCEL_ISSUERS.has(issuer) || !validVercelClaims(payload, issuer)) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature) || encodedSignature.length > 4_096) return false;

  try {
    let keys = await loadJwks(issuer, false);
    let key = keys.find((candidate) => candidate.kid === header.kid);
    if (!key) {
      keys = await loadJwks(issuer, true);
      key = keys.find((candidate) => candidate.kid === header.kid);
    }
    if (!key || (key.alg && key.alg !== "RS256") || (key.use && key.use !== "sig")) return false;
    const publicKey = crypto.createPublicKey({ format: "jwk", key });
    return crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    return false;
  }
}

function boundedIdentityValue(value: string, field: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,255}$/.test(normalized)) {
    throw new Error(`${field} is not a valid canonical identity value.`);
  }
  return normalized;
}

function serviceTokenIdentity(): CredentialActorIdentity {
  const actorType = process.env.LUZIONE_API_SERVICE_ACTOR_TYPE?.trim();
  if (actorType !== "agent" && actorType !== "service" && actorType !== "user") {
    throw new Error("Service credential actor identity is not configured.");
  }
  const capabilities = (process.env.LUZIONE_API_SERVICE_CAPABILITIES ?? "")
    .split(",")
    .map((capability) => capability.trim())
    .filter(Boolean);
  return {
    actorId: boundedIdentityValue(process.env.LUZIONE_API_SERVICE_ACTOR_ID ?? "", "actorId"),
    actorType,
    capabilities,
    tenantId: boundedIdentityValue(process.env.LUZIONE_API_SERVICE_TENANT_ID ?? "", "tenantId"),
  };
}

/**
 * Binds actor, tenant and capabilities from the verified credential adapter.
 * Legacy headers are assertions only: they may match, but can never select or
 * broaden the canonical subject associated with the credential.
 */
export function bindCredentialActor(
  headers: Headers,
  source: ApiActor["source"],
  identity: CredentialActorIdentity,
  requiredCapability?: string,
): ApiActor {
  const actorId = boundedIdentityValue(identity.actorId, "actorId");
  const tenantId = boundedIdentityValue(identity.tenantId, "tenantId");
  const capabilities = Object.freeze([...new Set(identity.capabilities.map((value) =>
    boundedIdentityValue(value, "capability")))].sort());
  const assertedTenant = headers.get("x-luzione-tenant")?.trim();
  const assertedActor = headers.get("x-luzione-actor")?.trim();
  const assertedActorType = headers.get("x-luzione-actor-type")?.trim();
  if ((assertedTenant && assertedTenant !== tenantId)
    || (assertedActor && assertedActor !== actorId)
    || (assertedActorType && assertedActorType !== identity.actorType)) {
    throw new Error("Caller identity assertions do not match the authenticated credential.");
  }
  if (requiredCapability && !capabilities.includes(requiredCapability)) {
    throw new Error("Authenticated actor lacks the required capability.");
  }
  return { actorId, actorType: identity.actorType, capabilities, source, tenantId };
}

export async function requireServiceActor(
  headers: Headers,
  requiredCapability?: string,
): Promise<ApiActor> {
  const configured = process.env.LUZIONE_API_SERVICE_TOKEN?.trim();
  const authorization = headers.get("authorization") ?? "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  let source: ApiActor["source"] | null = null;
  if (configured && received && safeEqual(received, configured)) {
    source = "service-token";
  } else if (received && await verifyVercelWorkloadToken(received)) {
    source = "vercel-oidc";
  }
  if (!source) {
    if (!configured && process.env.LUZIONE_API_VERCEL_OIDC_ENABLED === "false") {
      throw new Error("Service authentication is not configured.");
    }
    throw new Error("Service authentication failed.");
  }

  const identity = source === "vercel-oidc" ? VERCEL_CALLER : serviceTokenIdentity();
  return bindCredentialActor(headers, source, identity, requiredCapability);
}
