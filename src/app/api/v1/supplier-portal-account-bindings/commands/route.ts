import { requireServiceActor } from "@/lib/api/actor";
import { seedSupplierIdentityCommandsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION, PortalAccountAccessBindingStore, parsePortalAccountAccessBindingCommand } from "@/modules/seed-supplier-identity/portalAccessBinding";
import { requireSameTenantHumanSubject, seedSupplierIdentityRouteFailure } from "@/modules/seed-supplier-identity/routeSupport";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";
import { HUMAN_APPROVAL_SUBJECT_VERSION, requireHumanApprovalSubject } from "@/modules/onboard-core/humanApproval";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "supplier.portal.account_binding.command");
    if (!seedSupplierIdentityCommandsEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "SEED_SUPPLIER_IDENTITY_COMMANDS_DISABLED", message: "Portal Account access-binding commands remain default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    const command = parsePortalAccountAccessBindingCommand(await request.json());
    const humanCapability = command.commandType === "portal_account_access_binding.record" ? "supplier.portal.account_binding.record" : "supplier.portal.account_binding.revoke";
    const human = await requireHumanApprovalSubject(request.headers, humanCapability);
    requireSameTenantHumanSubject(human.tenantId, actor.tenantId);
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A2_HUMAN_APPROVAL_NO_EFFECT", capability: "supplier.portal.account_binding.command", idempotencyKey: command.idempotencyKey, purpose: command.commandType, sourceVersionRefs: [PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION, command.expectedVersion, HUMAN_APPROVAL_SUBJECT_VERSION] });
    const result = await new PortalAccountAccessBindingStore().execute({ actor, command, correlationId: identity.correlationId, human, requestedAt: identity.requestedAt });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return seedSupplierIdentityRouteFailure(error, identity);
  }
}
