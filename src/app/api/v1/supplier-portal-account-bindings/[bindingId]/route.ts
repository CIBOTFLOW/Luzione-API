import { requireServiceActor } from "@/lib/api/actor";
import { seedSupplierIdentityReadsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { PORTAL_ACCOUNT_ACCESS_BINDING_VERSION, PortalAccountAccessBindingStore } from "@/modules/seed-supplier-identity/portalAccessBinding";
import { seedSupplierIdentityRouteFailure, supplierProfileRouteId } from "@/modules/seed-supplier-identity/routeSupport";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ bindingId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "supplier.portal.account_binding.read");
    if (!seedSupplierIdentityReadsEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "SEED_SUPPLIER_IDENTITY_READS_DISABLED", message: "Portal Account access-binding reads remain default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    const bindingId = supplierProfileRouteId((await context.params).bindingId, "bindingId");
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A0", capability: "supplier.portal.account_binding.read", purpose: "read-portal-account-binding", sourceVersionRefs: [PORTAL_ACCOUNT_ACCESS_BINDING_VERSION] });
    const result = await new PortalAccountAccessBindingStore().read(actor, bindingId);
    if (!result) return apiResponse({ ok: false, code: "PORTAL_ACCOUNT_BINDING_NOT_FOUND", message: "Portal Account access binding not found for this tenant." }, { requestIdentity: identity, status: 404 });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity });
  } catch (error) {
    return seedSupplierIdentityRouteFailure(error, identity);
  }
}
