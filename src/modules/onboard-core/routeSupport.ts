import { apiResponse } from "@/lib/api/http";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import { OnboardCoreContractError } from "./contracts";
import { OnboardCoreBindingError } from "./sourceBinding";
import { OnboardCoreDomainError } from "./store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function routeUuid(value: string | null, field: string) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new OnboardCoreContractError("INVALID_QUERY", `${field} must be an exact UUID.`);
  }
  return value;
}

export function onboardRouteFailure(error: unknown, identity: RequestIdentityEnvelope) {
  if (error instanceof OnboardCoreContractError || error instanceof OnboardCoreBindingError || error instanceof OnboardCoreDomainError) {
    return apiResponse(
      { ok: false, code: error.code, message: error.message },
      { requestIdentity: identity, status: error.status },
    );
  }
  if (error instanceof IdempotencyConflictError) {
    return apiResponse(
      { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "The server-derived idempotency reservation conflicts with the original payload." },
      { requestIdentity: identity, status: 409 },
    );
  }
  const message = error instanceof Error ? error.message : "";
  const authentication = /authentication|authenticated actor|credential|required capability/i.test(message);
  return apiResponse(
    {
      ok: false,
      code: authentication ? "SERVICE_AUTH_FAILED" : "ONBOARDING_UNAVAILABLE",
      message: authentication ? "Service authentication is required." : "The onboarding boundary is unavailable.",
    },
    { requestIdentity: identity, status: authentication ? 401 : 503 },
  );
}
