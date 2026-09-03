import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { SultanAgentGatewayError } from "@/modules/sultan-agent-gateway/contracts";
import { parseCommandPreparationEnvelope } from "@/modules/sultan-agent-gateway/parser";
import { PostgresSultanAgentGatewayStore } from "@/modules/sultan-agent-gateway/postgresStore";
import { SultanAgentGatewayService } from "@/modules/sultan-agent-gateway/service";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 32 * 1024;

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.command.prepare");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A2",
      capability: "sultan.command.prepare",
      purpose: "prepare-sultan-agent-command-without-execution",
    });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) throw new SultanAgentGatewayError("COMMAND_PREPARATION_TOO_LARGE", "The command preparation exceeds the bounded request contract.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new SultanAgentGatewayError("INVALID_COMMAND_PREPARATION", "The command preparation body must be valid JSON."); }
    const call = parseCommandPreparationEnvelope(body);
    const preparation = await new SultanAgentGatewayService(new PostgresSultanAgentGatewayStore()).prepare({ actor, call });
    status = 201;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/sultan/commands/prepare", status, startedAt });
    return apiResponse({ ok: true, preparation }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = error instanceof SultanAgentGatewayError ? error.status : 503;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/sultan/commands/prepare", status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof SultanAgentGatewayError ? error.code : "SULTAN_COMMAND_PREPARATION_FAILED",
      message: error instanceof SultanAgentGatewayError ? error.message : "Sultan command preparation failed closed.",
      businessStateMutated: false,
      externalEffectAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}
