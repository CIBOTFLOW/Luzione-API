import { requireServiceActor } from "@/lib/api/actor";
import { onboardingCoreEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { ONBOARD_CORE_API_VERSION } from "@/modules/onboard-core/contracts";
import {
  ONBOARD_IMPORT_MAPPING_VERSION_V2,
  importReservation,
  parseImportDryRunRequest,
} from "@/modules/onboard-core/importContracts";
import { OnboardImportStore } from "@/modules/onboard-core/importStore";
import { onboardRouteFailure } from "@/modules/onboard-core/routeSupport";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "onboarding.import.dry_run");
    if (!onboardingCoreEnabledForTenant(actor.tenantId)) {
      return apiResponse(
        { ok: false, code: "ONBOARDING_DISABLED", message: "Onboarding dry-run persistence remains default-off for this tenant." },
        { requestIdentity: identity, status: 503 },
      );
    }
    const dryRun = parseImportDryRunRequest(await request.json());
    const reservation = importReservation(actor.tenantId, dryRun);
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_NO_EFFECT",
      capability: "onboarding.import.dry_run",
      idempotencyKey: reservation.idempotencyKey,
      purpose: "stage-and-validate-import-digests-without-crm-commit",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION, ONBOARD_IMPORT_MAPPING_VERSION_V2, dryRun.expectedMandateObjectVersion],
    });
    const result = await new OnboardImportStore().executeDryRun({
      actor,
      correlationId: identity.correlationId,
      request: dryRun,
      requestedAt: identity.requestedAt,
    });
    return apiResponse({ ok: true, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}
