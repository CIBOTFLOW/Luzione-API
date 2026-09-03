import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { stage5Pins } from "@/modules/sultan-stage5/config";
import { parseCanonicalReadbackRequest, SultanStage5ContractError } from "@/modules/sultan-stage5/parser";
import { PostgresSultanStage5Store, SultanStage5StoreError } from "@/modules/sultan-stage5/postgresStore";
import { SultanStage5Service } from "@/modules/sultan-stage5/service";

export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/sultan/canonical-readbacks";
const MAX_REQUEST_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.canonical.readback.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "sultan.canonical.readback.read",
      purpose: "read-canonical-sultan-grounding",
    });
    const readback = parseCanonicalReadbackRequest(await boundedJson(request));
    const receipt = await new SultanStage5Service(new PostgresSultanStage5Store(), stage5Pins())
      .canonicalReadback(actor, readback);
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({ ok: true, receipt, factsOrCalculationsOnly: true, grantsAuthority: false }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError
      ? error.status
      : /authentication|credential|capability/i.test(error instanceof Error ? error.message : "") ? 401 : 503;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError ? error.code : "CANONICAL_READBACK_FAILED",
      message: error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError ? error.message : "Canonical readback failed closed.",
      grantsAuthority: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new SultanStage5ContractError("INVALID_CANONICAL_READBACK_REQUEST", "Readback request is too large.", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) throw new SultanStage5ContractError("INVALID_CANONICAL_READBACK_REQUEST", "Readback request is too large.", 413);
  try { return JSON.parse(raw) as unknown; } catch { throw new SultanStage5ContractError("INVALID_CANONICAL_READBACK_REQUEST", "Readback request must be valid JSON."); }
}
