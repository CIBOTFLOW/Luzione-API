import { requireServiceActor } from "@/lib/api/actor";
import { connectorRevocationEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { connectorRevocationRouteFailure } from "@/modules/connector-revocation/routeSupport";
import {
  CONNECTOR_REVOCATION_RECEIPT_V2,
  CONNECTOR_REVOCATION_REQUEST_V2,
  CONNECTOR_CREDENTIAL_HANDLE_V2,
  CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1,
  parseConnectorRevocationRawBodyV2,
} from "@/modules/connector-revocation/v2/contracts";
import { ConnectorRevocationServiceV2 } from "@/modules/connector-revocation/v2/service";
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
    const parsed = parseConnectorRevocationRawBodyV2(await request.text());
    const revocation = parsed.request;
    const human = await requireHumanApprovalSubject(request.headers, revocation.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE" ? "connector.revocation.forward_recovery" : "connector.revocation.request");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_HUMAN_APPROVAL",
      capability: "connector.revocation.request",
      idempotencyKey: `connector-revocation-v2-route:${actor.tenantId}:${revocation.operationKey}`,
      purpose: "append-emulator-only-connector-revocation-receipt",
      sourceVersionRefs: [CONNECTOR_REVOCATION_REQUEST_V2, CONNECTOR_REVOCATION_RECEIPT_V2, CONNECTOR_CREDENTIAL_HANDLE_V2, CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1, HUMAN_APPROVAL_SUBJECT_VERSION],
    });
    const result = await new ConnectorRevocationServiceV2().execute({ actor, correlationId: identity.correlationId, human, rawBodyDigest: parsed.rawBodyDigest, request: revocation, requestedAt: identity.requestedAt });
    const status = result.receipt.remoteFinality === "RECONCILING" || result.receipt.remoteFinality === "ACKNOWLEDGED" ? 202
      : result.receipt.remoteFinality === "REVOKED" || result.receipt.recoveryState === "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT" ? (result.commandReceipt.idempotentReplay ? 200 : 201)
        : 409;
    return apiResponse({ ok: result.receipt.remoteFinality === "REVOKED" || result.receipt.recoveryState === "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT", result }, { requestIdentity: identity, status });
  } catch (error) {
    return connectorRevocationRouteFailure(error, identity);
  }
}
