import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  CapabilityWindowLedgerV1,
  EvidenceCompletenessReportV1,
  EvidenceRefV1,
  FeedbackRecordV1,
  OperationsEvidenceDocumentV1,
  ProofDailyRecordV1,
  ProofExitDecisionV1,
  ProofIncidentV1,
  ProofWeeklySignoffV1,
  StageReadinessV1,
} from "../contracts";
import {
  OperationsEvidenceCompatibilityError,
  type OperationsEvidenceErrorCode,
} from "../consumerSdk";
import {
  OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_VERSION,
  type LuzioneOperationsEvidenceLedgerV2,
} from "../v2/contracts";
import {
  makeReadyOperationsEvidenceLedgerV2Fixture,
  operationsEvidenceLedgerFixtureClock,
  operationsEvidenceLedgerV2Fixture,
} from "../v2/fixtures";
import {
  HARD_ZERO_METRIC_KEYS,
  OPS_CORRECTION_ADVERSE_PROBES,
  OPS_LEDGER_LIMITS,
  OPS_LEDGER_SCHEMA_KEYS,
} from "../v2/rules";
import {
  calculateContentDigest,
  parseLuzioneOperationsEvidenceLedgerManifestV2,
  parseOperationsEvidenceLedgerV2,
  sealOperationsEvidenceLedgerV2,
} from "../v2/sdk";

const schemaPath = "contracts/operations-evidence/v2/luzione-operations-evidence-ledger-v2.schema.json";
const v1SchemaPath = "contracts/operations-evidence/v1/luzione-operations-evidence-v1.schema.json";
const manifestPath = "contracts/operations-evidence/luzione-operations-evidence-ledger-v2.manifest.json";

test("v2 ledger content-addresses the complete supplied set and deterministically derives bounded state", () => {
  const parsed = parseOperationsEvidenceLedgerV2(operationsEvidenceLedgerV2Fixture, operationsEvidenceLedgerFixtureClock);
  assert.deepEqual(parsed.derived.dailyCredit, { "record:proof-daily:1": 1 });
  assert.deepEqual(parsed.derived.weeklyCreditedDays, { "record:proof-weekly:1": 1 });
  assert.deepEqual(parsed.derived.capabilityCreditedDays, { "record:capability-ledger:1": 1 });
  assert.deepEqual(parsed.derived.proofEntryStates, { "record:proof-window-entry:1": "BLOCKED" });
  assert.deepEqual(parsed.derived.stageDecisions, { "record:stage-readiness:1": "ADVANCE" });
  assert.deepEqual(parsed.derived.exitDecisions, { "record:proof-exit:1": "BLOCKED" });
  assert.equal(parsed.ledger.effectAuthority, "NO_EFFECT");

  const reordered = reseal({ ...structuredClone(operationsEvidenceLedgerV2Fixture), entries: [...operationsEvidenceLedgerV2Fixture.entries].reverse() });
  assert.equal(reordered.recordSetDigest, operationsEvidenceLedgerV2Fixture.recordSetDigest);
});

