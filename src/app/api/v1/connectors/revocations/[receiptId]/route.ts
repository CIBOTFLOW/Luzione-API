import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { CONNECTOR_REVOCATION_RECEIPT_VERSION } from "@/modules/connector-revocation/contracts";
import { connectorRevocationRouteFailure } from "@/modules/connector-revocation/routeSupport";
import { ConnectorRevocationService } from "@/modules/connector-revocation/service";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ receiptId: string }> }) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "connector.revocation.read");
    const { receiptId } = await context.params;
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0_READ_ONLY",
      capability: "connector.revocation.read",
      idempotencyKey: `connector-revocation-read:${actor.tenantId}:${receiptId}`,
      purpose: "read-same-tenant-connector-revocation-receipt",
      sourceVersionRefs: [CONNECTOR_REVOCATION_RECEIPT_VERSION],
    });
    const receipt = await new ConnectorRevocationService().readById(actor.tenantId, receiptId);
    return apiResponse({ ok: true, receipt }, { requestIdentity: identity, status: 200 });
  } catch (error) {
    return connectorRevocationRouteFailure(error, identity);
  }
}
