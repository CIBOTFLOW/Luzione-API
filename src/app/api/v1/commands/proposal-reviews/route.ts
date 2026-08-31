import { requireServiceActor } from "@/lib/api/actor";
import { domainCommandsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { parseProposalReviewCommand, PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION } from "@/modules/proposal-quote-approval/contracts";
import { proposalQuoteRouteFailure, routeId } from "@/modules/proposal-quote-approval/routeSupport";
import { ProposalQuoteApprovalStore } from "@/modules/proposal-quote-approval/store";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "proposal.review.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A0", capability: "proposal.review.read", purpose: "read-canonical-proposal-review", sourceVersionRefs: [PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION] });
    const url = new URL(request.url); const result = await new ProposalQuoteApprovalStore().readProposalReview(actor, routeId(url.searchParams.get("caseId"), "caseId"));
    return result ? apiResponse({ ok: true, result }, { requestIdentity: identity }) : apiResponse({ ok: false, code: "PROPOSAL_REVIEW_NOT_FOUND", message: "Proposal review not found." }, { requestIdentity: identity, status: 404 });
  } catch (error) { return proposalQuoteRouteFailure(error, identity); }
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "proposal.review.command");
    if (!domainCommandsEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "DOMAIN_MUTATIONS_DISABLED", message: "Proposal review mutations remain default-off until an authorized tenant/cohort cutover." }, { requestIdentity: identity, status: 503 });
    const command = parseProposalReviewCommand(await request.json());
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A2", capability: "proposal.review.command", idempotencyKey: command.idempotencyKey, purpose: "record-exact-proposal-review", sourceVersionRefs: [PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, command.expectedProposalDocumentVersionId] });
    const result = await new ProposalQuoteApprovalStore().executeProposalReview({ actor, command, correlationId: identity.correlationId, requestedAt: identity.requestedAt });
    return apiResponse({ ok: true, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) { return proposalQuoteRouteFailure(error, identity); }
}
