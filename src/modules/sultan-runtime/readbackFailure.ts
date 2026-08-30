import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { emitTelemetryLog } from "@/modules/platform-telemetry/telemetry";

export const SULTAN_RUNTIME_READBACK_FAILURE_CODES = Object.freeze({
  authenticationFailed: "SULTAN_RUNTIME_DATABASE_AUTHENTICATION_FAILED",
  connectionExhausted: "SULTAN_RUNTIME_DATABASE_CONNECTION_EXHAUSTED",
  permissionDenied: "SULTAN_RUNTIME_DATABASE_PERMISSION_DENIED",
  queryCancelled: "SULTAN_RUNTIME_DATABASE_QUERY_CANCELLED",
  relationMissing: "SULTAN_RUNTIME_DATABASE_RELATION_MISSING",
  schemaMismatch: "SULTAN_RUNTIME_DATABASE_SCHEMA_MISMATCH",
  unavailable: "SULTAN_RUNTIME_READBACK_FAILED",
});

function providerCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}

export function classifySultanRuntimeReadbackError(error: unknown) {
  const code = providerCode(error);
  const failureCode = code === "42P01"
    ? SULTAN_RUNTIME_READBACK_FAILURE_CODES.relationMissing
    : code === "42703" || code === "42883"
      ? SULTAN_RUNTIME_READBACK_FAILURE_CODES.schemaMismatch
      : code === "42501"
        ? SULTAN_RUNTIME_READBACK_FAILURE_CODES.permissionDenied
        : code === "57014"
          ? SULTAN_RUNTIME_READBACK_FAILURE_CODES.queryCancelled
          : code === "53300"
            ? SULTAN_RUNTIME_READBACK_FAILURE_CODES.connectionExhausted
            : code === "28P01"
              ? SULTAN_RUNTIME_READBACK_FAILURE_CODES.authenticationFailed
              : SULTAN_RUNTIME_READBACK_FAILURE_CODES.unavailable;
  return { failureCode, providerCode: code };
}

export function logSultanRuntimeReadbackFailure(input: {
  error: unknown;
  requestIdentity: RequestIdentityEnvelope;
  route: string;
}) {
  const classified = classifySultanRuntimeReadbackError(input.error);
  emitTelemetryLog({
    attributes: {
      "failure.code": classified.failureCode,
      "http.route": input.route,
      "provider.code": classified.providerCode,
    },
    body: "Sultan aggregate readback failed safely.",
    eventName: "sultan.runtime.readback.failed",
    identity: input.requestIdentity,
    severity: "ERROR",
  });
  return classified;
}
