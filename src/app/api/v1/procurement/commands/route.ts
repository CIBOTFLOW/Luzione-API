import { requireServiceActor } from "@/lib/api/actor";
import { seedProcurementEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { HUMAN_APPROVAL_SUBJECT_VERSION, requireHumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { SEED_PROCUREMENT_COMMAND_VERSION, parseSeedProcurementCommand } from "@/modules/seed-procurement/contracts";
import { seedProcurementRouteFailure } from "@/modules/seed-procurement/routeSupport";
import { SeedProcurementStore } from "@/modules/seed-procurement/store";
import { requireSameTenantHumanSubject } from "@/modules/seed-supplier-identity/routeSupport";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "procurement.command");
    if (!seedProcurementEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "SEED_PROCUREMENT_DISABLED", message: "Seed procurement remains default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    const command = parseSeedProcurementCommand(await request.json());
    const human = command.commandType === "procurement_selection.record" ? await requireHumanApprovalSubject(request.headers, "procurement.selection.record") : undefined;
    if (human) requireSameTenantHumanSubject(human.tenantId, actor.tenantId);
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: human ? "A2_HUMAN_APPROVAL_NO_EFFECT" : "A1_NO_EFFECT", capability: "procurement.command", idempotencyKey: command.idempotencyKey, purpose: `seed-procurement-${command.commandType}`, sourceVersionRefs: [SEED_PROCUREMENT_COMMAND_VERSION, command.expectedVersion, ...(human ? [HUMAN_APPROVAL_SUBJECT_VERSION] : [])] });
    const result = await new SeedProcurementStore().execute({ actor, command, correlationId: identity.correlationId, human, requestedAt: identity.requestedAt });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity, status: "receipt" in result && result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return seedProcurementRouteFailure(error, identity);
  }
}
