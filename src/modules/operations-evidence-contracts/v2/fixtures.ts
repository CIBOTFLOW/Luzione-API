import {
  capabilityWindowLedgerFixture,
  capacityObservationFixture,
  caseHandoffFixture,
  changeFreezeFixture,
  customerZeroCadenceFixture,
  evidenceCompletenessReportFixture,
  feedbackRecordFixture,
  metricCatalogFixture,
  proofDailyRecordFixture,
  proofExceptionFixture,
  proofExitDecisionFixture,
  proofIncidentFixture,
  proofWeeklySignoffFixture,
  proofWindowEntryFixture,
  stageReadinessFixture,
  trainingAttestationFixture,
} from "../fixtures";
import type {
  EvidenceRefV1,
  MetricDefinition,
  OperationsEvidenceDocumentV1,
  ProofWindowEntryV1,
} from "../contracts";
import {
  OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_VERSION,
  type CanonicalHumanOwnerContextV1,
  type DailyMetricEvidenceBindingV1,
  type G2EffectAuthorityGrantV1,
  type LuzioneOperationsEvidenceLedgerV2,
} from "./contracts";
import { HARD_ZERO_METRIC_KEYS, REQUIRED_PROOF_ENTRY_G2_EFFECTS } from "./rules";
import { sealOperationsEvidenceLedgerV2 } from "./sdk";

export const operationsEvidenceLedgerFixtureClock = { assessmentTime: "2026-09-05T12:00:00.000Z" } as const;
export const operationsEvidenceLedgerTenantId = "tenant:luzione-customer-zero";
const releaseSha = "e6dce8c92f8cee9102af341615c0fa31345ca77d";

function evidence(artifactKind: EvidenceRefV1["artifactKind"], evidenceRefId: string, digestCharacter: string): EvidenceRefV1 {
  return {
    artifactKind,
    artifactVersion: "synthetic-ops-ledger-evidence/v2",
    containsSecretOrPii: false,
    contractVersion: "EvidenceRef/v1",
    dataClassification: "NON_SENSITIVE_METADATA",
    evidenceRefId,
    immutable: true,
    observedAt: "2026-09-05T02:00:00.000Z",
    releaseSha,
    sha256: digestCharacter.repeat(64),
    tenantId: operationsEvidenceLedgerTenantId,
    verifierId: "service:offline-ledger-verifier",
  };
}

export const metricEvidenceRefFixture = evidence("METRIC", "evidence:metric:ops-v2", "a");
export const iremAuthorityEvidenceRefFixture = evidence("AUTHORITY", "evidence:authority:irem", "b");
export const founderAuthorityEvidenceRefFixture = evidence("AUTHORITY", "evidence:authority:founder", "c");
export const handoffEvidenceRefFixture = evidence("HANDOFF", "evidence:handoff:case-1", "d");
export const trainingEvidenceRefFixture = evidence("TRAINING", "evidence:training:founder", "e");

export const authorityGrantEvidenceFixtures = REQUIRED_PROOF_ENTRY_G2_EFFECTS.map((requirement, index) =>
  evidence("AUTHORITY", `evidence:authority:${requirement.actionId}`, String(index + 1)));

export const ownerContextFixtures: readonly CanonicalHumanOwnerContextV1[] = [
  {
    authorityEvidenceRefId: iremAuthorityEvidenceRefFixture.evidenceRefId,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.humanOwnerContext,
    function: "PLATFORM_OPERATIONS",
    membershipState: "ACTIVE",
    ownerId: "human:irem",
    principalType: "HUMAN",
    role: "IREM",
    tenantId: operationsEvidenceLedgerTenantId,
  },
  {
    authorityEvidenceRefId: founderAuthorityEvidenceRefFixture.evidenceRefId,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.humanOwnerContext,
    function: "FOUNDER",
    membershipState: "ACTIVE",
    ownerId: "human:founder",
    principalType: "HUMAN",
    role: "FOUNDER",
    tenantId: operationsEvidenceLedgerTenantId,
  },
];

const hardZeroDefinitions: MetricDefinition[] = HARD_ZERO_METRIC_KEYS.map((metricKey) => ({
  denominatorEvidenceClass: "NONE",
  formula: "HARD_ZERO",
  hardZero: true,
  metricId: `proof.hard_zero.${metricKey}`,
  missingDataRule: "NO_CREDIT",
  numeratorEvidenceClass: `COUNT_${metricKey}`,
  ownerId: "human:founder",
  unit: "COUNT",
}));

