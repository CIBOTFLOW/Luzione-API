import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ProofIncidentV1 } from "../contracts";
import {
  OperationsEvidenceCompatibilityError,
  type OperationsEvidenceErrorCode,
} from "../consumerSdk";
import type { LuzioneOperationsEvidenceLedgerV2 } from "../v2/contracts";
import { sealOperationsEvidenceLedgerV2 } from "../v2/sdk";
import {
  makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture,
  makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture,
  operationsEvidenceLedgerV3Fixture,
  operationsEvidenceLedgerV3FixtureContext,
} from "../v3/fixtures";
import type { LuzioneOperationsEvidenceLedgerV3 } from "../v3/contracts";
import {
  OPS_CORRECTION_02_ADVERSE_PROBES,
  OPS_LEDGER_V3_SCHEMA_KEYS,
} from "../v3/rules";
import {
  parseLuzioneOperationsEvidenceLedgerManifestV3,
  parseOperationsEvidenceLedgerV3,
  sealOperationsEvidenceLedgerV3,
} from "../v3/sdk";

const schemaPath = "contracts/operations-evidence/v3/luzione-operations-evidence-ledger-v3.schema.json";
const manifestPath = "contracts/operations-evidence/luzione-operations-evidence-ledger-v3.manifest.json";
const adverseFixturesPath = "contracts/operations-evidence/v3/ops-contracts-correction-02-adverse-fixtures.json";

test("v3 validates source-bound structural evidence while every decision credit remains zero", () => {
  const parsed = parseOperationsEvidenceLedgerV3(operationsEvidenceLedgerV3Fixture, operationsEvidenceLedgerV3FixtureContext);
  assert.equal(parsed.structurallyValidatedBaseVersion, "LuzioneOperationsEvidenceLedger/v2");
  assert.deepEqual(parsed.decision, {
    decisionBearingUse: "PROHIBITED_PENDING_ASSURANCE_03_AND_CANONICAL_SOURCES",
    g2Credit: 0,
    productionCredit: 0,
    proofDayCredit: 0,
  });
  assert.deepEqual(parsed.ledger.sourcePackets, { l2: "ABSENT", l3: "ABSENT" });
  assert.equal(parsed.ledger.effectAuthority, "NO_EFFECT");
});

test("source-bound exact-scope G2 successors validate but cannot grant G2 or production credit", () => {
  const fixture = makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture();
  const parsed = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  assert.equal(parsed.ledger.g2EffectAuthorityGrants.length, 4);
  assert.equal(parsed.decision.g2Credit, 0);
  assert.equal(parsed.decision.productionCredit, 0);
  assert.equal(parsed.decision.proofDayCredit, 0);
});

test("surplus, missing, wrong-version, ledger-digest and source-snapshot drift fail closed", () => {
  assertOpsError(() => parseOperationsEvidenceLedgerV3({ ...structuredClone(operationsEvidenceLedgerV3Fixture), surplus: true }, operationsEvidenceLedgerV3FixtureContext), "OPS_FIELD_SET_MISMATCH");
  const missing = structuredClone(operationsEvidenceLedgerV3Fixture) as unknown as Record<string, unknown>;
  delete missing["baseLedger"];
  assertOpsError(() => parseOperationsEvidenceLedgerV3(missing, operationsEvidenceLedgerV3FixtureContext), "OPS_FIELD_SET_MISMATCH");
  assertOpsError(() => parseOperationsEvidenceLedgerV3({ ...structuredClone(operationsEvidenceLedgerV3Fixture), contractVersion: "LuzioneOperationsEvidenceLedger/v2" }, operationsEvidenceLedgerV3FixtureContext), "OPS_WRONG_VERSION");
  assertOpsError(() => parseOperationsEvidenceLedgerV3({ ...structuredClone(operationsEvidenceLedgerV3Fixture), ledgerDigest: "f".repeat(64) }, operationsEvidenceLedgerV3FixtureContext), "OPS_MANIFEST_DRIFT");
  const sourceDrift = structuredClone(operationsEvidenceLedgerV3FixtureContext);
  sourceDrift.sourceSnapshot.snapshotAt = "2026-09-05T12:00:01.000Z";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(operationsEvidenceLedgerV3Fixture, sourceDrift), "OPS_CLOCK_INVALID");
});

