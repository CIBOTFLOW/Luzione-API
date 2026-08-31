import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { runtimeConfig } from "@/lib/api/config";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const requestIdentity = createRequestIdentity(request.headers);
  const config = runtimeConfig();
  const releaseIdentity = createReleaseIdentity({ mutationsEnabled: config.mutationsEnabled });
  return apiResponse({
    ok: true,
    releaseIdentity,
  }, { requestIdentity });
}
