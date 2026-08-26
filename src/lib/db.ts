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
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return global.__luzioneApiPool;
}
