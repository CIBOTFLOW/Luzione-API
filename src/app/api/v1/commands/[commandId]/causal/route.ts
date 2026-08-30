import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor } from "@/lib/control-plane/actor";
import { getCommandCausalReceipt, LUZIONE_CAUSAL_RECEIPT_V1 } from "@/lib/control-plane/causalReadModel";
import { controlPlaneFailure } from "@/lib/control-plane/http";
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
    const result = await getCommandCausalReceipt(actor, commandId);
    return apiResponse({ ok: true, contractVersion: LUZIONE_CAUSAL_RECEIPT_V1, result }, { requestId: id });
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
