import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor } from "@/lib/control-plane/actor";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { getCommand } from "@/lib/control-plane/store";
import { ControlPlaneRequestError } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ commandId: string }> }) {
  const id = requestId(request.headers);
  try {
    const actor = await requireCanonicalActor(request.headers);
    const { commandId } = await context.params;
    if (!/^cmd:[0-9a-f-]{36}$/i.test(commandId)) {
      throw new ControlPlaneRequestError("INVALID_PATH", "commandId is invalid.");
    }
    const result = await getCommand(actor, commandId);
    return apiResponse({ ok: true, contractVersion: "luzione-authority/v2", result }, { requestId: id });
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
