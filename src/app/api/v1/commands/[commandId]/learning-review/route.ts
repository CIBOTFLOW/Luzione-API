import { apiResponse, requestId } from "@/lib/api/http";
import {
  requireCanonicalActor,
  requireHumanMembershipCapability,
} from "@/lib/control-plane/actor";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { getLearningGuardianReview } from "@/lib/learning-safety/guardianReview";
import { ControlPlaneRequestError } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ commandId: string }> },
) {
  const id = requestId(request.headers);
  try {
    const actor = requireHumanMembershipCapability(
      await requireCanonicalActor(request.headers),
      "learning.guardian",
    );
    const { commandId } = await context.params;
    if (!/^cmd:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
      throw new ControlPlaneRequestError("INVALID_PATH", "commandId is invalid.");
    }
    const review = await getLearningGuardianReview(actor, commandId);
    return apiResponse(
      {
        ok: true,
        contractVersion: "learning-guardian/v1",
        review,
        externalEffectsAuthorized: false,
      },
      { requestId: id },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
