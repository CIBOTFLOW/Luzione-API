import { apiResponse, createRequestIdentity } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const identity = createRequestIdentity(request.headers);
  return apiResponse({
    ok: true,
    service: "luzione-api",
    status: "LIVE",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
    observedAt: new Date().toISOString(),
  }, { requestIdentity: identity });
}