const metricCatalog = structuredClone(metricCatalogFixture);
metricCatalog.evidenceRefs = [metricEvidenceRefFixture];
metricCatalog.payload.metrics = [
  {
    denominatorEvidenceClass: "REQUIRED_EVIDENCE",
    formula: "RATIO_BPS",
    hardZero: false,
    metricId: "proof.evidence_completeness_bps",
    missingDataRule: "NO_CREDIT",
    numeratorEvidenceClass: "PRESENT_VALID_EVIDENCE",
    ownerId: "human:irem",
    unit: "BASIS_POINTS",
  },
  {
    denominatorEvidenceClass: "REQUIRED_TELEMETRY",
    formula: "RATIO_BPS",
    hardZero: false,
    metricId: "proof.telemetry_coverage_bps",
    missingDataRule: "NO_CREDIT",
    numeratorEvidenceClass: "PRESENT_VALID_TELEMETRY",
    ownerId: "human:irem",
    unit: "BASIS_POINTS",
  },
  ...hardZeroDefinitions,
];

const completeness = structuredClone(evidenceCompletenessReportFixture);
completeness.evidenceRefs = [metricEvidenceRefFixture];
completeness.payload.calculatedCompletenessBps = 10000;
completeness.payload.claimedCompletenessBps = 10000;
completeness.payload.missingEvidenceKeys = [];
completeness.payload.presentValidEvidenceCount = 4;
completeness.payload.requiredEvidenceCount = 4;

const daily = structuredClone(proofDailyRecordFixture);
daily.evidenceRefs = [metricEvidenceRefFixture];
daily.payload.completenessBps = 10000;
daily.payload.capabilityCoverage = [{
  capabilityId: "crm.support",
  evidenceRefIds: [metricEvidenceRefFixture.evidenceRefId],
  ownerId: "human:irem",
}];

const weekly = structuredClone(proofWeeklySignoffFixture);
weekly.evidenceRefs = [metricEvidenceRefFixture];
const capability = structuredClone(capabilityWindowLedgerFixture);
capability.evidenceRefs = [metricEvidenceRefFixture];
const proofEntry = structuredClone(proofWindowEntryFixture);
proofEntry.evidenceRefs = [metricEvidenceRefFixture];
const exception = structuredClone(proofExceptionFixture);
exception.evidenceRefs = [metricEvidenceRefFixture];
const incident = structuredClone(proofIncidentFixture);
incident.evidenceRefs = [metricEvidenceRefFixture];
const exit = structuredClone(proofExitDecisionFixture);
exit.evidenceRefs = [metricEvidenceRefFixture];
const cadence = structuredClone(customerZeroCadenceFixture);
cadence.evidenceRefs = [metricEvidenceRefFixture];
const handoff = structuredClone(caseHandoffFixture);
handoff.evidenceRefs = [metricEvidenceRefFixture];
handoff.payload.summaryEvidenceRefIds = [handoffEvidenceRefFixture.evidenceRefId];
const training = structuredClone(trainingAttestationFixture);
training.evidenceRefs = [metricEvidenceRefFixture];
training.payload.assessmentEvidenceRefIds = [trainingEvidenceRefFixture.evidenceRefId];
const feedback = structuredClone(feedbackRecordFixture);
feedback.evidenceRefs = [metricEvidenceRefFixture];
const freeze = structuredClone(changeFreezeFixture);
freeze.evidenceRefs = [metricEvidenceRefFixture];
freeze.payload.approvalEvidenceRefId = founderAuthorityEvidenceRefFixture.evidenceRefId;
const capacity = structuredClone(capacityObservationFixture);
capacity.evidenceRefs = [metricEvidenceRefFixture];
const stage = structuredClone(stageReadinessFixture);
stage.evidenceRefs = [metricEvidenceRefFixture];

export const ledgerDocumentFixtures: readonly OperationsEvidenceDocumentV1[] = [
  metricEvidenceRefFixture,
  iremAuthorityEvidenceRefFixture,
  founderAuthorityEvidenceRefFixture,
  handoffEvidenceRefFixture,
  trainingEvidenceRefFixture,
  metricCatalog,
  proofEntry,
  daily,
  weekly,
  capability,
  completeness,
  exception,
  incident,
  exit,
  cadence,
  handoff,
  training,
  feedback,
  freeze,
  capacity,
  stage,
];

