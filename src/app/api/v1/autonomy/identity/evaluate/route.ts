import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { evaluateIdentityCandidate } from "@/modules/autonomy/identity";
import { parseIdentityCandidateRequest } from "@/modules/autonomy/identityParser";
import { AutonomyRequestError } from "@/modules/autonomy/parser";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 32 * 1024;

function statusFor(error: unknown) {
  if (error instanceof AutonomyRequestError) return 400;
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (/authentication|tenant|actor/i.test(message)) return 401;
  return 503;
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "sultan.identity.evaluate");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "sultan.identity.evaluate",
      purpose: "evaluate-identity-candidate",
    });
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      throw new AutonomyRequestError("INVALID_REQUEST", "Request body is too large.");
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      throw new AutonomyRequestError("INVALID_REQUEST", "Request body is too large.");
    }
    let body: unknown;
    try { body = JSON.parse(raw); } catch {
      throw new AutonomyRequestError("INVALID_REQUEST", "Request body must be valid JSON.");
    }
    return apiResponse({
      evaluation: evaluateIdentityCandidate(parseIdentityCandidateRequest(body)),
      evaluatedOnly: true,
      externalEffectsAuthorized: false,
      ok: true,
    }, { requestIdentity: identity });
  } catch (error) {
    return apiResponse({
      code: error instanceof AutonomyRequestError ? error.code : "IDENTITY_EVALUATION_FAILED",
      externalEffectsAuthorized: false,
      message: error instanceof Error ? error.message : "Identity candidate evaluation failed closed.",
      ok: false,
    }, { requestIdentity: identity, status: statusFor(error) });
  }
}
