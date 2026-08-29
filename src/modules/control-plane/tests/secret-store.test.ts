import assert from "node:assert/strict";
import test from "node:test";

import {
  PostgresVaultSecretStore,
  ReadOnlyEnvironmentSecretStore,
  RoutedSecretStore,
  type SecretStore,
  UnavailableSecretStore,
} from "../secretStore";

const tenantId = "1ef8061d-1c82-4e7e-8e45-9123e17f8b0a";
const vaultId = "d873b07e-2de3-45f7-b46d-d3dc7db100a9";

test("Vault stores only canonical opaque references and tenant-bound JSON material", async () => {
  const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
  const database = {
    async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (text.includes("create_vault_secret")) return { rows: [{ vault_secret_id: vaultId }] as unknown as T[] };
      return { rows: [{ secret_material: JSON.stringify({ clientId: "id", clientSecret: "secret" }) }] as unknown as T[] };
    },
  };
  const store: SecretStore = new PostgresVaultSecretStore(database, tenantId);
  assert.equal(await store.write({ clientSecret: "secret", clientId: "id" }), `vault:${vaultId}`);
  assert.deepEqual(await store.read(`vault:${vaultId}`), { clientId: "id", clientSecret: "secret" });
  assert.deepEqual(calls[0]?.values, [tenantId, JSON.stringify({ clientId: "id", clientSecret: "secret" })]);
  assert.deepEqual(calls[1]?.values, [tenantId, vaultId]);
  await assert.rejects(store.read("legacy:old"), /only accepts a canonical vault/);
  await assert.rejects(store.delete(`vault:${vaultId}`), /separately approved/);
});

test("environment references are fixed, allowlisted and read-only", async () => {
  const store: SecretStore = new ReadOnlyEnvironmentSecretStore(
    new Set(["SULTAN_OPENAI"]),
    (name) => name === "SULTAN_OPENAI" ? { apiKey: "available-but-never-logged" } : undefined,
  );
  assert.deepEqual(await store.read("env:SULTAN_OPENAI"), { apiKey: "available-but-never-logged" });
  await assert.rejects(store.read("env:OTHER_KEY"), /not allowlisted/);
  await assert.rejects(store.write({ apiKey: "replacement" }), /cannot be written/);
  await assert.rejects(store.delete("env:SULTAN_OPENAI"), /credential rotation/);
});

test("routed storage fails closed when a selected backend is absent", async () => {
  const unavailable = new UnavailableSecretStore();
  const routed: SecretStore = new RoutedSecretStore({ env: unavailable });
  await assert.rejects(routed.read("vault:d873b07e-2de3-45f7-b46d-d3dc7db100a9"), /backend is unavailable/);
  await assert.rejects(routed.write({ token: "secret" }), /no validated secure backend/);
});

test("Vault rejects malformed or unbounded decrypted material", async () => {
  const database = {
    async query<T extends Record<string, unknown>>() {
      return { rows: [{ secret_material: JSON.stringify({ token: 123 }) }] as unknown as T[] };
    },
  };
  const store: SecretStore = new PostgresVaultSecretStore(database, tenantId);
  await assert.rejects(store.read(`vault:${vaultId}`), /invalid secret material/);
});
