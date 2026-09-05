import { createHash } from "node:crypto";
import {
  CUSTOMER_ZERO_STAGES,
  OPERATIONS_EVIDENCE_VERSIONS,
  type AccountableOwner,
  type CapabilityWindowLedgerV1,
  type CapacityObservationV1,
  type CaseHandoffV1,
  type ChangeFreezeV1,
  type EvidenceCompletenessReportV1,
  type EvidenceRefV1,
  type FeedbackRecordV1,
  type MetricCatalogV1,
  type OperationsEvidenceDocumentV1,
  type ProofDailyRecordV1,
  type ProofExitDecisionV1,
  type ProofExceptionV1,
  type ProofIncidentV1,
  type ProofWeeklySignoffV1,
  type ProofWindowEntryV1,
  type StageReadinessV1,
  type TrainingAttestationV1,
} from "../contracts";
import {
  OperationsEvidenceCompatibilityError,
  parseOperationsEvidenceDocumentV1,
  type OperationsEvidenceClock,
  type OperationsEvidenceErrorCode,
} from "../consumerSdk";
import type {
  CanonicalHumanOwnerContextV1,
  CapabilityEpochResetV1,
  DailyMetricEvidenceBindingV1,
  DerivedOperationsEvidenceStateV2,
  EvidenceIndex,
  G2EffectAuthorityGrantV1,
  HardZeroMetricKey,
  LuzioneOperationsEvidenceLedgerManifestV2,
  LuzioneOperationsEvidenceLedgerV2,
  OperationsEvidenceLedgerEntryV2,
  OperationsEvidenceLedgerPriorSetV2,
  ParsedOperationsEvidenceLedgerV2,
} from "./contracts";
import {
  OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_MANIFEST_VERSION,
  OPERATIONS_EVIDENCE_LEDGER_VERSION,
} from "./contracts";
import {
  HARD_ZERO_METRIC_KEYS,
  OPS_CORRECTION_ASSURANCE,
  OPS_LEDGER_LIMITS,
  OPS_LEDGER_SCHEMA_KEYS,
  OWNER_FUNCTIONS_BY_ROLE,
  REQUIRED_PROOF_ENTRY_G2_EFFECTS,
  STAGE_G2_EFFECT,
} from "./rules";

type JsonObject = Record<string, unknown>;
type ParsedDocuments = ReadonlyMap<string, OperationsEvidenceDocumentV1>;

