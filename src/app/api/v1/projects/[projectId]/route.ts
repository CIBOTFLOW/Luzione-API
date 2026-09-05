import { requireServiceActor } from "@/lib/api/actor";
import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { SEED_PROJECT_PUBLICATION_COMMAND_VERSION } from "@/modules/seed-project-publication/contracts";
import { API_HTTP_RESPONSE_VERSION, createProjectSpecificationScheduleReadModel } from "@/modules/seed-project-publication/readModel";
import { projectPublicationRouteFailure, projectRouteId } from "@/modules/seed-project-publication/routeSupport";
import { SeedProjectPublicationStore } from "@/modules/seed-project-publication/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "project.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "project.read",
      purpose: "read-canonical-project-graph",
      sourceVersionRefs: [SEED_PROJECT_PUBLICATION_COMMAND_VERSION],
    });
    const projectId = projectRouteId((await context.params).projectId, "projectId");
    const schedule = await new SeedProjectPublicationStore().readSpecificationSchedule(actor, projectId);
    if (!schedule) return apiResponse({ ok: false, code: "PROJECT_NOT_FOUND", message: "Project not found." }, { requestIdentity: identity, status: 404 });
    const result = createProjectSpecificationScheduleReadModel(schedule, {
      observedAt: identity.requestedAt,
      releaseIdentity: createReleaseIdentity({ mutationsEnabled: runtimeConfig().mutationsEnabled }),
      tenantId: actor.tenantId,
    });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity });
  } catch (error) {
    return projectPublicationRouteFailure(error, identity);
  }
}
