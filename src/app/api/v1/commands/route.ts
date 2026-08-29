import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor, requireWorkloadCapability } from "@/lib/control-plane/actor";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { admitCommand } from "@/lib/control-plane/store";
import { parseCommand, readBoundedJson } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const id = requestId(request.headers);
  try {
    if (!runtimeConfig().controlPlaneMutationsEnabled) {
      return apiResponse(
        { ok: false, code: "CONTROL_PLANE_MUTATIONS_DISABLED", message: "Command admission is disabled.", externalEffectsAuthorized: false },
        { requestId: id, status: 503 },
      );
    }
    const actor = requireWorkloadCapability(await requireCanonicalActor(request.headers), "commands.request");
    const result = await admitCommand(actor, parseCommand(await readBoundedJson(request)));
    return apiResponse(
      { ok: true, contractVersion: "luzione-authority/v2", result, externalEffectsAuthorized: false },
      { requestId: id, status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
