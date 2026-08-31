import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { evaluateAutonomyPlan } from "@/modules/autonomy/evaluator";
import {
  AutonomyRequestError,
  parseAutonomyEvaluationRequest,
} from "@/modules/autonomy/parser";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

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
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "governance.evaluate");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "governance.evaluate",
      purpose: "evaluate-autonomy-plan",
    });
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
      { requestIdentity: identity },
    );
  } catch (error) {
    return apiResponse(
      {
        ok: false,
        code: error instanceof AutonomyRequestError ? error.code : "AUTONOMY_EVALUATION_FAILED",
        message: error instanceof Error ? error.message : "Autonomy evaluation failed closed.",
        externalEffectsAuthorized: false,
      },
      { requestIdentity: identity, status: statusFor(error) },
    );
  }
}
