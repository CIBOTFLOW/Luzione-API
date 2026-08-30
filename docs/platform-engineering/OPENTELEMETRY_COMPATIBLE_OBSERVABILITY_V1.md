# OpenTelemetry-Compatible Observability V1

Project: `API_SE_008`  
Canonical source: `src/modules/platform-telemetry/telemetry.ts`  
Contract version: `luzione-telemetry/v1`

## Working contract

The telemetry layer extends the existing W3C request identity rather than creating another trace system. Structured records use stable service/deployment resource attributes, `trace_id`, `span_id`, request/correlation lineage, severity, event name and nanosecond-form timestamp strings. Tenant and actor identity are omitted.

Recursive redaction removes credentials, authorization/cookies, prompts, payload/body/content and common contact fields, bounds depth/cardinality/string length, and rejects invalid event names. Raw errors and business payloads do not enter the shared logger.

The metric registry covers HTTP count/duration/errors, retry, reconciliation, queue backlog and database pool utilization. HTTP observations use route templates, method, status and service name only. Request, trace, correlation, actor, customer and tenant identifiers are forbidden metric dimensions.

The logger now covers service bootstrap, governance request completion, P113 projection failures, RLS readback failures and Sultan aggregate readback failures. All API routes already propagate W3C trace lineage through `luzione-request-identity/v1`.

## Evidence boundary

Tests prove trace correlation, tenant/actor omission, recursive secret/content redaction, low-cardinality metrics, 5xx error observations and invalid-event rejection. No collector/exporter, dashboard, alert, retention backend, sampling control or production observation is configured. Telemetry is explicitly not business truth.

Strongest claim: `BOUNDED_PASS | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.
