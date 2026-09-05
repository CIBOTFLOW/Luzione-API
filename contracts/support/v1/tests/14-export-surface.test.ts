import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import adverse from "../fixtures/adverse-cases.json";
import blocked from "../fixtures/blocked-dependent-fixtures.json";
import manifest from "../manifest.json";
import { documentOrder, makeDocument, parseByVersion, payloadFor } from "./support-test-kit";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("14 manifest, schemas, SDK and generation surface are closed and deterministic", () => {
  assert.equal(manifest.publicEntryCount, 20);
  assert.deepEqual(manifest.split, { sourceEvidence: 12, readProjections: 7, emulatorReceipts: 1 });
  assert.deepEqual(manifest.entries.map((entry) => entry.contractVersion), documentOrder);
  const positions = new Map(manifest.entries.map((entry, index) => [entry.contractVersion, index]));
  for (const [index, entry] of manifest.entries.entries()) {
    assert.equal(entry.order, index + 1);
    for (const dependency of entry.dependencies) assert.ok((positions.get(dependency) ?? Infinity) < index, `${entry.contractVersion} -> ${dependency}`);
    assert.equal(sha256(entry.schemaPath), entry.schemaSha256);
    const schema = JSON.parse(readFileSync(entry.schemaPath, "utf8")) as { unevaluatedProperties: boolean };
    assert.equal(schema.unevaluatedProperties, false);
  }
  assert.equal(sha256(manifest.internalDefinitions.path), manifest.internalDefinitions.sha256);
  const internal = JSON.parse(readFileSync(manifest.internalDefinitions.path, "utf8")) as { $defs: Record<string, { additionalProperties?: boolean }>; "x-originalByteRules": Record<string, unknown> };
  assert.equal(internal["x-originalByteRules"].inputType, "Uint8Array");
  assert.equal(internal["x-originalByteRules"].normalization, "NONE");
  assert.equal(internal.$defs.TypedAbsent.additionalProperties, false);
  assert.equal(internal.$defs.QualifiedSourceRef.additionalProperties, false);

  const eliminated = ["SupportSlaClaimReceipt/v1", "SupportEscalationEvidence/v1", "SupportObservabilityCorrelationRef/v1"];
  assert.ok(eliminated.every((id) => !positions.has(id)));
  assert.equal(adverse.groups.length, 14);
  assert.equal(blocked.dependencies.length, 6);
  assert.ok(blocked.dependencies.every((entry) => entry.state === "BLOCKED_INCOMPLETE"));

  const sdkSource = readFileSync(manifest.generatedSdk.path, "utf8");
  const publicTypes = [...sdkSource.matchAll(/^export type (\w+)/gm)].map((match) => match[1]);
  const publicParsers = [...sdkSource.matchAll(/^export function (\w+)/gm)].map((match) => match[1]);
  assert.deepEqual(publicTypes, manifest.generatedSdk.publicTypes);
  assert.deepEqual(publicParsers, manifest.generatedSdk.publicParsers);
  assert.equal(publicTypes.length, 20);
  assert.equal(publicParsers.length, 20);
  const exportedSymbols = [...publicTypes, ...publicParsers].map((name) => name.toLowerCase());
  assert.ok(manifest.generatedSdk.forbiddenExports.every((name) => !exportedSymbols.includes(name)));
  assert.doesNotMatch(sdkSource, /from ["'](?:node:fs|node:net|node:http|node:https|pg|@supabase|@vercel)/);

  for (const version of documentOrder) assert.doesNotThrow(() => parseByVersion(version, makeDocument(version, payloadFor(version))), version);
  execFileSync(process.execPath, ["contracts/support/v1/generated/typescript/generate.mjs", "--check"], { stdio: "pipe" });

  for (const [key, value] of Object.entries(manifest.frozenSpine)) {
    if (!key.endsWith("Sha256") || key.endsWith("TreeGitSha")) continue;
    const paths: Record<string, string> = {
      coreSchemaSha256: "contracts/core/v1/luzione-core-contracts-v1.schema.json",
      coreManifestSha256: "contracts/core/luzione-core-v1.manifest.json",
      coreTypesSha256: "src/modules/luzione-core-contracts/contracts.ts",
      coreParserSha256: "src/modules/luzione-core-contracts/consumerSdk.ts",
      coreFixturesSha256: "src/modules/luzione-core-contracts/fixtures.ts",
      p110EventSha256: "src/modules/platform-guarantees/eventContract.ts",
      p110CommandSha256: "src/modules/platform-guarantees/commandKernel.ts",
      p111StateSha256: "src/modules/platform-guarantees/stateMachine.ts",
      p111RetrySha256: "src/modules/platform-guarantees/retryPolicy.ts",
      p111RecoverySha256: "src/modules/platform-guarantees/recoveryPlaybooks.ts",
    };
    assert.equal(sha256(paths[key]), value, key);
  }
});