test("surplus, missing, wrong-version, content-digest, and ledger-digest drift fail closed", () => {
  const surplus = { ...structuredClone(operationsEvidenceLedgerV2Fixture), surplus: true };
  assertOpsError(() => parseOperationsEvidenceLedgerV2(surplus, operationsEvidenceLedgerFixtureClock), "OPS_FIELD_SET_MISMATCH");
  const missing = structuredClone(operationsEvidenceLedgerV2Fixture) as unknown as Record<string, unknown>;
  delete missing["entries"];
  assertOpsError(() => parseOperationsEvidenceLedgerV2(missing, operationsEvidenceLedgerFixtureClock), "OPS_FIELD_SET_MISMATCH");
  const wrong = { ...structuredClone(operationsEvidenceLedgerV2Fixture), contractVersion: "LuzioneOperationsEvidenceLedger/v3" };
  assertOpsError(() => parseOperationsEvidenceLedgerV2(wrong, operationsEvidenceLedgerFixtureClock), "OPS_WRONG_VERSION");
  const contentDrift = structuredClone(operationsEvidenceLedgerV2Fixture);
  contentDrift.entries[0].contentDigest = "f".repeat(64);
  assertOpsError(() => parseOperationsEvidenceLedgerV2(contentDrift, operationsEvidenceLedgerFixtureClock), "OPS_MANIFEST_DRIFT");
  const ledgerDrift = structuredClone(operationsEvidenceLedgerV2Fixture);
  ledgerDrift.ledgerDigest = "f".repeat(64);
  assertOpsError(() => parseOperationsEvidenceLedgerV2(ledgerDrift, operationsEvidenceLedgerFixtureClock), "OPS_MANIFEST_DRIFT");
});

test("A01 append-only identity rejects overwrite, nonexistent prior, cycle, and fork", () => {
  const prior = structuredClone(operationsEvidenceLedgerV2Fixture);
  const overwrite = structuredClone(operationsEvidenceLedgerV2Fixture);
  const overwrittenDaily = findDocument<ProofDailyRecordV1>(overwrite, "ProofDailyRecord/v1");
  overwrittenDaily.payload.blockingIncidentCount = 1;
  overwrittenDaily.payload.calculatedCredit = 0;
  overwrittenDaily.payload.claimedCredit = 0;
  overwrite.priorRecordSetDigest = prior.recordSetDigest;
  const overwrittenLedger = reseal(overwrite);
  assertOpsError(() => parseOperationsEvidenceLedgerV2(overwrittenLedger, {
    ...operationsEvidenceLedgerFixtureClock,
    priorSet: { entries: prior.entries, ledgerId: prior.ledgerId, recordSetDigest: prior.recordSetDigest, tenantId: prior.tenantId },
  }), "OPS_SUPERSESSION_INVALID");

  const nonexistent = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<ProofDailyRecordV1>(nonexistent, "ProofDailyRecord/v1").supersedesRecordId = "record:missing:prior";
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(nonexistent), operationsEvidenceLedgerFixtureClock), "OPS_SUPERSESSION_INVALID");

  const cycle = structuredClone(operationsEvidenceLedgerV2Fixture);
  const cycleFirst = findDocument<ProofDailyRecordV1>(cycle, "ProofDailyRecord/v1");
  cycleFirst.supersedesRecordId = "record:proof-daily:2";
  const cycleSecond = structuredClone(cycleFirst);
  cycleSecond.recordId = "record:proof-daily:2";
  cycleSecond.supersedesRecordId = cycleFirst.recordId;
  cycle.entries = [...cycle.entries, { contentDigest: calculateContentDigest(cycleSecond), document: cycleSecond }];
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(cycle), operationsEvidenceLedgerFixtureClock), "OPS_SUPERSESSION_INVALID");

  const fork = structuredClone(operationsEvidenceLedgerV2Fixture);
  const forkFirst = findDocument<ProofDailyRecordV1>(fork, "ProofDailyRecord/v1");
  const forkSecond = structuredClone(forkFirst);
  forkSecond.recordId = "record:proof-daily:2";
  forkSecond.supersedesRecordId = forkFirst.recordId;
  const forkThird = structuredClone(forkFirst);
  forkThird.recordId = "record:proof-daily:3";
  forkThird.supersedesRecordId = forkFirst.recordId;
  fork.entries = [...fork.entries,
    { contentDigest: calculateContentDigest(forkSecond), document: forkSecond },
    { contentDigest: calculateContentDigest(forkThird), document: forkThird },
  ];
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(fork), operationsEvidenceLedgerFixtureClock), "OPS_SUPERSESSION_INVALID");
});