test("owner/string reseal and Founder/Irem/Mallory substitution cannot cross the source boundary", () => {
  const mallory = structuredClone(operationsEvidenceLedgerV3Fixture);
  mallory.humanAuthoritySourceBindings[1].issuerSubjectId = "human:mallory";
  mallory.humanAuthoritySourceBindings[1].membershipSource.objectId = "human:mallory";
  mallory.humanAuthoritySourceBindings[1].membershipSource.readbackObjectId = "human:mallory";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(mallory), operationsEvidenceLedgerV3FixtureContext), "OPS_AUTHORITY_DENIED");

  const swapped = structuredClone(operationsEvidenceLedgerV3Fixture);
  swapped.humanAuthoritySourceBindings[0].issuerSubjectId = "human:founder";
  swapped.humanAuthoritySourceBindings[0].membershipSource.objectId = "human:founder";
  swapped.humanAuthoritySourceBindings[0].membershipSource.readbackObjectId = "human:founder";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(swapped), operationsEvidenceLedgerV3FixtureContext), "OPS_AUTHORITY_DENIED");
});

test("valid-enum role/function relabel cannot substitute canonical source meaning", () => {
  const relabel = structuredClone(operationsEvidenceLedgerV3Fixture);
  relabel.humanAuthoritySourceBindings[0].canonicalRole = "FOUNDER";
  relabel.humanAuthoritySourceBindings[0].canonicalFunction = "FOUNDER";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(relabel), operationsEvidenceLedgerV3FixtureContext), "OPS_AUTHORITY_DENIED");
});

test("agent, service, workload, dev and test principals cannot be relabeled as human", () => {
  for (const subject of ["agent:founder", "service:founder", "workload:founder", "dev:founder", "test:founder"]) {
    const candidate = structuredClone(operationsEvidenceLedgerV3Fixture);
    candidate.humanAuthoritySourceBindings[1].issuerSubjectId = subject;
    candidate.humanAuthoritySourceBindings[1].membershipSource.objectId = subject;
    candidate.humanAuthoritySourceBindings[1].membershipSource.readbackObjectId = subject;
    assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(candidate), operationsEvidenceLedgerV3FixtureContext), "OPS_AUTHORITY_DENIED");
  }
});

test("cross-tenant, stale, revoked and superseded membership all fail closed", () => {
  const crossTenant = structuredClone(operationsEvidenceLedgerV3Fixture);
  crossTenant.humanAuthoritySourceBindings[0].membershipSource.tenantId = "tenant:foreign";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(crossTenant), operationsEvidenceLedgerV3FixtureContext), "OPS_REFERENCE_MISMATCH");

  const stale = structuredClone(operationsEvidenceLedgerV3Fixture);
  stale.humanAuthoritySourceBindings[0].validUntil = "2026-09-05T11:59:59.999Z";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(stale), operationsEvidenceLedgerV3FixtureContext), "OPS_AUTHORITY_DENIED");

  const revoked = structuredClone(operationsEvidenceLedgerV3Fixture);
  revoked.humanAuthoritySourceBindings[0].revokedAt = "2026-09-05T10:00:00.000Z" as never;
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(revoked), operationsEvidenceLedgerV3FixtureContext), "OPS_AUTHORITY_DENIED");

  const superseded = structuredClone(operationsEvidenceLedgerV3Fixture);
  superseded.humanAuthoritySourceBindings[0].supersededByBindingId = "human-source-binding:irem:new" as never;
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(superseded), operationsEvidenceLedgerV3FixtureContext), "OPS_AUTHORITY_DENIED");
});

