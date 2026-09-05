import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateCompletenessBps,
  calculateDailyCredit,
  calculateUtilizationBps,
  OperationsEvidenceCompatibilityError,
  type OperationsEvidenceErrorCode,
  parseCapacityObservationV1,
  parseCaseHandoffV1,
  parseEvidenceCompletenessReportV1,
  parseEvidenceRefV1,
  parseLuzioneOperationsEvidenceManifestV1,
  parseOperationsEvidenceDocumentV1,
  parseProofDailyRecordV1,
  parseProofExceptionV1,
  parseStageReadinessV1,
  parseTrainingAttestationV1,
} from "../consumerSdk";
import {
  OPERATIONS_EVIDENCE_VERSIONS,
  OPS_CORE_COMPOSITION,
  OPS_PACKET_PINS,
} from "../contracts";
import {
  capacityObservationFixture,
  caseHandoffFixture,
  evidenceCompletenessReportFixture,
  evidenceRefFixture,
  operationsEvidenceFixtureClock,
  operationsEvidencePositiveFixtures,
  proofDailyRecordFixture,
  proofExceptionFixture,
  stageReadinessFixture,
  stageReadinessFixtureReferences,
  trainingAttestationFixture,
} from "../fixtures";
import { luzioneOperationsEvidenceSdkV1 } from "../generatedSdk";

const manifestPath = "contracts/operations-evidence/luzione-operations-evidence-v1.manifest.json";
const schemaPath = "contracts/operations-evidence/v1/luzione-operations-evidence-v1.schema.json";

test("all seventeen operations-evidence v1 fixtures pass the strict generated SDK", () => {
  for (const [name, fixture] of Object.entries(operationsEvidencePositiveFixtures)) {
    const references = name === "stageReadiness" ? stageReadinessFixtureReferences : undefined;
    assert.deepEqual(parseOperationsEvidenceDocumentV1(structuredClone(fixture), operationsEvidenceFixtureClock, references), fixture, name);
  }
});

test("every document rejects surplus, missing, and wrong-version fields", () => {
  for (const [name, fixture] of Object.entries(operationsEvidencePositiveFixtures)) {
    const references = name === "stageReadiness" ? stageReadinessFixtureReferences : undefined;
    const surplus = { ...structuredClone(fixture), unexpected: true };
    assertOpsError(() => parseOperationsEvidenceDocumentV1(surplus, operationsEvidenceFixtureClock, references), "OPS_FIELD_SET_MISMATCH", `${name}:surplus`);

    const missing = structuredClone(fixture) as unknown as Record<string, unknown>;
    delete missing["contractVersion"];
    assertOpsError(() => parseOperationsEvidenceDocumentV1(missing, operationsEvidenceFixtureClock, references), "OPS_WRONG_VERSION", `${name}:missing`);

    const wrongVersion = { ...structuredClone(fixture), contractVersion: `${fixture.contractVersion}-wrong` };
    assertOpsError(() => parseOperationsEvidenceDocumentV1(wrongVersion, operationsEvidenceFixtureClock, references), "OPS_WRONG_VERSION", `${name}:version`);
  }
});

test("records fail closed on missing accountable owner and base evidence", () => {
  const missingOwner = structuredClone(proofDailyRecordFixture);
  missingOwner.accountableOwner.ownerId = "";
  assertOpsError(() => parseProofDailyRecordV1(missingOwner, operationsEvidenceFixtureClock), "OPS_OWNER_MISSING");

  const missingEvidence = structuredClone(proofDailyRecordFixture);
  missingEvidence.evidenceRefs = [];
  assertOpsError(() => parseProofDailyRecordV1(missingEvidence, operationsEvidenceFixtureClock), "OPS_EVIDENCE_MISSING");
});