test("a same-tenant/same-contract append retains the exact prior set and parses", () => {
  const prior = structuredClone(operationsEvidenceLedgerV2Fixture);
  const current = structuredClone(operationsEvidenceLedgerV2Fixture);
  const feedback = findDocument<FeedbackRecordV1>(current, "FeedbackRecord/v1");
  const correction = structuredClone(feedback);
  correction.recordId = "record:feedback:2";
  correction.supersedesRecordId = feedback.recordId;
  current.entries = [...current.entries, { contentDigest: calculateContentDigest(correction), document: correction }];
  current.priorRecordSetDigest = prior.recordSetDigest;
  const sealed = reseal(current);
  assert.equal(parseOperationsEvidenceLedgerV2(sealed, {
    ...operationsEvidenceLedgerFixtureClock,
    priorSet: { entries: prior.entries, ledgerId: prior.ledgerId, recordSetDigest: prior.recordSetDigest, tenantId: prior.tenantId },
  }).ledger.entries.length, prior.entries.length + 1);
});

test("A02 unresolved or foreign capability evidence is denied", () => {
  const unresolved = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<ProofDailyRecordV1>(unresolved, "ProofDailyRecord/v1").payload.capabilityCoverage[0].evidenceRefIds = ["evidence:missing:metric"];
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(unresolved), operationsEvidenceLedgerFixtureClock), "OPS_REFERENCE_MISMATCH");
});

test("A03 invalid or future calendar days cannot earn credit", () => {
  const future = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<ProofDailyRecordV1>(future, "ProofDailyRecord/v1").payload.date = "2026-09-06";
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(future), operationsEvidenceLedgerFixtureClock), "OPS_CLOCK_INVALID");

  const invalid = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<ProofDailyRecordV1>(invalid, "ProofDailyRecord/v1").payload.date = "2026-02-30";
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(invalid), operationsEvidenceLedgerFixtureClock), "OPS_CLOCK_INVALID");
});

test("A04 weekly and capability IDs must resolve to supplied typed daily records", () => {
  const orphanWeek = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<ProofWeeklySignoffV1>(orphanWeek, "ProofWeeklySignoff/v1").payload.dailyRecordIds = ["record:daily:orphan"];
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(orphanWeek), operationsEvidenceLedgerFixtureClock), "OPS_REFERENCE_MISMATCH");

  const orphanCapability = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<CapabilityWindowLedgerV1>(orphanCapability, "CapabilityWindowLedger/v1").payload.dailyRecordIds = ["record:daily:orphan"];
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(orphanCapability), operationsEvidenceLedgerFixtureClock), "OPS_REFERENCE_MISMATCH");
});

test("A05 exit decisions reject self-asserted state and orphan recovery", () => {
  const asserted = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<ProofExitDecisionV1>(asserted, "ProofExitDecision/v1").payload.allCapabilitiesComplete = true;
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(asserted), operationsEvidenceLedgerFixtureClock), "OPS_FORMULA_MISMATCH");

  const orphan = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<ProofExitDecisionV1>(orphan, "ProofExitDecision/v1").payload.managedRecoveryEvidenceRefId = "evidence:recovery:orphan";
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(orphan), operationsEvidenceLedgerFixtureClock), "OPS_REFERENCE_MISMATCH");
});

test("A06 READY requires the complete distinct exact-action per-effect G2 authority set", () => {
  const ready = makeReadyOperationsEvidenceLedgerV2Fixture();
  assert.equal(parseOperationsEvidenceLedgerV2(ready, operationsEvidenceLedgerFixtureClock).derived.proofEntryStates["record:proof-window-entry:1"], "READY");
  const missingGrant = structuredClone(ready);
  missingGrant.authorityGrants = missingGrant.authorityGrants.slice(0, -1);
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(missingGrant), operationsEvidenceLedgerFixtureClock), "OPS_AUTHORITY_DENIED");
});

