import { apiResponse, requestId } from "@/lib/api/http";
import { runtimeConfig } from "@/lib/api/config";
import { databasePool } from "@/lib/db";
import { databaseRuntimeProfile } from "@/lib/databaseConnection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  const id = requestId(request.headers);
  const config = runtimeConfig();
  let database = "MISSING";
  let databaseLatencyMs: number | null = null;
  if (config.databaseConfigured) {
    const databaseStartedAt = performance.now();
    try {
      await databasePool().query({ name: "readiness-v1", text: "select 1", rowMode: "array" });
      database = "READY";
      databaseLatencyMs = Math.round((performance.now() - databaseStartedAt) * 10) / 10;
    } catch {
      database = "UNAVAILABLE";
    }
  }
  const ready = database === "READY" && config.serviceTokenConfigured && config.continuationSecretConfigured;
  const profile = process.env.DATABASE_URL
    ? databaseRuntimeProfile(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT)
    : null;
  return apiResponse({
    ok: ready,
    service: "luzione-api",
    status: ready ? "READY" : "NOT_READY",
    checks: {
      continuationSigning: config.continuationSecretConfigured ? "CONFIGURED" : "MISSING",
      database,
      serviceAuthentication: config.serviceTokenConfigured ? "CONFIGURED" : "MISSING",
    },
    databaseLatencyMs,
    connectionPosture: profile ? {
      pooler: profile.poolerDetected ? "DETECTED" : "DIRECT_CONNECTION",
      poolerRecommended: profile.poolerRecommended,
      tls: profile.tlsVerification,
    } : null,
    observedAt: new Date().toISOString(),
  }, { requestId: id, status: ready ? 200 : 503, startedAt });
}
