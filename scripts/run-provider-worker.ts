import { Pool } from "pg";
import { databaseConnectionOptions } from "../src/lib/databaseConnection";
import { PostgresWorkflowDeliveryStore } from "../src/lib/platform-guarantees/postgresWorkflowDeliveryStore";
import { ProviderAdapterRegistry } from "../src/modules/provider-runtime/registry";
import { ProviderWorkerRuntime } from "../src/modules/provider-runtime/runtime";
import { SandboxEchoProviderAdapter } from "../src/modules/provider-runtime/sandboxEchoAdapter";
import { ConfiguredEffectAdmissionGate, PostgresEffectKillStateReader } from "../src/modules/effect-admission/gate";

async function main() {
  const tenantId = process.env.LUZIONE_PROVIDER_WORKER_TENANT_ID?.trim();
  const workerId = process.env.LUZIONE_PROVIDER_WORKER_ID?.trim();
  const connectionString = process.env.DATABASE_URL?.trim();
  const once = process.argv.includes("--once");
  if (!tenantId || !workerId || !connectionString) throw new Error("DATABASE_URL, LUZIONE_PROVIDER_WORKER_TENANT_ID and LUZIONE_PROVIDER_WORKER_ID are required.");

  const pool = new Pool({
    ...databaseConnectionOptions(connectionString, process.env.DATABASE_CA_CERT),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 5_000),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  });

  const runtime = new ProviderWorkerRuntime(
    new PostgresWorkflowDeliveryStore(pool),
    new ProviderAdapterRegistry([new SandboxEchoProviderAdapter()]),
    undefined,
    new ConfiguredEffectAdmissionGate(new PostgresEffectKillStateReader(pool)),
  );
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  try {
    do {
      const delivery = await runtime.runDeliveryBatch({ limit: 10, tenantId, workerId });
      const reconciliation = await runtime.runReconciliationBatch({ limit: 10, tenantId, workerId });
      process.stdout.write(`${JSON.stringify({ contractVersion: "luzione-provider-adapter/v0.2", delivery, reconciliation })}\n`);
      if (!once && delivery.claimed === 0 && reconciliation.claimed === 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
    } while (!once && !stopping);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Provider worker failed."}\n`);
  process.exitCode = 1;
});