test("A07 arbitrary or bundled stage approval cannot advance", () => {
  const arbitrary = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<StageReadinessV1>(arbitrary, "StageReadiness/v1").payload.g2Approvals = [{
    actionId: "g2:arbitrary",
    evidenceRefId: "evidence:authority:founder",
  }];
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(arbitrary), operationsEvidenceLedgerFixtureClock), "OPS_AUTHORITY_DENIED");
});

test("A08 owner identity and function derive from active canonical human context; agents fail", () => {
  const agent = structuredClone(operationsEvidenceLedgerV2Fixture);
  agent.ownerContexts[0].principalType = "AGENT" as never;
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(agent), operationsEvidenceLedgerFixtureClock), "OPS_AUTHORITY_DENIED");

  const asserted = structuredClone(operationsEvidenceLedgerV2Fixture);
  findDocument<ProofDailyRecordV1>(asserted, "ProofDailyRecord/v1").accountableOwner.ownerId = "human:payload-only";
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(asserted), operationsEvidenceLedgerFixtureClock), "OPS_AUTHORITY_DENIED");
});

test("A09 P0/P1 auto-close is an unwaivable hard zero", () => {
  const breach = structuredClone(operationsEvidenceLedgerV2Fixture);
  const autoClose = breach.dailyMetricBindings[0].hardZeros.find((item) => item.metricKey === "p0P1AutoClose");
  assert.ok(autoClose);
  autoClose.value = 1;
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(breach), operationsEvidenceLedgerFixtureClock), "OPS_FORMULA_MISMATCH");

  const omitted = structuredClone(operationsEvidenceLedgerV2Fixture);
  omitted.dailyMetricBindings[0].hardZeros = omitted.dailyMetricBindings[0].hardZeros.filter((item) => item.metricKey !== "p0P1AutoClose");
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(omitted), operationsEvidenceLedgerFixtureClock), "OPS_COVERAGE_MISSING");
});

test("A10 caller-declared completeness cannot replace exact report/catalog/evidence binding", () => {
  const mismatch = structuredClone(operationsEvidenceLedgerV2Fixture);
  const report = findDocument<EvidenceCompletenessReportV1>(mismatch, "EvidenceCompletenessReport/v1");
  report.payload.calculatedCompletenessBps = 7500;
  report.payload.claimedCompletenessBps = 7500;
  report.payload.missingEvidenceKeys = ["missing:one"];
  report.payload.presentValidEvidenceCount = 3;
  report.payload.requiredEvidenceCount = 4;
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(mismatch), operationsEvidenceLedgerFixtureClock), "OPS_FORMULA_MISMATCH");

  const unbound = structuredClone(operationsEvidenceLedgerV2Fixture);
  unbound.dailyMetricBindings = [];
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(unbound), operationsEvidenceLedgerFixtureClock), "OPS_COVERAGE_MISSING");
});

