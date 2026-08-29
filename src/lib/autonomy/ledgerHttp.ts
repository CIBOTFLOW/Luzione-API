import { apiResponse } from "@/lib/api/http";
import { ConstitutionalLedgerStoreError } from "@/lib/autonomy/constitutionalLedgerStore";
import { CanonicalActorError } from "@/lib/control-plane/actor";
import { AutonomyRequestError } from "@/modules/autonomy/parser";
import { ControlPlaneRequestError } from "@/modules/control-plane/request";

export function constitutionalLedgerFailure(error: unknown, requestId: string) {
  if (error instanceof ConstitutionalLedgerStoreError
    || error instanceof CanonicalActorError
    || error instanceof ControlPlaneRequestError) {
    return apiResponse(
      { ok: false, code: error.code, message: error.message, externalEffectsAuthorized: false },
      { requestId, status: error.status },
    );
  }
  if (error instanceof AutonomyRequestError) {
    return apiResponse(
      { ok: false, code: error.code, message: error.message, externalEffectsAuthorized: false },
      { requestId, status: 400 },
    );
  }
  console.error(JSON.stringify({
    event: "constitutional_ledger_request_failed",
    errorCode: error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code).slice(0, 64)
      : "UNCLASSIFIED",
    requestId,
  }));
  return apiResponse(
    {
      ok: false,
      code: "CONSTITUTIONAL_LEDGER_UNAVAILABLE",
      message: "The constitutional ledger failed closed.",
      externalEffectsAuthorized: false,
    },
    { requestId, status: 503 },
  );
}
