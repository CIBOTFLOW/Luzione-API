import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor } from "@/lib/control-plane/actor";
import { controlPlaneFailure } from "@/lib/control-plane/http";
import { createConnection, listConnections } from "@/lib/control-plane/store";
import { parseCreateConnection, readBoundedJson } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const actor = await requireCanonicalActor(request.headers);
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
    const result = await listConnections(actor, Number.isInteger(rawLimit) ? rawLimit : 100);
    return apiResponse({ ok: true, contractVersion: "luzione-connections/v1", result }, { requestId: id });
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}

export async function POST(request: Request) {
  const id = requestId(request.headers);
  try {
    const config = runtimeConfig();
    if (!config.controlPlaneMutationsEnabled) {
      return apiResponse(
        { ok: false, code: "CONTROL_PLANE_MUTATIONS_DISABLED", message: "Connection mutations are disabled.", externalEffectsAuthorized: false },
        { requestId: id, status: 503 },
      );
    }
    const actor = await requireCanonicalActor(request.headers);
    const result = await createConnection(actor, parseCreateConnection(await readBoundedJson(request)));
    return apiResponse(
      { ok: true, contractVersion: "luzione-connections/v1", result, externalEffectsAuthorized: false },
      { requestId: id, status: 201 },
    );
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
