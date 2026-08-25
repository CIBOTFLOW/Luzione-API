import crypto from "node:crypto";
import { NextResponse } from "next/server";

export function requestId(headers: Headers) {
  return headers.get("x-request-id") ?? crypto.randomUUID();
}

export function apiResponse(
  body: Record<string, unknown>,
  options: { requestId: string; status?: number },
) {
  return NextResponse.json(
    { ...body, requestId: options.requestId },
    {
      status: options.status ?? 200,
      headers: {
        "cache-control": "no-store",
        "x-request-id": options.requestId,
      },
    },
  );
}
