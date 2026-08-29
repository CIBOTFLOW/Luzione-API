import { apiResponse, requestId } from "@/lib/api/http";
import { requireCanonicalActor } from "@/lib/control-plane/actor";
import { controlPlaneFailure, uuidPath } from "@/lib/control-plane/http";
import { getConnection, listConnectionSyncRuns } from "@/lib/control-plane/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ connectionId: string }> };

export async function GET(request: Request, context: Context) {
  const id = requestId(request.headers);
  try {
    const actor = await requireCanonicalActor(request.headers);
    const { connectionId } = await context.params;
    const checkedId = uuidPath(connectionId, "connectionId");
    await getConnection(actor, checkedId);
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    const result = await listConnectionSyncRuns(actor, checkedId, Number.isInteger(rawLimit) ? rawLimit : 50);
    return apiResponse({ ok: true, result }, { requestId: id });
  } catch (error) {
    return controlPlaneFailure(error, id);
  }
}
