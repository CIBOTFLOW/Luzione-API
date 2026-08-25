import { apiResponse, requestId } from "@/lib/api/http";
import { runtimeConfig } from "@/lib/api/config";
import { readRlsReadiness } from "@/lib/security-posture/readService";
import { logRlsReadbackFailure } from "@/modules/security-posture/readbackFailure";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  const config = runtimeConfig();
  let security: Awaited<ReturnType<typeof readRlsReadiness>> | null = null;
  let securityReadbackError = false;
  let securityReadbackErrorCode: string | null = null;
  if (config.databaseConfigured) {
    try {
      security = await readRlsReadiness();
    } catch (error) {
      securityReadbackError = true;
      securityReadbackErrorCode = logRlsReadbackFailure({
        error,
        requestId: id,
        route: "/api/v1/healthz",
      }).failureCode;
    }
  }
  const securityReady = security?.status === "PASS";
  const ready = config.databaseConfigured
    && config.serviceTokenConfigured
    && config.continuationSecretConfigured
    && securityReady;
  const status = ready
    ? "READY_READ_ONLY"
    : config.databaseConfigured && !securityReady
      ? "SECURITY_POSTURE_REQUIRED"
      : "FOUNDATION_CONFIGURATION_REQUIRED";

  return apiResponse(
    {
      ok: ready,
      service: "luzione-api",
      status,
      checks: {
        continuationSigning: config.continuationSecretConfigured ? "CONFIGURED" : "MISSING",
        database: !config.databaseConfigured
          ? "MISSING"
          : securityReady
            ? "CONNECTED_RLS_GATE_PASS"
            : "RLS_GATE_FAIL",
        serviceAuthentication: config.serviceTokenConfigured ? "CONFIGURED" : "MISSING",
      },
      security: {
        expectedTableCount: security?.expectedTableCount ?? 10,
        observedTableCount: security?.observedTableCount ?? 0,
        status: security?.status ?? "UNAVAILABLE",
        violationCount: security?.violations.length ?? 1,
        readbackError: securityReadbackError,
        readbackErrorCode: securityReadbackErrorCode,
      },
      mutations: config.mutationsEnabled ? "ENABLED" : "DISABLED_FAIL_CLOSED",
      externalEffectsAuthorized: false,
      observedAt: new Date().toISOString(),
    },
    { requestId: id, status: ready ? 200 : 503 },
  );
}
