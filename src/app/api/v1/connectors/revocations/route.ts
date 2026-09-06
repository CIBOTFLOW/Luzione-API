import { requireServiceActor } from "@/lib/api/actor";
import { connectorRevocationEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { connectorRevocationRouteFailure } from "@/modules/connector-revocation/routeSupport";
import { CONNECTOR_REVOCATION_REQUEST_VERSION } from "@/modules/connector-revocation/contracts";
import {
  CONNECTOR_REVOCATION_REQUEST_V2,
  parseConnectorRevocationRawBodyV2,
} from "@/modules/connector-revocation/v2/contracts";
import {
  CONNECTOR_BINDING_READBACK_V1,
  CONNECTOR_REVOCATION_READBACK_V1,
  CONNECTOR_REVOCATION_RECEIPT_V3,
  CONNECTOR_REVOCATION_REQUEST_V3,
  ConnectorRevocationV3Error,
  decodeConnectorRevocationRawBody,
  parseConnectorRevocationRawBodyV3,
} from "@/modules/connector-revocation/v3/contracts";
import { ConnectorRevocationServiceV3 } from "@/modules/connector-revocation/v3/service";
import { HUMAN_APPROVAL_SUBJECT_VERSION, requireHumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "connector.revocation.request");
    const rawBody = await request.text();
    const decoded = decodeConnectorRevocationRawBody(rawBody);
    if (decoded.version === CONNECTOR_REVOCATION_REQUEST_VERSION) {
      throw new ConnectorRevocationV3Error("VERSION_RETIRED", "ConnectorRevocationRequest/v1 is retired and cannot reserve or replay.", 409);
    }
    if (decoded.version !== CONNECTOR_REVOCATION_REQUEST_V2 && decoded.version !== CONNECTOR_REVOCATION_REQUEST_V3) {
      throw new ConnectorRevocationV3Error("WRONG_VERSION", "Only ConnectorRevocationRequest/v2 exact replay or /v3 is admitted.");
    }
    const service = new ConnectorRevocationServiceV3();
    if (decoded.version === CONNECTOR_REVOCATION_REQUEST_V2) {
      const parsed = parseConnectorRevocationRawBodyV2(rawBody);
      const human = await requireHumanApprovalSubject(request.headers, parsed.request.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE" ? "connector.revocation.forward_recovery" : "connector.revocation.request");
      identity = bindAuthenticatedRequestIdentity(identity, actor, {
        authorityClass: "A0_READ_ONLY",
        capability: "connector.revocation.read",
        idempotencyKey: `connector-revocation-v2-replay:${actor.tenantId}:${parsed.request.operationKey}`,
        purpose: "redact-exact-existing-v2-connector-revocation-replay",
        sourceVersionRefs: [CONNECTOR_REVOCATION_REQUEST_V2, CONNECTOR_REVOCATION_READBACK_V1, HUMAN_APPROVAL_SUBJECT_VERSION],
      });
      const replay = await service.replayLegacyV2({ actor, human, rawBodyDigest: parsed.rawBodyDigest, request: parsed.request });
      return apiResponse({ ok: true, readback: replay.readback }, { requestIdentity: identity, status: 200 });
    }
    if (!connectorRevocationEnabledForTenant(actor.tenantId)) {
      return apiResponse({ ok: false, code: "CONNECTOR_REVOCATION_DISABLED", message: "Connector revocation remains default-off for this tenant." }, { requestIdentity: identity, status: 503 });
    }
    const parsed = parseConnectorRevocationRawBodyV3(rawBody);
    const human = await requireHumanApprovalSubject(request.headers, parsed.request.operation.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE" ? "connector.revocation.forward_recovery" : "connector.revocation.request");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_HUMAN_APPROVAL",
      capability: "connector.revocation.request",
      idempotencyKey: `connector-revocation-v3-route:${actor.tenantId}:${parsed.request.operationKey}`,
      purpose: "append-locator-free-no-effect-connector-revocation-evidence",
      sourceVersionRefs: [CONNECTOR_REVOCATION_REQUEST_V3, CONNECTOR_REVOCATION_RECEIPT_V3, CONNECTOR_BINDING_READBACK_V1, CONNECTOR_REVOCATION_READBACK_V1, HUMAN_APPROVAL_SUBJECT_VERSION],
    });
    const result = await service.execute({ actor, correlationId: identity.correlationId, human, rawBodyDigest: parsed.rawBodyDigest, request: parsed.request, requestedAt: identity.requestedAt });
    const status = result.commandReceipt.idempotentReplay ? 200 : result.readback.recoveryState === "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT" ? 201 : 202;
    return apiResponse({ ok: true, readback: result.readback }, { requestIdentity: identity, status });
  } catch (error) {
    return connectorRevocationRouteFailure(error, identity);
  }
}