test("bundled, mismatched, reused, cross-tenant and expired G2 grants fail closed", () => {
  const fixture = makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture();
  const mismatched = structuredClone(fixture.ledger);
  mismatched.g2EffectAuthorityGrants[0].effect = "FORMAL_PROOF_OPEN";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(mismatched), fixture.context), "OPS_AUTHORITY_DENIED");

  const bundled = structuredClone(fixture.ledger) as unknown as { g2EffectAuthorityGrants: Array<Record<string, unknown>> } & LuzioneOperationsEvidenceLedgerV3;
  bundled.g2EffectAuthorityGrants[0]["effects"] = ["TENANT_LIVE_READ", "TENANT_REVERSIBLE_WRITE"];
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(bundled), fixture.context), "OPS_FIELD_SET_MISMATCH");

  const reused = structuredClone(fixture.ledger);
  const firstSource = structuredClone(reused.g2EffectAuthorityGrants[0].approvalSource);
  reused.g2EffectAuthorityGrants[1].approvalSource = firstSource;
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(reused), fixture.context), "OPS_AUTHORITY_DENIED");

  const crossTenant = structuredClone(fixture.ledger);
  crossTenant.g2EffectAuthorityGrants[0].approvalSource.tenantId = "tenant:foreign";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(crossTenant), fixture.context), "OPS_REFERENCE_MISMATCH");

  const expired = structuredClone(fixture.ledger);
  expired.g2EffectAuthorityGrants[0].expiresAt = "2026-09-05T11:59:59.999Z";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(expired), fixture.context), "OPS_AUTHORITY_DENIED");
});

test("open/unverified incident and orphan recovery cannot reset a capability epoch", () => {
  const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
  const open = structuredClone(fixture.ledger);
  open.incidentRecoverySourceBindings[0].incidentState = "OPEN" as never;
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(open), fixture.context), "OPS_STATE_INVALID");

  const unverified = structuredClone(fixture.ledger);
  unverified.incidentRecoverySourceBindings[0].recoveryState = "PENDING" as never;
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(unverified), fixture.context), "OPS_STATE_INVALID");

  const orphan = structuredClone(fixture.ledger);
  orphan.capabilityEpochResets[0].incidentRecoveryBindingId = "incident-recovery-binding:missing";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(orphan), fixture.context), "OPS_REFERENCE_MISMATCH");

  const wrongIncident = structuredClone(fixture.ledger);
  wrongIncident.incidentRecoverySourceBindings[0].recoveryIncidentRecordId = "record:proof-incident:foreign";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(wrongIncident), fixture.context), "OPS_REFERENCE_MISMATCH");
});

test("resolved-verified incident reset is deterministic and requires acknowledgement/readback/recovery ordering", () => {
  const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
  const parsed = parseOperationsEvidenceLedgerV3(fixture.ledger, fixture.context);
  assert.equal(parsed.ledger.capabilityEpochResets.length, 1);
  assert.equal(parsed.ledger.capabilityEpochResets[0].priorEpochSequence, 1);
  assert.equal(parsed.ledger.capabilityEpochResets[0].newEpochSequence, 2);
  assert.equal(parsed.decision.proofDayCredit, 0);

  const unordered = structuredClone(fixture.ledger);
  unordered.incidentRecoverySourceBindings[0].acknowledgedAt = "2026-09-05T03:05:00.000Z";
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(unordered), fixture.context), "OPS_CLOCK_INVALID");
});

test("epoch gap, fork/cycle and reused successor/recovery binding fail closed", () => {
  const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
  const gap = structuredClone(fixture.ledger);
  gap.capabilityEpochResets[0].priorEpochSequence = 9;
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(gap), fixture.context), "OPS_REFERENCE_MISMATCH");

  const cycle = structuredClone(fixture.ledger);
  cycle.capabilityEpochResets[0].newEpochId = cycle.capabilityEpochResets[0].priorEpochId;
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(cycle), fixture.context), "OPS_REFERENCE_MISMATCH");

  const reused = structuredClone(fixture.ledger);
  const duplicate = structuredClone(reused.capabilityEpochResets[0]);
  duplicate.resetId = "reset:duplicate-recovery-binding";
  reused.capabilityEpochResets = [...reused.capabilityEpochResets, duplicate];
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(reused), fixture.context), "OPS_REFERENCE_MISMATCH");

  const fork = structuredClone(fixture.ledger);
  fork.capabilityEpochResets[0].newEpochSequence = 3;
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(fork), fixture.context), "OPS_REFERENCE_MISMATCH");
});

