import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import {
  requireCanonicalActor,
  requireHumanMembershipCapability,
} from "@/lib/control-plane/actor";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { recordLearningGuardianDecision } from "@/lib/learning-safety/guardianReview";
import {
  ControlPlaneRequestError,
  parseLearningGuardianDecision,
  readBoundedJson,
} from "@/modules/control-plane/request";

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
          message: "Learning guardian decisions are disabled.",
          externalEffectsAuthorized: false,
        },
        { requestId: id, status: 503 },
      );
    }
    const actor = requireHumanMembershipCapability(
      await requireCanonicalActor(request.headers),
      "learning.guardian",
    );
    const { commandId } = await context.params;
    if (!/^cmd:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
      throw new ControlPlaneRequestError("INVALID_PATH", "commandId is invalid.");
    }
    const decision = parseLearningGuardianDecision(
      await readBoundedJson(request, 4 * 1024),
    );
    const result = await recordLearningGuardianDecision(actor, commandId, decision);
    return apiResponse(
      {
        ok: true,
        contractVersion: "learning-guardian/v1",
        result,
        externalEffectsAuthorized: false,
      },
      { requestId: id },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
