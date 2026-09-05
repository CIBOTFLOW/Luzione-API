import { requireServiceActor } from "@/lib/api/actor";
import { seedSupplierIdentityCommandsEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { HUMAN_APPROVAL_SUBJECT_VERSION, requireHumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { SUPPLIER_PROFILE_COMMAND_VERSION, parseSeedSupplierIdentityCommand } from "@/modules/seed-supplier-identity/contracts";
import { seedSupplierIdentityRouteFailure } from "@/modules/seed-supplier-identity/routeSupport";
import { SeedSupplierIdentityStore } from "@/modules/seed-supplier-identity/store";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "supplier.profile.command");
    if (!seedSupplierIdentityCommandsEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "SEED_SUPPLIER_IDENTITY_COMMANDS_DISABLED", message: "Supplier Profile commands remain default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    const command = parseSeedSupplierIdentityCommand(await request.json());
    const requiredHumanCapability = command.commandType === "supplier_profile.transition"
      ? `supplier.profile.${command.action.toLowerCase()}`
      : command.commandType === "supplier_profile.propose"
        ? "supplier.profile.propose"
        : "supplier.profile.revise";
    const human = await requireHumanApprovalSubject(request.headers, requiredHumanCapability);
    if (human.tenantId !== actor.tenantId) throw new Error("Human subject tenant does not match the authenticated transport tenant.");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: command.commandType === "supplier_profile.transition" ? "A2_HUMAN_APPROVAL_NO_EFFECT" : "A1_HUMAN_PROPOSAL_NO_EFFECT",
      capability: "supplier.profile.command",
      idempotencyKey: command.idempotencyKey,
      purpose: `seed-supplier-identity-${command.commandType}`,
      sourceVersionRefs: [SUPPLIER_PROFILE_COMMAND_VERSION, command.expectedVersion, HUMAN_APPROVAL_SUBJECT_VERSION],
    });
    const result = await new SeedSupplierIdentityStore().execute({ actor, command, correlationId: identity.correlationId, human, requestedAt: identity.requestedAt });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity, status: result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return seedSupplierIdentityRouteFailure(error, identity);
  }
}
