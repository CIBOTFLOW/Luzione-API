import { apiResponse, requestId } from "@/lib/api/http";
import { ControlPlaneRequestError } from "@/modules/control-plane/request";
import { controlPlaneFailure } from "@/lib/control-plane/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const id = requestId(request.headers);
  try {
    const { provider } = await context.params;
    if (!/^[a-z][a-z0-9._-]+$/.test(provider)) {
      throw new ControlPlaneRequestError("INVALID_PATH", "provider is invalid.");
    }
    return apiResponse(
      {
        ok: false,
        code: "WEBHOOK_ADAPTER_NOT_ACTIVATED",
        message: `The ${provider} webhook adapter is not activated. The body was not accepted or persisted.`,
        externalEffectsAuthorized: false,
      },
      { requestId: id, status: 501 },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
