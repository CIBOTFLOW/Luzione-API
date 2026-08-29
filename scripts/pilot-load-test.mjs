#!/usr/bin/env node

import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}

export function assertSafeBaseUrl(raw, allowNonLocal = false) {
  const url = new URL(raw);
  const local = new Set(["127.0.0.1", "::1", "localhost"]);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PILOT_LOAD_BASE_URL must use HTTP or HTTPS.");
  }
  if (!local.has(url.hostname) && !allowNonLocal) {
    throw new Error("Refusing a non-local load target without ALLOW_NON_LOCAL_PILOT_LOAD=true.");
  }
  return url;
}

function boundedInteger(raw, fallback, minimum, maximum) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function headers(config) {
  return {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
    "x-luzione-actor": config.actorId,
    "x-luzione-actor-type": config.actorType,
    "x-luzione-tenant": config.legacyTenantId,
  };
}

function command(config) {
  return {
    action: {
      actionId: "pilot-load-analysis",
      actionVersion: "v1",
      contentDigest: "b".repeat(64),
      provider: "openai",
      readbackPlanned: false,
      safeReconciliationPlanned: true,
    },
    commandType: "pilot.load.analysis",
    envelope: {
      actor: {
        identityId: config.actorId,
        membershipRole: config.membershipRole,
        principalType: "AGENT",
      },
      authorityClass: "A0",
      capability: "response.create",
      contractVersion: "luzione-authority/v2",
      correlationId: config.correlationId,
      idempotencyKey: config.idempotencyKey,
      policyDecisionId: config.policyDecisionId,
      resourceScope: ["pilot-load:analysis"],
      tenantId: config.canonicalTenantId,
    },
    payload: { purpose: "disposable validation load proof" },
    target: {
      objectId: "pilot-load-probe",
      objectType: "validation-probe",
      objectVersion: "v1",
      ownerProject: "CIBOTFLOW/Luzione-API",
    },
  };
}

