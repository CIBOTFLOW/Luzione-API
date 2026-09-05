import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { SEED_PROCUREMENT_COMMAND_VERSION } from "@/modules/seed-procurement/contracts";
import { createSeedProcurementReadModel } from "@/modules/seed-procurement/readModel";
import { procurementRouteId, seedProcurementRouteFailure } from "@/modules/seed-procurement/routeSupport";
import { SeedProcurementStore } from "@/modules/seed-procurement/store";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "procurement.read");
    const projectId = procurementRouteId((await context.params).projectId, "projectId");
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A0", capability: "procurement.read", purpose: "read-project-procurement-graph", sourceVersionRefs: [SEED_PROCUREMENT_COMMAND_VERSION] });
    const graph = await new SeedProcurementStore().readProjectProcurement(actor, projectId);
    if (!graph) return apiResponse({ ok: false, code: "PROJECT_NOT_FOUND", message: "Canonical Project not found for this tenant." }, { requestIdentity: identity, status: 404 });
    const result = createSeedProcurementReadModel(graph, { observedAt: new Date().toISOString(), projectId, releaseIdentity: createReleaseIdentity({ mutationsEnabled: false }), tenantId: actor.tenantId });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity });
  } catch (error) {
    return seedProcurementRouteFailure(error, identity);
  }
}
