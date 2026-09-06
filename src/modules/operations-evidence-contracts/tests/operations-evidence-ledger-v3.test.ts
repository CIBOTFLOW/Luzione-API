import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import type { CapabilityWindowLedgerV1, ProofDailyRecordV1 } from "../contracts";
import { OperationsEvidenceCompatibilityError, type OperationsEvidenceErrorCode } from "../consumerSdk";
import type { LuzioneOperationsEvidenceLedgerV2 } from "../v2/contracts";
import { parseOperationsEvidenceLedgerV2, sealOperationsEvidenceLedgerV2 } from "../v2/sdk";
import {
  makeBasicOperationsEvidenceLedgerV3Fixture,
  makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture,
  makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture,
  operationsEvidenceLedgerV3FixtureClock,
} from "../v3/fixtures";
import type { G2EffectAuthorityGrantV2, IncidentRecoverySourceBindingV1, LuzioneOperationsEvidenceLedgerV3, OperationsEvidenceAppendStateV1, OperationsEvidenceAppendStateV2, OperationsEvidenceAuthorityRecoverySourceSnapshotV1 } from "../v3/contracts";
import { OPS_CORRECTION_04_ADVERSE_PROBES, OPS_LEDGER_V3_SCHEMA_KEYS } from "../v3/rules";
import {
  calculateOperationsEvidenceAppendStateDigest,
  calculateOperationsEvidenceAppendStateDigestV2,
  calculateSourceSnapshotDigest,
  createGenesisOperationsEvidenceAppendStateV1,
  createInMemoryOperationsEvidenceAppendStateStoreV2,
  parseLuzioneOperationsEvidenceLedgerManifestV3,
  parseOperationsEvidenceAppendStateV1,
  parseOperationsEvidenceAppendStateV2,
  parseOperationsEvidenceLedgerV3,
  reinitializeEmptySyntheticAppendStateV1AsV2,
  sealG2EffectAuthorityGrantV2,
  sealIncidentRecoverySourceBindingV1,
  sealOperationsEvidenceLedgerV3,
} from "../v3/sdk";

const schemaPath = "contracts/operations-evidence/v3/luzione-operations-evidence-ledger-v3.schema.json";
const appendSchemaPath = "contracts/operations-evidence/v3/operations-evidence-append-state-v2.schema.json";
const sourceSchemaPath = "contracts/operations-evidence/v3/operations-evidence-canonical-source-attestation-v1.schema.json";
const sourceObjectsSchemaPath = "contracts/operations-evidence/v3/operations-evidence-canonical-source-objects-v1.schema.json";
const manifestPath = "contracts/operations-evidence/luzione-operations-evidence-ledger-v3.manifest.json";
const adverseFixturesPath = "contracts/operations-evidence/v3/ops-contracts-correction-04-adverse-fixtures.json";

test("D01/B07 stable grant identity is append-only across parser invocations and exact replay is idempotent", () => {
  const fixture = makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture();
  const first = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  assert.equal(first.appendDisposition, "APPENDED");
  const replay = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  assert.equal(replay.appendDisposition, "EXACT_REPLAY");
  assert.equal(replay.appendState.stateDigest, first.appendState.stateDigest);

  const changes: Array<(row: OperationsEvidenceAppendStateV2["g2GrantIdentities"][number]) => void> = [
    (row) => { (row as { issuerSubjectId: string }).issuerSubjectId = "human:alternate"; },
    (row) => { (row as { actionId: string }).actionId = "g2:changed-action"; },
    (row) => { (row as { requestedStage: string }).requestedStage = "FORMAL_PROOF"; },
    (row) => { (row as { effect: string }).effect = "FORMAL_PROOF_OPEN"; },
    (row) => { (row as { expiresAt: string }).expiresAt = "2026-09-07T12:00:00.000Z"; },
    (row) => { (row as { grantDigest: string }).grantDigest = "e".repeat(64); },
  ];
  for (const change of changes) {
    const conflicting = structuredClone(first.appendState);
    change(conflicting.g2GrantIdentities[0]);
    conflicting.stateDigest = calculateOperationsEvidenceAppendStateDigestV2(withoutStateDigest(conflicting));
    const context = { ...fixture.context, appendStateStore: createInMemoryOperationsEvidenceAppendStateStoreV2([conflicting]) };
    assertOpsError(() => parseOperationsEvidenceLedgerV3(fixture.ledger, context), "OPS_AUTHORITY_DENIED");
  }
  const changedState = structuredClone(first.appendState) as unknown as Record<string, unknown>;
  ((changedState.g2GrantIdentities as Array<Record<string, unknown>>)[0]).state = "REVOKED";
  changedState.stateDigest = calculateOperationsEvidenceAppendStateDigestV2(withoutStateDigest(changedState as unknown as OperationsEvidenceAppendStateV2));
  assertOpsError(() => parseOperationsEvidenceAppendStateV2(changedState), "OPS_VALUE_INVALID");
});