test("daily proof requires exact capability owner, coverage, and evidence", () => {
  const missingCoverage = structuredClone(proofDailyRecordFixture);
  missingCoverage.payload.capabilityCoverage = [];
  assertOpsError(() => parseProofDailyRecordV1(missingCoverage, operationsEvidenceFixtureClock), "OPS_COVERAGE_MISSING");

  const missingCapabilityEvidence = structuredClone(proofDailyRecordFixture);
  missingCapabilityEvidence.payload.capabilityCoverage[0].evidenceRefIds = [];
  assert.throws(() => parseProofDailyRecordV1(missingCapabilityEvidence, operationsEvidenceFixtureClock));

  const unsafeOwner = structuredClone(proofDailyRecordFixture);
  unsafeOwner.payload.capabilityCoverage[0].ownerId = "agent:sultan";
  assertOpsError(() => parseProofDailyRecordV1(unsafeOwner, operationsEvidenceFixtureClock), "OPS_AUTHORITY_DENIED");
});

test("telemetry gaps earn zero day credit and cannot be relabeled as pass", () => {
  const gap = structuredClone(proofDailyRecordFixture);
  gap.payload.telemetryCoverageBps = 9999;
  gap.payload.calculatedCredit = 0;
  gap.payload.claimedCredit = 0;
  assert.equal(parseProofDailyRecordV1(gap, operationsEvidenceFixtureClock).payload.claimedCredit, 0);

  gap.payload.claimedCredit = 1;
  assertOpsError(() => parseProofDailyRecordV1(gap, operationsEvidenceFixtureClock), "OPS_FORMULA_MISMATCH");
});

test("hard-zero failures earn zero and no exception may waive a hard zero", () => {
  const breach = structuredClone(proofDailyRecordFixture);
  breach.payload.hardZeroCounters.unauthorizedEffect = 1;
  breach.payload.calculatedCredit = 0;
  breach.payload.claimedCredit = 0;
  assert.equal(calculateDailyCredit(breach.payload), 0);
  assert.equal(parseProofDailyRecordV1(breach, operationsEvidenceFixtureClock).payload.claimedCredit, 0);

  const waiver = structuredClone(proofExceptionFixture) as unknown as Record<string, unknown>;
  (waiver.payload as Record<string, unknown>).hardZeroWaiver = true;
  assert.throws(() => parseProofExceptionV1(waiver, operationsEvidenceFixtureClock));
});

test("completeness and capacity formulas are deterministic and mismatch-sensitive", () => {
  assert.equal(calculateCompletenessBps(3, 4), 7500);
  assert.equal(calculateCompletenessBps(0, 0), 0);
  assert.equal(calculateUtilizationBps(195, 480), 4063);
  assert.equal(calculateUtilizationBps(600, 1200), 5000);

  const wrongCompleteness = structuredClone(evidenceCompletenessReportFixture);
  wrongCompleteness.payload.claimedCompletenessBps = 7501;
  assertOpsError(() => parseEvidenceCompletenessReportV1(wrongCompleteness, operationsEvidenceFixtureClock), "OPS_FORMULA_MISMATCH");

  const wrongCapacity = structuredClone(capacityObservationFixture);
  wrongCapacity.payload.claimedIremUtilizationBps = 4999;
  assertOpsError(() => parseCapacityObservationV1(wrongCapacity, operationsEvidenceFixtureClock), "OPS_FORMULA_MISMATCH");
});

test("capacity overrun deterministically blocks admission", () => {
  const overrun = structuredClone(capacityObservationFixture);
  overrun.payload.iremRequiredMinutes = 1300;
  overrun.payload.calculatedIremUtilizationBps = 10834;
  overrun.payload.claimedIremUtilizationBps = 10834;
  overrun.payload.overrun = true;
  overrun.payload.admissionAllowed = false;
  assert.equal(parseCapacityObservationV1(overrun, operationsEvidenceFixtureClock).payload.admissionAllowed, false);

  overrun.payload.admissionAllowed = true;
  assertOpsError(() => parseCapacityObservationV1(overrun, operationsEvidenceFixtureClock), "OPS_FORMULA_MISMATCH");
});

