import { apiResponse, requestId } from "@/lib/api/http";
import { runtimeConfig } from "@/lib/api/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  const config = runtimeConfig();
  const ready = config.databaseConfigured && config.serviceTokenConfigured && config.continuationSecretConfigured;
  return apiResponse(
    {
      ok: true,
      service: "luzione-api",
      status: ready ? "READY_READ_ONLY" : "FOUNDATION_CONFIGURATION_REQUIRED",
      checks: {
        continuationSigning: config.continuationSecretConfigured ? "CONFIGURED" : "MISSING",
        database: config.databaseConfigured ? "CONFIGURED_NOT_PROBED" : "MISSING",
        serviceAuthentication: config.serviceTokenConfigured ? "CONFIGURED" : "MISSING",
      },
      mutations: config.mutationsEnabled ? "ENABLED" : "DISABLED_FAIL_CLOSED",
      externalEffectsAuthorized: false,
      observedAt: new Date().toISOString(),
    },
    { requestId: id, status: ready ? 200 : 503 },
  );
}
