import {
  CUSTOMER_ZERO_STAGES,
  OPERATIONS_EVIDENCE_BUNDLE_VERSION,
  OPERATIONS_EVIDENCE_MANIFEST_VERSION,
  OPERATIONS_EVIDENCE_VERSIONS,
  OPS_CORE_COMPOSITION,
  OPS_PACKET_PINS,
  type AccountableOwner,
  type CapabilityWindowLedgerV1,
  type CapacityObservationV1,
  type CaseHandoffV1,
  type ChangeFreezeV1,
  type CustomerZeroCadenceV1,
  type EvidenceCompletenessReportV1,
  type EvidenceRefV1,
  type FeedbackRecordV1,
  type G2ApprovalRef,
  type LuzioneOperationsEvidenceManifestV1,
  type MetricCatalogV1,
  type OperationsEvidenceDocumentV1,
  type OperationsEvidenceVersion,
  type OperationsRecordBase,
  type ProofDailyRecordV1,
  type ProofExceptionV1,
  type ProofExitDecisionV1,
  type ProofIncidentV1,
  type ProofWeeklySignoffV1,
  type ProofWindowEntryV1,
  type SourcePacket,
  type StageReadinessV1,
  type TrainingAttestationV1,
} from "./contracts";

export type OperationsEvidenceErrorCode =
  | "OPS_AUTHORITY_DENIED"
  | "OPS_CLOCK_INVALID"
  | "OPS_COVERAGE_MISSING"
  | "OPS_EVIDENCE_MISSING"
  | "OPS_FIELD_SET_MISMATCH"
  | "OPS_FORMULA_MISMATCH"
  | "OPS_MANIFEST_DRIFT"
  | "OPS_OWNER_MISSING"
  | "OPS_REFERENCE_MISMATCH"
  | "OPS_SECRET_PII_FORBIDDEN"
  | "OPS_STATE_INVALID"
  | "OPS_SUPERSESSION_INVALID"
  | "OPS_VALUE_INVALID"
  | "OPS_WRONG_VERSION";

export class OperationsEvidenceCompatibilityError extends Error {
  readonly code: OperationsEvidenceErrorCode;

  constructor(code: OperationsEvidenceErrorCode, message: string) {
    super(message);
    this.name = "OperationsEvidenceCompatibilityError";
    this.code = code;
  }
}

export type OperationsEvidenceClock = { assessmentTime: string };

export type StageReadinessReferences = {
  capacity: CapacityObservationV1;
  changeFreeze: ChangeFreezeV1;
  handoffs: readonly CaseHandoffV1[];
  trainings: readonly TrainingAttestationV1[];
};

type JsonObject = Record<string, unknown>;

const RECORD_KEYS = [
  "accountableOwner", "contractVersion", "effectAuthority", "evidenceRefs", "immutable",
  "observedAt", "payload", "recordedAt", "recordId", "sourcePacket", "supersedesRecordId", "tenantId",
] as const;

const HARD_ZERO_KEYS = [
  "duplicateEffect", "falseFinality", "secretExposure", "unauthorizedCrossTenantSuccess",
  "unauthorizedEffect", "unapprovedProviderDispatch", "unverifiedClosure",
] as const;

const SENSITIVE_KEYS = new Set([
  "accessToken", "address", "credential", "credentialValue", "customerName", "documentBody",
  "email", "password", "phone", "rawPii", "refreshToken", "secret", "secretValue", "ssn", "token",
]);

const versionValues = Object.values(OPERATIONS_EVIDENCE_VERSIONS);

export function parseOperationsEvidenceDocumentV1(
  value: unknown,
  clock: OperationsEvidenceClock,
  stageReferences?: StageReadinessReferences,
): OperationsEvidenceDocumentV1 {
  const input = object(value, "operationsEvidenceDocument");
  switch (input.contractVersion) {
    case OPERATIONS_EVIDENCE_VERSIONS.evidenceRef: return parseEvidenceRefV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.metricCatalog: return parseMetricCatalogV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.proofWindowEntry: return parseProofWindowEntryV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord: return parseProofDailyRecordV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.proofWeeklySignoff: return parseProofWeeklySignoffV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.capabilityWindowLedger: return parseCapabilityWindowLedgerV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.evidenceCompletenessReport: return parseEvidenceCompletenessReportV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.proofException: return parseProofExceptionV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.proofIncident: return parseProofIncidentV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.proofExitDecision: return parseProofExitDecisionV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.customerZeroCadence: return parseCustomerZeroCadenceV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.caseHandoff: return parseCaseHandoffV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.trainingAttestation: return parseTrainingAttestationV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.feedbackRecord: return parseFeedbackRecordV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.changeFreeze: return parseChangeFreezeV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.capacityObservation: return parseCapacityObservationV1(value, clock);
    case OPERATIONS_EVIDENCE_VERSIONS.stageReadiness:
      return parseStageReadinessV1(value, clock, stageReferences);
    default:
      fail("OPS_WRONG_VERSION", "Unknown operations-evidence contractVersion.");
  }
}

export function parseEvidenceRefV1(value: unknown, clock: OperationsEvidenceClock): EvidenceRefV1 {
  assertNoSensitiveMaterial(value);
  const input = exact(value, [
    "artifactKind", "artifactVersion", "containsSecretOrPii", "contractVersion", "dataClassification",
    "evidenceRefId", "immutable", "observedAt", "releaseSha", "sha256", "tenantId", "verifierId",
  ], "evidenceRef");
  version(input.contractVersion, OPERATIONS_EVIDENCE_VERSIONS.evidenceRef, "evidenceRef");
  id(input.evidenceRefId, "evidenceRef.evidenceRefId");
  id(input.tenantId, "evidenceRef.tenantId");
  sha(input.releaseSha, 40, "evidenceRef.releaseSha");
  sha(input.sha256, 64, "evidenceRef.sha256");
  id(input.artifactVersion, "evidenceRef.artifactVersion");
  enumeration(input.artifactKind, [
    "AUTHORITY", "HANDOFF", "INCIDENT", "METRIC", "RECOVERY", "RELEASE", "SOURCE_READBACK", "TRAINING",
  ], "evidenceRef.artifactKind");
  const observedAt = timestamp(input.observedAt, "evidenceRef.observedAt");
  notAfter(observedAt, clock, "evidenceRef.observedAt");
  id(input.verifierId, "evidenceRef.verifierId");
  literal(input.dataClassification, "NON_SENSITIVE_METADATA", "evidenceRef.dataClassification");
  literal(input.immutable, true, "evidenceRef.immutable");
  literal(input.containsSecretOrPii, false, "evidenceRef.containsSecretOrPii");
  return input as EvidenceRefV1;
}

