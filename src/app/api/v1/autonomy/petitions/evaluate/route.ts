import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, requestId } from "@/lib/api/http";
import { AutonomyRequestError } from "@/modules/autonomy/parser";
import { evaluateConstitutionalPetition } from "@/modules/autonomy/petition";
import { parseConstitutionalPetitionRequest } from "@/modules/autonomy/petitionParser";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 48 * 1024;

function statusFor(error: unknown) {
  if (error instanceof AutonomyRequestError) return 400;
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (/authentication|tenant|actor/i.test(message)) return 401;
  return 503;
}

export async function POST(request: Request) {
  const id = requestId(request.headers);
  try {
    const actor = await requireServiceActor(request.headers);
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
      evaluatedOnly: true,
      evaluation: evaluateConstitutionalPetition(
        parseConstitutionalPetitionRequest(body),
        actor.actorId,
      ),
      externalEffectsAuthorized: false,
      ok: true,
    }, { requestId: id });
  } catch (error) {
    return apiResponse({
      code: error instanceof AutonomyRequestError ? error.code : "PETITION_EVALUATION_FAILED",
      externalEffectsAuthorized: false,
      message: error instanceof Error ? error.message : "Constitutional petition evaluation failed closed.",
      ok: false,
    }, { requestId: id, status: statusFor(error) });
  }
}
