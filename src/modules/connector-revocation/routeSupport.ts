import { apiResponse } from "@/lib/api/http";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import { ConnectorRevocationContractError } from "./contracts";
import { ConnectorRevocationV2Error } from "./v2/contracts";

export function connectorRevocationRouteFailure(error: unknown, identity: RequestIdentityEnvelope) {
  if (error instanceof ConnectorRevocationContractError || error instanceof ConnectorRevocationV2Error) {
    return apiResponse({ ok: false, code: error.code, message: error.message }, { requestIdentity: identity, status: error.status });
  }
  if (error instanceof IdempotencyConflictError) {
    return apiResponse({ ok: false, code: "IDEMPOTENCY_CONFLICT", message: "The server reservation already binds a different payload or human authority." }, { requestIdentity: identity, status: 409 });
  }
  const message = error instanceof Error ? error.message : "";
  const authentication = /authentication|authenticated actor|required capability|credential/i.test(message);
  return apiResponse(
    { ok: false, code: authentication ? "AUTHENTICATION_FAILED" : "CONNECTOR_REVOCATION_UNAVAILABLE", message: authentication ? "Service and genuine-human authentication are required." : "Connector revocation is unavailable and failed closed." },
    { requestIdentity: identity, status: authentication ? 401 : 503 },
  );
}