test("base incident cannot be open while a source binding claims resolved verification", () => {
  const fixture = makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture();
  const candidate = structuredClone(fixture.ledger);
  const incident = candidate.baseLedger.entries.find((entry) => entry.document.contractVersion === "ProofIncident/v1")!.document as ProofIncidentV1;
  incident.payload.state = "OPEN";
  incident.payload.resolvedAt = null;
  candidate.baseLedger = resealV2(candidate.baseLedger);
  assertOpsError(() => parseOperationsEvidenceLedgerV3(reseal(candidate), fixture.context), "OPS_REFERENCE_MISMATCH");
});

test("schema/parser parity and manifest prohibition/absence pins are exact", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  assert.deepEqual([...schema.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.ledger].sort());
  assert.deepEqual([...schema.$defs.ExactSourceReadback.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.sourceReadback].sort());
  assert.deepEqual([...schema.$defs.HumanAuthoritySourceBinding.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.humanBinding].sort());
  assert.deepEqual([...schema.$defs.G2EffectAuthorityGrant.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.g2Grant].sort());
  assert.deepEqual([...schema.$defs.IncidentRecoverySourceBinding.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.incidentBinding].sort());
  assert.deepEqual([...schema.$defs.CapabilityEpochReset.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.epochReset].sort());
  assert.deepEqual([...schema.$defs.CapabilityEpochAnchor.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.epochAnchor].sort());
  assert.deepEqual([...schema.$defs.SourceSnapshot.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.sourceSnapshot].sort());
  assert.deepEqual([...schema.$defs.CreditCeiling.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.creditCeiling].sort());
  assert.deepEqual([...schema.$defs.SourcePackets.required].sort(), [...OPS_LEDGER_V3_SCHEMA_KEYS.sourcePackets].sort());
  assert.equal(schema["x-luzione-semanticRules"].proofDayCreditCeiling, 0);
  assert.equal(OPS_CORRECTION_02_ADVERSE_PROBES.length, 11);
  const adverseFixtures = JSON.parse(readFileSync(adverseFixturesPath, "utf8"));
  assert.deepEqual(adverseFixtures.fixtures.map((fixture: { id: string }) => fixture.id), [...OPS_CORRECTION_02_ADVERSE_PROBES]);
  assert.deepEqual(adverseFixtures.creditCeiling, { proofDays: 0, g2: 0, production: 0 });

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const parsed = parseLuzioneOperationsEvidenceLedgerManifestV3(manifest);
  assert.equal(parsed.compatibility.decisionBearingV1UseProhibited, true);
  assert.equal(parsed.compatibility.decisionBearingV2UseProhibited, true);
  assert.deepEqual(parsed.sourceAvailability, {
    canonicalG2Approval: "ABSENT",
    canonicalHumanMembership: "ABSENT",
    incidentBoundRecovery: "ABSENT",
    resolvedVerifiedIncident: "ABSENT",
  });
  assert.equal(parsed.effectAuthority, "NO_EFFECT");
  assert.equal(parsed.productionReady, false);
});

function reseal(ledger: LuzioneOperationsEvidenceLedgerV3): LuzioneOperationsEvidenceLedgerV3 {
  return sealOperationsEvidenceLedgerV3({
    assessmentTime: ledger.assessmentTime,
    baseLedger: ledger.baseLedger,
    capabilityEpochResets: ledger.capabilityEpochResets,
    contractVersion: ledger.contractVersion,
    creditCeiling: ledger.creditCeiling,
    decisionPolicy: ledger.decisionPolicy,
    effectAuthority: ledger.effectAuthority,
    g2EffectAuthorityGrants: ledger.g2EffectAuthorityGrants,
    humanAuthoritySourceBindings: ledger.humanAuthoritySourceBindings,
    incidentRecoverySourceBindings: ledger.incidentRecoverySourceBindings,
    ledgerId: ledger.ledgerId,
    sourcePackets: ledger.sourcePackets,
    tenantId: ledger.tenantId,
  });
}

function resealV2(ledger: LuzioneOperationsEvidenceLedgerV2): LuzioneOperationsEvidenceLedgerV2 {
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