test("D02/B08 authenticated canonical bytes reject caller tamper and coherent re-seal", () => {
  const fixture = makeBasicOperationsEvidenceLedgerV3Fixture();
  const snapshot = structuredClone(fixture.context.sourceSnapshot);
  const attestation = snapshot.sourceAttestations[0];
  const object = JSON.parse(attestation.objectBytes);
  object.canonicalFunction = "FOUNDER";
  attestation.objectBytes = canonical(object);
  attestation.objectHash = sha256(attestation.objectBytes);
  const readback = JSON.parse(attestation.readbackBytes);
  readback.objectHash = attestation.objectHash;
  attestation.readbackBytes = canonical(readback);
  attestation.readbackHash = sha256(attestation.readbackBytes);
  attestation.attestationDigest = sha256(canonical(withoutAttestationSeal(attestation)));
  snapshot.snapshotDigest = calculateSourceSnapshotDigest(withoutSnapshotDigest(snapshot));
  const context = { ...fixture.context, sourceSnapshot: snapshot };
  assertOpsError(() => parseOperationsEvidenceLedgerV3(fixture.ledger, context), "OPS_AUTHORITY_DENIED");
});

test("D03/B09 generic recovery bytes cannot be relabeled as typed incident recovery authority", () => {
  const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
  const snapshot = structuredClone(fixture.context.sourceSnapshot);
  const recovery = snapshot.sourceAttestations.find((item) => item.objectType === "RECOVERY_RECEIPT")!;
  recovery.objectBytes = canonical({ contractVersion: "GenericRecovery/v1", recoveryReceiptId: recovery.objectId, tenantId: recovery.tenantId });
  recovery.objectHash = sha256(recovery.objectBytes);
  snapshot.snapshotDigest = calculateSourceSnapshotDigest(withoutSnapshotDigest(snapshot));
  assertOpsError(() => parseOperationsEvidenceLedgerV3(fixture.ledger, { ...fixture.context, sourceSnapshot: snapshot }), "OPS_FIELD_SET_MISMATCH");
});

test("D04/B10 a durable prior successor rejects a later cross-ledger fork from the same anchor", () => {
  const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
  const first = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  const forkedHistory = structuredClone(first.appendState);
  forkedHistory.appliedLedgerDigests = ["d".repeat(64)];
  forkedHistory.epochSuccessors[0].resetId = "reset:already-committed-other-ledger";
  forkedHistory.epochSuccessors[0].resetDigest = "c".repeat(64);
  forkedHistory.epochSuccessors[0].newEpochId = "epoch:already-committed-other-ledger";
  forkedHistory.stateDigest = calculateOperationsEvidenceAppendStateDigestV2(withoutStateDigest(forkedHistory));
  const context = { ...fixture.context, appendStateStore: createInMemoryOperationsEvidenceAppendStateStoreV2([forkedHistory]) };
  const separateLedger = structuredClone(fixture.ledger);
  separateLedger.ledgerId = "ledger:separate-document-same-tenant";
  separateLedger.baseLedger = resealV2({ ...separateLedger.baseLedger, ledgerId: separateLedger.ledgerId });
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(separateLedger), context), "OPS_REFERENCE_MISMATCH");
});