export function parseMetricCatalogV1(value: unknown, clock: OperationsEvidenceClock): MetricCatalogV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.metricCatalog, [
    "catalogId", "catalogVersion", "effectiveAt", "metrics", "retiredMetricIds",
  ], clock, undefined);
  const payload = record.payload;
  id(payload.catalogId, "metricCatalog.catalogId");
  id(payload.catalogVersion, "metricCatalog.catalogVersion");
  timestamp(payload.effectiveAt, "metricCatalog.effectiveAt");
  const metrics = array(payload.metrics, "metricCatalog.metrics");
  if (metrics.length === 0) missingCoverage("Metric catalog must define at least one metric.");
  const metricIds = new Set<string>();
  for (const [index, value] of metrics.entries()) {
    const metric = exact(value, [
      "denominatorEvidenceClass", "formula", "hardZero", "metricId", "missingDataRule",
      "numeratorEvidenceClass", "ownerId", "unit",
    ], `metricCatalog.metrics[${index}]`);
    const metricId = id(metric.metricId, `metricCatalog.metrics[${index}].metricId`);
    if (metricIds.has(metricId)) invalid(`Duplicate metricId ${metricId}.`);
    metricIds.add(metricId);
    id(metric.numeratorEvidenceClass, `metricCatalog.metrics[${index}].numeratorEvidenceClass`);
    id(metric.denominatorEvidenceClass, `metricCatalog.metrics[${index}].denominatorEvidenceClass`);
    enumeration(metric.formula, ["COUNT", "HARD_ZERO", "RATIO_BPS", "SUM"], `metricCatalog.metrics[${index}].formula`);
    enumeration(metric.unit, ["BASIS_POINTS", "COUNT", "DAYS", "MILLISECONDS", "MINUTES"], `metricCatalog.metrics[${index}].unit`);
    boolean(metric.hardZero, `metricCatalog.metrics[${index}].hardZero`);
    literal(metric.missingDataRule, "NO_CREDIT", `metricCatalog.metrics[${index}].missingDataRule`);
    humanOwnerId(metric.ownerId, `metricCatalog.metrics[${index}].ownerId`);
  }
  uniqueIds(payload.retiredMetricIds, false, "metricCatalog.retiredMetricIds");
  return record as unknown as MetricCatalogV1;
}

export function parseProofWindowEntryV1(value: unknown, clock: OperationsEvidenceClock): ProofWindowEntryV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.proofWindowEntry, [
    "activationConeCleared", "blockingIncidentCount", "capabilityCount", "clearedCapabilityCount",
    "coreContractVersion", "entryState", "g1ReleaseShas", "g2Approvals",
  ], clock, OPS_PACKET_PINS.proof);
  const p = record.payload;
  boolean(p.activationConeCleared, "proofWindowEntry.activationConeCleared");
  literal(p.capabilityCount, 40, "proofWindowEntry.capabilityCount");
  const cleared = boundedInteger(p.clearedCapabilityCount, 0, 40, "proofWindowEntry.clearedCapabilityCount");
  const incidents = nonnegativeInteger(p.blockingIncidentCount, "proofWindowEntry.blockingIncidentCount");
  literal(p.coreContractVersion, OPS_CORE_COMPOSITION.bundleVersion, "proofWindowEntry.coreContractVersion");
  const state = enumeration(p.entryState, ["BLOCKED", "READY"], "proofWindowEntry.entryState");
  const g1 = stringArray(p.g1ReleaseShas, false, "proofWindowEntry.g1ReleaseShas");
  for (const [index, item] of g1.entries()) sha(item, 40, `proofWindowEntry.g1ReleaseShas[${index}]`);
  parseG2Approvals(p.g2Approvals, "proofWindowEntry.g2Approvals");
  const ready = p.activationConeCleared === true && cleared === 40 && incidents === 0 && g1.length > 0;
  if ((state === "READY") !== ready) invalid("Proof Window READY requires 40/40 cone, no blocking incident, and exact G1 release evidence.");
  return record as unknown as ProofWindowEntryV1;
}

export function calculateDailyCredit(value: Pick<ProofDailyRecordV1["payload"],
  "blockingIncidentCount" | "capabilityCoverage" | "completenessBps" | "hardZeroCounters" |
  "requiredCapabilities" | "telemetryCoverageBps"
>): 0 | 1 {
  const coverage = new Map(value.capabilityCoverage.map((item) => [item.capabilityId, item]));
  const completeCoverage = value.requiredCapabilities.every((capabilityId) => {
    const item = coverage.get(capabilityId);
    return Boolean(item?.ownerId && item.evidenceRefIds.length > 0);
  });
  const hardZerosPass = Object.values(value.hardZeroCounters).every((count) => count === 0);
  return value.telemetryCoverageBps === 10000
    && value.completenessBps === 10000
    && value.blockingIncidentCount === 0
    && completeCoverage
    && hardZerosPass ? 1 : 0;
}

