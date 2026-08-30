import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";

export const PLATFORM_TELEMETRY_CONTRACT_VERSION = "luzione-telemetry/v1";

export const telemetryMetricRegistry = Object.freeze([
  { instrument: "COUNTER", name: "luzione.api.server.request.count", unit: "{request}" },
  { instrument: "HISTOGRAM", name: "luzione.api.server.request.duration", unit: "ms" },
  { instrument: "COUNTER", name: "luzione.api.server.error.count", unit: "{error}" },
  { instrument: "COUNTER", name: "luzione.platform.retry.count", unit: "{attempt}" },
  { instrument: "COUNTER", name: "luzione.platform.reconciliation.count", unit: "{operation}" },
  { instrument: "UP_DOWN_COUNTER", name: "luzione.platform.queue.backlog", unit: "{item}" },
  { instrument: "GAUGE", name: "luzione.database.pool.utilization", unit: "1" },
] as const);

export const telemetryAttributeLaw = Object.freeze({
  allowedMetricDimensions: [
    "deployment.environment", "failure.class", "failure.domain", "http.request.method",
    "http.response.status_code", "http.route", "reconciliation.state", "service.name",
  ],
  forbiddenMetricDimensions: [
    "actor.id", "correlation.id", "customer.id", "request.id", "tenant.id", "trace.id",
  ],
  telemetryIsBusinessTruth: false,
});

const SECRET_KEY = /authorization|cookie|credential|password|secret|session|token/i;
const CONTENT_KEY = /body|content|email|message_text|payload|phone|prompt|response_text/i;
const EVENT_NAME = /^[a-z][a-z0-9_.]{2,127}$/;

type JsonValue = boolean | number | string | null | JsonValue[] | { [key: string]: JsonValue };
type TelemetrySink = (record: Record<string, unknown>) => void;

function cleanString(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 256);
}

export function redactTelemetryAttributes(
  value: unknown,
  depth = 0,
): JsonValue {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[NON_FINITE]";
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactTelemetryAttributes(item, depth + 1));
  if (!value || typeof value !== "object") return `[UNSUPPORTED_${typeof value}]`;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, 50)
    .map(([key, child]) => [
      cleanString(key),
      SECRET_KEY.test(key) || CONTENT_KEY.test(key)
        ? "[REDACTED]"
        : redactTelemetryAttributes(child, depth + 1),
    ]));
}

export function telemetryResource() {
  return {
    "cloud.region": process.env.VERCEL_REGION ?? "local",
    "deployment.environment": process.env.VERCEL_ENV ?? process.env.APP_ENV ?? "local",
    "service.name": "luzione-api",
    "service.version": process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) ?? "local-unbound",
  };
}

export function createTelemetryLogRecord(input: {
  attributes?: Record<string, unknown>;
  body: string;
  eventName: string;
  identity?: RequestIdentityEnvelope | null;
  now?: string;
  severity: "DEBUG" | "ERROR" | "INFO" | "WARN";
}) {
  if (!EVENT_NAME.test(input.eventName)) throw new Error("eventName must use bounded dot notation.");
  const timestamp = new Date(input.now ?? new Date().toISOString());
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Telemetry timestamp must be valid.");
  return {
    ...telemetryResource(),
    attributes: redactTelemetryAttributes(input.attributes ?? {}),
    body: cleanString(input.body),
    event_name: input.eventName,
    observed_time_unix_nano: `${timestamp.getTime()}000000`,
    request_id: input.identity?.requestId ?? null,
    correlation_id: input.identity?.correlationId ?? null,
    severity_text: input.severity,
    span_id: input.identity?.spanId ?? null,
    tenant_ref: null,
    timestamp: timestamp.toISOString(),
    trace_id: input.identity?.traceId ?? null,
    telemetry_contract_version: PLATFORM_TELEMETRY_CONTRACT_VERSION,
  };
}

export function emitTelemetryLog(input: Parameters<typeof createTelemetryLogRecord>[0] & {
  sink?: TelemetrySink;
}) {
  const { sink, ...recordInput } = input;
  const record = createTelemetryLogRecord(recordInput);
  if (sink) {
    sink(record);
  } else {
    const target = input.severity === "ERROR" ? console.error : input.severity === "WARN" ? console.warn : console.info;
    target(JSON.stringify(record));
  }
  return record;
}

export function createHttpMetricObservations(input: {
  durationMs: number;
  method: string;
  route: string;
  status: number;
}) {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new Error("durationMs must be non-negative.");
  const attributes = {
    "http.request.method": input.method.toUpperCase().slice(0, 16),
    "http.response.status_code": input.status,
    "http.route": input.route.slice(0, 128),
    "service.name": "luzione-api",
  };
  return [
    { attributes, name: "luzione.api.server.request.count", unit: "{request}", value: 1 },
    { attributes, name: "luzione.api.server.request.duration", unit: "ms", value: input.durationMs },
    ...(input.status >= 500
      ? [{ attributes, name: "luzione.api.server.error.count", unit: "{error}", value: 1 }]
      : []),
  ];
}
