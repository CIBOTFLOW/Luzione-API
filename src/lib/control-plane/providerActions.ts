import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor } from "@/lib/control-plane/actor";
import { controlPlaneFailure, uuidPath } from "@/lib/control-plane/http";
import { getConnection } from "@/lib/control-plane/store";

export async function unavailableProviderAction(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
  action: "validate" | "refresh" | "disconnect",
) {
  const id = requestId(request.headers);
  try {
    if (!runtimeConfig().controlPlaneMutationsEnabled) {
      return apiResponse(
        { ok: false, code: "CONTROL_PLANE_MUTATIONS_DISABLED", message: "Provider actions are disabled.", externalEffectsAuthorized: false },
        { requestId: id, status: 503 },
      );
    }
    const actor = await requireCanonicalActor(request.headers);
    const { connectionId } = await context.params;
    const connection = await getConnection(actor, uuidPath(connectionId, "connectionId"));
    return apiResponse(
      {
        ok: false,
        action,
        code: "PROVIDER_ADAPTER_NOT_ACTIVATED",
        message: `The ${connection.provider} adapter has not passed conformance and real-read validation. No provider request was made.`,
        externalEffectsAuthorized: false,
      },
      { requestId: id, status: 501 },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