test("unaccepted handoff blocks a customer-zero stage advance", () => {
  const offered = structuredClone(caseHandoffFixture);
  offered.payload.state = "OFFERED";
  offered.payload.acceptedAt = null;
  offered.payload.acceptedBy = null;
  const parsedOffered = parseCaseHandoffV1(offered, operationsEvidenceFixtureClock);
  const refs = { ...stageReadinessFixtureReferences, handoffs: [parsedOffered] };
  assertOpsError(() => parseStageReadinessV1(stageReadinessFixture, operationsEvidenceFixtureClock, refs), "OPS_VALUE_INVALID");
});

test("stale training is rejected against the explicit assessment clock", () => {
  const stale = structuredClone(trainingAttestationFixture);
  stale.payload.expiresAt = "2026-09-05T11:59:59.000Z";
  assertOpsError(() => parseTrainingAttestationV1(stale, operationsEvidenceFixtureClock), "OPS_VALUE_INVALID");
});

test("false stage jumps and false stage decisions fail closed", () => {
  const jump = structuredClone(stageReadinessFixture);
  jump.payload.requestedStage = "BOUNDED_PROVIDER_ACTIONS";
  assertOpsError(() => parseStageReadinessV1(jump, operationsEvidenceFixtureClock, stageReadinessFixtureReferences), "OPS_VALUE_INVALID");

  const falseAdvance = structuredClone(stageReadinessFixture);
  falseAdvance.payload.coverageComplete = false;
  assertOpsError(() => parseStageReadinessV1(falseAdvance, operationsEvidenceFixtureClock, stageReadinessFixtureReferences), "OPS_VALUE_INVALID");
});

test("G2 approvals cannot be bundled across actions", () => {
  const bundled = structuredClone(stageReadinessFixture);
  bundled.payload.currentStage = "READS";
  bundled.payload.requestedStage = "REVERSIBLE_WRITES";
  bundled.payload.g2Approvals = [
    { actionId: "action:write-a", evidenceRefId: "approval:g2:bundled" },
    { actionId: "action:write-b", evidenceRefId: "approval:g2:bundled" },
  ];
  assertOpsError(() => parseStageReadinessV1(bundled, operationsEvidenceFixtureClock, stageReadinessFixtureReferences), "OPS_AUTHORITY_DENIED");
});

test("agent identities cannot own, sign, approve, submit, or advance operations evidence", () => {
  const agentOwned = structuredClone(capacityObservationFixture);
  agentOwned.accountableOwner.ownerId = "agent:sultan";
  assertOpsError(() => parseCapacityObservationV1(agentOwned, operationsEvidenceFixtureClock), "OPS_AUTHORITY_DENIED");

  const agentTrainee = structuredClone(trainingAttestationFixture);
  agentTrainee.payload.traineeOwnerId = "sultan:runtime";
  assertOpsError(() => parseTrainingAttestationV1(agentTrainee, operationsEvidenceFixtureClock), "OPS_AUTHORITY_DENIED");
});

test("append-only corrections use supersession and never overwrite", () => {
  const superseding = structuredClone(proofDailyRecordFixture);
  superseding.recordId = "record:proof-daily:2";
  superseding.supersedesRecordId = proofDailyRecordFixture.recordId;
  assert.equal(parseProofDailyRecordV1(superseding, operationsEvidenceFixtureClock).supersedesRecordId, proofDailyRecordFixture.recordId);

  const selfSuperseding = structuredClone(proofDailyRecordFixture);
  selfSuperseding.supersedesRecordId = selfSuperseding.recordId;
  assertOpsError(() => parseProofDailyRecordV1(selfSuperseding, operationsEvidenceFixtureClock), "OPS_SUPERSESSION_INVALID");

  const overwrite = { ...structuredClone(proofDailyRecordFixture), overwriteRecordId: proofDailyRecordFixture.recordId };
  assertOpsError(() => parseProofDailyRecordV1(overwrite, operationsEvidenceFixtureClock), "OPS_FIELD_SET_MISMATCH");
});