export function parseProofDailyRecordV1(value: unknown, clock: OperationsEvidenceClock): ProofDailyRecordV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord, [
    "blockingIncidentCount", "calculatedCredit", "capabilityCoverage", "claimedCredit", "completenessBps",
    "date", "hardZeroCounters", "requiredCapabilities", "telemetryCoverageBps",
  ], clock, OPS_PACKET_PINS.proof);
  const p = record.payload;
  dateOnly(p.date, "proofDailyRecord.date");
  bps(p.telemetryCoverageBps, "proofDailyRecord.telemetryCoverageBps");
  bps(p.completenessBps, "proofDailyRecord.completenessBps");
  nonnegativeInteger(p.blockingIncidentCount, "proofDailyRecord.blockingIncidentCount");
  const requiredCapabilities = uniqueIds(p.requiredCapabilities, true, "proofDailyRecord.requiredCapabilities");
  const coverageRows = array(p.capabilityCoverage, "proofDailyRecord.capabilityCoverage");
  if (coverageRows.length !== requiredCapabilities.length) missingCoverage("Capability coverage must contain one row per required capability.");
  const coverageIds = new Set<string>();
  for (const [index, item] of coverageRows.entries()) {
    const row = exact(item, ["capabilityId", "evidenceRefIds", "ownerId"], `proofDailyRecord.capabilityCoverage[${index}]`);
    const capabilityId = id(row.capabilityId, `proofDailyRecord.capabilityCoverage[${index}].capabilityId`);
    if (!requiredCapabilities.includes(capabilityId) || coverageIds.has(capabilityId)) {
      missingCoverage("Capability coverage must exactly match the required capability set.");
    }
    coverageIds.add(capabilityId);
    humanOwnerId(row.ownerId, `proofDailyRecord.capabilityCoverage[${index}].ownerId`);
    uniqueIds(row.evidenceRefIds, true, `proofDailyRecord.capabilityCoverage[${index}].evidenceRefIds`);
  }
  const hardZeros = exact(p.hardZeroCounters, HARD_ZERO_KEYS, "proofDailyRecord.hardZeroCounters");
  for (const key of HARD_ZERO_KEYS) nonnegativeInteger(hardZeros[key], `proofDailyRecord.hardZeroCounters.${key}`);
  const claimed = binary(p.claimedCredit, "proofDailyRecord.claimedCredit");
  const calculated = binary(p.calculatedCredit, "proofDailyRecord.calculatedCredit");
  const expected = calculateDailyCredit(p as ProofDailyRecordV1["payload"]);
  if (claimed !== expected || calculated !== expected) formula("Daily proof credit does not match the deterministic formula.");
  return record as unknown as ProofDailyRecordV1;
}

export function parseProofWeeklySignoffV1(value: unknown, clock: OperationsEvidenceClock): ProofWeeklySignoffV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.proofWeeklySignoff, [
    "creditedDays", "dailyRecordIds", "requiredDays", "signedAt", "signedBy", "signoffState", "weekStart",
  ], clock, OPS_PACKET_PINS.proof);
  const p = record.payload;
  dateOnly(p.weekStart, "proofWeeklySignoff.weekStart");
  literal(p.requiredDays, 7, "proofWeeklySignoff.requiredDays");
  const dailyIds = uniqueIds(p.dailyRecordIds, true, "proofWeeklySignoff.dailyRecordIds");
  if (dailyIds.length > 7) invalid("Weekly signoff cannot reference more than seven daily records.");
  const credited = boundedInteger(p.creditedDays, 0, dailyIds.length, "proofWeeklySignoff.creditedDays");
  const state = enumeration(p.signoffState, ["DRAFT", "READY", "SIGNED"], "proofWeeklySignoff.signoffState");
  const signedBy = idOrNull(p.signedBy, "proofWeeklySignoff.signedBy");
  const signedAt = timestampOrNull(p.signedAt, "proofWeeklySignoff.signedAt");
  if (state === "SIGNED") {
    if (!signedBy || !signedAt || dailyIds.length !== 7 || credited !== 7) invalid("SIGNED week requires a human signer and seven credited daily records.");
    humanOwnerId(signedBy, "proofWeeklySignoff.signedBy");
  } else if (signedBy !== null || signedAt !== null) invalid("Unsigned weekly records cannot carry signature fields.");
  return record as unknown as ProofWeeklySignoffV1;
}

export function parseCapabilityWindowLedgerV1(value: unknown, clock: OperationsEvidenceClock): CapabilityWindowLedgerV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.capabilityWindowLedger, [
    "capabilityId", "creditedDays", "dailyRecordIds", "requiredDays", "state", "windowEnd", "windowStart",
  ], clock, OPS_PACKET_PINS.proof);
  const p = record.payload;
  id(p.capabilityId, "capabilityWindowLedger.capabilityId");
  const start = dateOnly(p.windowStart, "capabilityWindowLedger.windowStart");
  const end = dateOnly(p.windowEnd, "capabilityWindowLedger.windowEnd");
  if (end < start) invalid("Capability window end must not precede its start.");
  literal(p.requiredDays, 30, "capabilityWindowLedger.requiredDays");
  const dailyIds = uniqueIds(p.dailyRecordIds, false, "capabilityWindowLedger.dailyRecordIds");
  const credited = boundedInteger(p.creditedDays, 0, dailyIds.length, "capabilityWindowLedger.creditedDays");
  const state = enumeration(p.state, ["BLOCKED", "COMPLETE", "NOT_STARTED", "OPEN"], "capabilityWindowLedger.state");
  if (state === "COMPLETE" && (credited !== 30 || dailyIds.length < 30)) invalid("A complete capability ledger requires thirty credited daily records.");
  if (state === "NOT_STARTED" && (credited !== 0 || dailyIds.length !== 0)) invalid("A not-started capability ledger cannot carry day evidence.");
  return record as unknown as CapabilityWindowLedgerV1;
}

export function calculateCompletenessBps(present: number, required: number): number {
  if (required === 0) return 0;
  return Math.floor((present * 10000) / required);
}

export function parseEvidenceCompletenessReportV1(value: unknown, clock: OperationsEvidenceClock): EvidenceCompletenessReportV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.evidenceCompletenessReport, [
    "calculatedCompletenessBps", "claimedCompletenessBps", "coverageOwnerIds", "missingEvidenceKeys",
    "presentValidEvidenceCount", "requiredEvidenceCount",
  ], clock, OPS_PACKET_PINS.proof);
  const p = record.payload;
  const required = positiveInteger(p.requiredEvidenceCount, "evidenceCompletenessReport.requiredEvidenceCount");
  const present = boundedInteger(p.presentValidEvidenceCount, 0, required, "evidenceCompletenessReport.presentValidEvidenceCount");
  const missing = uniqueIds(p.missingEvidenceKeys, false, "evidenceCompletenessReport.missingEvidenceKeys");
  if (missing.length !== required - present) missingEvidence("Missing evidence keys must enumerate the exact completeness deficit.");
  const owners = uniqueIds(p.coverageOwnerIds, true, "evidenceCompletenessReport.coverageOwnerIds");
  for (const owner of owners) humanOwnerId(owner, "evidenceCompletenessReport.coverageOwnerIds[]");
  const expected = calculateCompletenessBps(present, required);
  if (p.calculatedCompletenessBps !== expected || p.claimedCompletenessBps !== expected) {
    formula("Evidence completeness basis points do not match the deterministic formula.");
  }
  return record as unknown as EvidenceCompletenessReportV1;
}

