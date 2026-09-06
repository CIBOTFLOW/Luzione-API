import { requireServiceActor } from "@/lib/api/actor";
import { seedProposalCommandsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { HUMAN_APPROVAL_SUBJECT_VERSION, requireHumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";
import { SEED_PROPOSAL_COMMAND_VERSION, parseSeedProposalCommand } from "@/modules/seed-proposal-owner/contracts";
import { seedProposalRouteFailure } from "@/modules/seed-proposal-owner/routeSupport";
import { SeedProposalDomainError, SeedProposalStore } from "@/modules/seed-proposal-owner/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "proposal.command");
    if (!seedProposalCommandsEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "SEED_PROPOSAL_DISABLED", message: "The canonical Proposal owner remains default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    const command = parseSeedProposalCommand(await request.json());
    const human = command.commandType === "approval_decision.record" ? await requireHumanApprovalSubject(request.headers, "proposal.client_decision.record") : undefined;
    if (human && human.tenantId !== actor.tenantId) throw new SeedProposalDomainError("TENANT_MISMATCH", "Human subject and service transport tenants differ.", 403);
    // D1C must supply a server-derived Portal grant adapter. A body can never
    // carry this authority, so the HTTP decision path remains fail-closed at G0.
    if (command.commandType === "approval_decision.record") throw new SeedProposalDomainError("CLIENT_OBJECT_GRANT_ADAPTER_UNAVAILABLE", "Client decisions remain blocked until the Portal object-grant adapter is controller-admitted.", 503);
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A1_NO_EFFECT", capability: "proposal.command", idempotencyKey: command.idempotencyKey, purpose: `seed-proposal-${command.commandType}`, sourceVersionRefs: [SEED_PROPOSAL_COMMAND_VERSION, command.expectedVersion, ...(human ? [HUMAN_APPROVAL_SUBJECT_VERSION] : [])] });
    const result = await new SeedProposalStore().execute({ actor, command, correlationId: identity.correlationId, human, requestedAt: identity.requestedAt });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) { return seedProposalRouteFailure(error, identity); }
}
