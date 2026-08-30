import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { runtimeConfig } from "@/lib/api/config";
import { readRlsReadiness } from "@/lib/security-posture/readService";
import { logRlsReadbackFailure } from "@/modules/security-posture/readbackFailure";
import { deriveDesiredObservedState } from "@/modules/platform-contracts/stateContract";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = createRequestIdentity(request.headers);
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
        requestIdentity: identity,
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
    ? config.internalProjectionsEnabled
      ? "READY_INTERNAL_PROJECTIONS"
      : "READY_READ_ONLY"
    : config.databaseConfigured && !securityReady
      ? "SECURITY_POSTURE_REQUIRED"
      : "FOUNDATION_CONFIGURATION_REQUIRED";
  const observedAt = new Date().toISOString();
  const stateContract = deriveDesiredObservedState({
    desiredSource: "luzione-api deployment readiness policy",
    desiredState: "READY",
    evidenceRefs: ["runtime-config", "canonical-postgres-catalog"],
    freshnessMs: 60_000,
    nextAction: ready
      ? "Continue bounded health observation."
      : "Restore required configuration and the canonical Postgres RLS gate before promotion.",
    now: observedAt,
    observedAt,
    observedSource: "GET /api/v1/healthz",
    observedState: ready ? "READY" : "NOT_READY",
    owner: "CIBOTFLOW/Luzione-API",
    scope: "service.security-readiness",
  });

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
      internalProjections: config.internalProjectionsEnabled
        ? "ENABLED_BOUNDED"
        : "DISABLED_FAIL_CLOSED",
      externalEffectsAuthorized: false,
      observedAt,
      stateContract,
    },
    { requestIdentity: identity, status: ready ? 200 : 503 },
  );
}
