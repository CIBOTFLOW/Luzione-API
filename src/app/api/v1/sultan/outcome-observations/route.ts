import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { stage5Pins } from "@/modules/sultan-stage5/config";
import { parseOutcomeObservationRequest, SultanStage5ContractError } from "@/modules/sultan-stage5/parser";
import { PostgresSultanStage5Store, SultanStage5StoreError } from "@/modules/sultan-stage5/postgresStore";
import { SultanStage5Service } from "@/modules/sultan-stage5/service";

export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/sultan/outcome-observations";
const MAX_REQUEST_BYTES = 16 * 1024;

export async function GET(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.outcome.observe");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "sultan.outcome.observe",
      purpose: "verify-sultan-outcome-receipt",
    });
    const observationId = new URL(request.url).searchParams.get("observationId") ?? "";
    const receipt = await new SultanStage5Service(new PostgresSultanStage5Store(), stage5Pins())
      .readVerifiedOutcome(actor, observationId);
    logRequestCompletion({ method: "GET", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({
      ok: true,
      receipt,
      receiptOriginVerified: true,
      receiptHashVerified: true,
      tenantBindingVerified: true,
      externalEffectsAuthorized: false,
      learningPromotionAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError
      ? error.status
      : /authentication|credential|capability/i.test(error instanceof Error ? error.message : "") ? 401 : 503;
    logRequestCompletion({ method: "GET", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError ? error.code : "OUTCOME_RECEIPT_VERIFICATION_FAILED",
      message: error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError ? error.message : "Outcome receipt verification failed closed.",
      receiptOriginVerified: false,
      receiptHashVerified: false,
      tenantBindingVerified: false,
      learningPromotionAuthorized: false,
      externalEffectsAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.outcome.observe");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "sultan.outcome.observe",
      purpose: "observe-sultan-recommendation-outcome",
    });
    const observation = parseOutcomeObservationRequest(await boundedJson(request));
    const receipt = await new SultanStage5Service(new PostgresSultanStage5Store(), stage5Pins())
      .observeOutcome(actor, observation);
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({ ok: true, receipt, learningPromotionAuthorized: false, externalEffectsAuthorized: false }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError
      ? error.status
      : /authentication|credential|capability/i.test(error instanceof Error ? error.message : "") ? 401 : 503;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({
      ok: false,
      code: error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError ? error.code : "OUTCOME_OBSERVATION_FAILED",
      message: error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError ? error.message : "Outcome observation failed closed.",
      learningPromotionAuthorized: false,
      externalEffectsAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new SultanStage5ContractError("INVALID_OUTCOME_OBSERVATION_REQUEST", "Outcome request is too large.", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) throw new SultanStage5ContractError("INVALID_OUTCOME_OBSERVATION_REQUEST", "Outcome request is too large.", 413);
  try { return JSON.parse(raw) as unknown; } catch { throw new SultanStage5ContractError("INVALID_OUTCOME_OBSERVATION_REQUEST", "Outcome request must be valid JSON."); }
}
