import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { readActiveTenantPolicy } from "@/lib/tenant-policy/readService";
import { OrderFulfillmentStore } from "@/modules/order-fulfillment/store";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { stage5CanonicalReadbackReceiptIds, verifySultanAgentContext } from "@/modules/sultan-agent/contextVerifier";
import { evaluateSultanAgentIntent } from "@/modules/sultan-agent/evaluator";
import { parseSultanAgentIntent, SultanAgentIntentError } from "@/modules/sultan-agent/parser";
import { stage5Pins } from "@/modules/sultan-stage5/config";
import { PostgresSultanStage5Store } from "@/modules/sultan-stage5/postgresStore";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64 * 1024;

function statusFor(error: unknown) {
  if (error instanceof SultanAgentIntentError) return error.code === "CLIENT_AUTHORITY_REJECTED" ? 403 : 400;
  const message = error instanceof Error ? error.message : "Unknown failure";
  if (/authentication|credential|identity|tenant|actor|capability/i.test(message)) return 401;
  return 503;
}

function publicMessage(error: unknown) {
  if (error instanceof SultanAgentIntentError) return error.message;
  const message = error instanceof Error ? error.message : "";
  if (/authentication|credential|identity|tenant|actor|capability/i.test(message)) {
    return "Service authentication failed.";
  }
  return "Sultan agent intent evaluation failed closed.";
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
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
    const context = intent.sourceContext[0];
    const supportedOrderId = intent.caseRef.caseType === "FULFILLMENT"
      && intent.sourceContext.length === 1
      && context.sourceOwner === "CIBOTFLOW/Luzione-API"
      && context.sourceRef === `api:orders:${intent.caseRef.caseId}`
      ? intent.caseRef.caseId
      : null;
    const stage5ReceiptIds = stage5CanonicalReadbackReceiptIds(intent);
    const exactStage5Pins = stage5ReceiptIds ? stage5Pins() : undefined;
    const [orderReadback, stage5Readbacks, tenantPolicy] = await Promise.all([
      supportedOrderId ? new OrderFulfillmentStore().readOrder(actor, supportedOrderId) : Promise.resolve(null),
      stage5ReceiptIds
        ? new PostgresSultanStage5Store().readAdmissionEvidence(actor.tenantId, stage5ReceiptIds)
        : Promise.resolve([]),
      readActiveTenantPolicy(actor.tenantId),
    ]);
    const verified = verifySultanAgentContext({
      canonicalReadbacks: stage5Readbacks,
      intent,
      now: new Date().toISOString(),
      orderReadback,
      stage5Pins: exactStage5Pins,
      tenantId: actor.tenantId,
    });
    const decision = evaluateSultanAgentIntent({
      actor,
      contextVerification: verified.verification,
      intent: verified.intent,
      tenantPolicy,
    });
    status = decision.status === "BLOCKED" ? 422 : 200;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/sultan/agent-intents/evaluate", status, startedAt });
    return apiResponse(
      {
        ok: true,
        decision,
        evaluatedOnly: true,
        businessStateMutated: false,
        externalEffectsAuthorized: false,
      },
      { requestIdentity: identity, status, startedAt },
    );
  } catch (error) {
    status = statusFor(error);
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/sultan/agent-intents/evaluate", status, startedAt });
    return apiResponse(
      {
        ok: false,
        code: error instanceof SultanAgentIntentError ? error.code : "SULTAN_AGENT_INTENT_EVALUATION_FAILED",
        message: publicMessage(error),
        evaluatedOnly: true,
        businessStateMutated: false,
        externalEffectsAuthorized: false,
      },
      { requestIdentity: identity, status, startedAt },
    );
  }
}
