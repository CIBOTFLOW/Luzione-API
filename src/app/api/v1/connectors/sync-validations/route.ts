import { requireServiceActor } from "@/lib/api/actor";
import { connectorSyncValidationEnabledForTenant } from "@/lib/api/config";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import {
  CONNECTOR_SYNC_VALIDATION_VERSION,
  connectorValidationReservation,
  parseConnectorSyncValidationRequest,
} from "@/modules/onboard-core/connectorContracts";
import { ConnectorSyncValidationService } from "@/modules/onboard-core/connectorService";
import { ONBOARD_CORE_API_VERSION } from "@/modules/onboard-core/contracts";
import { onboardRouteFailure } from "@/modules/onboard-core/routeSupport";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "connector.sync_validation.execute");
    if (!connectorSyncValidationEnabledForTenant(actor.tenantId)) {
      return apiResponse(
        { ok: false, code: "CONNECTOR_VALIDATION_DISABLED", message: "Sandbox connector validation remains default-off for this tenant and destination." },
        { requestIdentity: identity, status: 503 },
      );
    }
    const validation = parseConnectorSyncValidationRequest(await request.json());
    const reservation = connectorValidationReservation(actor.tenantId, validation);
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1_NO_EFFECT_SANDBOX",
      capability: "connector.sync_validation.execute",
      idempotencyKey: reservation.idempotencyKey,
      purpose: "reserve-dispatch-and-read-back-one-sandbox-connector-validation",
      sourceVersionRefs: [ONBOARD_CORE_API_VERSION, CONNECTOR_SYNC_VALIDATION_VERSION, validation.binding.contractVersion],
    });
    const result = await new ConnectorSyncValidationService().execute({
      actor,
      correlationId: identity.correlationId,
      request: validation,
      requestedAt: identity.requestedAt,
    });
    const status = result.validationOutcome.state === "RECONCILING"
      ? 202
      : result.validationOutcome.success && result.commandReceipt.idempotentReplay
        ? 200
        : result.validationOutcome.success
          ? 201
          : result.validationOutcome.state === "VERSION_MISMATCH" || result.validationOutcome.state === "BLOCKED"
            ? 409
            : 503;
    return apiResponse({ ok: result.validationOutcome.success, result }, { requestIdentity: identity, status });
  } catch (error) {
    return onboardRouteFailure(error, identity);
  }
}
