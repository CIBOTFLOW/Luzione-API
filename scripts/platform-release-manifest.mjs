#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = path.join(apiRoot, "release/platform-release-manifest.json");

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function signPayload(payload, privateKeyPem, keyId) {
  const canonicalPayload = canonicalJson(payload);
  return {
    algorithm: "Ed25519",
    keyId,
    payloadSha256: sha256(canonicalPayload),
    signatureBase64: crypto.sign(null, Buffer.from(canonicalPayload), privateKeyPem).toString("base64"),
  };
}

export function verifySignature(document, publicKeyPem) {
  if (document.signature?.algorithm !== "Ed25519") throw new Error("Release manifest must use Ed25519.");
  const canonicalPayload = canonicalJson(document.payload);
  const digest = sha256(canonicalPayload);
  if (document.signature.payloadSha256 !== digest) throw new Error("Release manifest payload digest mismatch.");
  const valid = crypto.verify(
    null,
    Buffer.from(canonicalPayload),
    publicKeyPem,
    Buffer.from(document.signature.signatureBase64, "base64"),
  );
  if (!valid) throw new Error("Release manifest signature is invalid.");
  return true;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function repositoryState(name, root, artifactPathEnvironment, deploymentEnvironment) {
  const commit = git(root, ["rev-parse", "HEAD"]);
  const dirty = git(root, ["status", "--porcelain"]).length > 0;
  const artifactPath = process.env[artifactPathEnvironment]?.trim() || null;
  const artifactSha256 = artifactPath
    ? sha256(fs.readFileSync(path.resolve(root, artifactPath)))
    : "UNBUILT";
  return {
    name,
    commit,
    clean: !dirty,
    artifactPath: artifactPath || "UNBUILT",
    artifactSha256,
    deploymentReleaseId: process.env[deploymentEnvironment]?.trim() || "UNDEPLOYED",
  };
}

function rollbackArtifact(root, migrationPath) {
  const candidate = migrationPath.replace(/\.sql$/, ".down.sql");
  return fs.existsSync(path.join(root, candidate))
    ? { strategy: "GUARDED_DOWN", path: candidate, sha256: sha256(fs.readFileSync(path.join(root, candidate))) }
    : { strategy: "PREVIOUS_BINARY_WITH_ADDITIVE_SCHEMA", path: null, sha256: null };
}

function uiMigrations(root, sourceCommit) {
  const manifestPath = path.join(root, "packages/db-schema/migration-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return manifest.migrations
    .filter(({ sequence }) => sequence >= 64 && sequence <= 136)
    .map((migration, dependencyOrder) => {
      const absolutePath = path.join(root, migration.path);
      return {
        ownerRepository: "Luzione-UI",
        migrationId: migration.id,
        sequence: migration.sequence,
        path: migration.path,
        sha256: sha256(fs.readFileSync(absolutePath)),
        sourceCommit,
        dependencyOrder,
        lockProfile: { transactional: true, lockTimeout: "5s", statementTimeout: "5min" },
        rollbackArtifact: rollbackArtifact(root, migration.path),
      };
    });
}

function apiMigrations(root, sourceCommit, dependencyOffset) {
  const migrationRoot = path.join(root, "supabase/migrations");
  return fs.readdirSync(migrationRoot)
    .filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map((file, index) => {
      const migrationPath = `supabase/migrations/${file}`;
      return {
        ownerRepository: "Luzione-API",
        migrationId: file.slice(0, -4),
        sequence: null,
        path: migrationPath,
        sha256: sha256(fs.readFileSync(path.join(root, migrationPath))),
        sourceCommit,
        dependencyOrder: dependencyOffset + index,
        lockProfile: { transactional: true, lockTimeout: "5s", statementTimeout: "5min" },
        rollbackArtifact: rollbackArtifact(root, migrationPath),
      };
    });
}

export function buildPayload({ uiRoot, sultanRoot }) {
  const repositories = [
    repositoryState("Luzione-API", apiRoot, "LUZIONE_API_ARTIFACT_PATH", "LUZIONE_API_DEPLOYMENT_RELEASE_ID"),
    repositoryState("Luzione-UI", uiRoot, "LUZIONE_UI_ARTIFACT_PATH", "LUZIONE_UI_DEPLOYMENT_RELEASE_ID"),
    repositoryState("Sultan-OS", sultanRoot, "SULTAN_OS_ARTIFACT_PATH", "SULTAN_OS_DEPLOYMENT_RELEASE_ID"),
  ];
  const repositoryByName = Object.fromEntries(repositories.map((repository) => [repository.name, repository]));
  const ui = uiMigrations(uiRoot, repositoryByName["Luzione-UI"].commit);
  const api = apiMigrations(apiRoot, repositoryByName["Luzione-API"].commit, ui.length);
  const truthStatus = process.env.PLATFORM_RELEASE_TRUTH_STATUS?.trim() || "TESTED_LOCAL";
  const allowedTruthStatuses = new Set([
    "DESIGNED", "TESTED_LOCAL", "SHADOW_OBSERVED", "LIVE_INTERNAL",
    "LIVE_EXTERNAL", "DEGRADED", "BLOCKED",
  ]);
  if (!allowedTruthStatuses.has(truthStatus)) throw new Error(`Unsupported truth status ${truthStatus}.`);
  return {
    schemaVersion: "luzione-platform-release/v1",
    releaseId: requiredEnvironment("PLATFORM_RELEASE_ID"),
    evidenceAt: requiredEnvironment("PLATFORM_RELEASE_EVIDENCE_AT"),
    certifiedBoundary: ["Luzione-UI", "Luzione-API", "Sultan-OS", "Postgres/Supabase", "OpenAI", "Gmail", "private Google Docs/PDF"],
    truthStatus,
    repositories,
    migrations: [...ui, ...api],
    rollback: {
      previousDeploymentsRequired: true,
      backwardCompatibleSchemaRequired: true,
      destructiveCleanupAuthorized: false,
    },
  };
}

function assertProductionComplete(payload) {
  if (payload.truthStatus !== "LIVE_EXTERNAL") throw new Error("Production manifest truthStatus must be LIVE_EXTERNAL.");
  for (const repository of payload.repositories) {
    if (!repository.clean) throw new Error(`${repository.name} source tree is not clean.`);
    if (repository.artifactSha256 === "UNBUILT" || repository.artifactPath === "UNBUILT") {
      throw new Error(`${repository.name} immutable artifact is missing.`);
    }
    if (repository.deploymentReleaseId === "UNDEPLOYED") throw new Error(`${repository.name} deployment release ID is missing.`);
  }
}

export function verifyFiles(payload, roots, { production = false } = {}) {
  if (payload.schemaVersion !== "luzione-platform-release/v1") throw new Error("Unsupported release manifest version.");
  const repositoryMap = Object.fromEntries(payload.repositories.map((repository) => [repository.name, repository]));
  for (const [name, root] of Object.entries(roots)) {
    const repository = repositoryMap[name];
    if (!repository) throw new Error(`Missing repository record for ${name}.`);
    if (git(root, ["rev-parse", "HEAD"]) !== repository.commit) throw new Error(`${name} source commit mismatch.`);
    if (production && git(root, ["status", "--porcelain"]).length > 0) throw new Error(`${name} source tree is dirty.`);
    if (repository.artifactPath !== "UNBUILT") {
      const artifactDigest = sha256(fs.readFileSync(path.resolve(root, repository.artifactPath)));
      if (artifactDigest !== repository.artifactSha256) throw new Error(`${name} artifact checksum mismatch.`);
    }
  }
  for (const migration of payload.migrations) {
    const root = roots[migration.ownerRepository];
    if (!root) throw new Error(`Unknown migration owner ${migration.ownerRepository}.`);
    const digest = sha256(fs.readFileSync(path.join(root, migration.path)));
    if (digest !== migration.sha256) throw new Error(`Migration checksum mismatch for ${migration.migrationId}.`);
  }
  if (production) assertProductionComplete(payload);
  return true;
}

function paths() {
  return {
    output: path.resolve(process.env.PLATFORM_RELEASE_MANIFEST_PATH || defaultOutput),
    uiRoot: path.resolve(requiredEnvironment("LUZIONE_UI_RELEASE_ROOT")),
    sultanRoot: path.resolve(requiredEnvironment("SULTAN_OS_RELEASE_ROOT")),
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function main() {
  const command = process.argv[2];
  const releasePaths = paths();
  if (command === "prepare") {
    writeJson(releasePaths.output, { payload: buildPayload(releasePaths), signature: null });
    console.log(`[release-manifest] prepared ${releasePaths.output}`);
    return;
  }
  const document = JSON.parse(fs.readFileSync(releasePaths.output, "utf8"));
  if (command === "sign") {
    if (document.signature) throw new Error("Release manifest is already signed; regenerate from exact source instead of overwriting it.");
    const privateKey = fs.readFileSync(requiredEnvironment("RELEASE_MANIFEST_SIGNING_KEY_FILE"), "utf8");
    document.signature = signPayload(document.payload, privateKey, requiredEnvironment("RELEASE_MANIFEST_SIGNING_KEY_ID"));
    const signedOutput = `${releasePaths.output}.signed`;
    writeJson(signedOutput, document);
    console.log(`[release-manifest] signed ${signedOutput}`);
    return;
  }
  if (command === "verify") {
    const publicKey = fs.readFileSync(requiredEnvironment("RELEASE_MANIFEST_TRUSTED_PUBLIC_KEY_FILE"), "utf8");
    const trustedKeyId = requiredEnvironment("RELEASE_MANIFEST_TRUSTED_KEY_ID");
    if (document.signature?.keyId !== trustedKeyId) throw new Error("Release manifest signer key ID is not trusted.");
    verifySignature(document, publicKey);
    verifyFiles(document.payload, {
      "Luzione-API": apiRoot,
      "Luzione-UI": releasePaths.uiRoot,
      "Sultan-OS": releasePaths.sultanRoot,
    }, { production: process.argv.includes("--production") });
    console.log(`[release-manifest] verified ${releasePaths.output}`);
    return;
  }
  throw new Error("Usage: platform-release-manifest.mjs prepare|sign|verify [--production]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error("[release-manifest]", error instanceof Error ? error.message : "unknown failure");
    process.exitCode = 1;
  }
}
