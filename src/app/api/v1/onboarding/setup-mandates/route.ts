import { requireServiceActor } from "@/lib/api/actor";
import { onboardingCoreEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { ONBOARD_CORE_API_VERSION, parseSetupMandateRequest } from "@/modules/onboard-core/contracts";
import { onboardRouteFailure, routeUuid } from "@/modules/onboard-core/routeSupport";
import { OnboardCoreStore } from "@/modules/onboard-core/store";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "onboarding.mandate.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "onboarding.mandate.read",
      purpose: "read-canonical-setup-mandate",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION],
    });
    const mandateId = routeUuid(new URL(request.url).searchParams.get("mandateId"), "mandateId");
    const result = await new OnboardCoreStore().readMandate(actor, mandateId);
    return result
      ? apiResponse({ ok: true, result }, { requestIdentity: identity })
      : apiResponse({ ok: false, code: "MANDATE_NOT_FOUND", message: "Setup Mandate not found." }, { requestIdentity: identity, status: 404 });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "onboarding.mandate.issue");
    if (!onboardingCoreEnabledForTenant(actor.tenantId)) {
      return apiResponse(
        { ok: false, code: "ONBOARDING_DISABLED", message: "Onboarding persistence remains default-off for this tenant." },
        { requestIdentity: identity, status: 503 },
      );
    }
    const mandateRequest = parseSetupMandateRequest(await request.json());
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1",
      capability: "onboarding.mandate.issue",
      purpose: "issue-expiring-no-effect-setup-mandate",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION, mandateRequest.expectedBlueprintObjectVersion],
    });
    const result = await new OnboardCoreStore().issueMandate({
      actor,
      correlationId: identity.correlationId,
      mandateRequest,
      requestedAt: identity.requestedAt,
    });
    return apiResponse({ ok: true, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}