export function parseProofExceptionV1(value: unknown, clock: OperationsEvidenceClock): ProofExceptionV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.proofException, [
    "approvalEvidenceRefId", "approvedBy", "exceptionType", "expiresAt", "hardZeroWaiver",
    "reasonCode", "scope", "status",
  ], clock, OPS_PACKET_PINS.proof);
  const p = record.payload;
  enumeration(p.exceptionType, ["EVIDENCE_DELAY", "PLANNED_MAINTENANCE", "TELEMETRY_GAP"], "proofException.exceptionType");
  id(p.reasonCode, "proofException.reasonCode");
  uniqueIds(p.scope, true, "proofException.scope");
  literal(p.hardZeroWaiver, false, "proofException.hardZeroWaiver");
  const status = enumeration(p.status, ["APPROVED", "DRAFT", "EXPIRED", "REJECTED"], "proofException.status");
  timestamp(p.expiresAt, "proofException.expiresAt");
  const approvedBy = idOrNull(p.approvedBy, "proofException.approvedBy");
  const approvalRef = idOrNull(p.approvalEvidenceRefId, "proofException.approvalEvidenceRefId");
  if (status === "APPROVED") {
    if (!approvedBy || !approvalRef) authority("Approved exception requires human approval and evidence.");
    humanOwnerId(approvedBy, "proofException.approvedBy");
  } else if (approvedBy !== null || approvalRef !== null) authority("Only an approved exception may carry approval fields.");
  return record as unknown as ProofExceptionV1;
}

export function parseProofIncidentV1(value: unknown, clock: OperationsEvidenceClock): ProofIncidentV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.proofIncident, [
    "acknowledgedAt", "capabilityIds", "openedAt", "readbackEvidenceRefIds", "resetCapabilityEpoch",
    "resolvedAt", "severity", "state",
  ], clock, OPS_PACKET_PINS.proof);
  const p = record.payload;
  const severity = enumeration(p.severity, ["P0", "P1", "P2", "P3"], "proofIncident.severity");
  const state = enumeration(p.state, ["ACKNOWLEDGED", "OPEN", "RESOLVED_VERIFIED"], "proofIncident.state");
  const openedAt = timestamp(p.openedAt, "proofIncident.openedAt");
  const acknowledgedAt = timestampOrNull(p.acknowledgedAt, "proofIncident.acknowledgedAt");
  const resolvedAt = timestampOrNull(p.resolvedAt, "proofIncident.resolvedAt");
  if (acknowledgedAt && acknowledgedAt < openedAt) invalid("Incident acknowledgement cannot precede opening.");
  if (resolvedAt && (!acknowledgedAt || resolvedAt < acknowledgedAt)) invalid("Verified resolution requires prior acknowledgement.");
  const capabilityIds = uniqueIds(p.capabilityIds, true, "proofIncident.capabilityIds");
  const readbackIds = uniqueIds(p.readbackEvidenceRefIds, false, "proofIncident.readbackEvidenceRefIds");
  const reset = boolean(p.resetCapabilityEpoch, "proofIncident.resetCapabilityEpoch");
  if (state === "RESOLVED_VERIFIED" && (!resolvedAt || readbackIds.length === 0)) invalid("Verified incident resolution requires source readback evidence.");
  if (state !== "RESOLVED_VERIFIED" && resolvedAt !== null) invalid("Unresolved incident cannot carry resolvedAt.");
  if ((severity === "P0" || severity === "P1") && !reset) invalid("P0/P1 incidents reset the affected capability epoch.");
  if (capabilityIds.length === 0) missingCoverage("Incident must identify affected capabilities.");
  return record as unknown as ProofIncidentV1;
}

export function parseProofExitDecisionV1(value: unknown, clock: OperationsEvidenceClock): ProofExitDecisionV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.proofExitDecision, [
    "allCapabilitiesComplete", "allHardZerosPass", "blockingReasons", "creditedDays", "decision",
    "decisionAt", "decisionBy", "managedRecoveryEvidenceRefId", "requiredDays", "windowEnd", "windowStart",
  ], clock, OPS_PACKET_PINS.proof);
  const p = record.payload;
  boolean(p.allCapabilitiesComplete, "proofExitDecision.allCapabilitiesComplete");
  boolean(p.allHardZerosPass, "proofExitDecision.allHardZerosPass");
  literal(p.requiredDays, 30, "proofExitDecision.requiredDays");
  const credited = boundedInteger(p.creditedDays, 0, 30, "proofExitDecision.creditedDays");
  const decision = enumeration(p.decision, ["BLOCKED", "PASS"], "proofExitDecision.decision");
  timestamp(p.decisionAt, "proofExitDecision.decisionAt");
  humanOwnerId(p.decisionBy, "proofExitDecision.decisionBy");
  const recoveryRef = idOrNull(p.managedRecoveryEvidenceRefId, "proofExitDecision.managedRecoveryEvidenceRefId");
  const reasons = stringArray(p.blockingReasons, false, "proofExitDecision.blockingReasons");
  const start = dateOnly(p.windowStart, "proofExitDecision.windowStart");
  const end = dateOnly(p.windowEnd, "proofExitDecision.windowEnd");
  if (end < start) invalid("Proof exit window end must not precede start.");
  const canPass = credited === 30 && p.allCapabilitiesComplete === true && p.allHardZerosPass === true && recoveryRef !== null && reasons.length === 0;
  if ((decision === "PASS") !== canPass) invalid("Proof exit PASS requires thirty days, complete capabilities, hard-zero pass, managed recovery evidence, and no blocker.");
  return record as unknown as ProofExitDecisionV1;
}

