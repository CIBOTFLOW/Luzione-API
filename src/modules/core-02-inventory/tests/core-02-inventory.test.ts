import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const baseSha = "bb5eb395af0873f4483ba2dc10c76f9941051dde";
const root = "engineering/execution/core-02";
const manifestPath = `${root}/CORE_02_API_ACTIVATION_CONE_MANIFEST_V1.json`;
const ledgerPath = `${root}/CORE_02_UNKNOWN_OWNER_LEDGER_V1.json`;
const evidenceSetPath = `${root}/CORE_02_EVIDENCE_SET_V1.json`;
const correctionPath = `${root}/CORE_CORRECTION_01_REMEDIATION_V1.json`;
const artifactDigestPath = `${root}/CORE_02_ARTIFACT_DIGESTS_V1.json`;
const packetDirectory = `${root}/owner-returns`;

type Json = Record<string, unknown>;
type Route = { journeys: string[]; method: string; path: string; routeId: string; sourcePath: string };
type RelationGroup = {
  additionalSourcePaths?: string[];
  journeys: string[];
  relationGroupId: string;
  relations: string[];
  sourceKind: string;
  sourcePath: string;
};
type Unknown = {
  journeys: string[];
  packetId: string;
  requiredHumanFunction: string;
  requiredReturnFields: string[];
  unknown: string;
  unknownId: string;
};
type Journey = {
  jobIds: string[];
  journeyId: string;
  relationGroupIds: string[];
  routeIds: string[];
  unknownRefs: string[];
};
type Job = { jobId: string; journeys: string[]; scheduler: string };
type PacketAnswer = { unknownId: string; values: Record<string, unknown> };
type Packet = {
  answers: PacketAnswer[];
  packetId: string;
  requiredHumanFunction: string;
  return: { productionMutationPerformed: boolean; secretValuesIncluded: boolean };
  signer: { name: null; signatureRef: null; signedAt: null };
  unknownIds: string[];
};

function parse(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

function uniqueViolations(values: readonly string[], prefix: string) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (seen.has(value)) return [`duplicate-${prefix}:${value}`];
    seen.add(value);
    return [];
  });
}

function routeViolations(routes: readonly Route[]) {
  const violations = [
    ...uniqueViolations(routes.map((route) => route.routeId), "route-id"),
    ...uniqueViolations(routes.map((route) => `${route.method}:${route.path}`), "route-method-path"),
  ];
  for (const route of routes) {
    if (!existsSync(route.sourcePath)) {
      violations.push(`missing-route-source:${route.routeId}`);
      continue;
    }
    const source = readFileSync(route.sourcePath, "utf8");
    if (!new RegExp(`export\\s+(?:async\\s+)?function\\s+${route.method}\\b`).test(source)) {
      violations.push(`missing-route-method:${route.routeId}:${route.method}`);
    }
  }
  return violations;
}

