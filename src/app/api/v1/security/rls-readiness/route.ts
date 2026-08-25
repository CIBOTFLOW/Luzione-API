import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, requestId } from "@/lib/api/http";
import { readRlsReadiness } from "@/lib/security-posture/readService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const actor = requireServiceActor(request.headers);
    const url = new URL(request.url);
    const unsupported = [...url.searchParams.keys()].filter((key) => key !== "activeProbes");
    if (unsupported.length) {
      return apiResponse(
        { ok: false, message: `Unsupported security readback parameters: ${unsupported.join(", ")}.` },
        { requestId: id, status: 400 },
      );
    }
    const activeValue = url.searchParams.get("activeProbes");
    if (activeValue !== null && activeValue !== "true" && activeValue !== "false") {
      return apiResponse(
        { ok: false, message: "activeProbes must be true or false." },
        { requestId: id, status: 400 },
      );
    }
    const result = await readRlsReadiness({ activeProbes: activeValue === "true" });
    return apiResponse(
      {
        ok: result.status === "PASS",
        actor: { actorId: actor.actorId, actorType: actor.actorType, tenantId: actor.tenantId },
        result,
      },
      { requestId: id, status: result.status === "PASS" ? 200 : 503 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "RLS readiness read failed closed.";
    return apiResponse(
      { ok: false, message },
      { requestId: id, status: /authentication|tenant|actor/i.test(message) ? 401 : 503 },
    );
  }
}
