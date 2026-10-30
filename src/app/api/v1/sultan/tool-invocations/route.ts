import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { SultanAgentGatewayError } from "@/modules/sultan-agent-gateway/contracts";
import { parseToolCallEnvelope } from "@/modules/sultan-agent-gateway/parser";
import { PostgresSultanAgentGatewayStore } from "@/modules/sultan-agent-gateway/postgresStore";
import { maybeSignA0Receipt } from "@/modules/sultan-agent-gateway/a0ReceiptSigning";
import { SultanAgentGatewayService } from "@/modules/sultan-agent-gateway/service";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.tool.invoke");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A2",
      capability: "sultan.tool.invoke",
      purpose: "invoke-sultan-agent-tool",
    });
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      throw new SultanAgentGatewayError("TOOL_CALL_TOO_LARGE", "The tool call exceeds the bounded request contract.", 413);
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      throw new SultanAgentGatewayError("TOOL_CALL_TOO_LARGE", "The tool call exceeds the bounded request contract.", 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new SultanAgentGatewayError("INVALID_TOOL_CALL", "The tool call body must be valid JSON.");
    }
    const call = parseToolCallEnvelope(body);
    const service = new SultanAgentGatewayService(new PostgresSultanAgentGatewayStore());
    const toolResult = await service.invoke({ actor, call });
    // Default OFF. Only READY A0 case reads can receive a signed manifest and
    // envelope. No new network calls, database writes, or effect permissions.
    const signingRequested = process.env.LUZIONE_SULTAN_A0_RECEIPT_SIGNING_ENABLED === "true"
      && call.toolId === "luzione.case_context.read" && toolResult.status === "READY";
    const signed = signingRequested ? {
      manifest: service.manifest({ actor, assertedAgent: call.agent, caseRef: call.caseRef }),
    } : null;
    const envelope = signed ? maybeSignA0Receipt({ actor, call, manifest: signed.manifest, toolResult }) : null;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/sultan/tool-invocations", status, startedAt });
    return apiResponse({ ok: true, toolResult, ...(signed && envelope ? {
      manifest: signed.manifest, envelope,
    } : {}) }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = error instanceof SultanAgentGatewayError ? error.status : 503;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/sultan/tool-invocations", status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof SultanAgentGatewayError ? error.code : "SULTAN_TOOL_INVOCATION_FAILED",
      message: error instanceof SultanAgentGatewayError ? error.message : "Sultan tool invocation failed closed.",
      businessStateMutated: false,
      externalEffectAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}
