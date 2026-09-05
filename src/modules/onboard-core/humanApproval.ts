import crypto from "node:crypto";

import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { OnboardCoreContractError } from "./contracts";

export const HUMAN_APPROVAL_SUBJECT_VERSION = "LuzioneHumanApprovalSubject/v1";
export const HUMAN_APPROVAL_HEADER = "x-luzione-human-authorization";

export type HumanApprovalSubject = {
  actorId: string;
  actorType: "user";
  authenticationRef: string;
  authenticatedAt: string;
  capabilities: readonly string[];
  contractVersion: typeof HUMAN_APPROVAL_SUBJECT_VERSION;
  source: "supabase-user-jwt";
  tenantId: string;
};

type JsonObject = Record<string, unknown>;
export type HumanJwk = crypto.JsonWebKey & {
  alg?: "EdDSA" | "ES256" | "RS256";
  key_ops?: readonly string[];
  kid: string;
  kty: "EC" | "OKP" | "RSA";
  use?: string;
};
type JwksLoader = (issuer: string, forceRefresh?: boolean) => Promise<readonly HumanJwk[]>;

const ALGORITHMS = new Set(["EdDSA", "ES256", "RS256"]);
const CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_LIFETIME_SECONDS = 60 * 60;
const JWKS_CACHE_MS = 5 * 60 * 1_000;
const JWKS_TIMEOUT_MS = 4_000;
const JWKS_MAX_BYTES = 256 * 1_024;
const jwksCache = new Map<string, { expiresAt: number; keys: readonly HumanJwk[] }>();

function object(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodePart(value: string): JsonObject | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16_384) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return object(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validJwk(value: unknown): value is HumanJwk {
  if (!object(value) || typeof value.kid !== "string" || value.kid.length === 0 || value.kid.length > 256) return false;
  if (value.kty !== "RSA" && value.kty !== "EC" && value.kty !== "OKP") return false;
  if (value.alg !== undefined && !ALGORITHMS.has(String(value.alg))) return false;
  if (value.use !== undefined && value.use !== "sig") return false;
  return value.key_ops === undefined || (Array.isArray(value.key_ops) && value.key_ops.includes("verify"));
}

async function loadJwks(issuer: string, forceRefresh = false): Promise<readonly HumanJwk[]> {
  const cached = jwksCache.get(issuer);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(`${issuer}/.well-known/jwks.json`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Human identity key discovery failed.");
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > JWKS_MAX_BYTES) throw new Error("Human identity key discovery failed.");
  const parsed: unknown = JSON.parse(body);
  const keys = object(parsed) && Array.isArray(parsed.keys)
    ? Object.freeze(parsed.keys.filter(validJwk).slice(0, 20).map((key) => Object.freeze({ ...key })))
    : [];
  if (!keys.length) throw new Error("Human identity key discovery failed.");
  jwksCache.set(issuer, { expiresAt: Date.now() + JWKS_CACHE_MS, keys });
  return keys;
}

function audienceIncludes(value: unknown, expected: string) {
  return value === expected || (Array.isArray(value) && value.every((item) => typeof item === "string") && value.includes(expected));
}

function stableId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(value);
}

function verifySignature(alg: string, key: HumanJwk, signingInput: string, signature: string) {
  if (key.alg && key.alg !== alg) return false;
  const publicKey = crypto.createPublicKey({ format: "jwk", key });
  const algorithm = alg === "RS256" ? "RSA-SHA256" : alg === "ES256" ? "sha256" : null;
  const verifier = alg === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" as const } : publicKey;
  return crypto.verify(algorithm, Buffer.from(signingInput), verifier, Buffer.from(signature, "base64url"));
}

export async function verifySupabaseHumanApprovalToken(
  token: string,
  issuer: string,
  requiredCapability: string,
  loadKeys: JwksLoader = loadJwks,
): Promise<HumanApprovalSubject | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodePart(encodedHeader);
  const payload = decodePart(encodedPayload);
  if (!header || !payload || typeof header.alg !== "string" || !ALGORITHMS.has(header.alg)
    || typeof header.kid !== "string" || header.kid.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(encodedSignature) || encodedSignature.length > 4_096) return null;
  const now = Math.floor(Date.now() / 1_000);
  if (payload.iss !== issuer || !audienceIncludes(payload.aud, "authenticated") || payload.role !== "authenticated"
    || payload.is_anonymous !== false || typeof payload.exp !== "number" || typeof payload.iat !== "number"
    || payload.exp < now - CLOCK_SKEW_SECONDS || payload.iat > now + CLOCK_SKEW_SECONDS
    || payload.exp <= payload.iat || payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SECONDS
    || (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf > now + CLOCK_SKEW_SECONDS))
    || typeof payload.sub !== "string" || !/^[0-9a-f-]{36}$/.test(payload.sub)
    || typeof payload.session_id !== "string" || !/^[0-9a-f-]{36}$/.test(payload.session_id)
    || !object(payload.app_metadata)) return null;
  const tenantId = payload.app_metadata.luzione_tenant_id;
  const capabilities = payload.app_metadata.luzione_capabilities;
  if (!stableId(tenantId) || !Array.isArray(capabilities) || capabilities.length > 100
    || !capabilities.every(stableId) || !capabilities.includes(requiredCapability)) return null;
  try {
    let keys = await loadKeys(issuer, false);
    let key = keys.find((candidate) => candidate.kid === header.kid);
    if (!key) {
      keys = await loadKeys(issuer, true);
      key = keys.find((candidate) => candidate.kid === header.kid);
    }
    if (!key || !verifySignature(header.alg, key, `${encodedHeader}.${encodedPayload}`, encodedSignature)) return null;
  } catch {
    return null;
  }
  const actorId = `user_${sha256({ issuer, subject: payload.sub })}`;
  return Object.freeze({
    actorId,
    actorType: "user" as const,
    authenticationRef: `supabase-session:${sha256({ issuer, sessionId: payload.session_id, subject: payload.sub })}`,
    authenticatedAt: new Date(payload.iat * 1_000).toISOString(),
    capabilities: Object.freeze([...new Set(capabilities as string[])].sort()),
    contractVersion: HUMAN_APPROVAL_SUBJECT_VERSION,
    source: "supabase-user-jwt" as const,
    tenantId: tenantId as string,
  });
}

function configuredIssuer() {
  if (process.env.LUZIONE_API_HUMAN_APPROVALS_ENABLED !== "true") return null;
  const configured = process.env.SUPABASE_URL?.trim();
  try {
    const url = new URL(configured ?? "");
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return null;
    return `${url.origin}/auth/v1`;
  } catch {
    return null;
  }
}

export async function requireHumanApprovalSubject(headers: Headers, requiredCapability: string) {
  const issuer = configuredIssuer();
  if (!issuer) throw new OnboardCoreContractError("HUMAN_AUTHENTICATION_UNAVAILABLE", "Human approval verification remains default-off or unconfigured.", 503);
  const authorization = headers.get(HUMAN_APPROVAL_HEADER) ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new OnboardCoreContractError("HUMAN_AUTHENTICATION_REQUIRED", "A distinct signed human approval subject is required.", 401);
  const subject = await verifySupabaseHumanApprovalToken(token, issuer, requiredCapability);
  if (!subject) throw new OnboardCoreContractError("HUMAN_AUTHENTICATION_FAILED", "Human approval authentication failed closed.", 401);
  return subject;
}
