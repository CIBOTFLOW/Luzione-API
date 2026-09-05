import { requireServiceActor } from "@/lib/api/actor";
import { seedProjectPublicationEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import {
  SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
  parseProjectCreationCommand,
} from "@/modules/seed-project-publication/contracts";
import {
  projectPublicationRouteFailure,
  projectRouteLimit,
} from "@/modules/seed-project-publication/routeSupport";
import { SeedProjectPublicationStore } from "@/modules/seed-project-publication/store";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "project.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "project.read",
      purpose: "list-canonical-tenant-projects",
      sourceVersionRefs: [SEED_PROJECT_PUBLICATION_COMMAND_VERSION],
    });
    const projects = await new SeedProjectPublicationStore().listProjects(
      actor,
      projectRouteLimit(new URL(request.url).searchParams.get("limit")),
    );
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result: { projects } }, { requestIdentity: identity });
  } catch (error) {
    return projectPublicationRouteFailure(error, identity);
  }
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "project.command");
    if (!seedProjectPublicationEnabledForTenant(actor.tenantId)) {
      return apiResponse({
        ok: false,
        code: "PROJECT_PUBLICATION_DISABLED",
        message: "Project publication remains default-off for this tenant.",
      }, { requestIdentity: identity, status: 503 });
    }
    const command = parseProjectCreationCommand(await request.json());
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_NO_EFFECT",
      capability: "project.command",
      idempotencyKey: command.idempotencyKey,
      purpose: "create-canonical-project-from-exact-opportunity",
      sourceVersionRefs: [SEED_PROJECT_PUBLICATION_COMMAND_VERSION, command.opportunityRef.version],
    });
    const result = await new SeedProjectPublicationStore().executeProjectCreate({
      actor,
      command,
      correlationId: identity.correlationId,
      requestedAt: identity.requestedAt,
    });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, {
      requestIdentity: identity,
      status: result.receipt.idempotentReplay ? 200 : 201,
    });
  } catch (error) {
    return projectPublicationRouteFailure(error, identity);
  }
}
