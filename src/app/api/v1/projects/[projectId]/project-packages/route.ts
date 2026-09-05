import { requireServiceActor } from "@/lib/api/actor";
import { seedProjectPublicationEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import {
  SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
  parseProjectPackageCommand,
} from "@/modules/seed-project-publication/contracts";
import { projectPublicationRouteFailure, projectRouteId } from "@/modules/seed-project-publication/routeSupport";
import { SeedProjectPublicationStore } from "@/modules/seed-project-publication/store";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "project.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "project.read",
      purpose: "read-immutable-project-package",
      sourceVersionRefs: [SEED_PROJECT_PUBLICATION_COMMAND_VERSION],
    });
    const projectId = projectRouteId((await context.params).projectId, "projectId");
    const packageIdValue = new URL(request.url).searchParams.get("packageId");
    const packageId = packageIdValue ? projectRouteId(packageIdValue, "packageId") : undefined;
    const result = await new SeedProjectPublicationStore().readProjectPackage(actor, projectId, packageId);
    return result
      ? apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity })
      : apiResponse({ ok: false, code: "PROJECT_PACKAGE_NOT_FOUND", message: "Project Package not found." }, { requestIdentity: identity, status: 404 });
  } catch (error) {
    return projectPublicationRouteFailure(error, identity);
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "project_package.publish");
    if (!seedProjectPublicationEnabledForTenant(actor.tenantId)) {
      return apiResponse({ ok: false, code: "PROJECT_PUBLICATION_DISABLED", message: "Project Package publication remains default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    }
    const projectId = projectRouteId((await context.params).projectId, "projectId");
    const command = parseProjectPackageCommand(await request.json());
    if (command.commandType !== "project_package.publish") {
      return apiResponse({ ok: false, code: "UNSUPPORTED_COMMAND", message: "Use the Specification revision route for Planner revisions." }, { requestIdentity: identity, status: 400 });
    }
    if (command.projectId !== projectId) {
      return apiResponse({ ok: false, code: "PROJECT_ROUTE_MISMATCH", message: "Route Project ID must match the command Project ID." }, { requestIdentity: identity, status: 409 });
    }
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_NO_EFFECT",
      capability: "project_package.publish",
      idempotencyKey: command.idempotencyKey,
      purpose: "publish-immutable-room-planner-project-package",
      sourceVersionRefs: [SEED_PROJECT_PUBLICATION_COMMAND_VERSION, command.package.plannerProjectRef.version],
    });
    const result = await new SeedProjectPublicationStore().executePackagePublish({ actor, command, correlationId: identity.correlationId, requestedAt: identity.requestedAt });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return projectPublicationRouteFailure(error, identity);
  }
}
