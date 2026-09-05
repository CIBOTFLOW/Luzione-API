import { requireServiceActor } from "@/lib/api/actor";
import { seedProcurementEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { SEED_PROCUREMENT_COMMAND_VERSION, parseSeedProcurementCommand } from "@/modules/seed-procurement/contracts";
import { seedProcurementRouteFailure } from "@/modules/seed-procurement/routeSupport";
import { SeedProcurementStore } from "@/modules/seed-procurement/store";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "procurement.command");
    if (!seedProcurementEnabledForTenant(actor.tenantId)) return apiResponse({ ok: false, code: "SEED_PROCUREMENT_DISABLED", message: "Seed procurement remains default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    const command = parseSeedProcurementCommand(await request.json());
    identity = bindAuthenticatedRequestIdentity(identity, actor, { authorityClass: "A1_NO_EFFECT", capability: "procurement.command", idempotencyKey: command.idempotencyKey, purpose: `seed-procurement-${command.commandType}`, sourceVersionRefs: [SEED_PROCUREMENT_COMMAND_VERSION, command.expectedVersion] });
    const result = await new SeedProcurementStore().execute({ actor, command, correlationId: identity.correlationId, requestedAt: identity.requestedAt });
    return apiResponse({ ok: true, responseContractVersion: API_HTTP_RESPONSE_VERSION, result }, { requestIdentity: identity, status: "receipt" in result && result.receipt.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return seedProcurementRouteFailure(error, identity);
  }
}
