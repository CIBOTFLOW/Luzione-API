import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { ONBOARD_CORE_API_VERSION } from "@/modules/onboard-core/contracts";
import { ONBOARD_IMPORT_MAPPING_VERSION } from "@/modules/onboard-core/importContracts";
import { OnboardImportStore } from "@/modules/onboard-core/importStore";
import { onboardRouteFailure, routeUuid } from "@/modules/onboard-core/routeSupport";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ batchId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "onboarding.import.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "onboarding.import.read",
      purpose: "read-canonical-import-dry-run-receipt",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION, ONBOARD_IMPORT_MAPPING_VERSION],
    });
    const batchId = routeUuid((await context.params).batchId, "batchId");
    const result = await new OnboardImportStore().readDryRun(actor, batchId);
    return result
      ? apiResponse({ ok: true, result }, { requestIdentity: identity })
      : apiResponse({ ok: false, code: "IMPORT_BATCH_NOT_FOUND", message: "Import Batch not found." }, { requestIdentity: identity, status: 404 });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}
