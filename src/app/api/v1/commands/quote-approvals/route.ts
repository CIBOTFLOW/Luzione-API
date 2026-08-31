import { requireServiceActor } from "@/lib/api/actor";
import { domainCommandsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { parseQuoteApprovalCommand, PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION } from "@/modules/proposal-quote-approval/contracts";
import { proposalQuoteRouteFailure, routeId } from "@/modules/proposal-quote-approval/routeSupport";
import { ProposalQuoteApprovalStore } from "@/modules/proposal-quote-approval/store";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "quote.approval.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A0", capability: "quote.approval.read", purpose: "read-canonical-quote-approval", sourceVersionRefs: [PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION] });
    const result = await new ProposalQuoteApprovalStore().readQuote(actor, routeId(new URL(request.url).searchParams.get("quoteId"), "quoteId"));
    return result ? apiResponse({ ok: true, result }, { requestIdentity: identity }) : apiResponse({ ok: false, code: "QUOTE_NOT_FOUND", message: "Quote not found." }, { requestIdentity: identity, status: 404 });
  } catch (error) { return proposalQuoteRouteFailure(error, identity); }
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "quote.approval.command");
    if (!domainCommandsEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "DOMAIN_MUTATIONS_DISABLED", message: "Quote approval mutations remain default-off until an authorized tenant/cohort cutover." }, { requestIdentity: identity, status: 503 });
    const command = parseQuoteApprovalCommand(await request.json());
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A2", capability: "quote.approval.command", idempotencyKey: command.idempotencyKey, purpose: "record-exact-quote-margin-decision", sourceVersionRefs: [PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, command.expectedEconomicsVersionId] });
    const result = await new ProposalQuoteApprovalStore().executeQuoteApproval({ actor, command, correlationId: identity.correlationId, requestedAt: identity.requestedAt });
    return apiResponse({ ok: true, result }, { requestIdentity: identity });
  } catch (error) { return proposalQuoteRouteFailure(error, identity); }
}
