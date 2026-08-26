import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, requestId } from "@/lib/api/http";
import { readRlsReadiness } from "@/lib/security-posture/readService";
import { logRlsReadbackFailure } from "@/modules/security-posture/readbackFailure";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  let actor: Awaited<ReturnType<typeof requireServiceActor>>;
  try {
    actor = await requireServiceActor(request.headers);
  } catch {
    return apiResponse(
      { ok: false, message: "Service authentication required." },
      { requestId: id, status: 401 },
    );
  }

  try {
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
    const failure = logRlsReadbackFailure({
      error,
      requestId: id,
      route: "/api/v1/security/rls-readiness",
    });
    return apiResponse(
      {
        ok: false,
        message: "RLS readiness read failed closed.",
        errorCode: failure.failureCode,
      },
      { requestId: id, status: 503 },
    );
  }
}
