import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { requireServiceActor } from "@/lib/api/actor";
import { runtimeConfig } from "@/lib/api/config";
import {
  P113ContractError,
  P113_INGEST_CONTRACT_VERSION,
  parseP113IngestCommand,
} from "@/modules/catalog-projection/runtime";
import {
  P113IdempotencyConflictError,
  ingestP113CatalogProjection,
  listP113CatalogProjections,
} from "@/modules/catalog-projection/store";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { emitTelemetryLog } from "@/modules/platform-telemetry/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

function serviceActorFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/not configured/i.test(message)) return { code: "SERVICE_AUTH_NOT_CONFIGURED", status: 503 };
  if (/authentication failed|tenant is not authorized/i.test(message)) {
    return { code: "SERVICE_AUTH_FAILED", status: 401 };
  }
  if (/headers are required|actor type/i.test(message)) return { code: "ACTOR_CONTEXT_REQUIRED", status: 400 };
  return null;
}

function idempotencyKey(headers: Headers) {
  const value = (headers.get("idempotency-key") ?? headers.get("x-idempotency-key") ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new P113ContractError(
      "P113_IDEMPOTENCY_KEY_REQUIRED",
      "A stable 8–200 character Idempotency-Key header is required.",
    );
  }
  return value;
}

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers);
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "catalog.projection.read",
      purpose: "read-shopify-catalog-projection",
      sourceVersionRefs: [P113_INGEST_CONTRACT_VERSION],
    });
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? 100);
    const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 250)) : 100;
    const query = url.searchParams.get("query")?.trim().slice(0, 500) || null;
    const productType = url.searchParams.get("productType")?.trim().slice(0, 500) || null;
    const status = url.searchParams.get("status")?.trim().slice(0, 128) || null;
    const vendor = url.searchParams.get("vendor")?.trim().slice(0, 500) || null;
    const selectableValue = url.searchParams.get("quoteSelectable");
    const quoteSelectable = selectableValue === "true"
      ? true
      : selectableValue === "false"
        ? false
        : null;
    const catalog = await listP113CatalogProjections({
      actor,
      cursor: url.searchParams.get("cursor"),
      limit,
      productType,
      query,
      quoteSelectable,
      status,
      vendor,
    });
    return apiResponse({ ok: true, ...catalog }, { requestIdentity: identity });
  } catch (error) {
    const actorFailure = serviceActorFailure(error);
    if (actorFailure) {
      return apiResponse(
        { ok: false, code: actorFailure.code, message: "Service authentication is required." },
        { requestIdentity: identity, status: actorFailure.status },
      );
    }
    const cursorInvalid = error instanceof Error && error.message === "P113_CURSOR_INVALID";
    return apiResponse(
      {
        ok: false,
        code: cursorInvalid ? "P113_CURSOR_INVALID" : "P113_CATALOG_READ_UNAVAILABLE",
        message: cursorInvalid ? "The catalog cursor is invalid." : "The catalog projection is unavailable.",
      },
      { requestIdentity: identity, status: cursorInvalid ? 400 : 503 },
    );
  }
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers);
    const config = runtimeConfig();
    if (!config.internalProjectionsEnabled) {
      return apiResponse(
        {
          ok: false,
          code: "INTERNAL_PROJECTIONS_DISABLED",
          message: "Internal catalog projection writes are disabled fail closed.",
        },
        { requestIdentity: identity, status: 503 },
      );
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      throw new P113ContractError(
        "P113_REQUEST_TOO_LARGE",
        "The catalog projection request exceeds 24 MiB.",
        413,
      );
    }
    const key = idempotencyKey(request.headers);
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1",
      capability: "catalog.projection.ingest",
      idempotencyKey: key,
      purpose: "ingest-shopify-catalog-observation",
      sourceVersionRefs: [P113_INGEST_CONTRACT_VERSION],
    });
    let body: unknown;
    try {
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
        throw new P113ContractError(
          "P113_REQUEST_TOO_LARGE",
          "The catalog projection request exceeds 24 MiB.",
          413,
        );
      }
      body = JSON.parse(rawBody);
    } catch (error) {
      if (error instanceof P113ContractError) throw error;
      throw new P113ContractError("P113_INVALID_JSON", "The request body must be valid JSON.");
    }
    const command = parseP113IngestCommand(body);
    const receipt = await ingestP113CatalogProjection({
      actor,
      command,
      idempotencyKey: key,
    });
    return apiResponse(
      {
        ok: true,
        contractVersion: P113_INGEST_CONTRACT_VERSION,
        receipt,
      },
      { requestIdentity: identity, status: receipt.replayed ? 200 : 201 },
    );
  } catch (error) {
    const actorFailure = serviceActorFailure(error);
    if (actorFailure) {
      return apiResponse(
        { ok: false, code: actorFailure.code, message: "Service authentication is required." },
        { requestIdentity: identity, status: actorFailure.status },
      );
    }
    if (error instanceof P113ContractError) {
      return apiResponse(
        { ok: false, code: error.code, message: error.message },
        { requestIdentity: identity, status: error.status },
      );
    }
    if (error instanceof P113IdempotencyConflictError) {
      return apiResponse(
        { ok: false, code: "P113_IDEMPOTENCY_CONFLICT", message: error.message },
        { requestIdentity: identity, status: 409 },
      );
    }
    emitTelemetryLog({
      attributes: {
        "failure.code": "P113_CATALOG_PROJECTION_FAILED",
        "http.route": "/api/v1/catalog/shopify/projections",
        "provider.code": error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code).slice(0, 64)
          : null,
      },
      body: "P113 catalog projection failed safely.",
      eventName: "catalog.p113.projection.failed",
      identity,
      severity: "ERROR",
    });
    return apiResponse(
      {
        ok: false,
        code: "P113_CATALOG_PROJECTION_FAILED",
        message: "The catalog projection could not be reconciled.",
      },
      { requestIdentity: identity, status: 503 },
    );
  }
}
