import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { CONNECTOR_REVOCATION_RECEIPT_VERSION } from "@/modules/connector-revocation/contracts";
import { CONNECTOR_REVOCATION_RECEIPT_V2 } from "@/modules/connector-revocation/v2/contracts";
import { connectorRevocationRouteFailure } from "@/modules/connector-revocation/routeSupport";
import { CONNECTOR_REVOCATION_READBACK_V1, CONNECTOR_REVOCATION_RECEIPT_V3 } from "@/modules/connector-revocation/v3/contracts";
import { ConnectorRevocationServiceV3 } from "@/modules/connector-revocation/v3/service";
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
      purpose: "read-same-tenant-redacted-connector-revocation-readback",
      sourceVersionRefs: [CONNECTOR_REVOCATION_READBACK_V1, CONNECTOR_REVOCATION_RECEIPT_V3, CONNECTOR_REVOCATION_RECEIPT_V2, CONNECTOR_REVOCATION_RECEIPT_VERSION],
    });
    const readback = await new ConnectorRevocationServiceV3().readById(actor.tenantId, receiptId);
    return apiResponse({ ok: true, readback }, { requestIdentity: identity, status: 200 });
  } catch (error) {
    return connectorRevocationRouteFailure(error, identity);
  }
}