test("D05 reset calendar day is rejected even though frozen v2 admits it", () => {
  const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
  const ledger = structuredClone(fixture.ledger);
  const daily = ledger.baseLedger.entries.find((entry) => entry.document.contractVersion === "ProofDailyRecord/v1")!.document as ProofDailyRecordV1;
  const capability = ledger.baseLedger.entries.find((entry) => entry.document.contractVersion === "CapabilityWindowLedger/v1")!.document as CapabilityWindowLedgerV1;
  daily.payload.date = ledger.capabilityEpochResets[0].effectiveAt.slice(0, 10);
  capability.payload.windowStart = daily.payload.date;
  ledger.baseLedger = resealV2(ledger.baseLedger);
  assert.doesNotThrow(() => parseOperationsEvidenceLedgerV2(ledger.baseLedger, { assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime }));
  const v3 = reseal(ledger);
  assertOpsError(() => parseOperationsEvidenceLedgerV3(v3, fixture.context), "OPS_CLOCK_INVALID");
});

test("B11 object version/hash/readback drift fails before any append", () => {
  const mutations: Array<{ code: OperationsEvidenceErrorCode; mutate: (snapshot: OperationsEvidenceAuthorityRecoverySourceSnapshotV1) => void }> = [
    { code: "OPS_REFERENCE_MISMATCH", mutate: (snapshot) => { (snapshot.sourceAttestations[0] as { objectVersion: string }).objectVersion = "OperationsEvidenceCanonicalTenantMembership/v2"; } },
    { code: "OPS_AUTHORITY_DENIED", mutate: (snapshot) => { (snapshot.sourceAttestations[0] as { objectHash: string }).objectHash = "f".repeat(64); } },
    { code: "OPS_AUTHORITY_DENIED", mutate: (snapshot) => { (snapshot.sourceAttestations[0] as { readbackHash: string }).readbackHash = "e".repeat(64); } },
  ];
  for (const { code, mutate } of mutations) {
    const fixture = makeBasicOperationsEvidenceLedgerV3Fixture();
    const snapshot = structuredClone(fixture.context.sourceSnapshot);
    mutate(snapshot);
    snapshot.snapshotDigest = calculateSourceSnapshotDigest(withoutSnapshotDigest(snapshot));
    assertOpsError(() => parseOperationsEvidenceLedgerV3(fixture.ledger, { ...fixture.context, sourceSnapshot: snapshot }), code);
  }
});

test("gap, cycle, duplicate successor and reused new epoch fail in durable state", () => {
  const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
  const first = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  const mutations: Array<(state: OperationsEvidenceAppendStateV2) => void> = [
    (state) => { (state.epochSuccessors[0] as { newEpochSequence: number }).newEpochSequence = 3; },
    (state) => { (state.epochSuccessors[0] as { newEpochId: string }).newEpochId = state.epochSuccessors[0].priorEpochId; },
    (state) => { state.epochSuccessors = [...state.epochSuccessors, structuredClone(state.epochSuccessors[0])] as never; },
  ];
  for (const mutate of mutations) {
    const state = structuredClone(first.appendState);
    mutate(state);
    state.stateDigest = calculateOperationsEvidenceAppendStateDigestV2(withoutStateDigest(state));
    assertOpsError(() => parseOperationsEvidenceAppendStateV2(state), "OPS_REFERENCE_MISMATCH");
  }
});

test("E01 signed approval readback time cannot be rebound by resealing caller wrappers", () => {
  const fixture = makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture();
  const before = canonical(fixture.context.appendStateStore.load(fixture.ledger.tenantId, fixture.ledger.ledgerId));
  const ledger = structuredClone(fixture.ledger);
  const changed = structuredClone(ledger.g2EffectAuthorityGrants[0]);
  changed.approvalSource.readbackAt = "2026-09-05T03:01:00.000Z";
  ledger.g2EffectAuthorityGrants = [resealGrant(changed), ...ledger.g2EffectAuthorityGrants.slice(1)];
  const snapshot = structuredClone(fixture.context.sourceSnapshot);
  snapshot.g2EffectAuthorityGrants = ledger.g2EffectAuthorityGrants.map((grant) => structuredClone(grant));
  snapshot.snapshotDigest = calculateSourceSnapshotDigest(withoutSnapshotDigest(snapshot));
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(ledger), { ...fixture.context, sourceSnapshot: snapshot }), "OPS_AUTHORITY_DENIED");
  assert.equal(canonical(fixture.context.appendStateStore.load(ledger.tenantId, ledger.ledgerId)), before);
});

