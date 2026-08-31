import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { apiResponse } from "../../../lib/api/http";
import {
  PLATFORM_FAILURE_CONTRACT_VERSION,
  platformFailureFromHttp,
} from "../failureContract";
import {
  bindAuthenticatedRequestIdentity,
  createRequestIdentity,
  REQUEST_IDENTITY_CONTRACT_VERSION,
} from "../requestIdentity";
import {
  deriveDesiredObservedState,
  RECONCILIATION_STATE_CONTRACT_VERSION,
} from "../stateContract";

const fixedRandomBytes = (size: number) => Buffer.alloc(size, size);
const fixedUuid = () => "11111111-1111-4111-8111-111111111111";

test("request identity propagates bounded caller IDs and W3C trace lineage", () => {
  const identity = createRequestIdentity(new Headers({
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    "x-correlation-id": "corr_checkout_20260829",
    "x-request-id": "req_checkout_20260829",
  }), {
    now: "2026-08-29T12:00:00.000Z",
    randomBytes: fixedRandomBytes,
    randomUUID: fixedUuid,
  });
  assert.equal(identity.contractVersion, REQUEST_IDENTITY_CONTRACT_VERSION);
  assert.equal(identity.requestId, "req_checkout_20260829");
  assert.equal(identity.correlationId, "corr_checkout_20260829");
  assert.equal(identity.traceId, "0123456789abcdef0123456789abcdef");
  assert.equal(identity.actorId, null);
  assert.equal(identity.purpose, null);
});

test("malformed caller IDs are replaced and authenticated context is server-bound", () => {
  const headers = new Headers({
    "x-actor-id": "caller-forged-actor",
    "x-capability": "caller-forged-capability",
    "x-purpose": "caller-forged-purpose",
    "x-request-id": "bad id",
  });
  const base = createRequestIdentity(headers, {
    now: "2026-08-29T12:00:00.000Z",
    randomBytes: fixedRandomBytes,
    randomUUID: fixedUuid,
  });
  assert.equal(base.requestId, "11111111-1111-4111-8111-111111111111");
  const bound = bindAuthenticatedRequestIdentity(base, {
    actorId: "svc_runtime",
    actorType: "service",
    tenantId: "tenant_luzione",
  }, {
    authorityClass: "READ_ONLY",
    capability: "catalog.read",
    purpose: "catalog-projection-read",
    sourceVersionRefs: ["contract-b", "contract-a", "contract-b"],
  });
  assert.equal(bound.actorId, "svc_runtime");
  assert.equal(bound.capability, "catalog.read");
  assert.equal(bound.purpose, "catalog-projection-read");
  assert.deepEqual(bound.sourceVersionRefs, ["contract-a", "contract-b"]);
  assert.throws(() => bindAuthenticatedRequestIdentity(bound, {
    actorId: "svc_other",
    actorType: "service",
    tenantId: "tenant_other",
  }, { authorityClass: "READ_ONLY", capability: "other", purpose: "other" }), /already bound/);
});

