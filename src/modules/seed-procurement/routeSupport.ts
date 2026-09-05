import { apiResponse } from "@/lib/api/http";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import { SeedProcurementContractError } from "@/modules/seed-procurement/contracts";
import { SeedProcurementDomainError } from "@/modules/seed-procurement/store";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;

export function procurementRouteId(value: string, field: string) {
  if (!ID.test(value)) throw new SeedProcurementContractError("INVALID_QUERY", `${field} must be a stable canonical identifier.`);
  return value;
}

export function seedProcurementRouteFailure(error: unknown, identity: RequestIdentityEnvelope) {
  if (error instanceof SeedProcurementContractError || error instanceof SeedProcurementDomainError) {
    return apiResponse({ ok: false, code: error.code, message: error.message, ...(error instanceof SeedProcurementDomainError && error.recovery ? { recovery: error.recovery } : {}) }, { requestIdentity: identity, status: error.status });
  }
  if (error instanceof IdempotencyConflictError) return apiResponse({ ok: false, code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for a different command payload." }, { requestIdentity: identity, status: 409 });
  const message = error instanceof Error ? error.message : "";
  const authentication = /authentication|authenticated actor|credential|required capability/i.test(message);
  return apiResponse({ ok: false, code: authentication ? "SERVICE_AUTH_FAILED" : "SEED_PROCUREMENT_UNAVAILABLE", message: authentication ? "Service authentication is required." : "The seed procurement boundary is unavailable." }, { requestIdentity: identity, status: authentication ? 401 : 503 });
}