test("E02 one signed approval/readback identity cannot be appended under a new grant ID", () => {
  const fixture = makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture();
  parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  const ledger = structuredClone(fixture.ledger);
  const changed = structuredClone(ledger.g2EffectAuthorityGrants[0]);
  changed.grantId = `${changed.grantId}:alternate`;
  ledger.g2EffectAuthorityGrants = [resealGrant(changed), ...ledger.g2EffectAuthorityGrants.slice(1)];
  const snapshot = structuredClone(fixture.context.sourceSnapshot);
  snapshot.g2EffectAuthorityGrants = ledger.g2EffectAuthorityGrants.map((grant) => structuredClone(grant));
  snapshot.snapshotDigest = calculateSourceSnapshotDigest(withoutSnapshotDigest(snapshot));
  const before = canonical(fixture.context.appendStateStore.load(ledger.tenantId, ledger.ledgerId));
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(ledger), { ...fixture.context, sourceSnapshot: snapshot }), "OPS_AUTHORITY_DENIED");
  assert.equal(canonical(fixture.context.appendStateStore.load(ledger.tenantId, ledger.ledgerId)), before);
});

test("E03 one signed approval cannot be rebound to changed action, stage, or effect scope", () => {
  const mutations: Array<(grant: G2EffectAuthorityGrantV2) => void> = [
    (grant) => { grant.actionId = "g2:open-formal-proof"; },
    (grant) => { grant.requestedStage = "FORMAL_PROOF"; },
    (grant) => { grant.effect = "FORMAL_PROOF_OPEN"; },
  ];
  for (const mutate of mutations) {
    const fixture = makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture();
    const ledger = structuredClone(fixture.ledger);
    const changed = structuredClone(ledger.g2EffectAuthorityGrants[0]);
    mutate(changed);
    ledger.g2EffectAuthorityGrants = [resealGrant(changed), ...ledger.g2EffectAuthorityGrants.slice(1)];
    const snapshot = structuredClone(fixture.context.sourceSnapshot);
    snapshot.g2EffectAuthorityGrants = ledger.g2EffectAuthorityGrants.map((grant) => structuredClone(grant));
    snapshot.snapshotDigest = calculateSourceSnapshotDigest(withoutSnapshotDigest(snapshot));
    const before = canonical(fixture.context.appendStateStore.load(ledger.tenantId, ledger.ledgerId));
    assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(ledger), { ...fixture.context, sourceSnapshot: snapshot }), "OPS_AUTHORITY_DENIED");
    assert.equal(canonical(fixture.context.appendStateStore.load(ledger.tenantId, ledger.ledgerId)), before);
  }
});

test("E04-E05 signed incident and recovery readback times cannot be rebound", () => {
  for (const sourceKey of ["incidentSource", "recoverySource"] as const) {
    const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
    const ledger = structuredClone(fixture.ledger);
    const changed = structuredClone(ledger.incidentRecoverySourceBindings[0]);
    changed[sourceKey].readbackAt = sourceKey === "incidentSource"
      ? "2026-09-04T03:31:00.000Z"
      : "2026-09-04T04:11:00.000Z";
    ledger.incidentRecoverySourceBindings = [resealIncidentBinding(changed), ...ledger.incidentRecoverySourceBindings.slice(1)];
    const snapshot = structuredClone(fixture.context.sourceSnapshot);
    snapshot.incidentRecoverySourceBindings = ledger.incidentRecoverySourceBindings.map((binding) => structuredClone(binding));
    snapshot.snapshotDigest = calculateSourceSnapshotDigest(withoutSnapshotDigest(snapshot));
    const before = canonical(fixture.context.appendStateStore.load(ledger.tenantId, ledger.ledgerId));
    assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(ledger), { ...fixture.context, sourceSnapshot: snapshot }), "OPS_AUTHORITY_DENIED");
    assert.equal(canonical(fixture.context.appendStateStore.load(ledger.tenantId, ledger.ledgerId)), before);
  }
});

