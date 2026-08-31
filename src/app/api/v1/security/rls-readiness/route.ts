import { requireServiceActor } from "@/lib/api/actor";
import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { readRlsReadiness } from "@/lib/security-posture/readService";
import { logRlsReadbackFailure } from "@/modules/security-posture/readbackFailure";
import { bindAuthenticatedRequestIdentity } from "@/modules/platform-contracts/requestIdentity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let identity = createRequestIdentity(request.headers);
  let actor: Awaited<ReturnType<typeof requireServiceActor>>;
  try {
    actor = await requireServiceActor(request.headers, "security.rls.read");
    identity = bindAuthenticatedRequestIdentity(identity, actor, {
      authorityClass: "A0",
      capability: "security.rls.read",
      purpose: "read-rls-posture",
    });
  } catch {
    return apiResponse(
      { ok: false, message: "Service authentication required." },
      { requestIdentity: identity, status: 401 },
    );
  }

  try {
    const url = new URL(request.url);
    const unsupported = [...url.searchParams.keys()].filter((key) => key !== "activeProbes");
    if (unsupported.length) {
      return apiResponse(
        { ok: false, message: `Unsupported security readback parameters: ${unsupported.join(", ")}.` },
        { requestIdentity: identity, status: 400 },
      );
    }
    const activeValue = url.searchParams.get("activeProbes");
    if (activeValue !== null && activeValue !== "true" && activeValue !== "false") {
      return apiResponse(
        { ok: false, message: "activeProbes must be true or false." },
        { requestIdentity: identity, status: 400 },
      );
    }
    const result = await readRlsReadiness({ activeProbes: activeValue === "true" });
    return apiResponse(
      {
        ok: result.status === "PASS",
        actor: { actorId: actor.actorId, actorType: actor.actorType, tenantId: actor.tenantId },
        result,
      },
      { requestIdentity: identity, status: result.status === "PASS" ? 200 : 503 },
    );
  } catch (error) {
    const failure = logRlsReadbackFailure({
      error,
      requestIdentity: identity,
      route: "/api/v1/security/rls-readiness",
    });
    return apiResponse(
      {
        ok: false,
        message: "RLS readiness read failed closed.",
        errorCode: failure.failureCode,
      },
      { requestIdentity: identity, status: 503 },
    );
  }
}