export function parseCustomerZeroCadenceV1(value: unknown, clock: OperationsEvidenceClock): CustomerZeroCadenceV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.customerZeroCadence, [
    "dailyCeremonies", "externalCustomers", "founderMinutesPlanned", "iremMinutesPlanned", "liveEffects",
    "rehearsalFounderMinutes", "rehearsalIremMinutes", "state", "weekStart", "weeklyCeremonies",
  ], clock, OPS_PACKET_PINS.customerZero);
  const p = record.payload;
  dateOnly(p.weekStart, "customerZeroCadence.weekStart");
  exactEnumSet(p.dailyCeremonies, ["CLOSE", "CONTROL_HUDDLE", "OPEN"], "customerZeroCadence.dailyCeremonies");
  exactEnumSet(p.weeklyCeremonies, ["CHANGE", "PROOF", "TRAINING"], "customerZeroCadence.weeklyCeremonies");
  literal(p.iremMinutesPlanned, 600, "customerZeroCadence.iremMinutesPlanned");
  literal(p.founderMinutesPlanned, 195, "customerZeroCadence.founderMinutesPlanned");
  literal(p.rehearsalIremMinutes, 630, "customerZeroCadence.rehearsalIremMinutes");
  literal(p.rehearsalFounderMinutes, 360, "customerZeroCadence.rehearsalFounderMinutes");
  literal(p.externalCustomers, 0, "customerZeroCadence.externalCustomers");
  literal(p.liveEffects, 0, "customerZeroCadence.liveEffects");
  enumeration(p.state, ["PLANNED", "REHEARSED_SYNTHETIC"], "customerZeroCadence.state");
  return record as unknown as CustomerZeroCadenceV1;
}

export function parseCaseHandoffV1(value: unknown, clock: OperationsEvidenceClock): CaseHandoffV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.caseHandoff, [
    "acceptedAt", "acceptedBy", "caseId", "fromOwnerId", "offeredAt", "state", "summaryEvidenceRefIds", "toOwnerId",
  ], clock, OPS_PACKET_PINS.customerZero);
  const p = record.payload;
  id(p.caseId, "caseHandoff.caseId");
  const from = humanOwnerId(p.fromOwnerId, "caseHandoff.fromOwnerId");
  const to = humanOwnerId(p.toOwnerId, "caseHandoff.toOwnerId");
  if (from === to) invalid("Case handoff must transfer between distinct owners.");
  const offeredAt = timestamp(p.offeredAt, "caseHandoff.offeredAt");
  const acceptedAt = timestampOrNull(p.acceptedAt, "caseHandoff.acceptedAt");
  const acceptedBy = idOrNull(p.acceptedBy, "caseHandoff.acceptedBy");
  const state = enumeration(p.state, ["ACCEPTED", "OFFERED", "REJECTED"], "caseHandoff.state");
  uniqueIds(p.summaryEvidenceRefIds, true, "caseHandoff.summaryEvidenceRefIds");
  if (state === "ACCEPTED") {
    if (acceptedBy !== to || !acceptedAt || acceptedAt < offeredAt) invalid("Accepted handoff requires exact recipient acceptance after offer.");
  } else if (acceptedBy !== null || acceptedAt !== null) invalid("Unaccepted handoff cannot carry acceptance evidence.");
  return record as unknown as CaseHandoffV1;
}

export function parseTrainingAttestationV1(value: unknown, clock: OperationsEvidenceClock): TrainingAttestationV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.trainingAttestation, [
    "assessmentEvidenceRefIds", "completedAt", "curriculumVersion", "expiresAt", "scoreBps", "status", "traineeOwnerId",
  ], clock, OPS_PACKET_PINS.customerZero);
  const p = record.payload;
  id(p.curriculumVersion, "trainingAttestation.curriculumVersion");
  humanOwnerId(p.traineeOwnerId, "trainingAttestation.traineeOwnerId");
  const completedAt = timestamp(p.completedAt, "trainingAttestation.completedAt");
  const expiresAt = timestamp(p.expiresAt, "trainingAttestation.expiresAt");
  if (expiresAt <= completedAt) invalid("Training expiry must follow completion.");
  bps(p.scoreBps, "trainingAttestation.scoreBps");
  uniqueIds(p.assessmentEvidenceRefIds, true, "trainingAttestation.assessmentEvidenceRefIds");
  const status = enumeration(p.status, ["CURRENT", "EXPIRED"], "trainingAttestation.status");
  const isCurrent = Date.parse(expiresAt) >= assessmentTime(clock);
  if ((status === "CURRENT") !== isCurrent) invalid("Training status must match the explicit assessment clock.");
  return record as unknown as TrainingAttestationV1;
}

export function parseFeedbackRecordV1(value: unknown, clock: OperationsEvidenceClock): FeedbackRecordV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.feedbackRecord, [
    "caseId", "category", "changeRequestRef", "containsCustomerContent", "disposition", "feedbackId", "submittedAt", "submittedBy",
  ], clock, OPS_PACKET_PINS.customerZero);
  const p = record.payload;
  id(p.feedbackId, "feedbackRecord.feedbackId");
  id(p.caseId, "feedbackRecord.caseId");
  enumeration(p.category, ["CORRECTION", "GAP", "IMPROVEMENT"], "feedbackRecord.category");
  enumeration(p.disposition, ["ACCEPTED", "DEFERRED", "REJECTED", "TRIAGED"], "feedbackRecord.disposition");
  timestamp(p.submittedAt, "feedbackRecord.submittedAt");
  humanOwnerId(p.submittedBy, "feedbackRecord.submittedBy");
  idOrNull(p.changeRequestRef, "feedbackRecord.changeRequestRef");
  literal(p.containsCustomerContent, false, "feedbackRecord.containsCustomerContent");
  return record as unknown as FeedbackRecordV1;
}

export function parseChangeFreezeV1(value: unknown, clock: OperationsEvidenceClock): ChangeFreezeV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.changeFreeze, [
    "approvedBy", "approvalEvidenceRefId", "endsAt", "g2Approvals", "prohibitedChanges", "scope", "startsAt", "state",
  ], clock, OPS_PACKET_PINS.customerZero);
  const p = record.payload;
  humanOwnerId(p.approvedBy, "changeFreeze.approvedBy");
  id(p.approvalEvidenceRefId, "changeFreeze.approvalEvidenceRefId");
  const start = timestamp(p.startsAt, "changeFreeze.startsAt");
  const end = timestamp(p.endsAt, "changeFreeze.endsAt");
  if (end <= start) invalid("Change freeze end must follow start.");
  uniqueIds(p.scope, true, "changeFreeze.scope");
  uniqueIds(p.prohibitedChanges, true, "changeFreeze.prohibitedChanges");
  enumeration(p.state, ["FROZEN", "PLANNED", "RELEASED"], "changeFreeze.state");
  parseG2Approvals(p.g2Approvals, "changeFreeze.g2Approvals");
  return record as unknown as ChangeFreezeV1;
}

