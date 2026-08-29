export const PLATFORM_FAILURE_CONTRACT_VERSION = "luzione-platform-failure/v1";

export type FailureDomain =
  | "AUTH"
  | "CLIENT"
  | "DATA"
  | "DEPENDENCY"
  | "MODEL"
  | "PLATFORM"
  | "POLICY"
  | "TOOL"
  | "WORKFLOW";

export type FailureClass =
  | "CONFLICT"
  | "CORRUPT"
  | "DENIED"
  | "INDETERMINATE"
  | "INVALID"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "UNKNOWN";

export type FailureRetry = "BACKOFF" | "HUMAN" | "IMMEDIATE" | "NEVER" | "RECONCILE_FIRST";
export type FailureSeverity = "CRITICAL" | "DEGRADED" | "ERROR" | "INFO";

export type PlatformFailure = {
  class: FailureClass;
  code: string;
  contractVersion: typeof PLATFORM_FAILURE_CONTRACT_VERSION;
  domain: FailureDomain;
  retry: FailureRetry;
  safeMessage: string;
  severity: FailureSeverity;
};

function normalizedCode(value: unknown, status: number) {
  if (typeof value === "string" && /^[A-Z][A-Z0-9_]{2,127}$/.test(value)) return value;
  return `HTTP_${status}`;
}

function safeMessage(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "The request failed safely.";
  return value.trim().slice(0, 1_000);
}

export function platformFailureFromHttp(input: {
  code?: unknown;
  message?: unknown;
  status: number;
}): PlatformFailure {
  const code = normalizedCode(input.code, input.status);
  const message = safeMessage(input.message);

  if (/DISABLED|POLICY|AUTHORITY|APPROVAL|PROHIBITED|COMMAND_EXTRACTION_PENDING/.test(code)) {
    return { class: "DENIED", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "POLICY", retry: "HUMAN", safeMessage: message, severity: "ERROR" };
  }
  if (input.status === 401 || input.status === 403) {
    return { class: "DENIED", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "AUTH", retry: "NEVER", safeMessage: message, severity: "ERROR" };
  }
  if (input.status === 400 || input.status === 413 || input.status === 422) {
    return { class: "INVALID", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "CLIENT", retry: "NEVER", safeMessage: message, severity: "DEGRADED" };
  }
  if (input.status === 409) {
    return { class: "CONFLICT", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "DATA", retry: "RECONCILE_FIRST", safeMessage: message, severity: "ERROR" };
  }
  if (input.status === 429) {
    return { class: "RATE_LIMITED", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "DEPENDENCY", retry: "BACKOFF", safeMessage: message, severity: "DEGRADED" };
  }
  if (/TIMEOUT/.test(code) || input.status === 504) {
    return { class: "TIMEOUT", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "DEPENDENCY", retry: "BACKOFF", safeMessage: message, severity: "ERROR" };
  }
  if (/READ_UNAVAILABLE|READBACK|DATABASE|CONNECTION|UNAVAILABLE/.test(code) || input.status === 503) {
    return { class: "UNAVAILABLE", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "DEPENDENCY", retry: "BACKOFF", safeMessage: message, severity: "ERROR" };
  }
  if (input.status === 501) {
    return { class: "UNAVAILABLE", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "PLATFORM", retry: "HUMAN", safeMessage: message, severity: "DEGRADED" };
  }
  return { class: "UNKNOWN", code, contractVersion: PLATFORM_FAILURE_CONTRACT_VERSION, domain: "PLATFORM", retry: "HUMAN", safeMessage: message, severity: input.status >= 500 ? "ERROR" : "DEGRADED" };
}
