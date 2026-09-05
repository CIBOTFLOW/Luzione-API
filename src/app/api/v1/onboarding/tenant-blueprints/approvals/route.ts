import { requireServiceActor } from "@/lib/api/actor";
import { onboardingCoreEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import {
  ONBOARD_CORE_API_VERSION,
  parseTenantBlueprintApprovalRequest,
} from "@/modules/onboard-core/contracts";
import { onboardRouteFailure } from "@/modules/onboard-core/routeSupport";
import { OnboardCoreStore } from "@/modules/onboard-core/store";
import { HUMAN_APPROVAL_SUBJECT_VERSION, requireHumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "onboarding.blueprint.approve");
    if (!onboardingCoreEnabledForTenant(actor.tenantId)) {
      return apiResponse(
        { ok: false, code: "ONBOARDING_DISABLED", message: "Onboarding persistence remains default-off for this tenant." },
        { requestIdentity: identity, status: 503 },
      );
    }
    const approval = parseTenantBlueprintApprovalRequest(await request.json());
    const human = await requireHumanApprovalSubject(request.headers, "onboarding.blueprint.approve");
    if (human.tenantId !== actor.tenantId) throw new Error("Human approval tenant does not match the authenticated transport tenant.");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_HUMAN_APPROVAL",
      capability: "onboarding.blueprint.approve",
      purpose: "append-canonical-blueprint-approval-or-supersession",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION, HUMAN_APPROVAL_SUBJECT_VERSION, approval.expectedObjectVersion],
    });
    const result = await new OnboardCoreStore().approveBlueprint({
      actor,
      approval,
      correlationId: identity.correlationId,
      human,
      requestedAt: identity.requestedAt,
    });
    return apiResponse({ ok: true, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}
