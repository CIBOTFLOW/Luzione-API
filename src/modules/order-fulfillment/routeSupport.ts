import { apiResponse } from "@/lib/api/http";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { OrderFulfillmentContractError } from "@/modules/order-fulfillment/contracts";
import { IdempotencyConflictError, OrderFulfillmentDomainError } from "@/modules/order-fulfillment/store";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
export function routeId(value: string | null, field: string) { const result = value?.trim() ?? ""; if (!ID.test(result)) throw new OrderFulfillmentContractError("INVALID_QUERY", `${field} must be a stable canonical identifier.`); return result; }
export function orderFulfillmentRouteFailure(error: unknown, identity: RequestIdentityEnvelope) {
  if (error instanceof OrderFulfillmentContractError || error instanceof OrderFulfillmentDomainError) return apiResponse({ ok: false, code: error.code, message: error.message }, { requestIdentity: identity, status: error.status });
  if (error instanceof IdempotencyConflictError) return apiResponse({ ok: false, code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for a different command payload." }, { requestIdentity: identity, status: 409 });
  const auth = error instanceof Error && /authentication|credential|required capability/i.test(error.message); return apiResponse({ ok: false, code: auth ? "SERVICE_AUTH_FAILED" : "DOMAIN_COMMAND_UNAVAILABLE", message: auth ? "Service authentication is required." : "The domain command boundary is unavailable." }, { requestIdentity: identity, status: auth ? 401 : 503 });
}
