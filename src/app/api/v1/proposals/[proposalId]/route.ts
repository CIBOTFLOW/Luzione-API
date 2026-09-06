import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";
import { SEED_PROPOSAL_COMMAND_VERSION } from "@/modules/seed-proposal-owner/contracts";
import { proposalRouteId, seedProposalRouteFailure } from "@/modules/seed-proposal-owner/routeSupport";
import { SeedProposalStore } from "@/modules/seed-proposal-owner/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "proposal.read"); const proposalId = proposalRouteId((await context.params).proposalId, "proposalId"); const version = new URL(request.url).searchParams.get("version") ?? undefined;
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A0", capability: "proposal.read", purpose: "read-canonical-proposal-version", sourceVersionRefs: [SEED_PROPOSAL_COMMAND_VERSION, ...(version ? [version] : [])] });
    const result = await new SeedProposalStore().readProposal(actor, proposalId, version);
    return result ? apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity }) : apiResponse({ ok: false, code: "PROPOSAL_NOT_FOUND", message: "Proposal Version not found for this tenant." }, { requestIdentity: identity, status: 404 });
  } catch (error) { return seedProposalRouteFailure(error, identity); }
}
