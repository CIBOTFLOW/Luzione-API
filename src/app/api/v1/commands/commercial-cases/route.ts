import { requireServiceActor } from "@/lib/api/actor";
import { domainCommandsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import {
  LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
  parseCommercialCaseCommand,
} from "@/modules/lead-commercial-case/contracts";
import { commandRouteFailure, routeId } from "@/modules/lead-commercial-case/routeSupport";
import { LeadCommercialCaseStore } from "@/modules/lead-commercial-case/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "commercial_case.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "commercial_case.read",
      purpose: "read-canonical-commercial-case",
      sourceVersionRefs: [LEAD_COMMERCIAL_CASE_CONTRACT_VERSION],
    });
    const caseId = routeId(new URL(request.url).searchParams.get("caseId"), "caseId");
    const result = await new LeadCommercialCaseStore().readCommercialCase(actor, caseId);
    return result
      ? apiResponse({ ok: true, result }, { requestIdentity: identity })
      : apiResponse({ ok: false, code: "CASE_NOT_FOUND", message: "Commercial Case not found." }, { requestIdentity: identity, status: 404 });
  } catch (error) {
    return commandRouteFailure(error, identity);
  }
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "commercial_case.command");
    if (!domainCommandsEnabledForTenant(actor.tenantId)) {
      return apiResponse(
        {
          ok: false,
          code: "DOMAIN_MUTATIONS_DISABLED",
          message: "Commercial Case API mutations remain default-off until an authorized tenant/cohort cutover.",
        },
        { requestIdentity: identity, status: 503 },
      );
    }
    const command = parseCommercialCaseCommand(await request.json());
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1",
      capability: "commercial_case.command",
      idempotencyKey: command.idempotencyKey,
      purpose: "execute-canonical-commercial-case-command",
      sourceVersionRefs: [LEAD_COMMERCIAL_CASE_CONTRACT_VERSION],
    });
    const result = await new LeadCommercialCaseStore().executeCommercialCase({
      actor,
      command,
      correlationId: identity.correlationId,
      requestedAt: identity.requestedAt,
    });
    return apiResponse(
      { ok: true, result },
      {
        requestIdentity: identity,
        status: result.receipt.idempotentReplay || command.commandType !== "commercial_case.create" ? 200 : 201,
      },
    );
  } catch (error) {
    return commandRouteFailure(error, identity);
  }
}
