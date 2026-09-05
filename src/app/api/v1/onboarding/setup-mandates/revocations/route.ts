import { requireServiceActor } from "@/lib/api/actor";
import { onboardingCoreEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { ONBOARD_CORE_API_VERSION, SETUP_MANDATE_REVOCATION_VERSION, parseSetupMandateRevocationRequest } from "@/modules/onboard-core/contracts";
import { HUMAN_APPROVAL_SUBJECT_VERSION, requireHumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { onboardRouteFailure } from "@/modules/onboard-core/routeSupport";
import { OnboardCoreStore } from "@/modules/onboard-core/store";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "onboarding.mandate.revoke");
    if (!onboardingCoreEnabledForTenant(actor.tenantId)) {
      return apiResponse({ ok: false, code: "ONBOARDING_DISABLED", message: "Onboarding persistence remains default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    }
    const revocation = parseSetupMandateRevocationRequest(await request.json());
    const human = await requireHumanApprovalSubject(request.headers, "onboarding.mandate.revoke");
    if (human.tenantId !== actor.tenantId) throw new Error("Human revocation tenant does not match the authenticated transport tenant.");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_HUMAN_APPROVAL",
      capability: "onboarding.mandate.revoke",
      idempotencyKey: `mandate-revocation:${revocation.mandateId}:${revocation.expectedMandateObjectVersion}`,
      purpose: "append-canonical-setup-mandate-revocation",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION, SETUP_MANDATE_REVOCATION_VERSION, HUMAN_APPROVAL_SUBJECT_VERSION],
    });
    const result = await new OnboardCoreStore().revokeMandate({ actor, correlationId: identity.correlationId, human, requestedAt: identity.requestedAt, revocation });
    return apiResponse({ ok: true, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}