async function measuredRequest(config, kind) {
  const startedAt = performance.now();
  const response = kind === "read"
    ? await fetch(new URL("/api/v1/connections?limit=100", config.baseUrl), {
        headers: headers(config),
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    : await fetch(new URL("/api/v1/commands", config.baseUrl), {
        body: JSON.stringify(command(config)),
        headers: headers(config),
        method: "POST",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
  const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;
  const body = await response.json().catch(() => null);
  const expectedStatus = kind === "read" ? response.status === 200 : response.status === 200 || response.status === 201;
  const safeBoundary = body?.externalEffectsAuthorized !== true;
  return { kind, latencyMs, ok: expectedStatus && body?.ok === true && safeBoundary, status: response.status };
}

async function measuredWebhook(config) {
  const body = JSON.stringify({ event: "controlled-load-webhook", testOnly: true });
  const signature = crypto.createHmac("sha256", config.webhookSecret).update(body).digest("hex");
  const startedAt = performance.now();
  const response = await fetch(new URL(`/api/v1/webhooks/${config.webhookProvider}`, config.baseUrl), {
    body,
    headers: {
      "content-type": "application/json",
      "x-luzione-webhook-endpoint": config.webhookEndpoint,
      "x-provider-event-id": config.webhookEventId,
      "x-provider-event-type": "message.received",
      "x-provider-signature": `sha256=${signature}`,
    },
    method: "POST",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;
  const responseBody = await response.json().catch(() => null);
  return {
    kind: "webhook",
    latencyMs,
    ok: (response.status === 200 || response.status === 202)
      && responseBody?.ok === true
      && responseBody?.externalEffectsAuthorized === false,
    status: response.status,
  };
}

async function runBatch(config, count, offset = 0) {
  return Promise.all(Array.from({ length: count }, (_, index) =>
    measuredRequest(config, (index + offset) % 2 === 0 ? "read" : "command")));
}

export async function runPilotLoad(config) {
  const results = [];
  const startedAt = performance.now();
  for (let second = 0; second < config.durationSeconds; second += 1) {
    const target = startedAt + second * 1_000;
    const delay = target - performance.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    results.push(...await runBatch(config, config.sustainedRps, second * config.sustainedRps));
  }
  results.push(...await runBatch(config, config.burstRequests, config.durationSeconds * config.sustainedRps));
  if (config.webhookRequests > 0) {
    results.push(...await Promise.all(Array.from(
      { length: config.webhookRequests },
      () => measuredWebhook(config),
    )));
  }

  const failures = results.filter((result) => !result.ok);
  const reads = results.filter((result) => result.kind === "read").map((result) => result.latencyMs);
  const commands = results.filter((result) => result.kind === "command").map((result) => result.latencyMs);
  const webhooks = results.filter((result) => result.kind === "webhook").map((result) => result.latencyMs);
  const summary = {
    burstRequests: config.burstRequests,
    commandAdmissionP95Ms: percentile(commands, 0.95),
    connectionReadP95Ms: percentile(reads, 0.95),
    durationSeconds: config.durationSeconds,
    errorRate: results.length ? failures.length / results.length : 1,
    externalEffectsAuthorized: false,
    failures: failures.slice(0, 20).map(({ kind, status }) => ({ kind, status })),
    requests: results.length,
    sustainedRps: config.sustainedRps,
    webhookAckP95Ms: percentile(webhooks, 0.95),
    webhookRequests: config.webhookRequests,
  };
  if (summary.connectionReadP95Ms >= config.p95LimitMs
    || summary.commandAdmissionP95Ms >= config.p95LimitMs
    || (summary.webhookRequests > 0 && summary.webhookAckP95Ms >= config.webhookP95LimitMs)
    || summary.errorRate >= config.errorRateLimit) {
    throw new Error(`Pilot load gate failed: ${JSON.stringify(summary)}`);
  }
  return summary;
}

async function main() {
  const token = process.env.PILOT_LOAD_TOKEN?.trim();
  const canonicalTenantId = process.env.PILOT_LOAD_CANONICAL_TENANT_ID?.trim();
  const webhookSecret = process.env.PILOT_LOAD_WEBHOOK_SECRET?.trim() || "";
  if (!token || !canonicalTenantId) {
    throw new Error("PILOT_LOAD_TOKEN and PILOT_LOAD_CANONICAL_TENANT_ID are required.");
  }
  const config = {
    actorId: process.env.PILOT_LOAD_ACTOR_ID?.trim() || "agent:sultan-os",
    actorType: "agent",
    baseUrl: assertSafeBaseUrl(
      process.env.PILOT_LOAD_BASE_URL?.trim() || "http://127.0.0.1:3201",
      process.env.ALLOW_NON_LOCAL_PILOT_LOAD === "true",
    ),
    burstRequests: boundedInteger(process.env.PILOT_LOAD_BURST_REQUESTS, 50, 1, 500),
    canonicalTenantId,
    correlationId: process.env.PILOT_LOAD_CORRELATION_ID?.trim() || "pilot-load-correlation-1",
    durationSeconds: boundedInteger(process.env.PILOT_LOAD_DURATION_SECONDS, 10, 1, 300),
    errorRateLimit: 0.01,
    idempotencyKey: process.env.PILOT_LOAD_IDEMPOTENCY_KEY?.trim() || "pilot-load-idempotency-1",
    legacyTenantId: process.env.PILOT_LOAD_LEGACY_TENANT_ID?.trim() || "luzione",
    membershipRole: process.env.PILOT_LOAD_MEMBERSHIP_ROLE?.trim() || "SULTAN_AGENT",
    p95LimitMs: boundedInteger(process.env.PILOT_LOAD_P95_LIMIT_MS, 750, 1, 60_000),
    policyDecisionId: process.env.PILOT_LOAD_POLICY_DECISION_ID?.trim() || "pilot-load-policy-1",
    sustainedRps: boundedInteger(process.env.PILOT_LOAD_SUSTAINED_RPS, 20, 1, 200),
    timeoutMs: boundedInteger(process.env.PILOT_LOAD_TIMEOUT_MS, 5_000, 100, 60_000),
    token,
    webhookEndpoint: process.env.PILOT_LOAD_WEBHOOK_ENDPOINT?.trim() || "gmail-controlled-pilot",
    webhookEventId: process.env.PILOT_LOAD_WEBHOOK_EVENT_ID?.trim() || "pilot-load-webhook-1",
    webhookP95LimitMs: boundedInteger(process.env.PILOT_LOAD_WEBHOOK_P95_LIMIT_MS, 1_000, 1, 60_000),
    webhookProvider: process.env.PILOT_LOAD_WEBHOOK_PROVIDER?.trim() || "gmail",
    webhookRequests: webhookSecret
      ? boundedInteger(process.env.PILOT_LOAD_WEBHOOK_REQUESTS, 50, 1, 500)
      : 0,
    webhookSecret,
  };
  console.log(JSON.stringify(await runPilotLoad(config), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Pilot load gate failed.");
    process.exitCode = 1;
  });
}
