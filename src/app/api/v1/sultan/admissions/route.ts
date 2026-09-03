import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { stage5Pins } from "@/modules/sultan-stage5/config";
import { parseStage5AdmissionAssertion, SultanStage5ContractError } from "@/modules/sultan-stage5/parser";
import { PostgresSultanStage5Store, SultanStage5StoreError } from "@/modules/sultan-stage5/postgresStore";
import { SultanStage5Service } from "@/modules/sultan-stage5/service";

export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/sultan/admissions";
const MAX_REQUEST_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    const actor = await requireServiceActor(request.headers, "sultan.stage5.admission.request");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "sultan.stage5.admission.request",
      purpose: "issue-sultan-stage5-admission-receipt",
    });
    const assertion = parseStage5AdmissionAssertion(await boundedJson(request));
    const receipt = await new SultanStage5Service(
      new PostgresSultanStage5Store(),
      stage5Pins(),
    ).admit(actor, assertion);
    status = receipt.status === "DENIED" ? 403 : receipt.status === "SEPARATE_REVIEW_REQUIRED" ? 202 : 200;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({
      ok: receipt.status !== "DENIED",
      receipt,
      admissionTiming: "POST_INFERENCE",
      reasoningAuthorized: false,
      executionAuthorized: false,
      externalEffectsAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    status = errorStatus(error);
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({
      ok: false,
      code: errorCode(error, "SULTAN_STAGE5_ADMISSION_FAILED"),
      message: publicMessage(error, "Sultan Stage 5 admission failed closed."),
      admissionTiming: "POST_INFERENCE",
      reasoningAuthorized: false,
      executionAuthorized: false,
      externalEffectsAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw new SultanStage5ContractError("INVALID_ADMISSION_ASSERTION", "Admission request exceeds the bounded contract.", 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
    throw new SultanStage5ContractError("INVALID_ADMISSION_ASSERTION", "Admission request exceeds the bounded contract.", 413);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new SultanStage5ContractError("INVALID_ADMISSION_ASSERTION", "Admission request must be valid JSON.");
  }
}

function errorStatus(error: unknown) {
  if (error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError) return error.status;
  const message = error instanceof Error ? error.message : "";
  return /authentication|credential|capability/i.test(message) ? 401 : 503;
}

function errorCode(error: unknown, fallback: string) {
  return error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError ? error.code : fallback;
}

function publicMessage(error: unknown, fallback: string) {
  if (error instanceof SultanStage5ContractError || error instanceof SultanStage5StoreError) return error.message;
  const message = error instanceof Error ? error.message : "";
  return /authentication|credential|capability/i.test(message) ? "Service authentication failed." : fallback;
}
