import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { platformFailureFromHttp } from "@/modules/platform-contracts/failureContract";
import {
  createRequestIdentity,
  traceparent,
  type RequestIdentityEnvelope,
} from "@/modules/platform-contracts/requestIdentity";

export function requestId(headers: Headers) {
  return createRequestIdentity(headers).requestId;
}

export { createRequestIdentity };

type ApiResponseOptions = {
  cacheControl?: string;
  requestId?: string;
  requestIdentity?: RequestIdentityEnvelope;
  startedAt?: number;
  status?: number;
};

export function apiResponse(
  body: Record<string, unknown>,
  options: ApiResponseOptions,
) {
  const id = options.requestIdentity?.requestId ?? options.requestId ?? `req_${crypto.randomUUID()}`;
  const status = options.status ?? 200;
  const durationMs = options.startedAt === undefined
    ? null
    : Math.max(0, Math.round((performance.now() - options.startedAt) * 10) / 10);
  const failure = body.ok === false && !("failure" in body)
    ? platformFailureFromHttp({ code: body.code, message: body.message, status })
    : null;
  return NextResponse.json(
    {
      ...body,
      ...(failure ? { failure } : {}),
      requestId: id,
      ...(options.requestIdentity ? {
        correlationId: options.requestIdentity.correlationId,
        requestIdentityContractVersion: options.requestIdentity.contractVersion,
        traceId: options.requestIdentity.traceId,
      } : {}),
      ...(durationMs === null ? {} : { durationMs }),
    },
    {
      status,
      headers: {
        "cache-control": options.cacheControl ?? "no-store",
        ...(durationMs === null ? {} : { "server-timing": `app;dur=${durationMs}` }),
        ...(options.requestIdentity ? {
          "traceparent": traceparent(options.requestIdentity),
          "x-correlation-id": options.requestIdentity.correlationId,
        } : {}),
        "x-request-id": id,
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