test("secret and direct PII material is rejected before field compatibility", () => {
  const secret = { ...structuredClone(evidenceRefFixture), secretValue: "sb_secret_example" };
  assertOpsError(() => parseEvidenceRefV1(secret, operationsEvidenceFixtureClock), "OPS_SECRET_PII_FORBIDDEN");

  const pii = structuredClone(caseHandoffFixture) as unknown as Record<string, unknown>;
  (pii.payload as Record<string, unknown>).email = "person@example.com";
  assertOpsError(() => parseCaseHandoffV1(pii, operationsEvidenceFixtureClock), "OPS_SECRET_PII_FORBIDDEN");
});

test("future observations and contradictory training clocks are rejected", () => {
  const future = structuredClone(evidenceRefFixture);
  future.observedAt = "2026-09-05T12:00:00.001Z";
  assertOpsError(() => parseEvidenceRefV1(future, operationsEvidenceFixtureClock), "OPS_CLOCK_INVALID");

  const expiredClaim = structuredClone(trainingAttestationFixture);
  expiredClaim.payload.status = "EXPIRED";
  assertOpsError(() => parseTrainingAttestationV1(expiredClaim, operationsEvidenceFixtureClock), "OPS_VALUE_INVALID");
});

test("manifest binds exact packet fingerprints, schema definitions, and frozen Core trees", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const parsed = parseLuzioneOperationsEvidenceManifestV1(manifest);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { oneOf: unknown[]; $defs: Record<string, unknown> };
  assert.equal(Object.keys(parsed.contracts).length, 17);
  assert.equal(schema.oneOf.length, 17);
  assert.deepEqual(parsed.sourcePackets, OPS_PACKET_PINS);
  assert.deepEqual(parsed.coreComposition, OPS_CORE_COMPOSITION);
  assert.ok(Object.keys(schema.$defs).length >= 21);

  assert.equal(execFileSync("git", ["rev-parse", `${OPS_CORE_COMPOSITION.finalSha}:contracts/core`], { encoding: "utf8" }).trim(), OPS_CORE_COMPOSITION.schemaTree);
  assert.equal(execFileSync("git", ["rev-parse", `${OPS_CORE_COMPOSITION.finalSha}:src/modules/luzione-core-contracts`], { encoding: "utf8" }).trim(), OPS_CORE_COMPOSITION.sdkTree);
});

test("manifest drift in either source packet or frozen Core pin is rejected", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sourcePackets.proof.fingerprintSha256 = "b".repeat(64);
  assertOpsError(() => parseLuzioneOperationsEvidenceManifestV1(manifest), "OPS_MANIFEST_DRIFT");

  const coreDrift = JSON.parse(readFileSync(manifestPath, "utf8"));
  coreDrift.coreComposition.finalSha = "c".repeat(40);
  assert.throws(() => parseLuzioneOperationsEvidenceManifestV1(coreDrift));
});

test("schema and generated SDK publish the exact same version set", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { contracts: Record<string, string> };
  assert.deepEqual(Object.keys(manifest.contracts).sort(), Object.values(OPERATIONS_EVIDENCE_VERSIONS).sort());
  assert.deepEqual([...luzioneOperationsEvidenceSdkV1.supportedContractVersions].sort(), Object.values(OPERATIONS_EVIDENCE_VERSIONS).sort());
  assert.deepEqual(luzioneOperationsEvidenceSdkV1.sourcePacketPins, OPS_PACKET_PINS);
});

function assertOpsError(run: () => unknown, code: OperationsEvidenceErrorCode, message?: string) {
  assert.throws(run, (error) => error instanceof OperationsEvidenceCompatibilityError && error.code === code, message);
}
