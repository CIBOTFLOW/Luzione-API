import { apiResponse } from "@/lib/api/http";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { ProjectPublicationContractError } from "@/modules/seed-project-publication/contracts";
import {
  IdempotencyConflictError,
  ProjectPublicationDomainError,
} from "@/modules/seed-project-publication/store";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;

export function projectRouteId(value: string | null, field: string) {
  const normalized = value?.trim() ?? "";
  if (!ID.test(normalized)) throw new ProjectPublicationContractError("INVALID_QUERY", `${field} must be a stable canonical identifier.`);
  return normalized;
}

export function projectRouteLimit(value: string | null) {
  if (value === null || value === "") return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ProjectPublicationContractError("INVALID_QUERY", "limit must be an integer from 1 through 100.");
  }
  return parsed;
}

export function projectPublicationRouteFailure(error: unknown, identity: RequestIdentityEnvelope) {
  if (error instanceof ProjectPublicationContractError || error instanceof ProjectPublicationDomainError) {
    return apiResponse({
      ok: false,
      code: error.code,
      message: error.message,
      ...(error instanceof ProjectPublicationDomainError && error.recovery ? { recovery: error.recovery } : {}),
    }, { requestIdentity: identity, status: error.status });
  }
  if (error instanceof IdempotencyConflictError) {
    return apiResponse({
      ok: false,
      code: "IDEMPOTENCY_CONFLICT",
      message: "The idempotency key was already used for a different command payload.",
    }, { requestIdentity: identity, status: 409 });
  }
  const message = error instanceof Error ? error.message : "";
  const authentication = /authentication|authenticated actor|credential|required capability/i.test(message);
  return apiResponse({
    ok: false,
    code: authentication ? "SERVICE_AUTH_FAILED" : "PROJECT_PUBLICATION_UNAVAILABLE",
    message: authentication ? "Service authentication is required." : "The Project publication boundary is unavailable.",
  }, { requestIdentity: identity, status: authentication ? 401 : 503 });
}