export function calculateUtilizationBps(requiredMinutes: number, availableMinutes: number): number {
  if (availableMinutes <= 0) return requiredMinutes === 0 ? 0 : Number.MAX_SAFE_INTEGER;
  return Math.ceil((requiredMinutes * 10000) / availableMinutes);
}

export function parseCapacityObservationV1(value: unknown, clock: OperationsEvidenceClock): CapacityObservationV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.capacityObservation, [
    "admissionAllowed", "calculatedFounderUtilizationBps", "calculatedIremUtilizationBps",
    "claimedFounderUtilizationBps", "claimedIremUtilizationBps", "founderAvailableMinutes", "founderRequiredMinutes",
    "iremAvailableMinutes", "iremRequiredMinutes", "overrun", "windowEnd", "windowStart",
  ], clock, OPS_PACKET_PINS.customerZero);
  const p = record.payload;
  const start = timestamp(p.windowStart, "capacityObservation.windowStart");
  const end = timestamp(p.windowEnd, "capacityObservation.windowEnd");
  if (end <= start) invalid("Capacity window end must follow start.");
  const iremAvailable = positiveInteger(p.iremAvailableMinutes, "capacityObservation.iremAvailableMinutes");
  const founderAvailable = positiveInteger(p.founderAvailableMinutes, "capacityObservation.founderAvailableMinutes");
  const iremRequired = nonnegativeInteger(p.iremRequiredMinutes, "capacityObservation.iremRequiredMinutes");
  const founderRequired = nonnegativeInteger(p.founderRequiredMinutes, "capacityObservation.founderRequiredMinutes");
  const iremExpected = calculateUtilizationBps(iremRequired, iremAvailable);
  const founderExpected = calculateUtilizationBps(founderRequired, founderAvailable);
  if (p.calculatedIremUtilizationBps !== iremExpected || p.claimedIremUtilizationBps !== iremExpected
    || p.calculatedFounderUtilizationBps !== founderExpected || p.claimedFounderUtilizationBps !== founderExpected) {
    formula("Capacity utilization does not match deterministic basis-point calculation.");
  }
  const overrun = iremExpected > 10000 || founderExpected > 10000;
  if (p.overrun !== overrun || p.admissionAllowed !== !overrun) formula("Capacity overrun and admission fields must follow utilization.");
  return record as unknown as CapacityObservationV1;
}

export function parseStageReadinessV1(
  value: unknown,
  clock: OperationsEvidenceClock,
  references?: StageReadinessReferences,
): StageReadinessV1 {
  const record = parseRecord(value, OPERATIONS_EVIDENCE_VERSIONS.stageReadiness, [
    "blockingReasons", "calculatedDecision", "capacityObservationId", "changeFreezeId", "claimedDecision",
    "coverageComplete", "currentStage", "evidenceComplete", "g2Approvals", "handoffRecordIds", "requestedStage", "trainingRecordIds",
  ], clock, OPS_PACKET_PINS.customerZero);
  const p = record.payload;
  const current = enumeration(p.currentStage, CUSTOMER_ZERO_STAGES, "stageReadiness.currentStage");
  const requested = enumeration(p.requestedStage, CUSTOMER_ZERO_STAGES, "stageReadiness.requestedStage");
  const currentIndex = CUSTOMER_ZERO_STAGES.indexOf(current);
  const requestedIndex = CUSTOMER_ZERO_STAGES.indexOf(requested);
  if (requestedIndex > currentIndex + 1) invalid("Stage transitions may advance at most one stage.");
  const coverageComplete = boolean(p.coverageComplete, "stageReadiness.coverageComplete");
  const evidenceComplete = boolean(p.evidenceComplete, "stageReadiness.evidenceComplete");
  const handoffIds = uniqueIds(p.handoffRecordIds, true, "stageReadiness.handoffRecordIds");
  const trainingIds = uniqueIds(p.trainingRecordIds, true, "stageReadiness.trainingRecordIds");
  id(p.capacityObservationId, "stageReadiness.capacityObservationId");
  id(p.changeFreezeId, "stageReadiness.changeFreezeId");
  const approvals = parseG2Approvals(p.g2Approvals, "stageReadiness.g2Approvals");
  const reasons = stringArray(p.blockingReasons, false, "stageReadiness.blockingReasons");
  const calculated = enumeration(p.calculatedDecision, ["ADVANCE", "HOLD"], "stageReadiness.calculatedDecision");
  const claimed = enumeration(p.claimedDecision, ["ADVANCE", "HOLD"], "stageReadiness.claimedDecision");
  const requestsAdvance = requestedIndex === currentIndex + 1;
  let referencesReady = false;
  if (references) {
    if (references.capacity.recordId !== p.capacityObservationId || references.changeFreeze.recordId !== p.changeFreezeId) {
      mismatch("Stage readiness references do not match the supplied capacity/freeze records.");
    }
    if (!sameSet(handoffIds, references.handoffs.map((item) => item.recordId))
      || !sameSet(trainingIds, references.trainings.map((item) => item.recordId))) {
      mismatch("Stage readiness handoff/training IDs must exactly match supplied records.");
    }
    const accepted = references.handoffs.every((item) => item.payload.state === "ACCEPTED");
    const trainingCurrent = references.trainings.every((item) => item.payload.status === "CURRENT"
      && Date.parse(item.payload.expiresAt) >= assessmentTime(clock));
    referencesReady = accepted && trainingCurrent && references.capacity.payload.admissionAllowed
      && !references.capacity.payload.overrun && references.changeFreeze.payload.state === "FROZEN";
  }
  const g2Required = requestedIndex >= CUSTOMER_ZERO_STAGES.indexOf("REVERSIBLE_WRITES");
  const expected = requestsAdvance && coverageComplete && evidenceComplete && referencesReady
    && (!g2Required || approvals.length > 0) && reasons.length === 0 ? "ADVANCE" : "HOLD";
  if (calculated !== expected || claimed !== expected) invalid("Stage readiness decision does not match the deterministic dependency and authority state.");
  return record as unknown as StageReadinessV1;
}

