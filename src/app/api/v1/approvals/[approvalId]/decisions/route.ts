import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor } from "@/lib/control-plane/actor";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { decideApproval } from "@/lib/control-plane/store";
import { ControlPlaneRequestError, parseApprovalDecision, readBoundedJson } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ approvalId: string }> }) {
  const id = requestId(request.headers);
  try {
    if (!runtimeConfig().controlPlaneMutationsEnabled) {
      return apiResponse(
        { ok: false, code: "CONTROL_PLANE_MUTATIONS_DISABLED", message: "Approval decisions are disabled.", externalEffectsAuthorized: false },
        { requestId: id, status: 503 },
      );
    }
    const actor = await requireCanonicalActor(request.headers);
    const { approvalId } = await context.params;
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(approvalId)) {
      throw new ControlPlaneRequestError("INVALID_PATH", "approvalId is invalid.");
    }
    const result = await decideApproval(actor, approvalId, parseApprovalDecision(await readBoundedJson(request)));
    return apiResponse(
      { ok: true, contractVersion: "luzione-authority/v2", result, externalEffectsAuthorized: false },
      { requestId: id },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