test("A11 zero-denominator rejection and 30-day maximum are identical in schema and SDK", () => {
  const zero = structuredClone(operationsEvidenceLedgerV2Fixture);
  const report = findDocument<EvidenceCompletenessReportV1>(zero, "EvidenceCompletenessReport/v1");
  report.payload.calculatedCompletenessBps = 0;
  report.payload.claimedCompletenessBps = 0;
  report.payload.missingEvidenceKeys = [];
  report.payload.presentValidEvidenceCount = 0;
  report.payload.requiredEvidenceCount = 0;
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(zero), operationsEvidenceLedgerFixtureClock), "OPS_VALUE_INVALID");

  const tooLong = structuredClone(operationsEvidenceLedgerV2Fixture);
  const sourceDaily = findDocument<ProofDailyRecordV1>(tooLong, "ProofDailyRecord/v1");
  const sourceBinding = tooLong.dailyMetricBindings[0];
  const capability = findDocument<CapabilityWindowLedgerV1>(tooLong, "CapabilityWindowLedger/v1");
  const dailyIds = [sourceDaily.recordId];
  const bindings = [sourceBinding];
  for (let index = 2; index <= 31; index += 1) {
    const clone = structuredClone(sourceDaily);
    clone.recordId = `record:proof-daily:${index}`;
    clone.payload.date = new Date(Date.parse("2026-08-05T00:00:00.000Z") + index * 86400000).toISOString().slice(0, 10);
    dailyIds.push(clone.recordId);
    tooLong.entries = [...tooLong.entries, { contentDigest: calculateContentDigest(clone), document: clone }];
    bindings.push({ ...structuredClone(sourceBinding), dailyRecordId: clone.recordId });
  }
  capability.payload.windowStart = "2026-08-07";
  capability.payload.windowEnd = "2026-09-05";
  capability.payload.dailyRecordIds = dailyIds;
  capability.payload.creditedDays = 31;
  capability.payload.state = "OPEN";
  tooLong.dailyMetricBindings = bindings;
  assertOpsError(() => parseOperationsEvidenceLedgerV2(reseal(tooLong), operationsEvidenceLedgerFixtureClock), "OPS_CLOCK_INVALID");

  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const v1Schema = JSON.parse(readFileSync(v1SchemaPath, "utf8"));
  assert.equal(schema["x-luzione-semanticRules"].capabilityProofDayMaximum, OPS_LEDGER_LIMITS.maximumCapabilityProofDays);
  assert.equal(schema["x-luzione-semanticRules"].completenessDenominatorMinimum, OPS_LEDGER_LIMITS.minimumCompletenessDenominator);
  assert.equal(schema.$defs.Entry.properties.document.allOf[1].then.properties.payload.properties.dailyRecordIds.maxItems, OPS_LEDGER_LIMITS.maximumCapabilityProofDays);
  assert.equal(v1Schema.$defs.EvidenceCompletenessReport.allOf[1].properties.payload.properties.requiredEvidenceCount.minimum, OPS_LEDGER_LIMITS.minimumCompletenessDenominator);
});

test("resolved typed incident/reset evidence starts a new capability epoch deterministically", () => {
  const withReset = structuredClone(operationsEvidenceLedgerV2Fixture);
  const metricRef = withReset.entries.find((entry) => entry.document.contractVersion === "EvidenceRef/v1")?.document as EvidenceRefV1;
  const readbackRef: EvidenceRefV1 = { ...structuredClone(metricRef), artifactKind: "SOURCE_READBACK", evidenceRefId: "evidence:incident:readback", sha256: "8".repeat(64) };
  const recoveryRef: EvidenceRefV1 = { ...structuredClone(metricRef), artifactKind: "RECOVERY", evidenceRefId: "evidence:epoch:recovery", sha256: "9".repeat(64) };
  withReset.entries = [
    ...withReset.entries,
    { contentDigest: calculateContentDigest(readbackRef), document: readbackRef },
    { contentDigest: calculateContentDigest(recoveryRef), document: recoveryRef },
  ];
  const incident = findDocument<ProofIncidentV1>(withReset, "ProofIncident/v1");
  incident.payload.severity = "P1";
  incident.payload.state = "RESOLVED_VERIFIED";
  incident.payload.acknowledgedAt = "2026-09-05T02:05:00.000Z";
  incident.payload.resolvedAt = "2026-09-05T03:00:00.000Z";
  incident.payload.readbackEvidenceRefIds = [readbackRef.evidenceRefId];
  incident.payload.resetCapabilityEpoch = true;
  withReset.capabilityEpochResets = [{
    capabilityId: "crm.support",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.capabilityEpochReset,
    effectiveDate: "2026-09-05",
    incidentRecordId: incident.recordId,
    newEpochId: "epoch:crm-support:2",
    priorEpochId: "epoch:crm-support:1",
    recoveryEvidenceRefId: recoveryRef.evidenceRefId,
    resetId: "reset:crm-support:1",
    tenantId: withReset.tenantId,
  }];
  assert.equal(parseOperationsEvidenceLedgerV2(reseal(withReset), operationsEvidenceLedgerFixtureClock)
    .derived.capabilityCreditedDays["record:capability-ledger:1"], 1);
});

