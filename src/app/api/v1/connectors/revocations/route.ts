import { requireServiceActor } from "@/lib/api/actor";
import { connectorRevocationEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import {
  CONNECTOR_REVOCATION_RECEIPT_VERSION,
  CONNECTOR_REVOCATION_REQUEST_VERSION,
  parseConnectorRevocationRequest,
  revocationReservation,
} from "@/modules/connector-revocation/contracts";
import { connectorRevocationRouteFailure } from "@/modules/connector-revocation/routeSupport";
import { ConnectorRevocationService } from "@/modules/connector-revocation/service";
import { HUMAN_APPROVAL_SUBJECT_VERSION, requireHumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "connector.revocation.request");
    if (!connectorRevocationEnabledForTenant(actor.tenantId)) {
      return apiResponse({ ok: false, code: "CONNECTOR_REVOCATION_DISABLED", message: "Connector revocation remains default-off for this tenant and emulator destination." }, { requestIdentity: identity, status: 503 });
    }
    const revocation = parseConnectorRevocationRequest(await request.json());
    const human = await requireHumanApprovalSubject(request.headers, revocation.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE" ? "connector.revocation.forward_recovery" : "connector.revocation.request");
    const reservation = revocationReservation(actor.tenantId, revocation);
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_HUMAN_APPROVAL",
      capability: "connector.revocation.request",
      idempotencyKey: reservation.idempotencyKey,
      purpose: "append-emulator-only-connector-revocation-receipt",
      sourceVersionRefs: [CONNECTOR_REVOCATION_REQUEST_VERSION, CONNECTOR_REVOCATION_RECEIPT_VERSION, revocation.binding.contractVersion, HUMAN_APPROVAL_SUBJECT_VERSION],
    });
    const result = await new ConnectorRevocationService().execute({ actor, correlationId: identity.correlationId, human, request: revocation, requestedAt: identity.requestedAt });
    const status = result.receipt.remoteFinality === "RECONCILING" || result.receipt.remoteFinality === "ACKNOWLEDGED" ? 202
      : result.receipt.remoteFinality === "REVOKED" || result.receipt.recoveryState === "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT" ? (result.commandReceipt.idempotentReplay ? 200 : 201)
        : 409;
    return apiResponse({ ok: result.receipt.remoteFinality === "REVOKED" || result.receipt.recoveryState === "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT", result }, { requestIdentity: identity, status });
  } catch (error) {
    return connectorRevocationRouteFailure(error, identity);
  }
}
