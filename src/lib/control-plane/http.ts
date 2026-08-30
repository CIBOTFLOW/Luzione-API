import { apiResponse } from "@/lib/api/http";
import { CanonicalActorError } from "@/lib/control-plane/actor";
import { ControlPlaneStoreError } from "@/lib/control-plane/store";
import { ControlPlaneRequestError } from "@/modules/control-plane/request";

export function uuidPath(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ControlPlaneRequestError("INVALID_PATH", `${label} must be a UUID.`);
  }
  return value;
}

export function controlPlaneFailure(error: unknown, requestId: string) {
  if (error instanceof ControlPlaneRequestError
    || error instanceof CanonicalActorError
    || error instanceof ControlPlaneStoreError) {
    return apiResponse(
      { ok: false, code: error.code, message: error.message, externalEffectsAuthorized: false },
      { requestId, status: error.status },
    );
  }
  console.error(JSON.stringify({
    event: "control_plane_request_failed",
    errorCode: error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code).slice(0, 64)
      : "UNCLASSIFIED",
    requestId,
  }));
  return apiResponse(
    {
      ok: false,
      code: "CONTROL_PLANE_UNAVAILABLE",
      message: "The control plane failed closed.",
      externalEffectsAuthorized: false,
    },
    { requestId, status: 503 },
  );
}
