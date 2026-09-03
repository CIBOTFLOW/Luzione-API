import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { SultanAgentGatewayError } from "@/modules/sultan-agent-gateway/contracts";
import { parseManifestQuery } from "@/modules/sultan-agent-gateway/parser";
import { PostgresSultanAgentGatewayStore } from "@/modules/sultan-agent-gateway/postgresStore";
import { SultanAgentGatewayService } from "@/modules/sultan-agent-gateway/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.tool.manifest.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "sultan.tool.manifest.read",
      purpose: "discover-sultan-agent-tools",
    });
    const parsed = parseManifestQuery(new URL(request.url));
    const manifest = new SultanAgentGatewayService(new PostgresSultanAgentGatewayStore()).manifest({ actor, ...parsed });
    logRequestCompletion({ method: "GET", requestIdentity: identity, route: "/api/v1/sultan/tools", status, startedAt });
    return apiResponse({ ok: true, manifest }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = error instanceof SultanAgentGatewayError ? error.status : 503;
    logRequestCompletion({ method: "GET", requestIdentity: identity, route: "/api/v1/sultan/tools", status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof SultanAgentGatewayError ? error.code : "SULTAN_TOOL_MANIFEST_FAILED",
      message: error instanceof SultanAgentGatewayError ? error.message : "Sultan tool discovery failed closed.",
      discoveryGrantsAuthority: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}
