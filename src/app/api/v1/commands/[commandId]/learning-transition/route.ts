import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import {
  requireCanonicalActor,
  requireMembershipCapability,
} from "@/lib/control-plane/actor";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { applyLearningCommand } from "@/lib/learning-safety/commandKernel";
import { ControlPlaneRequestError } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ commandId: string }> },
) {
  const id = requestId(request.headers);
  try {
    if (!runtimeConfig().controlPlaneMutationsEnabled) {
      return apiResponse(
        {
          ok: false,
          code: "CONTROL_PLANE_MUTATIONS_DISABLED",
          message: "Learning command execution is disabled.",
          externalEffectsAuthorized: false,
        },
        { requestId: id, status: 503 },
      );
    }
    if (request.headers.get("content-length") !== null
      && request.headers.get("content-length") !== "0") {
      throw new ControlPlaneRequestError(
        "REQUEST_BODY_FORBIDDEN",
        "Learning transitions read only the admitted canonical command.",
      );
    }
    const actor = requireMembershipCapability(
      await requireCanonicalActor(request.headers),
      "learning.commands.execute",
    );
    const { commandId } = await context.params;
    if (!/^cmd:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
      throw new ControlPlaneRequestError("INVALID_PATH", "commandId is invalid.");
    }
    const result = await applyLearningCommand(actor, commandId);
    return apiResponse(
      {
        ok: true,
        contractVersion: "learning-command/v1",
        result,
        externalEffectsAuthorized: false,
      },
      { requestId: id },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
