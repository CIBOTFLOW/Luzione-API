import type { Client } from "pg";

export type PlatformMigration = {
  dependencyOrder: number;
  id: string;
  path: string;
};

export function checksum(content: string): string;
export function stripOuterTransaction(content: string): string;
export function discoverMigrations(): PlatformMigration[];
export function migrationDatabaseUrl(): string;
export function ensureLedger(client: { query(statement: string): Promise<unknown> }): Promise<void>;
export function applyMigrations(client: Client, migrations?: PlatformMigration[]): Promise<void>;
