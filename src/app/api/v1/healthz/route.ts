import { apiResponse, createRequestIdentity } from "@/lib/api/http";
import { runtimeConfig } from "@/lib/api/config";
import { readRlsReadiness } from "@/lib/security-posture/readService";
import { logRlsReadbackFailure } from "@/modules/security-posture/readbackFailure";
import { EXPECTED_RLS_TABLES } from "@/modules/security-posture/rlsPosture";
import { deriveDesiredObservedState } from "@/modules/platform-contracts/stateContract";
import { deriveReadinessEvidenceSummary, runtimeReadinessEvidenceContext, type ReadinessEvidence } from "@/modules/platform-readiness/evidence";

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
  const { environment, exactSha, observedTier } = runtimeReadinessEvidenceContext();
  const configurationEvidence: ReadinessEvidence[] = [
    ["database-configuration", "database connection configuration", config.databaseConfigured],
    ["service-authentication-configuration", "service authentication configuration", config.serviceTokenConfigured],
    ["continuation-signing-configuration", "continuation signing configuration", config.continuationSecretConfigured],
  ].map(([evidenceId, threshold, passed]) => ({
    actual: passed === true ? "CONFIGURED" : "MISSING",
    environment,
    evidenceId: String(evidenceId),
    evidenceTier: "CONFIGURED",
    exactSha,
    impact: "BLOCKING",
    observedAt,
    owner: "Luzione API platform owner",
    scope: "service.security-readiness",
    source: "runtimeConfig",
    sourceKind: "CONFIGURATION",
    status: passed === true ? "PASS" : "FAIL",
    threshold: String(threshold),
    validForMs: 60_000,
  }));
  const readinessEvidence = deriveReadinessEvidenceSummary([
    ...configurationEvidence,
    {
      actual: security?.status ?? "UNAVAILABLE",
      environment,
      evidenceId: "canonical-postgres-rls-readback",
      evidenceTier: observedTier,
      exactSha,
      impact: "BLOCKING",
      observedAt: security ? observedAt : null,
      owner: "Luzione database and security owner",
      scope: "service.security-readiness",
      source: "canonical Postgres catalog",
      sourceKind: "CANONICAL_READBACK",
      status: securityReady ? "PASS" : securityReadbackError ? "UNKNOWN" : "FAIL",
      threshold: "all expected server-only relations pass RLS/grant posture",
      validForMs: 60_000,
    },
  ]);
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
        expectedTableCount: security?.expectedTableCount ?? EXPECTED_RLS_TABLES.length,
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
      readinessEvidence,
    },
    { requestIdentity: identity, status: ready ? 200 : 503 },
  );
}
