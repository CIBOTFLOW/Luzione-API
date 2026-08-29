import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor, requireConnectionAdministrator } from "@/lib/control-plane/actor";
import { controlPlaneFailure, uuidPath } from "@/lib/control-plane/http";
import { getConnection, patchConnection } from "@/lib/control-plane/store";
import { parseConnectionPatch, readBoundedJson } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ connectionId: string }> };

export async function GET(request: Request, context: Context) {
  const id = requestId(request.headers);
  try {
    const actor = await requireCanonicalActor(request.headers);
    const { connectionId } = await context.params;
    const result = await getConnection(actor, uuidPath(connectionId, "connectionId"));
    return apiResponse({ ok: true, contractVersion: "luzione-connections/v1", result }, { requestId: id });
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}

export async function PATCH(request: Request, context: Context) {
  const id = requestId(request.headers);
  try {
    if (!runtimeConfig().controlPlaneMutationsEnabled) {
      return apiResponse(
        { ok: false, code: "CONTROL_PLANE_MUTATIONS_DISABLED", message: "Connection mutations are disabled.", externalEffectsAuthorized: false },
        { requestId: id, status: 503 },
      );
    }
    const actor = requireConnectionAdministrator(await requireCanonicalActor(request.headers));
    const { connectionId } = await context.params;
    const result = await patchConnection(
      actor,
      uuidPath(connectionId, "connectionId"),
      parseConnectionPatch(await readBoundedJson(request)),
    );
    return apiResponse(
      { ok: true, contractVersion: "luzione-connections/v1", result, externalEffectsAuthorized: false },
      { requestId: id },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
