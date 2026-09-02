import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { SultanAgentGatewayError } from "@/modules/sultan-agent-gateway/contracts";
import { PostgresSultanAgentGatewayStore } from "@/modules/sultan-agent-gateway/postgresStore";
import { SultanAgentGatewayService } from "@/modules/sultan-agent-gateway/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.effect.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "sultan.effect.read",
      purpose: "read-sultan-effect-receipt",
    });
    const { receiptId } = await params;
    const readback = await new SultanAgentGatewayService(new PostgresSultanAgentGatewayStore()).readEffect(actor, receiptId);
    logRequestCompletion({ method: "GET", requestIdentity: identity, route: "/api/v1/sultan/effects/:receiptId/readback", status, startedAt });
    return apiResponse({ ok: true, readback }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = error instanceof SultanAgentGatewayError ? error.status : 503;
    logRequestCompletion({ method: "GET", requestIdentity: identity, route: "/api/v1/sultan/effects/:receiptId/readback", status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof SultanAgentGatewayError ? error.code : "SULTAN_EFFECT_READBACK_FAILED",
      message: error instanceof SultanAgentGatewayError ? error.message : "Sultan effect readback failed closed.",
    }, { requestIdentity: identity, status, startedAt });
  }
}