export function parseLuzioneOperationsEvidenceManifestV1(
  value: unknown,
  expectedCandidateSha?: string,
): LuzioneOperationsEvidenceManifestV1 {
  const input = exact(value, [
    "artifacts", "bundleVersion", "candidateSha", "compatibility", "contracts", "controllerAuthority",
    "coreComposition", "effectAuthority", "productionReady", "runtimeActivation", "schemaVersion", "sourcePackets",
  ], "operationsEvidenceManifest");
  literal(input.schemaVersion, OPERATIONS_EVIDENCE_MANIFEST_VERSION, "operationsEvidenceManifest.schemaVersion");
  literal(input.bundleVersion, OPERATIONS_EVIDENCE_BUNDLE_VERSION, "operationsEvidenceManifest.bundleVersion");
  if (expectedCandidateSha !== undefined && input.candidateSha !== expectedCandidateSha) manifestDrift("Manifest candidate SHA drift.");
  if (input.candidateSha !== "UNBOUND_G0") sha(input.candidateSha, 40, "operationsEvidenceManifest.candidateSha");
  id(input.controllerAuthority, "operationsEvidenceManifest.controllerAuthority");
  literal(input.effectAuthority, "NO_EFFECT", "operationsEvidenceManifest.effectAuthority");
  literal(input.runtimeActivation, "NOT_IMPLEMENTED", "operationsEvidenceManifest.runtimeActivation");
  literal(input.productionReady, false, "operationsEvidenceManifest.productionReady");
  exactManifestPin(input.coreComposition, OPS_CORE_COMPOSITION, "operationsEvidenceManifest.coreComposition");
  const packets = exact(input.sourcePackets, ["customerZero", "proof"], "operationsEvidenceManifest.sourcePackets");
  exactManifestPin(packets.customerZero, OPS_PACKET_PINS.customerZero, "operationsEvidenceManifest.sourcePackets.customerZero");
  exactManifestPin(packets.proof, OPS_PACKET_PINS.proof, "operationsEvidenceManifest.sourcePackets.proof");
  const contracts = exact(input.contracts, versionValues, "operationsEvidenceManifest.contracts");
  for (const contractVersion of versionValues) id(contracts[contractVersion], `operationsEvidenceManifest.contracts.${contractVersion}`);
  const artifacts = exact(input.artifacts, [
    "generatedSdk", "l2ConsumerPacket", "l3ConsumerPacket", "schemaBundle", "semanticFixtures", "strictConsumerSdk",
  ], "operationsEvidenceManifest.artifacts");
  for (const key of Object.keys(artifacts)) id(artifacts[key], `operationsEvidenceManifest.artifacts.${key}`);
  const compatibility = exact(input.compatibility, [
    "additiveEvolutionRequiresNewVersion", "exactFieldSets", "unknownVersionsRejected",
  ], "operationsEvidenceManifest.compatibility");
  for (const key of Object.keys(compatibility)) literal(compatibility[key], true, `operationsEvidenceManifest.compatibility.${key}`);
  return input as unknown as LuzioneOperationsEvidenceManifestV1;
}

function parseRecord<V extends OperationsEvidenceVersion>(
  value: unknown,
  expectedVersion: V,
  payloadKeys: readonly string[],
  clock: OperationsEvidenceClock,
  expectedPacket: SourcePacket | undefined,
): OperationsRecordBase<V, JsonObject> {
  assertNoSensitiveMaterial(value);
  const input = exact(value, RECORD_KEYS, expectedVersion);
  version(input.contractVersion, expectedVersion, expectedVersion);
  const recordId = id(input.recordId, `${expectedVersion}.recordId`);
  const tenantId = id(input.tenantId, `${expectedVersion}.tenantId`);
  const observedAt = timestamp(input.observedAt, `${expectedVersion}.observedAt`);
  const recordedAt = timestamp(input.recordedAt, `${expectedVersion}.recordedAt`);
  notAfter(observedAt, clock, `${expectedVersion}.observedAt`);
  notAfter(recordedAt, clock, `${expectedVersion}.recordedAt`);
  if (recordedAt < observedAt) clockInvalid(`${expectedVersion} recordedAt cannot precede observedAt.`);
  parseAccountableOwner(input.accountableOwner, `${expectedVersion}.accountableOwner`);
  literal(input.effectAuthority, "NO_EFFECT", `${expectedVersion}.effectAuthority`);
  literal(input.immutable, true, `${expectedVersion}.immutable`);
  const supersedes = idOrNull(input.supersedesRecordId, `${expectedVersion}.supersedesRecordId`);
  if (supersedes === recordId) supersession("A record cannot supersede itself.");
  const packet = parseSourcePacket(input.sourcePacket, `${expectedVersion}.sourcePacket`);
  if (expectedPacket && (packet.packetId !== expectedPacket.packetId
    || packet.fingerprintSha256 !== expectedPacket.fingerprintSha256)) {
    manifestDrift(`${expectedVersion} source packet fingerprint drift.`);
  }
  const refs = array(input.evidenceRefs, `${expectedVersion}.evidenceRefs`);
  if (refs.length === 0) missingEvidence(`${expectedVersion} requires at least one immutable evidence reference.`);
  const refIds = new Set<string>();
  for (const refValue of refs) {
    const ref = parseEvidenceRefV1(refValue, clock);
    if (ref.tenantId !== tenantId) mismatch(`${expectedVersion} evidence tenant mismatch.`);
    if (refIds.has(ref.evidenceRefId)) invalid(`${expectedVersion} duplicate evidenceRefId.`);
    refIds.add(ref.evidenceRefId);
  }
  const payload = exact(input.payload, payloadKeys, `${expectedVersion}.payload`);
  return { ...input, payload } as unknown as OperationsRecordBase<V, JsonObject>;
}

function parseAccountableOwner(value: unknown, label: string): AccountableOwner {
  const owner = exact(value, ["function", "ownerId", "ownerType"], label);
  literal(owner.ownerType, "HUMAN", `${label}.ownerType`);
  humanOwnerId(owner.ownerId, `${label}.ownerId`);
  enumeration(owner.function, ["FOUNDER", "PLATFORM_OPERATIONS", "SUPPORT_OPERATIONS"], `${label}.function`);
  return owner as AccountableOwner;
}

