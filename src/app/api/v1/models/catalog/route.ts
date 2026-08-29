import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor, requireWorkloadCapability } from "@/lib/control-plane/actor";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { listModelPriceCatalog } from "@/lib/control-plane/store";
import { ControlPlaneRequestError } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function catalogQuery(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider")?.trim() || undefined;
  if (provider && !/^[a-z][a-z0-9._-]{0,99}$/.test(provider)) {
    throw new ControlPlaneRequestError("INVALID_QUERY", "provider is invalid.");
  }
  const requestedAt = url.searchParams.get("at")?.trim();
  if (requestedAt && requestedAt.length > 40) {
    throw new ControlPlaneRequestError("INVALID_QUERY", "at is invalid.");
  }
  const date = requestedAt ? new Date(requestedAt) : new Date();
  if (!Number.isFinite(date.getTime())) {
    throw new ControlPlaneRequestError("INVALID_QUERY", "at must be a valid timestamp.");
  }
  return { effectiveAt: date.toISOString(), provider };
}

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const actor = requireWorkloadCapability(await requireCanonicalActor(request.headers), "models.read");
    const result = await listModelPriceCatalog(actor, catalogQuery(request));
    return apiResponse(
      { ok: true, contractVersion: "luzione-model-catalog/v1", result },
      { requestId: id },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
