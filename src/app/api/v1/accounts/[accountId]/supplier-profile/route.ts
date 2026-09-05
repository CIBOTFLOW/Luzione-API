import { requireServiceActor } from "@/lib/api/actor";
import { seedSupplierIdentityReadsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { SUPPLIER_PROFILE_CONTRACT_VERSION } from "@/modules/seed-supplier-identity/contracts";
import { createSupplierProfileReadModel } from "@/modules/seed-supplier-identity/readModel";
import { seedSupplierIdentityRouteFailure, supplierProfileRouteId } from "@/modules/seed-supplier-identity/routeSupport";
import { SeedSupplierIdentityStore } from "@/modules/seed-supplier-identity/store";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ accountId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "supplier.profile.read");
    if (!seedSupplierIdentityReadsEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "SEED_SUPPLIER_IDENTITY_READS_DISABLED", message: "Supplier Profile reads remain default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    const accountId = supplierProfileRouteId((await context.params).accountId, "accountId");
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A0", capability: "supplier.profile.read", purpose: "read-account-supplier-profile", sourceVersionRefs: [SUPPLIER_PROFILE_CONTRACT_VERSION] });
    const observedAt = new Date().toISOString();
    const readback = await new SeedSupplierIdentityStore().readByAccountWithTimeline(actor, accountId, observedAt);
    if (!readback) return apiResponse({ ok: false, code: "SUPPLIER_PROFILE_NOT_FOUND", message: "Supplier Profile not found for this tenant Account." }, { requestIdentity: identity, status: 404 });
    const result = createSupplierProfileReadModel(readback.supplierProfile, readback.timelineEvent, { observedAt, releaseIdentity: createReleaseIdentity({ mutationsEnabled: false }), tenantId: actor.tenantId });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity });
  } catch (error) {
    return seedSupplierIdentityRouteFailure(error, identity);
  }
}
