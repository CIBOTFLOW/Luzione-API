export const RLS_READBACK_FAILURE_CODES = Object.freeze({
  authenticationFailed: "DATABASE_AUTHENTICATION_FAILED",
  authorizationFailed: "DATABASE_AUTHORIZATION_FAILED",
  catalogReadFailed: "CATALOG_READ_FAILED",
  connectionRefused: "DATABASE_CONNECTION_REFUSED",
  connectionTimeout: "DATABASE_CONNECTION_TIMEOUT",
  dnsUnavailable: "DATABASE_DNS_UNAVAILABLE",
  poolerTenantOrUserMissing: "POOLER_TENANT_OR_USER_NOT_FOUND",
  tlsFailed: "DATABASE_TLS_FAILED",
} as const);

export type RlsReadbackFailureCode =
  typeof RLS_READBACK_FAILURE_CODES[keyof typeof RLS_READBACK_FAILURE_CODES];

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

function errorParts(error: unknown) {
  if (!error || typeof error !== "object") return { message: "", providerCode: null };
  const candidate = error as ErrorLike;
  const rawProviderCode = typeof candidate.code === "string" ? candidate.code : "";
  return {
    message: typeof candidate.message === "string" ? candidate.message : "",
    providerCode: /^[A-Z0-9_-]{2,32}$/i.test(rawProviderCode) ? rawProviderCode : null,
  };
}

export function classifyRlsReadbackError(error: unknown): {
  failureCode: RlsReadbackFailureCode;
  providerCode: string | null;
} {
  const { message, providerCode } = errorParts(error);
  const normalizedCode = providerCode?.toUpperCase();

  if (/tenant or user not found/i.test(message)) {
    return {
      failureCode: RLS_READBACK_FAILURE_CODES.poolerTenantOrUserMissing,
      providerCode,
    };
  }
  if (normalizedCode === "28P01" || /password authentication failed|authentication error/i.test(message)) {
    return { failureCode: RLS_READBACK_FAILURE_CODES.authenticationFailed, providerCode };
  }
  if (normalizedCode === "42501" || /permission denied/i.test(message)) {
    return { failureCode: RLS_READBACK_FAILURE_CODES.authorizationFailed, providerCode };
  }
  if (normalizedCode === "ENOTFOUND" || normalizedCode === "EAI_AGAIN") {
    return { failureCode: RLS_READBACK_FAILURE_CODES.dnsUnavailable, providerCode };
  }
  if (normalizedCode === "ECONNREFUSED") {
    return { failureCode: RLS_READBACK_FAILURE_CODES.connectionRefused, providerCode };
  }
  if (normalizedCode === "ETIMEDOUT" || /timeout|timed out/i.test(message)) {
    return { failureCode: RLS_READBACK_FAILURE_CODES.connectionTimeout, providerCode };
  }
  if (/ssl|tls|certificate/i.test(message)) {
    return { failureCode: RLS_READBACK_FAILURE_CODES.tlsFailed, providerCode };
  }
  return { failureCode: RLS_READBACK_FAILURE_CODES.catalogReadFailed, providerCode };
}

export function logRlsReadbackFailure(input: {
  error: unknown;
  requestId: string;
  route: string;
}) {
  const failure = classifyRlsReadbackError(input.error);
  console.error(JSON.stringify({
    level: "error",
    event: "rls_readback_failed",
    route: input.route,
    requestId: input.requestId,
    ...failure,
  }));
  return failure;
}
