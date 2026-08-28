import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, requestId } from "@/lib/api/http";
import { evaluateAutonomyPlan } from "@/modules/autonomy/evaluator";
import {
  AutonomyRequestError,
  parseAutonomyEvaluationRequest,
} from "@/modules/autonomy/parser";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 32 * 1024;

function statusFor(error: unknown) {
  if (error instanceof AutonomyRequestError) return 400;
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (/authentication|tenant|actor/i.test(message)) return 401;
  if (/not configured/i.test(message)) return 503;
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
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      throw new AutonomyRequestError("INVALID_REQUEST", "Request body is too large.");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new AutonomyRequestError("INVALID_REQUEST", "Request body must be valid JSON.");
    }
    const plan = parseAutonomyEvaluationRequest(body);
    const evaluation = evaluateAutonomyPlan(plan, {
      actor: {
        actorId: actor.actorId,
        actorType: actor.actorType,
        tenantId: actor.tenantId,
      },
      now: new Date().toISOString(),
    });
    return apiResponse(
      {
        ok: true,
        evaluatedOnly: true,
        evaluation,
        externalEffectsAuthorized: false,
      },
      { requestId: id },
    );
  } catch (error) {
    return apiResponse(
      {
        ok: false,
        code: error instanceof AutonomyRequestError ? error.code : "AUTONOMY_EVALUATION_FAILED",
        message: error instanceof Error ? error.message : "Autonomy evaluation failed closed.",
        externalEffectsAuthorized: false,
      },
      { requestId: id, status: statusFor(error) },
    );
  }
}