test("E06-E07 exact replay is byte-idempotent and every rejected call leaves state byte-identical", () => {
  const fixture = makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture();
  const first = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  const beforeReplay = canonical(fixture.context.appendStateStore.load(fixture.ledger.tenantId, fixture.ledger.ledgerId));
  const replay = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  assert.equal(replay.appendDisposition, "EXACT_REPLAY");
  assert.equal(canonical(replay.appendState), beforeReplay);

  const changed = structuredClone(fixture.ledger);
  changed.g2EffectAuthorityGrants[0].approvalSource.readbackAt = "2026-09-05T03:02:00.000Z";
  changed.g2EffectAuthorityGrants = [resealGrant(changed.g2EffectAuthorityGrants[0]), ...changed.g2EffectAuthorityGrants.slice(1)];
  const snapshot = structuredClone(fixture.context.sourceSnapshot);
  snapshot.g2EffectAuthorityGrants = changed.g2EffectAuthorityGrants.map((grant) => structuredClone(grant));
  snapshot.snapshotDigest = calculateSourceSnapshotDigest(withoutSnapshotDigest(snapshot));
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(changed), { ...fixture.context, sourceSnapshot: snapshot }), "OPS_AUTHORITY_DENIED");
  assert.equal(canonical(fixture.context.appendStateStore.load(changed.tenantId, changed.ledgerId)), beforeReplay);
  assert.equal(first.appendState.stateDigest, replay.appendState.stateDigest);
});

test("E08-E09 populated v1 history is denied while empty synthetic v1 can initialize zero-credit v2", () => {
  const fixture = makeBasicOperationsEvidenceLedgerV3Fixture();
  const emptyV1 = createGenesisOperationsEvidenceAppendStateV1(fixture.ledger.tenantId, fixture.ledger.ledgerId);
  const populatedV1 = structuredClone(emptyV1);
  populatedV1.appliedLedgerDigests = ["a".repeat(64)];
  populatedV1.priorStateDigest = emptyV1.stateDigest;
  populatedV1.revision = 1;
  populatedV1.stateDigest = calculateOperationsEvidenceAppendStateDigest(withoutStateDigestV1(populatedV1));
  assert.doesNotThrow(() => parseOperationsEvidenceAppendStateV1(populatedV1));
  assertOpsError(() => reinitializeEmptySyntheticAppendStateV1AsV2(populatedV1), "OPS_AUTHORITY_DENIED");

  const v2 = reinitializeEmptySyntheticAppendStateV1AsV2(emptyV1);
  assert.equal(v2.contractVersion, "OperationsEvidenceAppendState/v2");
  assert.equal(v2.revision, 0);
  assert.deepEqual(v2.appliedLedgerDigests, []);
  const parsed = parseOperationsEvidenceLedgerV3(fixture.ledger, {
    ...fixture.context,
    appendStateStore: createInMemoryOperationsEvidenceAppendStateStoreV2([v2]),
  });
  assert.deepEqual(parsed.decision, {
    decisionBearingUse: "PROHIBITED_PENDING_ASSURANCE_04_AND_CANONICAL_SOURCES",
    g2Credit: 0, productionCredit: 0, proofDayCredit: 0,
  });
});

