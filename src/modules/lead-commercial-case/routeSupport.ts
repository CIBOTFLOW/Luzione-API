import { apiResponse } from "@/lib/api/http";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import {
  LeadCommercialCaseContractError,
} from "@/modules/lead-commercial-case/contracts";
import {
  IdempotencyConflictError,
  LeadCommercialCaseDomainError,
} from "@/modules/lead-commercial-case/store";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export function routeId(value: string | null, field: string) {
  const normalized = value?.trim() ?? "";
  if (!ID.test(normalized)) {
    throw new LeadCommercialCaseContractError("INVALID_QUERY", `${field} must be a stable canonical identifier.`);
  }
  return normalized;
}

export function commandRouteFailure(error: unknown, identity: RequestIdentityEnvelope) {
  if (error instanceof LeadCommercialCaseContractError) {
    return apiResponse(
      { ok: false, code: error.code, message: error.message },
      { requestIdentity: identity, status: error.status },
    );
  }
  if (error instanceof LeadCommercialCaseDomainError) {
    return apiResponse(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.recovery ? { recovery: error.recovery } : {}),
      },
      { requestIdentity: identity, status: error.status },
    );
  }
  if (error instanceof IdempotencyConflictError) {
    return apiResponse(
      { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for a different command payload." },
      { requestIdentity: identity, status: 409 },
    );
  }
  const message = error instanceof Error ? error.message : "";
  const authentication = /authentication|authenticated actor|credential|required capability/i.test(message);
  return apiResponse(
    {
      ok: false,
      code: authentication ? "SERVICE_AUTH_FAILED" : "DOMAIN_COMMAND_UNAVAILABLE",
      message: authentication ? "Service authentication is required." : "The domain command boundary is unavailable.",
    },
    { requestIdentity: identity, status: authentication ? 401 : 503 },
  );
}
