import { apiResponse } from "@/lib/api/http";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import { OnboardCoreContractError } from "@/modules/onboard-core/contracts";
import { SeedSupplierIdentityContractError } from "@/modules/seed-supplier-identity/contracts";
import { SeedSupplierIdentityDomainError } from "@/modules/seed-supplier-identity/store";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;

export function supplierProfileRouteId(value: string, field: string) {
  if (!ID.test(value)) throw new SeedSupplierIdentityContractError("INVALID_QUERY", `${field} must be a stable canonical identifier.`);
  return value;
}

export function requireSameTenantHumanSubject(humanTenantId: string, transportTenantId: string) {
  if (humanTenantId !== transportTenantId) {
    throw new SeedSupplierIdentityDomainError(
      "HUMAN_TENANT_MISMATCH",
      "The signed human subject and authenticated service transport must belong to the same tenant.",
      403,
    );
  }
}

export function seedSupplierIdentityRouteFailure(error: unknown, identity: RequestIdentityEnvelope) {
  if (error instanceof SeedSupplierIdentityContractError || error instanceof SeedSupplierIdentityDomainError || error instanceof OnboardCoreContractError) {
    return apiResponse({ ok: false, code: error.code, message: error.message, ...(error instanceof SeedSupplierIdentityDomainError && error.recovery ? { recovery: error.recovery } : {}) }, { requestIdentity: identity, status: error.status });
  }
  if (error instanceof IdempotencyConflictError) return apiResponse({ ok: false, code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for a different Supplier Profile command." }, { requestIdentity: identity, status: 409 });
  const message = error instanceof Error ? error.message : "";
  const authentication = /authentication|authenticated actor|credential|required capability/i.test(message);
  return apiResponse({ ok: false, code: authentication ? "SERVICE_AUTH_FAILED" : "SEED_SUPPLIER_IDENTITY_UNAVAILABLE", message: authentication ? "Service authentication is required." : "The Supplier Profile boundary is unavailable." }, { requestIdentity: identity, status: authentication ? 401 : 503 });
}