test("schema/SDK parity keeps stable readback identity embedded and exposes all D01-D06/B07-B11 probes", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const appendSchema = JSON.parse(readFileSync(appendSchemaPath, "utf8"));
  const sourceSchema = JSON.parse(readFileSync(sourceSchemaPath, "utf8"));
  const sourceObjectsSchema = JSON.parse(readFileSync(sourceObjectsSchemaPath, "utf8"));
  assert.deepEqual([...schema.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.ledger].sort());
  assert.deepEqual([...schema.$defs.SourceSnapshot.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.sourceSnapshot].sort());
  assert.deepEqual([...appendSchema.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.appendStateV2].sort());
  assert.deepEqual([...appendSchema.$defs.EpochSuccessor.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.epochSuccessorIdentityV2].sort());
  assert.deepEqual([...appendSchema.$defs.G2GrantIdentity.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.g2GrantIdentityV2].sort());
  assert.deepEqual([...appendSchema.$defs.StableSignedSourceReadbackIdentity.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.stableSignedSourceReadbackIdentity].sort());
  assert.equal(existsSync("contracts/operations-evidence/v3/stable-signed-source-readback-identity-v1.schema.json"), false);
  assert.deepEqual([...sourceSchema.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.canonicalSourceAttestation].sort());
  assert.deepEqual([...sourceObjectsSchema.$defs.TenantMembership.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.canonicalTenantMembership].sort());
  assert.deepEqual([...sourceObjectsSchema.$defs.G2Approval.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.canonicalG2Approval].sort());
  assert.deepEqual([...sourceObjectsSchema.$defs.ProofIncident.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.canonicalProofIncident].sort());
  assert.deepEqual([...sourceObjectsSchema.$defs.IncidentRecovery.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.canonicalIncidentRecovery].sort());
  assert.deepEqual([...sourceObjectsSchema.$defs.CanonicalReadback.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.canonicalSourceReadback].sort());
  assert.equal(schema.properties.decisionPolicy.const, "ZERO_CREDIT_PENDING_ASSURANCE_04");
  assert.equal(schema["x-luzione-semanticRules"].proofDayCreditCeiling, 0);
  const adverseFixtures = JSON.parse(readFileSync(adverseFixturesPath, "utf8"));
  assert.deepEqual(adverseFixtures.fixtures.map((fixture: { id: string }) => fixture.id), [...OPS_CORRECTION_04_ADVERSE_PROBES]);
  assert.deepEqual(adverseFixtures.creditCeiling, { proofDays: 0, g2: 0, production: 0 });
});

test("D06 manifest and immutable handoff contain exact truthful evidence modes without self-hash placeholders", () => {
  const manifest = parseLuzioneOperationsEvidenceLedgerManifestV3(JSON.parse(readFileSync(manifestPath, "utf8")));
  assert.equal(manifest.controllerAuthority, "48b8e76d510bd5f8bbc06510ad0ba7df9b39315b");
  assert.equal(manifest.assuranceFingerprintSha256, "d122a74f54fa03fb4d60214363e84608888cda5f54a80457fad7ce96b8c08764");
  assert.deepEqual(manifest.sourceAvailability, {
    canonicalG2Approval: "ABSENT", canonicalHumanMembership: "ABSENT", incidentBoundRecovery: "ABSENT", resolvedVerifiedIncident: "ABSENT",
  });
  assert.equal(manifest.effectAuthority, "NO_EFFECT");
  assert.equal(manifest.productionReady, false);
  assert.equal("stableSignedSourceReadbackIdentitySchema" in manifest.artifacts, false);
  const handoff = readFileSync("architecture/production-convergence/OPS_CONTRACTS_CORRECTION_03_IMMUTABLE_HANDOFF.md", "utf8");
  assert.doesNotMatch(handoff, /\b(?:PENDING|PLACEHOLDER|PEEL_SHA|TO_BE_FILLED)\b/);
  assert.match(handoff, /DETACHED_ANNOTATED_TAG/);
  assert.match(handoff, /NOT_OBSERVED/);
});

test("the bounded parser always returns zero credit and prohibits v1/v2 decision-bearing use", () => {
  for (const fixture of [makeBasicOperationsEvidenceLedgerV3Fixture(), makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture(), makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture()]) {
    const parsed = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
    assert.deepEqual(parsed.decision, {
      decisionBearingUse: "PROHIBITED_PENDING_ASSURANCE_04_AND_CANONICAL_SOURCES",
      g2Credit: 0, productionCredit: 0, proofDayCredit: 0,
    });
    assert.deepEqual(parsed.ledger.sourcePackets, { l2: "ABSENT", l3: "ABSENT" });
    assert.equal(parsed.ledger.effectAuthority, "NO_EFFECT");
  }
});