export const dailyMetricBindingFixture: DailyMetricEvidenceBindingV1 = {
  completenessEvidenceRefId: metricEvidenceRefFixture.evidenceRefId,
  completenessMetricId: "proof.evidence_completeness_bps",
  completenessReportRecordId: completeness.recordId,
  contractVersion: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.dailyMetricBinding,
  dailyRecordId: daily.recordId,
  hardZeros: HARD_ZERO_METRIC_KEYS.map((metricKey) => ({
    evidenceRefId: metricEvidenceRefFixture.evidenceRefId,
    metricId: `proof.hard_zero.${metricKey}`,
    metricKey,
    value: 0,
  })),
  metricCatalogRecordId: metricCatalog.recordId,
  telemetryEvidenceRefId: metricEvidenceRefFixture.evidenceRefId,
  telemetryMetricId: "proof.telemetry_coverage_bps",
};

export const operationsEvidenceLedgerV2Fixture: LuzioneOperationsEvidenceLedgerV2 = sealOperationsEvidenceLedgerV2({
  assessmentTime: operationsEvidenceLedgerFixtureClock.assessmentTime,
  authorityGrants: [],
  capabilityEpochResets: [],
  contractVersion: OPERATIONS_EVIDENCE_LEDGER_VERSION,
  dailyMetricBindings: [dailyMetricBindingFixture],
  effectAuthority: "NO_EFFECT",
  entries: ledgerDocumentFixtures.map((document) => ({ contentDigest: "0".repeat(64), document })),
  ledgerId: "ledger:customer-zero:proof-v2",
  ownerContexts: ownerContextFixtures,
  priorRecordSetDigest: null,
  tenantId: operationsEvidenceLedgerTenantId,
});

export function makeReadyOperationsEvidenceLedgerV2Fixture(): LuzioneOperationsEvidenceLedgerV2 {
  const readyEntry = structuredClone(proofEntry) as ProofWindowEntryV1;
  readyEntry.payload.activationConeCleared = true;
  readyEntry.payload.clearedCapabilityCount = 40;
  readyEntry.payload.entryState = "READY";
  readyEntry.payload.g1ReleaseShas = [releaseSha];
  readyEntry.payload.g2Approvals = REQUIRED_PROOF_ENTRY_G2_EFFECTS.map((requirement, index) => ({
    actionId: requirement.actionId,
    evidenceRefId: authorityGrantEvidenceFixtures[index].evidenceRefId,
  }));
  const grants: G2EffectAuthorityGrantV1[] = REQUIRED_PROOF_ENTRY_G2_EFFECTS.map((requirement, index) => ({
    actionId: requirement.actionId,
    authorityEvidenceRefId: authorityGrantEvidenceFixtures[index].evidenceRefId,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.authorityGrant,
    effect: requirement.effect,
    expiresAt: "2026-09-06T12:00:00.000Z",
    grantId: `grant:${requirement.effect.toLowerCase()}`,
    grantedAt: "2026-09-05T01:00:00.000Z",
    requestedStage: requirement.requestedStage,
    signerFunction: "FOUNDER",
    signerOwnerId: "human:founder",
    state: "GRANTED",
    tenantId: operationsEvidenceLedgerTenantId,
  }));
  const documents: OperationsEvidenceDocumentV1[] = [
    ...ledgerDocumentFixtures.filter((document) => document.contractVersion !== "ProofWindowEntry/v1"),
    readyEntry,
    ...authorityGrantEvidenceFixtures,
  ];
  return sealOperationsEvidenceLedgerV2({
    assessmentTime: operationsEvidenceLedgerFixtureClock.assessmentTime,
    authorityGrants: grants,
    capabilityEpochResets: [],
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_VERSION,
    dailyMetricBindings: [dailyMetricBindingFixture],
    effectAuthority: "NO_EFFECT",
    entries: documents.map((document) => ({ contentDigest: "0".repeat(64), document })),
    ledgerId: "ledger:customer-zero:proof-v2",
    ownerContexts: ownerContextFixtures,
    priorRecordSetDigest: null,
    tenantId: operationsEvidenceLedgerTenantId,
  });
}
