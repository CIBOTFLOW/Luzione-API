import crypto from "node:crypto";
import { NextResponse } from "next/server";

export function requestId(headers: Headers) {
  return headers.get("x-request-id") ?? crypto.randomUUID();
}

export function apiResponse(
  body: Record<string, unknown>,
  options: { requestId: string; status?: number; startedAt?: number; cacheControl?: string },
) {
  const durationMs = options.startedAt === undefined
    ? null
    : Math.max(0, Math.round((performance.now() - options.startedAt) * 10) / 10);
  return NextResponse.json(
    { ...body, requestId: options.requestId, ...(durationMs === null ? {} : { durationMs }) },
    {
      status: options.status ?? 200,
      headers: {
        "cache-control": options.cacheControl ?? "no-store",
        ...(durationMs === null ? {} : { "server-timing": `app;dur=${durationMs}` }),
        "x-request-id": options.requestId,
      },
    },
  );
}


export function logRequestCompletion(input: {
  requestId: string;
  route: string;
  status: number;
  startedAt: number;
  tenantId?: string;
}) {
  const durationMs = Math.max(0, Math.round((performance.now() - input.startedAt) * 10) / 10);
  console.info(JSON.stringify({
    event: "http_request_completed",
    level: "info",
    requestId: input.requestId,
    route: input.route,
    status: input.status,
    durationMs,
    tenantId: input.tenantId ?? null,
    observedAt: new Date().toISOString(),
  }));
  return durationMs;
}
