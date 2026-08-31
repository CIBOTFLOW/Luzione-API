import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { evaluateSultanAgentIntent } from "@/modules/sultan-agent/evaluator";
import { parseSultanAgentIntent, SultanAgentIntentError } from "@/modules/sultan-agent/parser";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64 * 1024;

function statusFor(error: unknown) {
  if (error instanceof SultanAgentIntentError) return error.code === "CLIENT_AUTHORITY_REJECTED" ? 403 : 400;
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (/authentication|tenant|actor|capability/i.test(message)) return 401;
  return 503;
}

export async function POST(request: Request) {
  let identity = createRequestIdentity(request.headers);
  try {
    const actor = await requireServiceActor(request.headers, "sultan.agent.intent.evaluate");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "sultan.agent.intent.evaluate",
      purpose: "evaluate-sultan-agent-intent",
    });
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      throw new SultanAgentIntentError("INVALID_AGENT_INTENT", "Request body is too large.");
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      throw new SultanAgentIntentError("INVALID_AGENT_INTENT", "Request body is too large.");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new SultanAgentIntentError("INVALID_AGENT_INTENT", "Request body must be valid JSON.");
    }
    const intent = parseSultanAgentIntent(body);
    const decision = evaluateSultanAgentIntent({ actor, intent });
    return apiResponse(
      {
        ok: true,
        decision,
        evaluatedOnly: true,
        businessStateMutated: false,
        externalEffectsAuthorized: false,
      },
      { requestIdentity: identity, status: decision.status === "BLOCKED" ? 422 : 200 },
    );
  } catch (error) {
    return apiResponse(
      {
        ok: false,
        code: error instanceof SultanAgentIntentError ? error.code : "SULTAN_AGENT_INTENT_EVALUATION_FAILED",
        message: error instanceof Error ? error.message : "Sultan agent intent evaluation failed closed.",
        evaluatedOnly: true,
        businessStateMutated: false,
        externalEffectsAuthorized: false,
      },
      { requestIdentity: identity, status: statusFor(error) },
    );
  }
}
