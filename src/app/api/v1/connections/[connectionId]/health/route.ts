import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor } from "@/lib/control-plane/actor";
import { controlPlaneFailure, uuidPath } from "@/lib/control-plane/http";
import { getConnection } from "@/lib/control-plane/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ connectionId: string }> };

export async function GET(request: Request, context: Context) {
  const id = requestId(request.headers);
  try {
    const actor = await requireCanonicalActor(request.headers);
    const { connectionId } = await context.params;
    const connection = await getConnection(actor, uuidPath(connectionId, "connectionId"));
    const healthy = connection.state === "CONNECTED" && connection.lastValidationStatus === "PASS";
    return apiResponse({
      ok: true,
      result: {
        adapterVersion: connection.adapterVersion,
        connectionId: connection.connectionId,
        lastError: connection.lastError,
        lastValidatedAt: connection.lastValidatedAt,
        status: healthy ? "HEALTHY" : connection.state === "LEGACY_MANAGED" ? "LEGACY_MANAGED" : "DEGRADED",
        truth: healthy ? "LIVE_INTERNAL" : "DEGRADED",
      },
    }, { requestId: id });
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
