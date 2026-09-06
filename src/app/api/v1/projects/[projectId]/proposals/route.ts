import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";
import { SEED_PROPOSAL_COMMAND_VERSION } from "@/modules/seed-proposal-owner/contracts";
import { createSeedProposalReadModel } from "@/modules/seed-proposal-owner/readModel";
import { proposalRouteId, seedProposalRouteFailure } from "@/modules/seed-proposal-owner/routeSupport";
import { SeedProposalStore } from "@/modules/seed-proposal-owner/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "proposal.read"); const projectId = proposalRouteId((await context.params).projectId, "projectId");
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A0", capability: "proposal.read", purpose: "read-canonical-project-proposals", sourceVersionRefs: [SEED_PROPOSAL_COMMAND_VERSION] });
    const data = await new SeedProposalStore().readProjectProposals(actor, projectId);
    if (!data) return apiResponse({ ok: false, code: "PROJECT_NOT_FOUND", message: "Canonical Project not found for this tenant." }, { requestIdentity: identity, status: 404 });
    const result = createSeedProposalReadModel(data, { observedAt: identity.requestedAt, projectId, releaseIdentity: createReleaseIdentity({ mutationsEnabled: false }), tenantId: actor.tenantId });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity });
  } catch (error) { return seedProposalRouteFailure(error, identity); }
}