export type OperationsEvidenceLedgerParseContextV2 = {
  assessmentTime: string;
  priorSet?: OperationsEvidenceLedgerPriorSetV2;
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function calculateContentDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function calculateRecordSetDigest(entries: readonly OperationsEvidenceLedgerEntryV2[]): string {
  const identities = entries.map((entry) => ({
    contentDigest: entry.contentDigest,
    documentId: documentIdentity(entry.document),
  })).sort((left, right) => left.documentId.localeCompare(right.documentId));
  return calculateContentDigest(identities);
}

export function calculateLedgerDigest(ledger: Omit<LuzioneOperationsEvidenceLedgerV2, "ledgerDigest">): string {
  return calculateContentDigest({
    ...ledger,
    authorityGrants: [...ledger.authorityGrants].sort((left, right) => left.grantId.localeCompare(right.grantId)),
    capabilityEpochResets: [...ledger.capabilityEpochResets].sort((left, right) => left.resetId.localeCompare(right.resetId)),
    dailyMetricBindings: [...ledger.dailyMetricBindings].sort((left, right) => left.dailyRecordId.localeCompare(right.dailyRecordId)),
    entries: [...ledger.entries].sort((left, right) => documentIdentity(left.document).localeCompare(documentIdentity(right.document))),
    ownerContexts: [...ledger.ownerContexts].sort((left, right) => `${left.ownerId}:${left.function}`.localeCompare(`${right.ownerId}:${right.function}`)),
  });
}

export function sealOperationsEvidenceLedgerV2(
  ledger: Omit<LuzioneOperationsEvidenceLedgerV2, "ledgerDigest" | "recordSetDigest">,
): LuzioneOperationsEvidenceLedgerV2 {
  const entries = ledger.entries.map((entry) => ({
    contentDigest: calculateContentDigest(entry.document),
    document: entry.document,
  }));
  const recordSetDigest = calculateRecordSetDigest(entries);
  const withoutDigest: Omit<LuzioneOperationsEvidenceLedgerV2, "ledgerDigest"> = {
    ...ledger,
    entries,
    recordSetDigest,
  };
  return { ...withoutDigest, ledgerDigest: calculateLedgerDigest(withoutDigest) };
}

export function parseOperationsEvidenceLedgerV2(
  value: unknown,
  context: OperationsEvidenceLedgerParseContextV2,
): ParsedOperationsEvidenceLedgerV2 {
  const raw = exact(value, OPS_LEDGER_SCHEMA_KEYS.ledger, "operationsEvidenceLedger");
  literal(raw.contractVersion, OPERATIONS_EVIDENCE_LEDGER_VERSION, "operationsEvidenceLedger.contractVersion", "OPS_WRONG_VERSION");
  literal(raw.effectAuthority, "NO_EFFECT", "operationsEvidenceLedger.effectAuthority");
  const ledgerId = id(raw.ledgerId, "operationsEvidenceLedger.ledgerId");
  const tenantId = id(raw.tenantId, "operationsEvidenceLedger.tenantId");
  const assessmentTime = timestamp(raw.assessmentTime, "operationsEvidenceLedger.assessmentTime");
  if (assessmentTime !== timestamp(context.assessmentTime, "context.assessmentTime")) {
    mismatch("Ledger assessmentTime must exactly match the explicit consumer clock.");
  }
  const entries = parseEntries(raw.entries, { assessmentTime }, tenantId);
  const recordSetDigest = sha(raw.recordSetDigest, "operationsEvidenceLedger.recordSetDigest");
  if (calculateRecordSetDigest(entries.list) !== recordSetDigest) manifestDrift("Record-set digest mismatch.");
  validatePriorSet(entries.list, ledgerId, tenantId, raw.priorRecordSetDigest, context.priorSet);
  validateSupersession(entries.documents);

  const evidence = indexEvidence(entries.documents, tenantId);
  const ownerContexts = parseOwnerContexts(raw.ownerContexts, tenantId, evidence);
  const ownerIndex = indexOwners(ownerContexts);
  validateRecordEvidenceAndOwners(entries.documents, evidence, ownerIndex, tenantId);

  const authorityGrants = parseAuthorityGrants(raw.authorityGrants, tenantId, assessmentTime, evidence, ownerIndex);
  const epochResets = parseEpochResets(raw.capabilityEpochResets, tenantId, assessmentTime, entries.documents, evidence);
  const dailyMetricBindings = parseDailyMetricBindings(raw.dailyMetricBindings, entries.documents, evidence);
  const derived = deriveDecisionState(entries.documents, evidence, ownerIndex, authorityGrants, epochResets, dailyMetricBindings, assessmentTime);

  const ledgerWithoutDigest: Omit<LuzioneOperationsEvidenceLedgerV2, "ledgerDigest"> = {
    assessmentTime,
    authorityGrants,
    capabilityEpochResets: epochResets,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_VERSION,
    dailyMetricBindings,
    effectAuthority: "NO_EFFECT",
    entries: entries.list,
    ledgerId,
    ownerContexts,
    priorRecordSetDigest: raw.priorRecordSetDigest === null ? null : sha(raw.priorRecordSetDigest, "operationsEvidenceLedger.priorRecordSetDigest"),
    recordSetDigest,
    tenantId,
  };
  const ledgerDigest = sha(raw.ledgerDigest, "operationsEvidenceLedger.ledgerDigest");
  if (calculateLedgerDigest(ledgerWithoutDigest) !== ledgerDigest) manifestDrift("Ledger digest mismatch.");
  return { derived, ledger: { ...ledgerWithoutDigest, ledgerDigest } };
}

export function parseLuzioneOperationsEvidenceLedgerManifestV2(
  value: unknown,
  expectedCandidateSha?: string,
): LuzioneOperationsEvidenceLedgerManifestV2 {
  const input = exact(value, [
    "artifacts", "assuranceFingerprintSha256", "baseRecordBundleVersion", "candidateSha", "compatibility",
    "controllerAuthority", "effectAuthority", "ledgerVersion", "productionReady", "runtimeActivation", "schemaVersion",
  ], "operationsEvidenceLedgerManifest");
  literal(input.schemaVersion, OPERATIONS_EVIDENCE_LEDGER_MANIFEST_VERSION, "manifest.schemaVersion", "OPS_WRONG_VERSION");
  literal(input.ledgerVersion, OPERATIONS_EVIDENCE_LEDGER_VERSION, "manifest.ledgerVersion", "OPS_WRONG_VERSION");
  literal(input.baseRecordBundleVersion, "LuzioneOperationsEvidence/v1", "manifest.baseRecordBundleVersion");
  literal(input.effectAuthority, "NO_EFFECT", "manifest.effectAuthority");
  literal(input.runtimeActivation, "NOT_IMPLEMENTED", "manifest.runtimeActivation");
  literal(input.productionReady, false, "manifest.productionReady");
  literal(input.assuranceFingerprintSha256, OPS_CORRECTION_ASSURANCE.fingerprintSha256, "manifest.assuranceFingerprintSha256", "OPS_MANIFEST_DRIFT");
  sha(input.controllerAuthority, "manifest.controllerAuthority", 40);
  const candidateSha = sha(input.candidateSha, "manifest.candidateSha", 40);
  if (expectedCandidateSha && candidateSha !== expectedCandidateSha) manifestDrift("Manifest candidate SHA mismatch.");
  const compatibility = exact(input.compatibility, [
    "decisionBearingV1UseProhibited", "exactFieldSets", "priorSetRequiredAfterGenesis", "unknownVersionsRejected",
  ], "manifest.compatibility");
  for (const [key, item] of Object.entries(compatibility)) literal(item, true, `manifest.compatibility.${key}`);
  const artifacts = exact(input.artifacts, [
    "l2ConsumerPacket", "l3ConsumerPacket", "ruleSource", "schemaBundle", "semanticFixtures", "strictConsumerSdk",
  ], "manifest.artifacts");
  for (const [key, item] of Object.entries(artifacts)) id(item, `manifest.artifacts.${key}`);
  return input as unknown as LuzioneOperationsEvidenceLedgerManifestV2;
}

function parseEntries(value: unknown, clock: OperationsEvidenceClock, tenantId: string): {
  documents: ParsedDocuments;
  list: OperationsEvidenceLedgerEntryV2[];
} {
  const rawEntries = array(value, "operationsEvidenceLedger.entries");
  if (rawEntries.length === 0) missingEvidence("Ledger requires at least one content-bound document.");
  const rawById = new Map<string, OperationsEvidenceDocumentV1>();
  const list = rawEntries.map((item, index) => {
    const entry = exact(item, OPS_LEDGER_SCHEMA_KEYS.entry, `entries[${index}]`);
    const document = object(entry.document, `entries[${index}].document`) as unknown as OperationsEvidenceDocumentV1;
    const contentDigest = sha(entry.contentDigest, `entries[${index}].contentDigest`);
    if (calculateContentDigest(document) !== contentDigest) manifestDrift(`entries[${index}] content digest mismatch.`);
    const identity = documentIdentity(document);
    if (rawById.has(identity)) supersession(`Duplicate document identity ${identity}.`);
    rawById.set(identity, document);
    return { contentDigest, document };
  });

  const parsed = new Map<string, OperationsEvidenceDocumentV1>();
  for (const [identity, document] of rawById) {
    if (document.contractVersion === OPERATIONS_EVIDENCE_VERSIONS.stageReadiness) continue;
    parsed.set(identity, parseOperationsEvidenceDocumentV1(document, clock));
  }
  for (const [identity, document] of rawById) {
    if (document.contractVersion !== OPERATIONS_EVIDENCE_VERSIONS.stageReadiness) continue;
    const payload = object(document.payload, `${identity}.payload`);
    const capacity = requireVersion(parsed, id(payload.capacityObservationId, `${identity}.capacityObservationId`), OPERATIONS_EVIDENCE_VERSIONS.capacityObservation) as CapacityObservationV1;
    const changeFreeze = requireVersion(parsed, id(payload.changeFreezeId, `${identity}.changeFreezeId`), OPERATIONS_EVIDENCE_VERSIONS.changeFreeze) as ChangeFreezeV1;
    const handoffs = stringArray(payload.handoffRecordIds, `${identity}.handoffRecordIds`).map((recordId) =>
      requireVersion(parsed, recordId, OPERATIONS_EVIDENCE_VERSIONS.caseHandoff) as CaseHandoffV1);
    const trainings = stringArray(payload.trainingRecordIds, `${identity}.trainingRecordIds`).map((recordId) =>
      requireVersion(parsed, recordId, OPERATIONS_EVIDENCE_VERSIONS.trainingAttestation) as TrainingAttestationV1);
    parsed.set(identity, parseOperationsEvidenceDocumentV1(document, clock, { capacity, changeFreeze, handoffs, trainings }));
  }
  for (const document of parsed.values()) {
    if (document.tenantId !== tenantId) mismatch(`${documentIdentity(document)} tenant does not match ledger tenant.`);
  }
  return { documents: parsed, list };
}

function validatePriorSet(
  current: readonly OperationsEvidenceLedgerEntryV2[],
  ledgerId: string,
  tenantId: string,
  claimedPriorDigest: unknown,
  prior?: OperationsEvidenceLedgerPriorSetV2,
): void {
  if (!prior) {
    if (claimedPriorDigest !== null) supersession("Genesis ledger must use null priorRecordSetDigest.");
    return;
  }
  if (prior.ledgerId !== ledgerId || prior.tenantId !== tenantId) supersession("Prior set must have the same ledger and tenant identity.");
  const computedPrior = calculateRecordSetDigest(prior.entries);
  if (prior.recordSetDigest !== computedPrior || claimedPriorDigest !== computedPrior) supersession("Prior-set digest mismatch.");
  const currentById = new Map(current.map((entry) => [documentIdentity(entry.document), entry]));
  for (const priorEntry of prior.entries) {
    const identity = documentIdentity(priorEntry.document);
    const currentEntry = currentById.get(identity);
    if (!currentEntry || currentEntry.contentDigest !== priorEntry.contentDigest
      || calculateContentDigest(currentEntry.document) !== calculateContentDigest(priorEntry.document)) {
      supersession(`Prior document ${identity} was removed or overwritten.`);
    }
  }
}

function validateSupersession(documents: ParsedDocuments): void {
  const childByParent = new Map<string, string>();
  const edges = new Map<string, string>();
  for (const [recordId, document] of documents) {
    if (isEvidenceRef(document)) continue;
    const prior = document.supersedesRecordId;
    if (prior === null) continue;
    const target = documents.get(prior);
    if (!target || isEvidenceRef(target)) supersession(`${recordId} supersedes nonexistent record ${prior}.`);
    if (target.tenantId !== document.tenantId || target.contractVersion !== document.contractVersion) {
      supersession(`${recordId} must supersede a same-tenant, same-contract record.`);
    }
    if (childByParent.has(prior)) supersession(`${prior} has multiple supersession children (fork).`);
    childByParent.set(prior, recordId);
    edges.set(recordId, prior);
  }
  for (const recordId of edges.keys()) {
    const seen = new Set<string>();
    let cursor: string | undefined = recordId;
    while (cursor) {
      if (seen.has(cursor)) supersession(`Supersession cycle detected at ${cursor}.`);
      seen.add(cursor);
      cursor = edges.get(cursor);
    }
  }
}

function indexEvidence(documents: ParsedDocuments, tenantId: string): EvidenceIndex {
  const evidence = new Map<string, EvidenceRefV1>();
  for (const document of documents.values()) {
    if (!isEvidenceRef(document)) continue;
    if (document.tenantId !== tenantId) mismatch(`Evidence ${document.evidenceRefId} has foreign tenant.`);
    evidence.set(document.evidenceRefId, document);
  }
  return evidence;
}

function parseOwnerContexts(value: unknown, tenantId: string, evidence: EvidenceIndex): CanonicalHumanOwnerContextV1[] {
  const seen = new Set<string>();
  return array(value, "ownerContexts").map((item, index) => {
    const row = exact(item, OPS_LEDGER_SCHEMA_KEYS.ownerContext, `ownerContexts[${index}]`);
    literal(row.contractVersion, OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.humanOwnerContext, `ownerContexts[${index}].contractVersion`, "OPS_WRONG_VERSION");
    literal(row.tenantId, tenantId, `ownerContexts[${index}].tenantId`, "OPS_REFERENCE_MISMATCH");
    literal(row.principalType, "HUMAN", `ownerContexts[${index}].principalType`, "OPS_AUTHORITY_DENIED");
    literal(row.membershipState, "ACTIVE", `ownerContexts[${index}].membershipState`, "OPS_AUTHORITY_DENIED");
    const ownerId = humanId(row.ownerId, `ownerContexts[${index}].ownerId`);
    const role = enumeration(row.role, ["FOUNDER", "IREM"], `ownerContexts[${index}].role`);
    const fn = enumeration(row.function, ["FOUNDER", "PLATFORM_OPERATIONS", "SUPPORT_OPERATIONS"], `ownerContexts[${index}].function`);
    if (!(OWNER_FUNCTIONS_BY_ROLE[role] as readonly string[]).includes(fn)) authority(`Owner ${ownerId} function is not canonical for role ${role}.`);
    const authorityEvidenceRefId = id(row.authorityEvidenceRefId, `ownerContexts[${index}].authorityEvidenceRefId`);
    requireEvidence(evidence, authorityEvidenceRefId, "AUTHORITY");
    const identity = `${ownerId}:${fn}`;
    if (seen.has(identity)) authority(`Duplicate canonical owner context ${identity}.`);
    seen.add(identity);
    return { ...row, authorityEvidenceRefId, function: fn, ownerId, role, tenantId } as CanonicalHumanOwnerContextV1;
  });
}

function indexOwners(contexts: readonly CanonicalHumanOwnerContextV1[]): ReadonlyMap<string, CanonicalHumanOwnerContextV1> {
  return new Map(contexts.map((context) => [`${context.ownerId}:${context.function}`, context]));
}

function validateRecordEvidenceAndOwners(
  documents: ParsedDocuments,
  evidence: EvidenceIndex,
  owners: ReadonlyMap<string, CanonicalHumanOwnerContextV1>,
  tenantId: string,
): void {
  for (const document of documents.values()) {
    if (isEvidenceRef(document)) continue;
    requireOwner(owners, document.accountableOwner);
    for (const embedded of document.evidenceRefs) {
      const supplied = requireEvidence(evidence, embedded.evidenceRefId);
      if (calculateContentDigest(supplied) !== calculateContentDigest(embedded)) mismatch(`${document.recordId} embeds evidence that differs from supplied ${embedded.evidenceRefId}.`);
    }
    validatePayloadReferences(document, documents, evidence, owners, tenantId);
  }
}

function validatePayloadReferences(
  document: Exclude<OperationsEvidenceDocumentV1, EvidenceRefV1>,
  documents: ParsedDocuments,
  evidence: EvidenceIndex,
  owners: ReadonlyMap<string, CanonicalHumanOwnerContextV1>,
  tenantId: string,
): void {
  switch (document.contractVersion) {
    case OPERATIONS_EVIDENCE_VERSIONS.metricCatalog: {
      const p = (document as MetricCatalogV1).payload;
      for (const metric of p.metrics) requireOwnerId(owners, metric.ownerId);
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord: {
      const p = (document as ProofDailyRecordV1).payload;
      for (const coverage of p.capabilityCoverage) {
        requireOwnerId(owners, coverage.ownerId);
        coverage.evidenceRefIds.forEach((ref) => requireEvidence(evidence, ref));
      }
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.proofWeeklySignoff: {
      const p = (document as ProofWeeklySignoffV1).payload;
      p.dailyRecordIds.forEach((recordId) => requireVersion(documents, recordId, OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord));
      if (p.signedBy) requireOwnerId(owners, p.signedBy);
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.capabilityWindowLedger: {
      const p = (document as CapabilityWindowLedgerV1).payload;
      p.dailyRecordIds.forEach((recordId) => requireVersion(documents, recordId, OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord));
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.evidenceCompletenessReport: {
      const p = (document as EvidenceCompletenessReportV1).payload;
      p.coverageOwnerIds.forEach((ownerId) => requireOwnerId(owners, ownerId));
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.proofException: {
      const p = (document as ProofExceptionV1).payload;
      if (p.approvalEvidenceRefId) requireEvidence(evidence, p.approvalEvidenceRefId, "AUTHORITY");
      if (p.approvedBy) requireOwnerId(owners, p.approvedBy);
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.proofIncident: {
      const p = (document as ProofIncidentV1).payload;
      p.readbackEvidenceRefIds.forEach((ref) => requireEvidence(evidence, ref, "SOURCE_READBACK"));
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.proofExitDecision: {
      const p = (document as ProofExitDecisionV1).payload;
      requireOwnerId(owners, p.decisionBy);
      if (p.managedRecoveryEvidenceRefId) requireEvidence(evidence, p.managedRecoveryEvidenceRefId, "RECOVERY");
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.caseHandoff: {
      const p = (document as CaseHandoffV1).payload;
      requireOwnerId(owners, p.fromOwnerId);
      requireOwnerId(owners, p.toOwnerId);
      if (p.acceptedBy) requireOwnerId(owners, p.acceptedBy);
      p.summaryEvidenceRefIds.forEach((ref) => requireEvidence(evidence, ref, "HANDOFF"));
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.trainingAttestation: {
      const p = (document as TrainingAttestationV1).payload;
      requireOwnerId(owners, p.traineeOwnerId);
      p.assessmentEvidenceRefIds.forEach((ref) => requireEvidence(evidence, ref, "TRAINING"));
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.feedbackRecord: {
      const p = (document as FeedbackRecordV1).payload;
      requireOwnerId(owners, p.submittedBy);
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.changeFreeze: {
      const p = (document as ChangeFreezeV1).payload;
      requireOwnerId(owners, p.approvedBy);
      requireEvidence(evidence, p.approvalEvidenceRefId, "AUTHORITY");
      break;
    }
    case OPERATIONS_EVIDENCE_VERSIONS.stageReadiness: {
      const p = (document as StageReadinessV1).payload;
      requireVersion(documents, p.capacityObservationId, OPERATIONS_EVIDENCE_VERSIONS.capacityObservation);
      requireVersion(documents, p.changeFreezeId, OPERATIONS_EVIDENCE_VERSIONS.changeFreeze);
      p.handoffRecordIds.forEach((id) => requireVersion(documents, id, OPERATIONS_EVIDENCE_VERSIONS.caseHandoff));
      p.trainingRecordIds.forEach((id) => requireVersion(documents, id, OPERATIONS_EVIDENCE_VERSIONS.trainingAttestation));
      break;
    }
    default:
      break;
  }
  if (document.tenantId !== tenantId) mismatch(`${document.recordId} has a foreign tenant.`);
}

function parseAuthorityGrants(
  value: unknown,
  tenantId: string,
  assessmentTime: string,
  evidence: EvidenceIndex,
  owners: ReadonlyMap<string, CanonicalHumanOwnerContextV1>,
): G2EffectAuthorityGrantV1[] {
  const grantIds = new Set<string>();
  const actions = new Set<string>();
  const evidenceIds = new Set<string>();
  return array(value, "authorityGrants").map((item, index) => {
    const row = exact(item, OPS_LEDGER_SCHEMA_KEYS.authorityGrant, `authorityGrants[${index}]`);
    literal(row.contractVersion, OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.authorityGrant, `authorityGrants[${index}].contractVersion`, "OPS_WRONG_VERSION");
    literal(row.tenantId, tenantId, `authorityGrants[${index}].tenantId`, "OPS_REFERENCE_MISMATCH");
    literal(row.signerFunction, "FOUNDER", `authorityGrants[${index}].signerFunction`, "OPS_AUTHORITY_DENIED");
    literal(row.state, "GRANTED", `authorityGrants[${index}].state`, "OPS_AUTHORITY_DENIED");
    const grantId = id(row.grantId, `authorityGrants[${index}].grantId`);
    const actionId = id(row.actionId, `authorityGrants[${index}].actionId`);
    const authorityEvidenceRefId = id(row.authorityEvidenceRefId, `authorityGrants[${index}].authorityEvidenceRefId`);
    const signerOwnerId = humanId(row.signerOwnerId, `authorityGrants[${index}].signerOwnerId`);
    requireOwnerId(owners, signerOwnerId, "FOUNDER");
    requireEvidence(evidence, authorityEvidenceRefId, "AUTHORITY");
    const grantedAt = timestamp(row.grantedAt, `authorityGrants[${index}].grantedAt`);
    const expiresAt = timestamp(row.expiresAt, `authorityGrants[${index}].expiresAt`);
    if (grantedAt > assessmentTime || expiresAt < assessmentTime || expiresAt <= grantedAt) authority(`G2 grant ${grantId} is stale or not yet valid.`);
    const requirement = REQUIRED_PROOF_ENTRY_G2_EFFECTS.find((candidate) => candidate.actionId === actionId);
    if (!requirement || row.effect !== requirement.effect || row.requestedStage !== requirement.requestedStage) {
      authority(`G2 grant ${grantId} is not bound to an exact canonical action/stage/effect.`);
    }
    if (grantIds.has(grantId) || actions.has(actionId) || evidenceIds.has(authorityEvidenceRefId)) authority("G2 grants must be distinct per effect, action, and AUTHORITY evidence.");
    grantIds.add(grantId); actions.add(actionId); evidenceIds.add(authorityEvidenceRefId);
    return { ...row, actionId, authorityEvidenceRefId, expiresAt, grantId, grantedAt, signerOwnerId, tenantId } as G2EffectAuthorityGrantV1;
  });
}

function parseEpochResets(
  value: unknown,
  tenantId: string,
  assessmentTime: string,
  documents: ParsedDocuments,
  evidence: EvidenceIndex,
): CapabilityEpochResetV1[] {
  const resets = array(value, "capabilityEpochResets").map((item, index) => {
    const row = exact(item, OPS_LEDGER_SCHEMA_KEYS.capabilityEpochReset, `capabilityEpochResets[${index}]`);
    literal(row.contractVersion, OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.capabilityEpochReset, `capabilityEpochResets[${index}].contractVersion`, "OPS_WRONG_VERSION");
    literal(row.tenantId, tenantId, `capabilityEpochResets[${index}].tenantId`, "OPS_REFERENCE_MISMATCH");
    const resetId = id(row.resetId, `capabilityEpochResets[${index}].resetId`);
    const capabilityId = id(row.capabilityId, `capabilityEpochResets[${index}].capabilityId`);
    const incidentRecordId = id(row.incidentRecordId, `capabilityEpochResets[${index}].incidentRecordId`);
    const incident = requireVersion(documents, incidentRecordId, OPERATIONS_EVIDENCE_VERSIONS.proofIncident) as ProofIncidentV1;
    if (!incident.payload.resetCapabilityEpoch || !incident.payload.capabilityIds.includes(capabilityId)) mismatch(`Reset ${resetId} does not match its incident capability.`);
    const recoveryEvidenceRefId = id(row.recoveryEvidenceRefId, `capabilityEpochResets[${index}].recoveryEvidenceRefId`);
    requireEvidence(evidence, recoveryEvidenceRefId, "RECOVERY");
    const effectiveDate = dateOnly(row.effectiveDate, `capabilityEpochResets[${index}].effectiveDate`);
    if (effectiveDate > assessmentTime.slice(0, 10) || effectiveDate < incident.payload.openedAt.slice(0, 10)) clockInvalid(`Reset ${resetId} effective date is outside the incident/assessment interval.`);
    const priorEpochId = id(row.priorEpochId, `capabilityEpochResets[${index}].priorEpochId`);
    const newEpochId = id(row.newEpochId, `capabilityEpochResets[${index}].newEpochId`);
    if (priorEpochId === newEpochId) mismatch(`Reset ${resetId} must advance the capability epoch.`);
    return { ...row, capabilityId, effectiveDate, incidentRecordId, newEpochId, priorEpochId, recoveryEvidenceRefId, resetId, tenantId } as CapabilityEpochResetV1;
  });
  const resetIds = new Set<string>();
  const nextEpochs = new Set<string>();
  for (const reset of resets.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))) {
    if (resetIds.has(reset.resetId) || nextEpochs.has(`${reset.capabilityId}:${reset.newEpochId}`)) mismatch("Capability epoch reset identities must be unique.");
    resetIds.add(reset.resetId); nextEpochs.add(`${reset.capabilityId}:${reset.newEpochId}`);
  }
  for (const document of documents.values()) {
    if (document.contractVersion !== OPERATIONS_EVIDENCE_VERSIONS.proofIncident || !document.payload.resetCapabilityEpoch) continue;
    for (const capabilityId of document.payload.capabilityIds) {
      if (!resets.some((reset) => reset.incidentRecordId === document.recordId && reset.capabilityId === capabilityId)) {
        mismatch(`Reset incident ${document.recordId} lacks exact capability epoch reset evidence.`);
      }
    }
  }
  return resets;
}

function parseDailyMetricBindings(
  value: unknown,
  documents: ParsedDocuments,
  evidence: EvidenceIndex,
): DailyMetricEvidenceBindingV1[] {
  const bindings = array(value, "dailyMetricBindings").map((item, index) => {
    const row = exact(item, OPS_LEDGER_SCHEMA_KEYS.dailyMetricBinding, `dailyMetricBindings[${index}]`);
    literal(row.contractVersion, OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.dailyMetricBinding, `dailyMetricBindings[${index}].contractVersion`, "OPS_WRONG_VERSION");
    const dailyRecordId = id(row.dailyRecordId, `dailyMetricBindings[${index}].dailyRecordId`);
    const metricCatalogRecordId = id(row.metricCatalogRecordId, `dailyMetricBindings[${index}].metricCatalogRecordId`);
    const completenessReportRecordId = id(row.completenessReportRecordId, `dailyMetricBindings[${index}].completenessReportRecordId`);
    requireVersion(documents, dailyRecordId, OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord);
    requireVersion(documents, metricCatalogRecordId, OPERATIONS_EVIDENCE_VERSIONS.metricCatalog);
    requireVersion(documents, completenessReportRecordId, OPERATIONS_EVIDENCE_VERSIONS.evidenceCompletenessReport);
    const completenessEvidenceRefId = id(row.completenessEvidenceRefId, `dailyMetricBindings[${index}].completenessEvidenceRefId`);
    const telemetryEvidenceRefId = id(row.telemetryEvidenceRefId, `dailyMetricBindings[${index}].telemetryEvidenceRefId`);
    requireEvidence(evidence, completenessEvidenceRefId, "METRIC");
    requireEvidence(evidence, telemetryEvidenceRefId, "METRIC");
    const hardZeros = array(row.hardZeros, `dailyMetricBindings[${index}].hardZeros`).map((item, hardZeroIndex) => {
      const observation = exact(item, OPS_LEDGER_SCHEMA_KEYS.hardZeroObservation, `dailyMetricBindings[${index}].hardZeros[${hardZeroIndex}]`);
      const metricKey = enumeration(observation.metricKey, HARD_ZERO_METRIC_KEYS, `dailyMetricBindings[${index}].hardZeros[${hardZeroIndex}].metricKey`);
      const evidenceRefId = id(observation.evidenceRefId, `dailyMetricBindings[${index}].hardZeros[${hardZeroIndex}].evidenceRefId`);
      requireEvidence(evidence, evidenceRefId, "METRIC");
      return {
        evidenceRefId,
        metricId: id(observation.metricId, `dailyMetricBindings[${index}].hardZeros[${hardZeroIndex}].metricId`),
        metricKey,
        value: nonnegativeInteger(observation.value, `dailyMetricBindings[${index}].hardZeros[${hardZeroIndex}].value`),
      };
    });
    if (hardZeros.length !== HARD_ZERO_METRIC_KEYS.length
      || !sameSet(hardZeros.map((entry) => entry.metricKey), HARD_ZERO_METRIC_KEYS)) {
      missingCoverage("Daily binding must include every hard-zero metric, including P0/P1 auto-close.");
    }
    return {
      completenessEvidenceRefId,
      completenessMetricId: id(row.completenessMetricId, `dailyMetricBindings[${index}].completenessMetricId`),
      completenessReportRecordId,
      contractVersion: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.dailyMetricBinding,
      dailyRecordId,
      hardZeros,
      metricCatalogRecordId,
      telemetryEvidenceRefId,
      telemetryMetricId: id(row.telemetryMetricId, `dailyMetricBindings[${index}].telemetryMetricId`),
    } as DailyMetricEvidenceBindingV1;
  });
  const dailyRecords = [...documents.values()].filter((document) => document.contractVersion === OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord);
  if (bindings.length !== dailyRecords.length || new Set(bindings.map((binding) => binding.dailyRecordId)).size !== bindings.length) {
    missingCoverage("Every daily record requires exactly one metric binding.");
  }
  return bindings;
}

function deriveDecisionState(
  documents: ParsedDocuments,
  evidence: EvidenceIndex,
  owners: ReadonlyMap<string, CanonicalHumanOwnerContextV1>,
  grants: readonly G2EffectAuthorityGrantV1[],
  resets: readonly CapabilityEpochResetV1[],
  bindings: readonly DailyMetricEvidenceBindingV1[],
  assessmentTime: string,
): DerivedOperationsEvidenceStateV2 {
  const dailyCredit: Record<string, 0 | 1> = {};
  for (const binding of bindings) {
    const daily = requireVersion(documents, binding.dailyRecordId, OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord) as ProofDailyRecordV1;
    const report = requireVersion(documents, binding.completenessReportRecordId, OPERATIONS_EVIDENCE_VERSIONS.evidenceCompletenessReport) as EvidenceCompletenessReportV1;
    const catalog = requireVersion(documents, binding.metricCatalogRecordId, OPERATIONS_EVIDENCE_VERSIONS.metricCatalog) as MetricCatalogV1;
    validateDailyBinding(binding, daily, report, catalog, evidence, assessmentTime);
    const hardZerosPass = binding.hardZeros.every((observation) => observation.value === 0);
    const expected: 0 | 1 = daily.payload.telemetryCoverageBps === OPS_LEDGER_LIMITS.requiredTelemetryBps
      && report.payload.calculatedCompletenessBps === OPS_LEDGER_LIMITS.requiredCompletenessBps
      && daily.payload.blockingIncidentCount === 0
      && hardZerosPass ? 1 : 0;
    if (daily.payload.calculatedCredit !== expected || daily.payload.claimedCredit !== expected) formula(`Daily record ${daily.recordId} credit is not evidence-grounded.`);
    dailyCredit[daily.recordId] = expected;
  }

  const weeklyCreditedDays: Record<string, number> = {};
  for (const document of documents.values()) {
    if (document.contractVersion !== OPERATIONS_EVIDENCE_VERSIONS.proofWeeklySignoff) continue;
    const week = document as ProofWeeklySignoffV1;
    const end = addDays(week.payload.weekStart, OPS_LEDGER_LIMITS.weeklyCalendarDays - 1);
    const dates = week.payload.dailyRecordIds.map((recordId) => {
      const daily = requireVersion(documents, recordId, OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord) as ProofDailyRecordV1;
      if (daily.payload.date < week.payload.weekStart || daily.payload.date > end || daily.payload.date > assessmentTime.slice(0, 10)) {
        clockInvalid(`Weekly record ${week.recordId} cites an invalid service date.`);
      }
      return daily.payload.date;
    });
    if (new Set(dates).size !== dates.length) clockInvalid(`Weekly record ${week.recordId} cites duplicate calendar days.`);
    const credited = week.payload.dailyRecordIds.reduce((sum, id) => sum + (dailyCredit[id] ?? 0), 0);
    if (week.payload.creditedDays !== credited) formula(`Weekly record ${week.recordId} credit mismatch.`);
    weeklyCreditedDays[week.recordId] = credited;
  }

  const capabilityCreditedDays: Record<string, number> = {};
  for (const document of documents.values()) {
    if (document.contractVersion !== OPERATIONS_EVIDENCE_VERSIONS.capabilityWindowLedger) continue;
    const capability = document as CapabilityWindowLedgerV1;
    if (capability.payload.dailyRecordIds.length > OPS_LEDGER_LIMITS.maximumCapabilityProofDays) clockInvalid(`Capability ${capability.recordId} exceeds the 30-day maximum.`);
    const latestReset = resets.filter((reset) => reset.capabilityId === capability.payload.capabilityId)
      .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0];
    const dates = capability.payload.dailyRecordIds.map((recordId) => {
      const daily = requireVersion(documents, recordId, OPERATIONS_EVIDENCE_VERSIONS.proofDailyRecord) as ProofDailyRecordV1;
      if (!daily.payload.capabilityCoverage.some((row) => row.capabilityId === capability.payload.capabilityId)) {
        missingCoverage(`Capability ${capability.recordId} cites a day without its coverage.`);
      }
      if (daily.payload.date < capability.payload.windowStart || daily.payload.date > capability.payload.windowEnd
        || daily.payload.date > assessmentTime.slice(0, 10) || (latestReset && daily.payload.date < latestReset.effectiveDate)) {
        clockInvalid(`Capability ${capability.recordId} cites a day outside its active epoch/window.`);
      }
      return daily.payload.date;
    });
    if (new Set(dates).size !== dates.length) clockInvalid(`Capability ${capability.recordId} cites duplicate calendar days.`);
    const credited = capability.payload.dailyRecordIds.reduce((sum, id) => sum + (dailyCredit[id] ?? 0), 0);
    if (capability.payload.creditedDays !== credited || capability.payload.requiredDays !== OPS_LEDGER_LIMITS.maximumCapabilityProofDays) {
      formula(`Capability ${capability.recordId} credited days do not match resolved unique days.`);
    }
    const expectedState = credited === OPS_LEDGER_LIMITS.maximumCapabilityProofDays ? "COMPLETE" : credited === 0 ? "NOT_STARTED" : "OPEN";
    if (capability.payload.state !== "BLOCKED" && capability.payload.state !== expectedState) formula(`Capability ${capability.recordId} state is not derived.`);
    capabilityCreditedDays[capability.recordId] = credited;
  }

  const proofEntryStates: Record<string, "BLOCKED" | "READY"> = {};
  const requiredGrantSet = REQUIRED_PROOF_ENTRY_G2_EFFECTS.map((item) => `${item.actionId}:${item.effect}:${item.requestedStage}`);
  for (const document of documents.values()) {
    if (document.contractVersion !== OPERATIONS_EVIDENCE_VERSIONS.proofWindowEntry) continue;
    const entry = document as ProofWindowEntryV1;
    const structuralReady = entry.payload.activationConeCleared && entry.payload.clearedCapabilityCount === entry.payload.capabilityCount
      && entry.payload.blockingIncidentCount === 0 && entry.payload.g1ReleaseShas.length > 0;
    const suppliedGrantSet = grants.map((grant) => `${grant.actionId}:${grant.effect}:${grant.requestedStage}`);
    const completeAuthorities = sameSet(suppliedGrantSet, requiredGrantSet)
      && approvalsMatch(entry.payload.g2Approvals, grants);
    const expected = structuralReady && completeAuthorities ? "READY" : "BLOCKED";
    if (entry.payload.entryState !== expected) authority(`Proof entry ${entry.recordId} is not backed by the complete distinct G2 effect set.`);
    proofEntryStates[entry.recordId] = expected;
  }

  const stageDecisions: Record<string, "ADVANCE" | "HOLD"> = {};
  for (const document of documents.values()) {
    if (document.contractVersion !== OPERATIONS_EVIDENCE_VERSIONS.stageReadiness) continue;
    const stage = document as StageReadinessV1;
    const targetEffect = STAGE_G2_EFFECT[stage.payload.requestedStage as keyof typeof STAGE_G2_EFFECT];
    const matching = targetEffect === null ? [] : grants.filter((grant) => grant.effect === targetEffect && grant.requestedStage === stage.payload.requestedStage);
    if (targetEffect === null) {
      if (stage.payload.g2Approvals.length !== 0) authority(`Stage ${stage.recordId} carries arbitrary G2 approval for a non-G2 stage.`);
    } else if (matching.length !== 1 || !approvalsMatch(stage.payload.g2Approvals, matching)) {
      authority(`Stage ${stage.recordId} lacks its exact action/stage/effect AUTHORITY grant.`);
    }
    const capacity = requireVersion(documents, stage.payload.capacityObservationId, OPERATIONS_EVIDENCE_VERSIONS.capacityObservation) as CapacityObservationV1;
    const freeze = requireVersion(documents, stage.payload.changeFreezeId, OPERATIONS_EVIDENCE_VERSIONS.changeFreeze) as ChangeFreezeV1;
    const handoffsReady = stage.payload.handoffRecordIds.every((id) => (requireVersion(documents, id, OPERATIONS_EVIDENCE_VERSIONS.caseHandoff) as CaseHandoffV1).payload.state === "ACCEPTED");
    const trainingsReady = stage.payload.trainingRecordIds.every((id) => {
      const training = requireVersion(documents, id, OPERATIONS_EVIDENCE_VERSIONS.trainingAttestation) as TrainingAttestationV1;
      return training.payload.status === "CURRENT" && training.payload.expiresAt >= assessmentTime;
    });
    const currentIndex = CUSTOMER_ZERO_STAGES.indexOf(stage.payload.currentStage);
    const targetIndex = CUSTOMER_ZERO_STAGES.indexOf(stage.payload.requestedStage);
    const expected = targetIndex === currentIndex + 1 && stage.payload.coverageComplete && stage.payload.evidenceComplete
      && capacity.payload.admissionAllowed && !capacity.payload.overrun && freeze.payload.state === "FROZEN"
      && handoffsReady && trainingsReady && (targetEffect === null || matching.length === 1)
      && stage.payload.blockingReasons.length === 0 ? "ADVANCE" : "HOLD";
    if (stage.payload.calculatedDecision !== expected || stage.payload.claimedDecision !== expected) formula(`Stage ${stage.recordId} decision is not derived.`);
    stageDecisions[stage.recordId] = expected;
  }

  const exitDecisions: Record<string, "BLOCKED" | "PASS"> = {};
  const capabilityValues = Object.values(capabilityCreditedDays);
  const allCapabilitiesComplete = capabilityValues.length > 0 && capabilityValues.every((days) => days === OPS_LEDGER_LIMITS.maximumCapabilityProofDays);
  const minimumCreditedDays = capabilityValues.length === 0 ? 0 : Math.min(...capabilityValues);
  const allHardZerosPass = bindings.every((binding) => binding.hardZeros.every((item) => item.value === 0));
  for (const document of documents.values()) {
    if (document.contractVersion !== OPERATIONS_EVIDENCE_VERSIONS.proofExitDecision) continue;
    const exit = document as ProofExitDecisionV1;
    const recovery = exit.payload.managedRecoveryEvidenceRefId
      ? requireEvidence(evidence, exit.payload.managedRecoveryEvidenceRefId, "RECOVERY") : null;
    const openCriticalIncident = [...documents.values()].some((item) => item.contractVersion === OPERATIONS_EVIDENCE_VERSIONS.proofIncident
      && (item.payload.severity === "P0" || item.payload.severity === "P1") && item.payload.state !== "RESOLVED_VERIFIED");
    const canPass = allCapabilitiesComplete && allHardZerosPass && minimumCreditedDays === OPS_LEDGER_LIMITS.maximumCapabilityProofDays
      && recovery !== null && !openCriticalIncident && exit.payload.blockingReasons.length === 0;
    const expected = canPass ? "PASS" : "BLOCKED";
    if (exit.payload.allCapabilitiesComplete !== allCapabilitiesComplete || exit.payload.allHardZerosPass !== allHardZerosPass
      || exit.payload.creditedDays !== minimumCreditedDays || exit.payload.decision !== expected) {
      formula(`Exit ${exit.recordId} is self-asserted rather than derived from resolved evidence.`);
    }
    exitDecisions[exit.recordId] = expected;
  }

  for (const owner of owners.values()) requireEvidence(evidence, owner.authorityEvidenceRefId, "AUTHORITY");
  return { capabilityCreditedDays, dailyCredit, exitDecisions, proofEntryStates, stageDecisions, weeklyCreditedDays };
}

function validateDailyBinding(
  binding: DailyMetricEvidenceBindingV1,
  daily: ProofDailyRecordV1,
  report: EvidenceCompletenessReportV1,
  catalog: MetricCatalogV1,
  evidence: EvidenceIndex,
  assessmentTime: string,
): void {
  if (daily.payload.date > assessmentTime.slice(0, 10)) clockInvalid(`Daily record ${daily.recordId} uses a future service date.`);
  if (report.payload.requiredEvidenceCount < OPS_LEDGER_LIMITS.minimumCompletenessDenominator) formula("Completeness denominator must be at least one in schema and SDK.");
  if (daily.payload.completenessBps !== report.payload.calculatedCompletenessBps) formula(`Daily record ${daily.recordId} is not bound to its exact completeness report.`);
  requireEvidence(evidence, binding.completenessEvidenceRefId, "METRIC");
  requireEvidence(evidence, binding.telemetryEvidenceRefId, "METRIC");
  const completenessMetric = metric(catalog, binding.completenessMetricId);
  const telemetryMetric = metric(catalog, binding.telemetryMetricId);
  if (completenessMetric.formula !== "RATIO_BPS" || completenessMetric.hardZero
    || telemetryMetric.formula !== "RATIO_BPS" || telemetryMetric.hardZero) {
    formula("Completeness and telemetry bindings require non-hard-zero RATIO_BPS metrics.");
  }
  for (const observation of binding.hardZeros) {
    const definition = metric(catalog, observation.metricId);
    if (definition.formula !== "HARD_ZERO" || definition.hardZero !== true) formula(`Metric ${observation.metricId} is not a hard zero.`);
    const expected = observation.metricKey === "p0P1AutoClose"
      ? observation.value
      : daily.payload.hardZeroCounters[observation.metricKey as Exclude<HardZeroMetricKey, "p0P1AutoClose">];
    if (observation.value !== expected) formula(`Hard-zero observation ${observation.metricKey} conflicts with daily record.`);
  }
}

function metric(catalog: MetricCatalogV1, metricId: string): MetricCatalogV1["payload"]["metrics"][number] {
  const value = catalog.payload.metrics.find((item) => item.metricId === metricId);
  if (!value) missingEvidence(`Metric catalog ${catalog.recordId} does not define ${metricId}.`);
  return value;
}

function approvalsMatch(
  approvals: readonly { actionId: string; evidenceRefId: string }[],
  grants: readonly G2EffectAuthorityGrantV1[],
): boolean {
  return sameSet(
    approvals.map((item) => `${item.actionId}:${item.evidenceRefId}`),
    grants.map((item) => `${item.actionId}:${item.authorityEvidenceRefId}`),
  );
}

function documentIdentity(document: OperationsEvidenceDocumentV1): string {
  return isEvidenceRef(document) ? document.evidenceRefId : document.recordId;
}

function isEvidenceRef(document: OperationsEvidenceDocumentV1): document is EvidenceRefV1 {
  return document.contractVersion === OPERATIONS_EVIDENCE_VERSIONS.evidenceRef;
}

function requireVersion(documents: ParsedDocuments, recordId: string, version: string): OperationsEvidenceDocumentV1 {
  const document = documents.get(recordId);
  if (!document || document.contractVersion !== version) mismatch(`Reference ${recordId} must resolve to supplied ${version}.`);
  return document;
}

function requireEvidence(evidence: EvidenceIndex, evidenceRefId: string, artifactKind?: EvidenceRefV1["artifactKind"]): EvidenceRefV1 {
  const value = evidence.get(evidenceRefId);
  if (!value || (artifactKind && value.artifactKind !== artifactKind)) {
    mismatch(`Evidence ${evidenceRefId} must resolve to supplied ${artifactKind ?? "typed"} evidence.`);
  }
  return value;
}

function requireOwner(
  owners: ReadonlyMap<string, CanonicalHumanOwnerContextV1>,
  owner: AccountableOwner,
): CanonicalHumanOwnerContextV1 {
  literal(owner.ownerType, "HUMAN", "accountableOwner.ownerType", "OPS_AUTHORITY_DENIED");
  const context = owners.get(`${owner.ownerId}:${owner.function}`);
  if (!context) authority(`Accountable owner ${owner.ownerId}/${owner.function} is not derived from canonical active human context.`);
  return context;
}

function requireOwnerId(
  owners: ReadonlyMap<string, CanonicalHumanOwnerContextV1>,
  ownerId: string,
  requiredFunction?: CanonicalHumanOwnerContextV1["function"],
): CanonicalHumanOwnerContextV1 {
  humanId(ownerId, "ownerId");
  const contexts = [...owners.values()].filter((context) => context.ownerId === ownerId
    && (!requiredFunction || context.function === requiredFunction));
  if (contexts.length !== 1) authority(`Owner ${ownerId} does not resolve to one canonical active human function.`);
  return contexts[0];
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function exact(value: unknown, keys: readonly string[], label: string): JsonObject {
  const input = object(value, label);
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (!sameSet(actual, expected)) fail("OPS_FIELD_SET_MISMATCH", `${label} exact fields differ.`);
  return input;
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((item, index) => id(item, `${label}[${index}]`));
}

function id(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 3 || value.length > 240) invalid(`${label} must be a bounded exact identifier.`);
  return value;
}

function humanId(value: unknown, label: string): string {
  const result = id(value, label);
  if (/^(?:agent|sultan|model|automation|bot):/i.test(result)) authority(`${label} must identify a human, never an agent.`);
  return result;
}

function sha(value: unknown, label: string, length: 40 | 64 = 64): string {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) invalid(`${label} must be a lowercase ${length}-character digest.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || Number.isNaN(Date.parse(value))) clockInvalid(`${label} must be a millisecond UTC timestamp.`);
  return value;
}

function dateOnly(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) clockInvalid(`${label} must be a real ISO calendar date.`);
  return value;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${label} has an unsupported value.`);
  return value as T;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) invalid(`${label} must be a nonnegative integer.`);
  return value as number;
}

function literal(
  value: unknown,
  expected: unknown,
  label: string,
  code: OperationsEvidenceErrorCode = "OPS_VALUE_INVALID",
): void {
  if (value !== expected) fail(code, `${label} must equal ${String(expected)}.`);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((item, index) => item === [...right].sort()[index]);
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
function supersession(message: string): never { fail("OPS_SUPERSESSION_INVALID", message); }
