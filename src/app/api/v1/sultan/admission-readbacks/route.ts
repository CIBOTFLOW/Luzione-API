// Default-OFF, authenticated, tenant-bound Stage 5 receipt/readback retrieval.
// POST is a read-only transport to keep receipt IDs out of URL/query logs.
import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity, logRequestCompletion } from "@/lib/api/http";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";
import { readStage5AdmissionBundle } from "@/modules/sultan-stage5/admissionReadbackTransport";
import { PostgresSultanStage5Store, SultanStage5StoreError } from "@/modules/sultan-stage5/postgresStore";

export const dynamic = "force-dynamic";
const ROUTE = "/api/v1/sultan/admission-readbacks";
const MAX_REQUEST_BYTES = 256;

export async function POST(request: Request) {
  const startedAt = performance.now();
  let identity = createRequestIdentity(request.headers);
  let status = 200;
  try {
    // No production activation until explicit credential/policy verification.
    if (process.env.LUZIONE_SULTAN_STAGE5_READBACK_ENABLED !== "true")
      throw new SultanStage5StoreError("STAGE5_READBACK_DISABLED", "Stage 5 readback unavailable.", 404);
    const actor = await requireServiceActor(request.headers, "sultan.stage5.admission.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0", capability: "sultan.stage5.admission.read",
      purpose: "read-independent-stage5-admission-evidence",
    });
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES)
      throw new SultanStage5StoreError("STAGE5_READBACK_REQUEST_TOO_LARGE", "Invalid Stage 5 readback request.", 413);
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES)
      throw new SultanStage5StoreError("STAGE5_READBACK_REQUEST_TOO_LARGE", "Invalid Stage 5 readback request.", 413);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, "admissionReceiptId")
      || typeof (parsed as {admissionReceiptId?: unknown}).admissionReceiptId !== "string")
      throw new SultanStage5StoreError("STAGE5_READBACK_REQUEST_INVALID", "Invalid Stage 5 readback request.", 400);
    const bundle = await readStage5AdmissionBundle({
      actor, admissionReceiptId: (parsed as {admissionReceiptId: string}).admissionReceiptId,
      store: new PostgresSultanStage5Store(), enabled: true,
    });
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({ ok: true, ...bundle, grantsAuthority: false,
      executionAuthorized: false, externalEffectsAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    status = error instanceof SultanStage5StoreError ? error.status
      : /authentication|credential|capability/i.test(message) ? 401 : 503;
    logRequestCompletion({ method: "POST", requestIdentity: identity, route: ROUTE, status, startedAt });
    return apiResponse({ ok: false,
      code: error instanceof SultanStage5StoreError ? error.code : "STAGE5_READBACK_FAILED",
      message: "Stage 5 readback unavailable.",
      grantsAuthority: false, executionAuthorized: false, externalEffectsAuthorized: false,
    }, { requestIdentity: identity, status, startedAt });
  }
}
