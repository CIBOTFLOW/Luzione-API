import "server-only";

import { Pool } from "pg";

import { databaseConnectionOptions } from "@/lib/databaseConnection";

declare global {
  var __luzioneApiPool: Pool | undefined;
}

export function databasePool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  if (!global.__luzioneApiPool) {
    const connection = databaseConnectionOptions(
      connectionString,
      process.env.DATABASE_CA_CERT,
    );
    global.__luzioneApiPool = new Pool({
      ...connection,
      allowExitOnIdle: true,
      max: boundedInteger(process.env.DATABASE_POOL_MAX, 3, 1, 20),
      idleTimeoutMillis: boundedInteger(process.env.DATABASE_IDLE_TIMEOUT_MS, 10_000, 1_000, 60_000),
      connectionTimeoutMillis: boundedInteger(process.env.DATABASE_CONNECT_TIMEOUT_MS, 3_000, 500, 15_000),
      maxUses: boundedInteger(process.env.DATABASE_POOL_MAX_USES, 7_500, 100, 50_000),
    });
  }
  return global.__luzioneApiPool;
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
