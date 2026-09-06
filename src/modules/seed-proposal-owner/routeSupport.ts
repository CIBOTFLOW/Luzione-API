import { apiResponse } from "@/lib/api/http";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { SeedProposalContractError } from "@/modules/seed-proposal-owner/contracts";
import { IdempotencyConflictError, SeedProposalDomainError } from "@/modules/seed-proposal-owner/store";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;

export function proposalRouteId(value: string | null, field: string) {
  const parsed = value?.trim() ?? "";
  if (!ID.test(parsed)) throw new SeedProposalContractError("INVALID_QUERY", `${field} must be a stable canonical identifier.`);
  return parsed;
}

export function seedProposalRouteFailure(error: unknown, identity: RequestIdentityEnvelope) {
  if (error instanceof SeedProposalContractError || error instanceof SeedProposalDomainError) return apiResponse({ ok: false, code: error.code, message: error.message, ...(error instanceof SeedProposalDomainError && error.recovery ? { recovery: error.recovery } : {}) }, { requestIdentity: identity, status: error.status });
  if (error instanceof IdempotencyConflictError) return apiResponse({ ok: false, code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for different proposal command bytes." }, { requestIdentity: identity, status: 409 });
  const message = error instanceof Error ? error.message : ""; const auth = /authentication|authenticated actor|credential|required capability/i.test(message);
  return apiResponse({ ok: false, code: auth ? "SERVICE_AUTH_FAILED" : "PROPOSAL_OWNER_UNAVAILABLE", message: auth ? "Service authentication is required." : "The canonical Proposal owner is unavailable." }, { requestIdentity: identity, status: auth ? 401 : 503 });
}
