import { requireServiceActor } from "@/lib/api/actor";
import { onboardingCoreEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import {
  ONBOARD_CORE_API_VERSION,
  TENANT_BLUEPRINT_MAPPING_VERSION,
  blueprintIdempotencyKey,
  parseTenantBlueprintProposal,
} from "@/modules/onboard-core/contracts";
import { onboardRouteFailure, routeUuid } from "@/modules/onboard-core/routeSupport";
import { OnboardCoreStore } from "@/modules/onboard-core/store";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "onboarding.blueprint.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "onboarding.blueprint.read",
      purpose: "read-canonical-tenant-blueprint",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION, TENANT_BLUEPRINT_MAPPING_VERSION],
    });
    const blueprintId = routeUuid(new URL(request.url).searchParams.get("blueprintId"), "blueprintId");
    const result = await new OnboardCoreStore().readBlueprint(actor, blueprintId);
    return result
      ? apiResponse({ ok: true, result }, { requestIdentity: identity })
      : apiResponse({ ok: false, code: "BLUEPRINT_NOT_FOUND", message: "Tenant Blueprint not found." }, { requestIdentity: identity, status: 404 });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "onboarding.blueprint.propose");
    if (!onboardingCoreEnabledForTenant(actor.tenantId)) {
      return apiResponse(
        { ok: false, code: "ONBOARDING_DISABLED", message: "Onboarding persistence remains default-off for this tenant." },
        { requestIdentity: identity, status: 503 },
      );
    }
    const proposal = parseTenantBlueprintProposal(await request.json());
    const serverIdempotencyKey = blueprintIdempotencyKey(actor.tenantId, proposal);
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1",
      capability: "onboarding.blueprint.propose",
      idempotencyKey: serverIdempotencyKey,
      purpose: "map-draft-tenant-pack-to-canonical-blueprint",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION, proposal.draft.contractVersion, proposal.mappingVersion],
    });
    const result = await new OnboardCoreStore().proposeBlueprint({
      actor,
      correlationId: identity.correlationId,
      proposal,
      requestedAt: identity.requestedAt,
    });
    return apiResponse({ ok: true, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}