test("API responses publish correlation headers and add a stable failure contract", async () => {
  const identity = createRequestIdentity(new Headers(), {
    now: "2026-08-29T12:00:00.000Z",
    randomBytes: fixedRandomBytes,
    randomUUID: fixedUuid,
  });
  const response = apiResponse({ ok: false, code: "PROVIDER_TIMEOUT", message: "Provider timed out." }, {
    requestIdentity: identity,
    status: 504,
  });
  const body = await response.json();
  assert.equal(response.headers.get("x-request-id"), identity.requestId);
  assert.equal(response.headers.get("x-correlation-id"), identity.correlationId);
  assert.match(response.headers.get("traceparent") ?? "", /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  assert.equal(body.requestIdentityContractVersion, REQUEST_IDENTITY_CONTRACT_VERSION);
  assert.equal(body.failure.contractVersion, PLATFORM_FAILURE_CONTRACT_VERSION);
  assert.equal(body.failure.class, "TIMEOUT");
  assert.equal(body.failure.retry, "BACKOFF");
});

test("failure taxonomy keeps retry behavior explicit and fail-safe", () => {
  assert.deepEqual(
    [400, 401, 409, 429, 503].map((status) => platformFailureFromHttp({ status } as const).retry),
    ["NEVER", "NEVER", "RECONCILE_FIRST", "BACKOFF", "BACKOFF"],
  );
  const policy = platformFailureFromHttp({ code: "MUTATIONS_DISABLED", status: 503 });
  assert.equal(policy.domain, "POLICY");
  assert.equal(policy.retry, "HUMAN");
  const unknown = platformFailureFromHttp({ code: "not-safe", message: "", status: 418 });
  assert.equal(unknown.code, "HTTP_418");
  assert.equal(unknown.class, "UNKNOWN");
  assert.equal(unknown.retry, "HUMAN");
});

test("desired and observed state distinguishes convergence, drift, active recovery and absence", () => {
  const common = {
    desiredSource: "deployment policy",
    desiredState: "READY",
    freshnessMs: 60_000,
    nextAction: "Inspect the owner runbook.",
    now: "2026-08-29T12:01:00.000Z",
    owner: "api-owner",
    scope: "service.api",
  } as const;
  const converged = deriveDesiredObservedState({
    ...common,
    observedAt: "2026-08-29T12:00:30.000Z",
    observedSource: "readyz",
    observedState: "READY",
  });
  assert.equal(converged.contractVersion, RECONCILIATION_STATE_CONTRACT_VERSION);
  assert.equal(converged.reconciliation.state, "CONVERGED");
  const stale = deriveDesiredObservedState({
    ...common,
    observedAt: "2026-08-29T11:59:00.000Z",
    observedSource: "readyz",
    observedState: "READY",
  });
  assert.equal(stale.reconciliation.state, "DRIFTED");
  const missing = deriveDesiredObservedState({
    ...common,
    observedAt: null,
    observedSource: null,
    observedState: null,
  });
  assert.equal(missing.reconciliation.state, "UNKNOWN");
  const reconciling = deriveDesiredObservedState({
    ...common,
    activeReconciliation: { reason: "A bounded restore is running.", state: "RECONCILING" },
    observedAt: "2026-08-29T12:00:30.000Z",
    observedSource: "readyz",
    observedState: "NOT_READY",
  });
  assert.equal(reconciling.reconciliation.state, "RECONCILING");
});

test("all current API route modules create request identity at their entrypoints", () => {
  const routes = [
    "autonomy/constitution", "autonomy/evaluate", "autonomy/identity/evaluate",
    "autonomy/petitions/evaluate", "catalog", "catalog/shopify/projections",
    "commands/commercial-cases", "commands/leads", "commands/proposal-reviews", "commands/quote-approvals", "commands/quotes", "governance/evaluate", "healthz", "livez", "platform-guarantees", "readyz",
    "security/rls-readiness", "sultan/runtime-status", "workflows",
  ];
  for (const route of routes) {
    const source = readFileSync(`src/app/api/v1/${route}/route.ts`, "utf8");
    assert.match(source, /createRequestIdentity\(request\.headers\)/, route);
    assert.match(source, /requestIdentity:\s*identity/, route);
    assert.doesNotMatch(source, /requestId\(request\.headers\)/, route);
  }
});

test("health scopes remain distinct and connector configuration is not observation", () => {
  const health = readFileSync("src/app/api/v1/healthz/route.ts", "utf8");
  const readiness = readFileSync("src/app/api/v1/readyz/route.ts", "utf8");
  const runtime = readFileSync("src/modules/sultan-runtime/runtimeStatus.ts", "utf8");
  assert.match(health, /service\.security-readiness/);
  assert.match(readiness, /service\.dependency-readiness/);
  assert.match(runtime, /observedAt:\s*null/);
  assert.match(runtime, /authoritative Google Drive reachability/);
});
