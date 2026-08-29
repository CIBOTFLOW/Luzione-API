import crypto from "node:crypto";

export const REQUEST_IDENTITY_CONTRACT_VERSION = "luzione-request-identity/v1";

const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const TRACEPARENT = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/;

export type RequestIdentityEnvelope = {
  actorId: string | null;
  actorType: "agent" | "service" | "user" | null;
  authorityClass: string | null;
  capability: string | null;
  contractVersion: typeof REQUEST_IDENTITY_CONTRACT_VERSION;
  correlationId: string;
  idempotencyKey: string | null;
  purpose: string | null;
  requestId: string;
  requestedAt: string;
  sourceVersionRefs: readonly string[];
  spanId: string;
  tenantId: string | null;
  traceFlags: string;
  traceId: string;
};

type Actor = {
  actorId: string;
  actorType: "agent" | "service" | "user";
  tenantId: string;
};

function externalId(value: string | null) {
  const normalized = value?.trim() ?? "";
  return EXTERNAL_ID.test(normalized) ? normalized : null;
}

export function createRequestIdentity(
  headers: Headers,
  options: { now?: string; randomBytes?: (size: number) => Buffer; randomUUID?: () => string } = {},
): RequestIdentityEnvelope {
  const randomUUID = options.randomUUID ?? crypto.randomUUID;
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  const incomingTrace = TRACEPARENT.exec((headers.get("traceparent") ?? "").trim().toLowerCase());
  const incomingTraceId = incomingTrace?.[1];
  const traceId = incomingTraceId && !/^0+$/.test(incomingTraceId)
    ? incomingTraceId
    : randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const requestId = externalId(headers.get("x-request-id")) ?? randomUUID();
  const correlationId = externalId(headers.get("x-correlation-id")) ?? requestId;
  const requestedAt = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(requestedAt))) throw new Error("requestedAt must be an ISO timestamp.");
  return {
    actorId: null,
    actorType: null,
    authorityClass: null,
    capability: null,
    contractVersion: REQUEST_IDENTITY_CONTRACT_VERSION,
    correlationId,
    idempotencyKey: null,
    purpose: null,
    requestId,
    requestedAt: new Date(requestedAt).toISOString(),
    sourceVersionRefs: [],
    spanId,
    tenantId: null,
    traceFlags: incomingTrace?.[3] ?? "01",
    traceId,
  };
}

function requiredServerValue(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new Error(`${field} is required and must be bounded.`);
  return normalized;
}

export function bindAuthenticatedRequestIdentity(
  identity: RequestIdentityEnvelope,
  actor: Actor,
  context: {
    authorityClass: string;
    capability: string;
    idempotencyKey?: string | null;
    purpose: string;
    sourceVersionRefs?: readonly string[];
  },
): RequestIdentityEnvelope {
  if (identity.actorId || identity.actorType || identity.tenantId) {
    throw new Error("Request identity actor context is already bound.");
  }
  return {
    ...identity,
    actorId: requiredServerValue(actor.actorId, "actorId"),
    actorType: actor.actorType,
    authorityClass: requiredServerValue(context.authorityClass, "authorityClass"),
    capability: requiredServerValue(context.capability, "capability"),
    idempotencyKey: context.idempotencyKey
      ? requiredServerValue(context.idempotencyKey, "idempotencyKey")
      : null,
    purpose: requiredServerValue(context.purpose, "purpose"),
    sourceVersionRefs: [...new Set(context.sourceVersionRefs ?? [])].sort(),
    tenantId: requiredServerValue(actor.tenantId, "tenantId"),
  };
}

export function traceparent(identity: RequestIdentityEnvelope) {
  return `00-${identity.traceId}-${identity.spanId}-${identity.traceFlags}`;
}
