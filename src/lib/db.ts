import "server-only";

import { Pool } from "pg";

declare global {
  var __luzioneApiPool: Pool | undefined;
}

export function databasePool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  if (!global.__luzioneApiPool) {
    global.__luzioneApiPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return global.__luzioneApiPool;
}