function relationViolations(groups: readonly RelationGroup[]) {
  const violations = uniqueViolations(groups.map((group) => group.relationGroupId), "relation-group");
  const relationOwner = new Map<string, string>();
  for (const group of groups) {
    for (const relation of group.relations) {
      const existing = relationOwner.get(relation);
      if (existing) violations.push(`duplicate-relation:${relation}:${existing}:${group.relationGroupId}`);
      relationOwner.set(relation, group.relationGroupId);
    }
    if (group.sourceKind.includes("MIGRATION_OWNED")) {
      const sources = [group.sourcePath, ...(group.additionalSourcePaths ?? [])];
      if (sources.some((path) => !existsSync(path))) {
        violations.push(`missing-migration-source:${group.relationGroupId}`);
        continue;
      }
      const sql = sources.map((path) => readFileSync(path, "utf8")).join("\n");
      for (const relation of group.relations) {
        const creation = new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${relation}\\b`, "i");
        if (!creation.test(sql)) violations.push(`relation-not-created:${group.relationGroupId}:${relation}`);
      }
    }
  }
  return violations;
}

function packetViolations(unknowns: readonly Unknown[], packets: readonly Packet[]) {
  const violations = [
    ...uniqueViolations(unknowns.map((item) => item.unknownId), "unknown"),
    ...uniqueViolations(packets.map((packet) => packet.packetId), "packet"),
  ];
  const packetByUnknown = new Map<string, Packet[]>();
  for (const packet of packets) {
    assert.equal(packet.return.secretValuesIncluded, false);
    assert.equal(packet.return.productionMutationPerformed, false);
    assert.equal(packet.signer.name, null);
    assert.equal(packet.signer.signedAt, null);
    assert.equal(packet.signer.signatureRef, null);
    assert.deepEqual(packet.answers.map((answer) => answer.unknownId).sort(), [...packet.unknownIds].sort());
    for (const unknownId of packet.unknownIds) {
      packetByUnknown.set(unknownId, [...(packetByUnknown.get(unknownId) ?? []), packet]);
    }
  }
  for (const unknown of unknowns) {
    const matches = packetByUnknown.get(unknown.unknownId) ?? [];
    if (matches.length !== 1) {
      violations.push(`packet-coverage:${unknown.unknownId}:${matches.length}`);
      continue;
    }
    const packet = matches[0];
    if (packet.packetId !== unknown.packetId) violations.push(`packet-id:${unknown.unknownId}`);
    if (packet.requiredHumanFunction !== unknown.requiredHumanFunction) violations.push(`packet-function:${unknown.unknownId}`);
    const answer = packet.answers.find((candidate) => candidate.unknownId === unknown.unknownId);
    if (!answer) {
      violations.push(`packet-answer:${unknown.unknownId}`);
      continue;
    }
    if (JSON.stringify(Object.keys(answer.values).sort()) !== JSON.stringify([...unknown.requiredReturnFields].sort())) {
      violations.push(`packet-fields:${unknown.unknownId}`);
    }
    if (!unknown.unknown.trim() || unknown.requiredReturnFields.length === 0) violations.push(`incomplete-unknown:${unknown.unknownId}`);
  }
  for (const unknownId of packetByUnknown.keys()) {
    if (!unknowns.some((unknown) => unknown.unknownId === unknownId)) violations.push(`orphan-packet-unknown:${unknownId}`);
  }
  return violations;
}

function secretValueViolations(raw: string) {
  const patterns: Array<[string, RegExp]> = [
    ["credentialed-database-url", /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@/i],
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
    ["bearer-token", /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/],
    ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ["stripe-key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/],
    ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
    ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
    ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
    ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    ["shopify-token", /\b(?:shpat|shpca|shppa|shpss)_[A-Fa-f0-9]{20,}\b/],
    ["supabase-token", /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}\b/],
    ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
    ["vercel-token", /\bvercel_[A-Za-z0-9_-]{20,}\b/],
    ["npm-token", /\bnpm_[A-Za-z0-9]{20,}\b/],
    ["sendgrid-key", /\bSG\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{20,}\b/],
    ["assigned-secret-value", /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i],
  ];
  return patterns.flatMap(([name, pattern]) => pattern.test(raw) ? [`secret-pattern:${name}`] : []);
}

function gitTree(revision: string, path: string) {
  return execFileSync("git", ["rev-parse", `${revision}:${path}`], { encoding: "utf8" }).trim();
}

const manifest = parse(manifestPath) as {
  credentialBindings: Array<Record<string, unknown>>;
  flags: Array<{ reference: string }>;
  frozenInputs: { contractsCoreTree: string; core01FinalSha: string; sdkTree: string };
  inventoryCounts: { ownerReturnPackets: number; routes: number; uniqueRelations: number; unknowns: number };
  jobs: Job[];
  journeys: Journey[];
  monitors: { alerts: string[]; dashboards: string[]; sourcePath: string };
  relationGroups: RelationGroup[];
  routes: Route[];
  scope: { effectAuthority: string; includedJourneys: string[] };
};
const ledger = parse(ledgerPath) as { summary: { ownerPacketCount: number; unknownCount: number }; unknowns: Unknown[] };
const evidenceSet = parse(evidenceSetPath) as { paths: string[]; policy: { scanEveryListedByte: boolean; unsignedOwnerReturnsRemainUnknown: boolean } };
const correction = parse(correctionPath) as {
  detachedFinalAttestation: {
    publicationMechanism: string;
    publicationTiming: string;
    repositoryTrackedFinalShaPlaceholderProhibited: boolean;
    sameCommitSelfHashProhibited: boolean;
  };
  ownerReturns: { answerCount: number; disposition: string; signedCount: number };
};
const artifactDigests = parse(artifactDigestPath) as { algorithm: string; artifacts: Array<{ digest: string; path: string }> };
const packetPaths = readdirSync(packetDirectory).filter((name) => name.endsWith(".json")).sort();
const packets = packetPaths.map((name) => parse(`${packetDirectory}/${name}`) as Packet);

test("CORE-02 manifest is a bounded three-journey no-effect inventory", () => {
  assert.deepEqual(manifest.scope.includedJourneys, ["GJ-1", "GJ-2", "GJ-3"]);
  assert.equal(manifest.scope.effectAuthority, "NO_EFFECT");
  assert.deepEqual(routeViolations(manifest.routes), []);
  assert.deepEqual(relationViolations(manifest.relationGroups), []);
  assert.equal(manifest.inventoryCounts.routes, manifest.routes.length);
  assert.equal(manifest.inventoryCounts.uniqueRelations, new Set(manifest.relationGroups.flatMap((group) => group.relations)).size);
  assert.equal(manifest.inventoryCounts.unknowns, ledger.unknowns.length);
  assert.equal(manifest.inventoryCounts.ownerReturnPackets, packets.length);

  const routeIds = new Set(manifest.routes.map((route) => route.routeId));
  const relationGroupIds = new Set(manifest.relationGroups.map((group) => group.relationGroupId));
  const unknownIds = new Set(ledger.unknowns.map((unknown) => unknown.unknownId));
  const jobIds = new Set(manifest.jobs.map((job) => job.jobId));
  for (const journey of manifest.journeys) {
    assert.ok(["GJ-1", "GJ-2", "GJ-3"].includes(journey.journeyId));
    assert.ok(journey.routeIds.every((id) => routeIds.has(id)));
    assert.ok(journey.relationGroupIds.every((id) => relationGroupIds.has(id)));
    assert.ok(journey.jobIds.every((id) => jobIds.has(id)));
    assert.ok(journey.unknownRefs.every((id) => unknownIds.has(id)));

    assert.deepEqual(
      new Set(journey.routeIds),
      new Set(manifest.routes.filter((route) => route.journeys.includes(journey.journeyId)).map((route) => route.routeId)),
    );
    assert.deepEqual(
      new Set(journey.relationGroupIds),
      new Set(manifest.relationGroups.filter((group) => group.journeys.includes(journey.journeyId)).map((group) => group.relationGroupId)),
    );
    assert.deepEqual(
      new Set(journey.jobIds),
      new Set(manifest.jobs.filter((job) => job.journeys.includes(journey.journeyId)).map((job) => job.jobId)),
    );
    assert.deepEqual(
      new Set(journey.unknownRefs),
      new Set(ledger.unknowns.filter((unknown) => unknown.journeys.includes(journey.journeyId)).map((unknown) => unknown.unknownId)),
    );
  }
  assert.deepEqual(
    new Set(manifest.journeys.flatMap((journey) => journey.unknownRefs)),
    unknownIds,
  );
  assert.ok(manifest.journeys.find((journey) => journey.journeyId === "GJ-1")?.unknownRefs.includes("CORE02-U008"));
});

test("every unknown has one unsigned exact-field owner-return packet", () => {
  assert.equal(ledger.unknowns.length, 19);
  assert.equal(ledger.summary.unknownCount, ledger.unknowns.length);
  assert.equal(ledger.summary.ownerPacketCount, packetPaths.length);
  assert.deepEqual(packetViolations(ledger.unknowns, packets), []);
  assert.equal(correction.ownerReturns.answerCount, ledger.unknowns.length);
  assert.equal(correction.ownerReturns.signedCount, 0);
  assert.equal(correction.ownerReturns.disposition, "ALL_UNSIGNED_ANSWERS_REMAIN_UNKNOWN");
});

test("final attestation is detached and can bind the exact final without self-hashing", () => {
  assert.equal(correction.detachedFinalAttestation.publicationTiming, "AFTER_FINAL_COMMIT");
  assert.equal(correction.detachedFinalAttestation.publicationMechanism, "CONTENT_ADDRESSED_ANNOTATED_GIT_TAG");
  assert.equal(correction.detachedFinalAttestation.sameCommitSelfHashProhibited, true);
  assert.equal(correction.detachedFinalAttestation.repositoryTrackedFinalShaPlaceholderProhibited, true);
  assert.equal(Object.hasOwn(correction.detachedFinalAttestation, "finalSha"), false);
});

test("every declared CORE-02 artifact digest matches the current correction tree", () => {
  assert.equal(artifactDigests.algorithm, "sha256");
  assert.equal(new Set(artifactDigests.artifacts.map((artifact) => artifact.path)).size, artifactDigests.artifacts.length);
  for (const artifact of artifactDigests.artifacts) {
    assert.ok(existsSync(artifact.path), artifact.path);
    assert.equal(createHash("sha256").update(readFileSync(artifact.path)).digest("hex"), artifact.digest, artifact.path);
  }
});

test("the complete declared CORE-02 evidence set contains no standard credential or token values", () => {
  assert.equal(evidenceSet.policy.scanEveryListedByte, true);
  assert.equal(evidenceSet.policy.unsignedOwnerReturnsRemainUnknown, true);
  assert.equal(new Set(evidenceSet.paths).size, evidenceSet.paths.length);
  assert.ok(evidenceSet.paths.includes(evidenceSetPath));
  assert.ok(evidenceSet.paths.includes("engineering/execution/handoffs/CORE_02_G0_CONTROLLER_HANDOFF.json"));
  assert.ok(evidenceSet.paths.includes("engineering/execution/CORE_02_G0_WRITER_CLAIM.json"));
  assert.ok(evidenceSet.paths.includes("architecture/production-convergence/CORE_02_WORKING_CONTRACT.md"));
  assert.ok(evidenceSet.paths.every((path) => existsSync(path)));
  const raw = evidenceSet.paths
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.deepEqual(secretValueViolations(raw), []);
  for (const binding of manifest.credentialBindings) {
    assert.ok(typeof binding.opaqueReference === "string");
    assert.equal(Object.hasOwn(binding, "value"), false);
    assert.equal(Object.hasOwn(binding, "secret"), false);
  }
});

test("tracked jobs flags monitors and kill switches remain documentary and default-off", () => {
  const packageSource = readFileSync("package.json", "utf8");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as Record<string, unknown>;
  const config = readFileSync("src/lib/api/config.ts", "utf8");
  const operations = readFileSync(manifest.monitors.sourcePath, "utf8");
  assert.match(packageSource, /"worker:providers": "node --import tsx scripts\/run-provider-worker\.ts"/);
  assert.equal(Object.hasOwn(vercel, "crons"), false);
  assert.ok(manifest.jobs.every((job) => job.scheduler === "NONE_IN_REPOSITORY"));
  for (const flag of manifest.flags.filter((item) => item.reference.startsWith("LUZIONE_API_"))) {
    for (const name of flag.reference.split("|").map((value) => value.trim())) {
      const sourceToken = name.startsWith("LUZIONE_API_PROVIDER_")
        ? name.replace(/_(?:DESTINATIONS|ENABLED|TENANTS)$/, "")
        : name;
      assert.match(config, new RegExp(sourceToken));
    }
  }
  for (const dashboard of manifest.monitors.dashboards) assert.match(operations, new RegExp(`dashboardId: "${dashboard}"`));
  for (const alert of manifest.monitors.alerts) assert.match(operations, new RegExp(`alertId: "${alert}"`));
});

test("CORE-01 contract and SDK trees match the immutable tree IDs derived from the exact released final", () => {
  assert.equal(manifest.frozenInputs.core01FinalSha, baseSha);
  assert.equal(manifest.frozenInputs.contractsCoreTree, "d57ccc4cccd97b37acd1a1575b1e07ede5787349");
  assert.equal(manifest.frozenInputs.sdkTree, "d594fa014d7020fdf8386c7a6926ff9b573ac355");
  assert.equal(gitTree("HEAD", "contracts/core"), manifest.frozenInputs.contractsCoreTree);
  assert.equal(gitTree("HEAD", "src/modules/luzione-core-contracts"), manifest.frozenInputs.sdkTree);
});

test("known-bad inventory mutations fail mechanically", () => {
  assert.ok(routeViolations([...manifest.routes, manifest.routes[0]]).some((item) => item.startsWith("duplicate-route-id")));
  assert.ok(routeViolations([{ ...manifest.routes[0], method: "DELETE" }]).includes(`missing-route-method:${manifest.routes[0].routeId}:DELETE`));
  assert.ok(relationViolations([...manifest.relationGroups, manifest.relationGroups[0]]).some((item) => item.startsWith("duplicate-relation-group")));
  assert.ok(packetViolations([...ledger.unknowns, { ...ledger.unknowns[0], unknownId: "CORE02-U999" }], packets).includes("packet-coverage:CORE02-U999:0"));
  assert.deepEqual(secretValueViolations("postgres://runtime:do-not-record@example.invalid/db"), ["secret-pattern:credentialed-database-url"]);
  assert.deepEqual(secretValueViolations(`Bearer ${"x".repeat(24)}`), ["secret-pattern:bearer-token"]);
  assert.deepEqual(secretValueViolations(`AKIA${"A".repeat(16)}`), ["secret-pattern:aws-access-key"]);
  assert.deepEqual(secretValueViolations(`github_pat_${"a".repeat(24)}`), ["secret-pattern:github-token"]);
});
