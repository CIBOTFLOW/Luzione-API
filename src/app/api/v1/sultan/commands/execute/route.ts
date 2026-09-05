import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { SultanAgentGatewayError } from "@/modules/sultan-agent-gateway/contracts";
import { parseCommandExecutionEnvelope } from "@/modules/sultan-agent-gateway/parser";
import { PostgresSultanAgentGatewayStore } from "@/modules/sultan-agent-gateway/postgresStore";
import { databasePool } from "@/lib/db";
import { ConfiguredEffectAdmissionGate, PostgresEffectKillStateReader } from "@/modules/effect-admission/gate";
import { SultanAgentGatewayService } from "@/modules/sultan-agent-gateway/service";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.command.execute");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A1",
      capability: "sultan.command.execute",
      purpose: "execute-exact-approved-sultan-internal-command",
    });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) throw new SultanAgentGatewayError("COMMAND_EXECUTION_TOO_LARGE", "The command execution exceeds the bounded request contract.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new SultanAgentGatewayError("INVALID_COMMAND_EXECUTION", "The command execution body must be valid JSON."); }
    const executionRequest = parseCommandExecutionEnvelope(body);
    const pool = databasePool();
    const execution = await new SultanAgentGatewayService(new PostgresSultanAgentGatewayStore(pool), undefined, undefined, new ConfiguredEffectAdmissionGate(new PostgresEffectKillStateReader(pool))).execute({ actor, ...executionRequest });
    status = execution.idempotentReplay ? 200 : 201;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/sultan/commands/execute", status, startedAt });
    return apiResponse({ ok: true, execution }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = error instanceof SultanAgentGatewayError ? error.status : 503;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: "/api/v1/sultan/commands/execute", status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof SultanAgentGatewayError ? error.code : "SULTAN_COMMAND_EXECUTION_FAILED",
      message: error instanceof SultanAgentGatewayError ? error.message : "Sultan command execution failed closed.",
      externalEffectAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}
