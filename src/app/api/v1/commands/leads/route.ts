import { requireServiceActor } from "@/lib/api/actor";
import { domainCommandsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import {
  LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
  parseLeadCommand,
} from "@/modules/lead-commercial-case/contracts";
import { commandRouteFailure, routeId } from "@/modules/lead-commercial-case/routeSupport";
import { LeadCommercialCaseStore } from "@/modules/lead-commercial-case/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "lead.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "lead.read",
      purpose: "read-canonical-lead",
      sourceVersionRefs: [LEAD_COMMERCIAL_CASE_CONTRACT_VERSION],
    });
    const leadId = routeId(new URL(request.url).searchParams.get("leadId"), "leadId");
    const result = await new LeadCommercialCaseStore().readLead(actor, leadId);
    return result
      ? apiResponse({ ok: true, result }, { requestIdentity: identity })
      : apiResponse({ ok: false, code: "LEAD_NOT_FOUND", message: "Lead not found." }, { requestIdentity: identity, status: 404 });
  } catch (error) {
    return commandRouteFailure(error, identity);
  }
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "lead.command");
    if (!domainCommandsEnabledForTenant(actor.tenantId)) {
      return apiResponse(
        {
          ok: false,
          code: "DOMAIN_MUTATIONS_DISABLED",
          message: "Lead API mutations remain default-off until an authorized tenant/cohort cutover.",
        },
        { requestIdentity: identity, status: 503 },
      );
    }
    const command = parseLeadCommand(await request.json());
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1",
      capability: "lead.command",
      idempotencyKey: command.idempotencyKey,
      purpose: "execute-canonical-lead-command",
      sourceVersionRefs: [LEAD_COMMERCIAL_CASE_CONTRACT_VERSION],
    });
    const result = await new LeadCommercialCaseStore().executeLeadCreate({
      actor,
      command,
      correlationId: identity.correlationId,
      requestedAt: identity.requestedAt,
    });
    return apiResponse({ ok: true, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return commandRouteFailure(error, identity);
  }
}