function parseSourcePacket(value: unknown, label: string): SourcePacket {
  const packet = exact(value, ["fingerprintSha256", "packetId"], label);
  const packetId = enumeration(packet.packetId, [OPS_PACKET_PINS.customerZero.packetId, OPS_PACKET_PINS.proof.packetId], `${label}.packetId`);
  sha(packet.fingerprintSha256, 64, `${label}.fingerprintSha256`);
  const expected = packetId === OPS_PACKET_PINS.proof.packetId ? OPS_PACKET_PINS.proof : OPS_PACKET_PINS.customerZero;
  if (packet.fingerprintSha256 !== expected.fingerprintSha256) manifestDrift(`${label} fingerprint does not match packet identity.`);
  return packet as unknown as SourcePacket;
}

function parseG2Approvals(value: unknown, label: string): G2ApprovalRef[] {
  const approvals = array(value, label);
  const actionIds = new Set<string>();
  const evidenceIds = new Set<string>();
  return approvals.map((item, index) => {
    const approval = exact(item, ["actionId", "evidenceRefId"], `${label}[${index}]`);
    const actionId = id(approval.actionId, `${label}[${index}].actionId`);
    const evidenceRefId = id(approval.evidenceRefId, `${label}[${index}].evidenceRefId`);
    if (actionIds.has(actionId) || evidenceIds.has(evidenceRefId)) {
      authority("G2 approvals must bind one unique evidence reference to one exact action; bundling is forbidden.");
    }
    actionIds.add(actionId);
    evidenceIds.add(evidenceRefId);
    return { actionId, evidenceRefId };
  });
}

function assertNoSensitiveMaterial(value: unknown, path = "document"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveMaterial(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key)) sensitive(`${path}.${key} is forbidden; store only opaque, non-sensitive evidence references.`);
      assertNoSensitiveMaterial(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    || /\b(?:Bearer|sb_secret_|sk_live_|sk_test_)\s*[A-Za-z0-9._-]+/.test(value)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || /\b\d{3}-\d{2}-\d{4}\b/.test(value)
  )) sensitive(`${path} contains secret or direct PII material.`);
}

function exact(value: unknown, keys: readonly string[], label: string): JsonObject {
  const input = object(value, label);
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("OPS_FIELD_SET_MISMATCH", `${label} expected fields [${expected.join(", ")}], received [${actual.join(", ")}].`);
  }
  return input;
}

function exactManifestPin(value: unknown, expected: Readonly<Record<string, unknown>>, label: string): void {
  const input = exact(value, Object.keys(expected), label);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (input[key] !== expectedValue) manifestDrift(`${label}.${key} does not match the frozen pin.`);
  }
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return value;
}

function stringArray(value: unknown, nonempty: boolean, label: string): string[] {
  const values = array(value, label).map((item, index) => id(item, `${label}[${index}]`));
  if (nonempty && values.length === 0) invalid(`${label} must not be empty.`);
  return values;
}

function uniqueIds(value: unknown, nonempty: boolean, label: string): string[] {
  const values = stringArray(value, nonempty, label);
  if (new Set(values).size !== values.length) invalid(`${label} must contain unique values.`);
  return values;
}

function exactEnumSet(value: unknown, expected: readonly string[], label: string): void {
  const values = uniqueIds(value, true, label).sort();
  const sorted = [...expected].sort();
  if (!sameSet(values, sorted)) invalid(`${label} must contain exactly ${sorted.join(", ")}.`);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]);
}

function version(value: unknown, expected: string, label: string): void {
  if (value !== expected) fail("OPS_WRONG_VERSION", `${label} requires ${expected}.`);
}

function literal(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) invalid(`${label} must equal ${String(expected)}.`);
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length < 3 || value.length > 240) invalid(`${label} must be a bounded non-empty identifier.`);
  return value;
}

function humanOwnerId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length < 3 || value.length > 240) {
    fail("OPS_OWNER_MISSING", `${label} must identify an accountable human owner.`);
  }
  const owner = value;
  if (/^(?:agent|sultan|model|automation|bot):/i.test(owner)) authority(`${label} must identify an accountable human, not an agent.`);
  return owner;
}

function idOrNull(value: unknown, label: string): string | null {
  return value === null ? null : id(value, label);
}

function sha(value: unknown, length: 40 | 64, label: string): string {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) invalid(`${label} must be a lowercase ${length}-character digest.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    clockInvalid(`${label} must be a millisecond UTC timestamp.`);
  }
  return value;
}

function timestampOrNull(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function dateOnly(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    clockInvalid(`${label} must be an ISO date.`);
  }
  return value;
}

function assessmentTime(clock: OperationsEvidenceClock): number {
  return Date.parse(timestamp(clock.assessmentTime, "clock.assessmentTime"));
}

function notAfter(value: string, clock: OperationsEvidenceClock, label: string): void {
  if (Date.parse(value) > assessmentTime(clock)) clockInvalid(`${label} cannot be after the assessment clock.`);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be boolean.`);
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) invalid(`${label} must be a nonnegative integer.`);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const result = nonnegativeInteger(value, label);
  if (result === 0) invalid(`${label} must be positive.`);
  return result;
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  const result = nonnegativeInteger(value, label);
  if (result < min || result > max) invalid(`${label} must be between ${min} and ${max}.`);
  return result;
}

function bps(value: unknown, label: string): number {
  return boundedInteger(value, 0, 10000, label);
}

function binary(value: unknown, label: string): 0 | 1 {
  if (value !== 0 && value !== 1) invalid(`${label} must be 0 or 1.`);
  return value;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${label} has an unsupported value.`);
  return value as T;
}

function fail(code: OperationsEvidenceErrorCode, message: string): never {
  throw new OperationsEvidenceCompatibilityError(code, message);
}

function invalid(message: string): never { fail("OPS_VALUE_INVALID", message); }
function authority(message: string): never { fail("OPS_AUTHORITY_DENIED", message); }
function clockInvalid(message: string): never { fail("OPS_CLOCK_INVALID", message); }
function formula(message: string): never { fail("OPS_FORMULA_MISMATCH", message); }
function manifestDrift(message: string): never { fail("OPS_MANIFEST_DRIFT", message); }
function mismatch(message: string): never { fail("OPS_REFERENCE_MISMATCH", message); }
function missingCoverage(message: string): never { fail("OPS_COVERAGE_MISSING", message); }
function missingEvidence(message: string): never { fail("OPS_EVIDENCE_MISSING", message); }
function sensitive(message: string): never { fail("OPS_SECRET_PII_FORBIDDEN", message); }
function supersession(message: string): never { fail("OPS_SUPERSESSION_INVALID", message); }
