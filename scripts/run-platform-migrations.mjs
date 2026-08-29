#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(repositoryRoot, "supabase/migrations");

export function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function stripOuterTransaction(content) {
  const lines = content.split("\n");
  const significant = lines
    .map((line, index) => ({ index, text: line.trim() }))
    .filter(({ text }) => text && !text.startsWith("--"));
  const first = significant[0];
  const last = significant.at(-1);
  const begins = /^begin\s*;$/i.test(first?.text ?? "");
  const commits = /^commit\s*;$/i.test(last?.text ?? "");
  if (begins !== commits) throw new Error("Migration has an incomplete outer transaction wrapper.");
  const nested = significant.some(({ index, text }) => /^(begin|commit)\s*;$/i.test(text)
    && index !== first?.index
    && index !== last?.index);
  if (nested) throw new Error("Migration has unsupported nested transaction control.");
  if (!begins) return content;
  return lines.filter((_, index) => index !== first.index && index !== last.index).join("\n");
}

export function discoverMigrations() {
  return fs.readdirSync(migrationDirectory)
    .filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map((file, dependencyOrder) => ({
      dependencyOrder,
      id: file.slice(0, -4),
      path: `supabase/migrations/${file}`,
    }));
}

export function migrationDatabaseUrl() {
  const raw = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!raw) throw new Error("MIGRATION_DATABASE_URL is required.");
  const url = new URL(raw);
  if (!url.protocol.startsWith("postgres")) throw new Error("MIGRATION_DATABASE_URL must be PostgreSQL.");
  const local = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!local.has(url.hostname) && process.env.ALLOW_NON_LOCAL_MIGRATION_DATABASE !== "true") {
    throw new Error(`Refusing non-local migration host ${url.hostname} without exact release authorization.`);
  }
  return url.toString();
}

async function ensureLedger(client) {
  await client.query(`
    create table if not exists platform_schema_migrations (
      id text primary key,
      dependency_order integer not null unique,
      path text not null unique,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

export async function applyMigrations(client, migrations = discoverMigrations()) {
  await ensureLedger(client);
  for (const migration of migrations) {
    const absolutePath = path.join(repositoryRoot, migration.path);
    const content = fs.readFileSync(absolutePath, "utf8");
    const digest = checksum(content);
    const applied = await client.query(
      "select checksum, dependency_order, path from platform_schema_migrations where id = $1",
      [migration.id],
    );
    if (applied.rows.length === 1) {
      const row = applied.rows[0];
      if (row.checksum !== digest || row.path !== migration.path || row.dependency_order !== migration.dependencyOrder) {
        throw new Error(`Applied migration identity mismatch for ${migration.id}.`);
      }
      console.log(`[platform-migrate] skip ${migration.id}`);
      continue;
    }
    console.log(`[platform-migrate] apply ${migration.id}`);
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '5min'");
      await client.query(stripOuterTransaction(content));
      await client.query(
        `insert into platform_schema_migrations (id, dependency_order, path, checksum)
         values ($1,$2,$3,$4)`,
        [migration.id, migration.dependencyOrder, migration.path, digest],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      if (error instanceof Error) error.message = `Migration ${migration.id} failed: ${error.message}`;
      throw error;
    }
  }
}

async function main() {
  const migrations = discoverMigrations();
  if (process.argv.includes("--dry-run")) {
    for (const migration of migrations) console.log(`${migration.dependencyOrder}\t${migration.id}\t${migration.path}`);
    return;
  }
  const client = new Client({ connectionString: migrationDatabaseUrl() });
  await client.connect();
  try {
    await applyMigrations(client, migrations);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[platform-migrate]", error instanceof Error ? error.message : "unknown failure");
    process.exitCode = 1;
  });
}