function reseal(ledger: LuzioneOperationsEvidenceLedgerV3): LuzioneOperationsEvidenceLedgerV3 {
  return sealOperationsEvidenceLedgerV3({
    assessmentTime: ledger.assessmentTime, baseLedger: ledger.baseLedger, capabilityEpochResets: ledger.capabilityEpochResets,
    contractVersion: ledger.contractVersion, creditCeiling: ledger.creditCeiling, decisionPolicy: ledger.decisionPolicy,
    effectAuthority: ledger.effectAuthority, g2EffectAuthorityGrants: ledger.g2EffectAuthorityGrants,
    humanAuthoritySourceBindings: ledger.humanAuthoritySourceBindings, incidentRecoverySourceBindings: ledger.incidentRecoverySourceBindings,
    ledgerId: ledger.ledgerId, sourcePackets: ledger.sourcePackets, tenantId: ledger.tenantId,
  });
}

function resealV2(ledger: LuzioneOperationsEvidenceLedgerV2): LuzioneOperationsEvidenceLedgerV2 {
  return sealOperationsEvidenceLedgerV2({
    assessmentTime: ledger.assessmentTime, authorityGrants: ledger.authorityGrants,
    capabilityEpochResets: ledger.capabilityEpochResets, contractVersion: ledger.contractVersion,
    dailyMetricBindings: ledger.dailyMetricBindings, effectAuthority: ledger.effectAuthority, entries: ledger.entries,
    ledgerId: ledger.ledgerId, ownerContexts: ledger.ownerContexts, priorRecordSetDigest: ledger.priorRecordSetDigest,
    tenantId: ledger.tenantId,
  });
}

function resealGrant(grant: G2EffectAuthorityGrantV2): G2EffectAuthorityGrantV2 {
  const copy = structuredClone(grant) as unknown as Record<string, unknown>;
  delete copy.grantDigest;
  return sealG2EffectAuthorityGrantV2(copy as Omit<G2EffectAuthorityGrantV2, "grantDigest">);
}

function resealIncidentBinding(binding: IncidentRecoverySourceBindingV1): IncidentRecoverySourceBindingV1 {
  const copy = structuredClone(binding) as unknown as Record<string, unknown>;
  delete copy.bindingDigest;
  return sealIncidentRecoverySourceBindingV1(copy as Omit<IncidentRecoverySourceBindingV1, "bindingDigest">);
}

function withoutStateDigest(state: OperationsEvidenceAppendStateV2): Omit<OperationsEvidenceAppendStateV2, "stateDigest"> {
  const copy = structuredClone(state) as unknown as Record<string, unknown>;
  delete copy.stateDigest;
  return copy as Omit<OperationsEvidenceAppendStateV2, "stateDigest">;
}

function withoutStateDigestV1(state: OperationsEvidenceAppendStateV1): Omit<OperationsEvidenceAppendStateV1, "stateDigest"> {
  const copy = structuredClone(state) as unknown as Record<string, unknown>;
  delete copy.stateDigest;
  return copy as Omit<OperationsEvidenceAppendStateV1, "stateDigest">;
}

function withoutSnapshotDigest(snapshot: OperationsEvidenceAuthorityRecoverySourceSnapshotV1): Omit<OperationsEvidenceAuthorityRecoverySourceSnapshotV1, "snapshotDigest"> {
  const copy = structuredClone(snapshot) as unknown as Record<string, unknown>;
  delete copy.snapshotDigest;
  return copy as Omit<OperationsEvidenceAuthorityRecoverySourceSnapshotV1, "snapshotDigest">;
}

function withoutAttestationSeal(attestation: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(attestation);
  delete copy.attestationDigest;
  delete copy.signature;
  return copy;
}

function canonical(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function assertOpsError(run: () => unknown, code: OperationsEvidenceErrorCode): void {
  assert.throws(run, (error) => error instanceof OperationsEvidenceCompatibilityError && error.code === code);
}
