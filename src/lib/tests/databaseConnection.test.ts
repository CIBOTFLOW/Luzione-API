import assert from "node:assert/strict";
import test from "node:test";

import { databaseConnectionOptions } from "../databaseConnection";

test("URL TLS parameters cannot replace the explicit Pool TLS policy", () => {
  const config = databaseConnectionOptions(
    "postgres://readiness:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&application_name=luzione-api",
  );
  const normalized = new URL(config.connectionString);

  assert.equal(normalized.searchParams.get("sslmode"), null);
  assert.equal(normalized.searchParams.get("application_name"), "luzione-api");
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test("file-based TLS URL parameters are removed instead of being read by node-postgres", () => {
  const config = databaseConnectionOptions(
    "postgres://readiness:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslrootcert=/tmp/root.crt&sslkey=/tmp/key.pem&sslcert=/tmp/cert.pem",
  );
  const normalized = new URL(config.connectionString);

  assert.equal(normalized.searchParams.get("sslrootcert"), null);
  assert.equal(normalized.searchParams.get("sslkey"), null);
  assert.equal(normalized.searchParams.get("sslcert"), null);
});

test("an environment-provided CA enables certificate verification", () => {
  const config = databaseConnectionOptions(
    "postgres://readiness:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
    "-----BEGIN CERTIFICATE-----\\ncertificate-data\\n-----END CERTIFICATE-----",
  );

  assert.deepEqual(config.ssl, {
    ca: "-----BEGIN CERTIFICATE-----\ncertificate-data\n-----END CERTIFICATE-----",
    rejectUnauthorized: true,
  });
});

test("localhost remains available for development without TLS", () => {
  const connectionString = "postgres://postgres:postgres@localhost:5432/luzione";
  assert.deepEqual(databaseConnectionOptions(connectionString), { connectionString });
});

test("non-Postgres URLs fail closed", () => {
  assert.throws(
    () => databaseConnectionOptions("https://example.com/database"),
    /must use the postgres or postgresql scheme/,
  );
});