test("schema and SDK rule source are bidirectionally exact", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  assert.deepEqual([...schema.required].sort(), [...OPS_LEDGER_SCHEMA_KEYS.ledger].sort());
  assert.deepEqual([...schema.$defs.Entry.required].sort(), [...OPS_LEDGER_SCHEMA_KEYS.entry].sort());
  assert.deepEqual([...schema.$defs.OwnerContext.required].sort(), [...OPS_LEDGER_SCHEMA_KEYS.ownerContext].sort());
  assert.deepEqual([...schema.$defs.AuthorityGrant.required].sort(), [...OPS_LEDGER_SCHEMA_KEYS.authorityGrant].sort());
  assert.deepEqual([...schema.$defs.CapabilityEpochReset.required].sort(), [...OPS_LEDGER_SCHEMA_KEYS.capabilityEpochReset].sort());
  assert.deepEqual([...schema.$defs.DailyMetricBinding.required].sort(), [...OPS_LEDGER_SCHEMA_KEYS.dailyMetricBinding].sort());
  assert.deepEqual([...schema.$defs.HardZeroObservation.required].sort(), [...OPS_LEDGER_SCHEMA_KEYS.hardZeroObservation].sort());
  assert.deepEqual([...schema.$defs.HardZeroObservation.properties.metricKey.enum].sort(), [...HARD_ZERO_METRIC_KEYS].sort());
  assert.equal(schema.$defs.DailyMetricBinding.properties.hardZeros.minItems, HARD_ZERO_METRIC_KEYS.length);
  assert.equal(schema.$defs.DailyMetricBinding.properties.hardZeros.maxItems, HARD_ZERO_METRIC_KEYS.length);
  assert.equal(OPS_CORRECTION_ADVERSE_PROBES.length, 11);
});

test("v2 manifest is strict, NO_EFFECT, and prohibits decision-bearing v1 consumption", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const parsed = parseLuzioneOperationsEvidenceLedgerManifestV2(manifest);
  assert.equal(parsed.ledgerVersion, OPERATIONS_EVIDENCE_LEDGER_VERSION);
  assert.equal(parsed.effectAuthority, "NO_EFFECT");
  assert.equal(parsed.productionReady, false);
  assert.equal(parsed.compatibility.decisionBearingV1UseProhibited, true);
});

function findDocument<T extends OperationsEvidenceDocumentV1>(
  ledger: LuzioneOperationsEvidenceLedgerV2,
  version: OperationsEvidenceDocumentV1["contractVersion"],
): T {
  const document = ledger.entries.find((entry) => entry.document.contractVersion === version)?.document;
  assert.ok(document, `missing ${version}`);
  return document as T;
}

function reseal(ledger: LuzioneOperationsEvidenceLedgerV2): LuzioneOperationsEvidenceLedgerV2 {
  return sealOperationsEvidenceLedgerV2({
    assessmentTime: ledger.assessmentTime,
    authorityGrants: ledger.authorityGrants,
    capabilityEpochResets: ledger.capabilityEpochResets,
    contractVersion: ledger.contractVersion,
    dailyMetricBindings: ledger.dailyMetricBindings,
    effectAuthority: ledger.effectAuthority,
    entries: ledger.entries,
    ledgerId: ledger.ledgerId,
    ownerContexts: ledger.ownerContexts,
    priorRecordSetDigest: ledger.priorRecordSetDigest,
    tenantId: ledger.tenantId,
  });
}

function assertOpsError(run: () => unknown, code: OperationsEvidenceErrorCode): void {
  assert.throws(run, (error) => error instanceof OperationsEvidenceCompatibilityError && error.code === code);
}
