import type { ProofIncidentV1, EvidenceRefV1, OperationsEvidenceDocumentV1 } from "../contracts";
import {
  OperationsEvidenceCompatibilityError,
  type OperationsEvidenceErrorCode,
} from "../consumerSdk";
import type {
  CanonicalHumanOwnerContextV1,
  G2EffectAuthorityGrantV1,
} from "../v2/contracts";
import {
  calculateContentDigest,
  parseOperationsEvidenceLedgerV2,
} from "../v2/sdk";
import {
  OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_V3_MANIFEST_VERSION,
  OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
  type CapabilityEpochAnchorV1,
  type CapabilityEpochResetV2,
  type ExactAuthorityRecoverySourceReadbackV1,
  type G2EffectAuthorityGrantV2,
  type HumanAuthoritySourceBindingV1,
  type IncidentRecoverySourceBindingV1,
  type LuzioneOperationsEvidenceLedgerManifestV3,
  type LuzioneOperationsEvidenceLedgerV3,
  type OperationsEvidenceAuthorityRecoverySourceSnapshotV1,
  type OperationsEvidenceLedgerParseContextV3,
  type ParsedOperationsEvidenceLedgerV3,
} from "./contracts";
import {
  OPS_CORRECTION_02_ASSURANCE,
  OPS_LEDGER_V3_SCHEMA_KEYS,
  OWNER_FUNCTIONS_BY_ROLE_V3,
  REQUIRED_G2_SCOPES_V2,
} from "./rules";

type JsonObject = Record<string, unknown>;

export function calculateHumanAuthoritySourceBindingDigest(
  binding: Omit<HumanAuthoritySourceBindingV1, "bindingDigest">,
): string {
  return calculateContentDigest(binding);
}

export function sealHumanAuthoritySourceBindingV1(
  binding: Omit<HumanAuthoritySourceBindingV1, "bindingDigest">,
): HumanAuthoritySourceBindingV1 {
  return { ...binding, bindingDigest: calculateHumanAuthoritySourceBindingDigest(binding) };
}

export function calculateG2EffectAuthorityGrantDigest(
  grant: Omit<G2EffectAuthorityGrantV2, "grantDigest">,
): string {
  return calculateContentDigest(grant);
}

export function sealG2EffectAuthorityGrantV2(
  grant: Omit<G2EffectAuthorityGrantV2, "grantDigest">,
): G2EffectAuthorityGrantV2 {
  return { ...grant, grantDigest: calculateG2EffectAuthorityGrantDigest(grant) };
}

export function calculateIncidentRecoverySourceBindingDigest(
  binding: Omit<IncidentRecoverySourceBindingV1, "bindingDigest">,
): string {
  return calculateContentDigest(binding);
}

export function sealIncidentRecoverySourceBindingV1(
  binding: Omit<IncidentRecoverySourceBindingV1, "bindingDigest">,
): IncidentRecoverySourceBindingV1 {
  return { ...binding, bindingDigest: calculateIncidentRecoverySourceBindingDigest(binding) };
}

export function calculateCapabilityEpochResetDigest(
  reset: Omit<CapabilityEpochResetV2, "resetDigest">,
): string {
  return calculateContentDigest(reset);
}

export function deriveCapabilityEpochResetV2(
  binding: IncidentRecoverySourceBindingV1,
  priorEpoch: CapabilityEpochAnchorV1,
): CapabilityEpochResetV2 {
  if (binding.tenantId !== priorEpoch.tenantId || binding.capabilityId !== priorEpoch.capabilityId) {
    mismatch("Epoch anchor must match the exact incident tenant and capability.");
  }
  const seed = {
    capabilityId: binding.capabilityId,
    effectiveAt: binding.recoveryCompletedAt,
    incidentRecordId: binding.incidentRecordId,
    incidentRecoveryBindingDigest: binding.bindingDigest,
    incidentRecoveryBindingId: binding.bindingId,
    priorEpochId: priorEpoch.epochId,
    priorEpochSequence: priorEpoch.epochSequence,
    tenantId: binding.tenantId,
  };
  const seedDigest = calculateContentDigest(seed);
  const withoutDigest: Omit<CapabilityEpochResetV2, "resetDigest"> = {
    ...seed,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.capabilityEpochReset,
    newEpochId: `epoch:${seedDigest.slice(0, 40)}`,
    newEpochSequence: priorEpoch.epochSequence + 1,
    resetId: `reset:${calculateContentDigest({ ...seed, seedDigest }).slice(0, 40)}`,
  };
  return { ...withoutDigest, resetDigest: calculateCapabilityEpochResetDigest(withoutDigest) };
}

export function calculateOperationsEvidenceLedgerV3Digest(
  ledger: Omit<LuzioneOperationsEvidenceLedgerV3, "ledgerDigest">,
): string {
  return calculateContentDigest({
    ...ledger,
    capabilityEpochResets: [...ledger.capabilityEpochResets].sort((a, b) => a.resetId.localeCompare(b.resetId)),
    g2EffectAuthorityGrants: [...ledger.g2EffectAuthorityGrants].sort((a, b) => a.grantId.localeCompare(b.grantId)),
    humanAuthoritySourceBindings: [...ledger.humanAuthoritySourceBindings].sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
    incidentRecoverySourceBindings: [...ledger.incidentRecoverySourceBindings].sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
  });
}

export function sealOperationsEvidenceLedgerV3(
  ledger: Omit<LuzioneOperationsEvidenceLedgerV3, "ledgerDigest">,
): LuzioneOperationsEvidenceLedgerV3 {
  const withoutDigest: Omit<LuzioneOperationsEvidenceLedgerV3, "ledgerDigest"> = {
    ...ledger,
    capabilityEpochResets: ledger.capabilityEpochResets.map((reset) => sealCapabilityEpochReset(reset)),
    g2EffectAuthorityGrants: ledger.g2EffectAuthorityGrants.map((grant) => sealG2EffectAuthorityGrantV2(without(grant, "grantDigest"))),
    humanAuthoritySourceBindings: ledger.humanAuthoritySourceBindings.map((binding) => sealHumanAuthoritySourceBindingV1(without(binding, "bindingDigest"))),
    incidentRecoverySourceBindings: ledger.incidentRecoverySourceBindings.map((binding) => sealIncidentRecoverySourceBindingV1(without(binding, "bindingDigest"))),
  };
  return { ...withoutDigest, ledgerDigest: calculateOperationsEvidenceLedgerV3Digest(withoutDigest) };
}

export function parseOperationsEvidenceLedgerV3(
  value: unknown,
  context: OperationsEvidenceLedgerParseContextV3,
): ParsedOperationsEvidenceLedgerV3 {
  const raw = exact(value, OPS_LEDGER_V3_SCHEMA_KEYS.ledger, "operationsEvidenceLedgerV3");
  literal(raw.contractVersion, OPERATIONS_EVIDENCE_LEDGER_V3_VERSION, "operationsEvidenceLedgerV3.contractVersion", "OPS_WRONG_VERSION");
  literal(raw.effectAuthority, "NO_EFFECT", "operationsEvidenceLedgerV3.effectAuthority");
  literal(raw.decisionPolicy, "ZERO_CREDIT_PENDING_ASSURANCE_03", "operationsEvidenceLedgerV3.decisionPolicy", "OPS_AUTHORITY_DENIED");
  const assessmentTime = timestamp(raw.assessmentTime, "operationsEvidenceLedgerV3.assessmentTime");
  if (assessmentTime !== timestamp(context.assessmentTime, "context.assessmentTime")) {
    mismatch("Ledger assessment time must match the explicit verifier clock.");
  }
  const tenantId = id(raw.tenantId, "operationsEvidenceLedgerV3.tenantId");
  const ledgerId = id(raw.ledgerId, "operationsEvidenceLedgerV3.ledgerId");
  const credit = exact(raw.creditCeiling, OPS_LEDGER_V3_SCHEMA_KEYS.creditCeiling, "operationsEvidenceLedgerV3.creditCeiling");
  literal(credit.g2, 0, "creditCeiling.g2", "OPS_AUTHORITY_DENIED");
  literal(credit.production, 0, "creditCeiling.production", "OPS_AUTHORITY_DENIED");
  literal(credit.proofDays, 0, "creditCeiling.proofDays", "OPS_AUTHORITY_DENIED");
  const sourcePackets = exact(raw.sourcePackets, OPS_LEDGER_V3_SCHEMA_KEYS.sourcePackets, "operationsEvidenceLedgerV3.sourcePackets");
  literal(sourcePackets.l2, "ABSENT", "sourcePackets.l2", "OPS_AUTHORITY_DENIED");
  literal(sourcePackets.l3, "ABSENT", "sourcePackets.l3", "OPS_AUTHORITY_DENIED");

  const base = parseOperationsEvidenceLedgerV2(raw.baseLedger, {
    assessmentTime,
    priorSet: context.priorSet,
  });
  if (base.ledger.tenantId !== tenantId || base.ledger.ledgerId !== ledgerId) {
    mismatch("The frozen v2 structural ledger must share the v3 tenant and ledger identity.");
  }

  const trusted = parseSourceSnapshot(context.sourceSnapshot, tenantId, assessmentTime);
  const humans = parseHumanBindings(raw.humanAuthoritySourceBindings, tenantId, assessmentTime);
  requireExactTrustedSet(humans, trusted.humanAuthoritySourceBindings, "bindingId", "human authority");
  const humanIndex = new Map(humans.map((binding) => [binding.bindingId, binding]));
  const grants = parseG2Grants(raw.g2EffectAuthorityGrants, tenantId, assessmentTime, humanIndex);
  requireExactTrustedSet(grants, trusted.g2EffectAuthorityGrants, "grantId", "G2 grant");
  const incidents = parseIncidentBindings(raw.incidentRecoverySourceBindings, tenantId, assessmentTime);
  requireExactTrustedSet(incidents, trusted.incidentRecoverySourceBindings, "bindingId", "incident recovery");
  const incidentIndex = new Map(incidents.map((binding) => [binding.bindingId, binding]));
  const resets = parseEpochResets(raw.capabilityEpochResets, tenantId, incidentIndex, context.capabilityEpochAnchors);

  bindV2Owners(base.ledger.ownerContexts, humans, base.ledger.entries.map((entry) => entry.document));
  bindV2Grants(base.ledger.authorityGrants, grants, base.ledger.entries.map((entry) => entry.document));
  bindV2IncidentRecovery(base.ledger.entries.map((entry) => entry.document), incidents, resets);
  bindV2Resets(base.ledger.capabilityEpochResets, resets);

  const withoutDigest: Omit<LuzioneOperationsEvidenceLedgerV3, "ledgerDigest"> = {
    assessmentTime,
    baseLedger: base.ledger,
    capabilityEpochResets: resets,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
    creditCeiling: { g2: 0, production: 0, proofDays: 0 },
    decisionPolicy: "ZERO_CREDIT_PENDING_ASSURANCE_03",
    effectAuthority: "NO_EFFECT",
    g2EffectAuthorityGrants: grants,
    humanAuthoritySourceBindings: humans,
    incidentRecoverySourceBindings: incidents,
    ledgerId,
    sourcePackets: { l2: "ABSENT", l3: "ABSENT" },
    tenantId,
  };
  const ledgerDigest = sha(raw.ledgerDigest, "operationsEvidenceLedgerV3.ledgerDigest");
  if (calculateOperationsEvidenceLedgerV3Digest(withoutDigest) !== ledgerDigest) drift("v3 ledger digest mismatch.");
  return {
    decision: {
      decisionBearingUse: "PROHIBITED_PENDING_ASSURANCE_03_AND_CANONICAL_SOURCES",
      g2Credit: 0,
      productionCredit: 0,
      proofDayCredit: 0,
    },
    ledger: { ...withoutDigest, ledgerDigest },
    structurallyValidatedBaseVersion: "LuzioneOperationsEvidenceLedger/v2",
  };
}

export function parseLuzioneOperationsEvidenceLedgerManifestV3(
  value: unknown,
  expectedCandidateSha?: string,
): LuzioneOperationsEvidenceLedgerManifestV3 {
  const raw = exact(value, [
    "artifacts", "assuranceFingerprintSha256", "baseLedgerVersion", "candidateSha", "compatibility",
    "controllerAuthority", "effectAuthority", "ledgerVersion", "productionReady", "runtimeActivation",
    "schemaVersion", "sourceAvailability", "sourceMapFingerprintSha256",
  ], "operationsEvidenceLedgerManifestV3");
  literal(raw.schemaVersion, OPERATIONS_EVIDENCE_LEDGER_V3_MANIFEST_VERSION, "manifest.schemaVersion", "OPS_WRONG_VERSION");
  literal(raw.ledgerVersion, OPERATIONS_EVIDENCE_LEDGER_V3_VERSION, "manifest.ledgerVersion", "OPS_WRONG_VERSION");
  literal(raw.baseLedgerVersion, "LuzioneOperationsEvidenceLedger/v2", "manifest.baseLedgerVersion");
  literal(raw.controllerAuthority, OPS_CORRECTION_02_ASSURANCE.controllerAuthority, "manifest.controllerAuthority", "OPS_MANIFEST_DRIFT");
  literal(raw.assuranceFingerprintSha256, OPS_CORRECTION_02_ASSURANCE.assuranceFingerprintSha256, "manifest.assuranceFingerprintSha256", "OPS_MANIFEST_DRIFT");
  literal(raw.sourceMapFingerprintSha256, OPS_CORRECTION_02_ASSURANCE.sourceMapFingerprintSha256, "manifest.sourceMapFingerprintSha256", "OPS_MANIFEST_DRIFT");
  literal(raw.effectAuthority, "NO_EFFECT", "manifest.effectAuthority");
  literal(raw.runtimeActivation, "NOT_IMPLEMENTED", "manifest.runtimeActivation");
  literal(raw.productionReady, false, "manifest.productionReady");
  const candidateSha = sha(raw.candidateSha, "manifest.candidateSha", 40);
  if (expectedCandidateSha && candidateSha !== expectedCandidateSha) drift("Manifest candidate SHA mismatch.");
  const compatibility = exact(raw.compatibility, ["decisionBearingV1UseProhibited", "decisionBearingV2UseProhibited", "exactFieldSets", "sourceBindingsRequired", "unknownVersionsRejected"], "manifest.compatibility");
  for (const [key, item] of Object.entries(compatibility)) literal(item, true, `manifest.compatibility.${key}`);
  const availability = exact(raw.sourceAvailability, ["canonicalG2Approval", "canonicalHumanMembership", "incidentBoundRecovery", "resolvedVerifiedIncident"], "manifest.sourceAvailability");
  for (const [key, item] of Object.entries(availability)) literal(item, "ABSENT", `manifest.sourceAvailability.${key}`);
  const artifacts = exact(raw.artifacts, ["l2SourcePacket", "l3SourcePacket", "ruleSource", "schemaBundle", "semanticFixtures", "strictConsumerSdk"], "manifest.artifacts");
  for (const [key, item] of Object.entries(artifacts)) id(item, `manifest.artifacts.${key}`);
  return raw as unknown as LuzioneOperationsEvidenceLedgerManifestV3;
}

function parseSourceSnapshot(
  value: unknown,
  tenantId: string,
  assessmentTime: string,
): OperationsEvidenceAuthorityRecoverySourceSnapshotV1 {
  const raw = exact(value, OPS_LEDGER_V3_SCHEMA_KEYS.sourceSnapshot, "sourceSnapshot");
  literal(raw.contractVersion, OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.sourceSnapshot, "sourceSnapshot.contractVersion", "OPS_WRONG_VERSION");
  literal(raw.tenantId, tenantId, "sourceSnapshot.tenantId", "OPS_REFERENCE_MISMATCH");
  enumeration(raw.resolvedBy, ["LUZIONE_CORE_SERVER", "SYNTHETIC_TEST_HARNESS"], "sourceSnapshot.resolvedBy");
  const snapshotAt = timestamp(raw.snapshotAt, "sourceSnapshot.snapshotAt");
  if (snapshotAt > assessmentTime) clock("Source snapshot cannot be observed after assessment.");
  const humans = parseHumanBindings(raw.humanAuthoritySourceBindings, tenantId, assessmentTime);
  const humanIndex = new Map(humans.map((binding) => [binding.bindingId, binding]));
  const grants = parseG2Grants(raw.g2EffectAuthorityGrants, tenantId, assessmentTime, humanIndex);
  const incidents = parseIncidentBindings(raw.incidentRecoverySourceBindings, tenantId, assessmentTime);
  return {
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.sourceSnapshot,
    g2EffectAuthorityGrants: grants,
    humanAuthoritySourceBindings: humans,
    incidentRecoverySourceBindings: incidents,
    resolvedBy: raw.resolvedBy as OperationsEvidenceAuthorityRecoverySourceSnapshotV1["resolvedBy"],
    snapshotAt,
    tenantId,
  };
}

function parseHumanBindings(value: unknown, tenantId: string, assessmentTime: string): HumanAuthoritySourceBindingV1[] {
  const ids = new Set<string>();
  const subjects = new Set<string>();
  return array(value, "humanAuthoritySourceBindings").map((item, index) => {
    const label = `humanAuthoritySourceBindings[${index}]`;
    const raw = exact(item, OPS_LEDGER_V3_SCHEMA_KEYS.humanBinding, label);
    literal(raw.contractVersion, OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.humanAuthoritySourceBinding, `${label}.contractVersion`, "OPS_WRONG_VERSION");
    literal(raw.tenantId, tenantId, `${label}.tenantId`, "OPS_REFERENCE_MISMATCH");
    literal(raw.principalType, "HUMAN", `${label}.principalType`, "OPS_AUTHORITY_DENIED");
    literal(raw.membershipState, "ACTIVE", `${label}.membershipState`, "OPS_AUTHORITY_DENIED");
    literal(raw.revokedAt, null, `${label}.revokedAt`, "OPS_AUTHORITY_DENIED");
    literal(raw.supersededByBindingId, null, `${label}.supersededByBindingId`, "OPS_AUTHORITY_DENIED");
    const bindingId = id(raw.bindingId, `${label}.bindingId`);
    const issuerSubjectId = genuineHumanId(raw.issuerSubjectId, `${label}.issuerSubjectId`);
    const canonicalRole = enumeration(raw.canonicalRole, ["FOUNDER", "IREM"], `${label}.canonicalRole`);
    const canonicalFunction = enumeration(raw.canonicalFunction, ["FOUNDER", "PLATFORM_OPERATIONS", "SUPPORT_OPERATIONS"], `${label}.canonicalFunction`);
    if (!(OWNER_FUNCTIONS_BY_ROLE_V3[canonicalRole] as readonly string[]).includes(canonicalFunction)) {
      authority(`${label} role/function is not canonical.`);
    }
    const validFrom = timestamp(raw.validFrom, `${label}.validFrom`);
    const validUntil = timestamp(raw.validUntil, `${label}.validUntil`);
    if (validFrom > assessmentTime || validUntil < assessmentTime || validUntil <= validFrom) authority(`${label} membership is stale or not yet valid.`);
    const membershipSource = parseSourceReadback(raw.membershipSource, tenantId, "TENANT_MEMBERSHIP", `${label}.membershipSource`, assessmentTime);
    if (membershipSource.objectId !== issuerSubjectId) mismatch(`${label} membership source must own the exact issuer subject.`);
    const legacyAuthorityEvidenceRefId = id(raw.legacyAuthorityEvidenceRefId, `${label}.legacyAuthorityEvidenceRefId`);
    const withoutDigest: Omit<HumanAuthoritySourceBindingV1, "bindingDigest"> = {
      bindingId, canonicalFunction, canonicalRole,
      contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.humanAuthoritySourceBinding,
      issuerSubjectId, legacyAuthorityEvidenceRefId, membershipSource, membershipState: "ACTIVE", principalType: "HUMAN",
      revokedAt: null, supersededByBindingId: null, tenantId, validFrom, validUntil,
    };
    const bindingDigest = sha(raw.bindingDigest, `${label}.bindingDigest`);
    if (calculateHumanAuthoritySourceBindingDigest(withoutDigest) !== bindingDigest) drift(`${label} digest mismatch.`);
    if (ids.has(bindingId) || subjects.has(`${issuerSubjectId}:${canonicalFunction}`)) authority(`${label} duplicates binding or subject/function identity.`);
    ids.add(bindingId); subjects.add(`${issuerSubjectId}:${canonicalFunction}`);
    return { ...withoutDigest, bindingDigest };
  });
}

function parseG2Grants(
  value: unknown,
  tenantId: string,
  assessmentTime: string,
  humans: ReadonlyMap<string, HumanAuthoritySourceBindingV1>,
): G2EffectAuthorityGrantV2[] {
  const ids = new Set<string>();
  const scopes = new Set<string>();
  const approvals = new Set<string>();
  return array(value, "g2EffectAuthorityGrants").map((item, index) => {
    const label = `g2EffectAuthorityGrants[${index}]`;
    const raw = exact(item, OPS_LEDGER_V3_SCHEMA_KEYS.g2Grant, label);
    literal(raw.contractVersion, OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.g2EffectAuthorityGrant, `${label}.contractVersion`, "OPS_WRONG_VERSION");
    literal(raw.tenantId, tenantId, `${label}.tenantId`, "OPS_REFERENCE_MISMATCH");
    literal(raw.approvalAppendOnly, true, `${label}.approvalAppendOnly`, "OPS_AUTHORITY_DENIED");
    literal(raw.approvalState, "APPROVED", `${label}.approvalState`, "OPS_AUTHORITY_DENIED");
    literal(raw.state, "GRANTED", `${label}.state`, "OPS_AUTHORITY_DENIED");
    literal(raw.revokedAt, null, `${label}.revokedAt`, "OPS_AUTHORITY_DENIED");
    literal(raw.supersededByGrantId, null, `${label}.supersededByGrantId`, "OPS_AUTHORITY_DENIED");
    const grantId = id(raw.grantId, `${label}.grantId`);
    const legacyGrantId = id(raw.legacyGrantId, `${label}.legacyGrantId`);
    const actionId = id(raw.actionId, `${label}.actionId`);
    const requirement = REQUIRED_G2_SCOPES_V2.find((candidate) => candidate.actionId === actionId);
    if (!requirement || raw.effect !== requirement.effect || raw.requestedStage !== requirement.requestedStage) authority(`${label} must bind one exact canonical action/stage/effect scope.`);
    const bindingId = id(raw.humanAuthorityBindingId, `${label}.humanAuthorityBindingId`);
    const binding = humans.get(bindingId);
    if (!binding || binding.canonicalRole !== "FOUNDER" || binding.canonicalFunction !== "FOUNDER") authority(`${label} requires one source-bound founder.`);
    const bindingDigest = sha(raw.humanAuthorityBindingDigest, `${label}.humanAuthorityBindingDigest`);
    if (binding.bindingDigest !== bindingDigest) mismatch(`${label} founder binding digest mismatch.`);
    const issuerSubjectId = genuineHumanId(raw.issuerSubjectId, `${label}.issuerSubjectId`);
    if (issuerSubjectId !== binding.issuerSubjectId) authority(`${label} issuer does not match the source-bound founder.`);
    const issuedAt = timestamp(raw.issuedAt, `${label}.issuedAt`);
    const validFrom = timestamp(raw.validFrom, `${label}.validFrom`);
    const expiresAt = timestamp(raw.expiresAt, `${label}.expiresAt`);
    if (issuedAt > validFrom || validFrom > assessmentTime || expiresAt < assessmentTime || expiresAt <= validFrom) authority(`${label} is expired or has invalid validity ordering.`);
    const approvalSource = parseSourceReadback(raw.approvalSource, tenantId, "G2_APPROVAL", `${label}.approvalSource`, assessmentTime);
    if (approvalSource.readbackAt < issuedAt) clock(`${label} approval readback predates issuance.`);
    const legacyAuthorityEvidenceRefId = id(raw.legacyAuthorityEvidenceRefId, `${label}.legacyAuthorityEvidenceRefId`);
    const withoutDigest: Omit<G2EffectAuthorityGrantV2, "grantDigest"> = {
      actionId, approvalAppendOnly: true, approvalSource, approvalState: "APPROVED",
      contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.g2EffectAuthorityGrant,
      effect: requirement.effect, expiresAt, grantId, humanAuthorityBindingDigest: bindingDigest,
      humanAuthorityBindingId: bindingId, issuedAt, issuerSubjectId, legacyAuthorityEvidenceRefId,
      legacyGrantId, requestedStage: requirement.requestedStage, revokedAt: null, state: "GRANTED",
      supersededByGrantId: null, tenantId, validFrom,
    };
    const grantDigest = sha(raw.grantDigest, `${label}.grantDigest`);
    if (calculateG2EffectAuthorityGrantDigest(withoutDigest) !== grantDigest) drift(`${label} digest mismatch.`);
    const scope = `${actionId}:${requirement.requestedStage}:${requirement.effect}`;
    if (ids.has(grantId) || scopes.has(scope) || approvals.has(approvalSource.objectId)) authority(`${label} bundles or reuses a G2 identity, scope or approval receipt.`);
    ids.add(grantId); scopes.add(scope); approvals.add(approvalSource.objectId);
    return { ...withoutDigest, grantDigest };
  });
}

function parseIncidentBindings(value: unknown, tenantId: string, assessmentTime: string): IncidentRecoverySourceBindingV1[] {
  const ids = new Set<string>();
  const incidents = new Set<string>();
  return array(value, "incidentRecoverySourceBindings").map((item, index) => {
    const label = `incidentRecoverySourceBindings[${index}]`;
    const raw = exact(item, OPS_LEDGER_V3_SCHEMA_KEYS.incidentBinding, label);
    literal(raw.contractVersion, OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.incidentRecoverySourceBinding, `${label}.contractVersion`, "OPS_WRONG_VERSION");
    literal(raw.tenantId, tenantId, `${label}.tenantId`, "OPS_REFERENCE_MISMATCH");
    literal(raw.incidentState, "RESOLVED_VERIFIED", `${label}.incidentState`, "OPS_STATE_INVALID");
    literal(raw.recoveryState, "VERIFIED", `${label}.recoveryState`, "OPS_STATE_INVALID");
    literal(raw.revokedAt, null, `${label}.revokedAt`, "OPS_STATE_INVALID");
    literal(raw.supersededByBindingId, null, `${label}.supersededByBindingId`, "OPS_STATE_INVALID");
    const bindingId = id(raw.bindingId, `${label}.bindingId`);
    const capabilityId = id(raw.capabilityId, `${label}.capabilityId`);
    const incidentRecordId = id(raw.incidentRecordId, `${label}.incidentRecordId`);
    const recoveryIncidentRecordId = id(raw.recoveryIncidentRecordId, `${label}.recoveryIncidentRecordId`);
    if (recoveryIncidentRecordId !== incidentRecordId) mismatch(`${label} recovery receipt is not incident-bound.`);
    const incidentSource = parseSourceReadback(raw.incidentSource, tenantId, "PROOF_INCIDENT", `${label}.incidentSource`, assessmentTime);
    const recoverySource = parseSourceReadback(raw.recoverySource, tenantId, "RECOVERY_RECEIPT", `${label}.recoverySource`, assessmentTime);
    if (incidentSource.objectId !== incidentRecordId) mismatch(`${label} incident source object mismatch.`);
    const openedAt = timestamp(raw.openedAt, `${label}.openedAt`);
    const acknowledgedAt = timestamp(raw.acknowledgedAt, `${label}.acknowledgedAt`);
    const resolvedAt = timestamp(raw.resolvedAt, `${label}.resolvedAt`);
    const recoveryCompletedAt = timestamp(raw.recoveryCompletedAt, `${label}.recoveryCompletedAt`);
    if (!(openedAt <= acknowledgedAt && acknowledgedAt <= resolvedAt && resolvedAt <= incidentSource.readbackAt
      && incidentSource.readbackAt <= recoveryCompletedAt && recoveryCompletedAt <= recoverySource.readbackAt
      && recoverySource.readbackAt <= assessmentTime)) {
      clock(`${label} incident acknowledgement, resolution, readback and recovery ordering is invalid.`);
    }
    const withoutDigest: Omit<IncidentRecoverySourceBindingV1, "bindingDigest"> = {
      acknowledgedAt, bindingId, capabilityId,
      contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.incidentRecoverySourceBinding,
      incidentRecordId, incidentSource, incidentState: "RESOLVED_VERIFIED", openedAt, recoveryCompletedAt,
      recoveryIncidentRecordId, recoverySource, recoveryState: "VERIFIED", resolvedAt, revokedAt: null,
      supersededByBindingId: null, tenantId,
    };
    const bindingDigest = sha(raw.bindingDigest, `${label}.bindingDigest`);
    if (calculateIncidentRecoverySourceBindingDigest(withoutDigest) !== bindingDigest) drift(`${label} digest mismatch.`);
    if (ids.has(bindingId) || incidents.has(incidentRecordId)) mismatch(`${label} duplicates an incident recovery identity.`);
    ids.add(bindingId); incidents.add(incidentRecordId);
    return { ...withoutDigest, bindingDigest };
  });
}

function parseEpochResets(
  value: unknown,
  tenantId: string,
  incidents: ReadonlyMap<string, IncidentRecoverySourceBindingV1>,
  anchorsValue: readonly CapabilityEpochAnchorV1[],
): CapabilityEpochResetV2[] {
  const anchors = anchorsValue.map((item, index) => parseEpochAnchor(item, tenantId, `capabilityEpochAnchors[${index}]`));
  const anchorIndex = new Map<string, CapabilityEpochAnchorV1>();
  for (const anchor of anchors) {
    if (anchorIndex.has(anchor.capabilityId)) mismatch(`Duplicate epoch anchor for ${anchor.capabilityId}.`);
    anchorIndex.set(anchor.capabilityId, anchor);
  }
  const resets = array(value, "capabilityEpochResets").map((item, index) => parseEpochReset(item, tenantId, `capabilityEpochResets[${index}]`));
  const ids = new Set<string>();
  const usedBindings = new Set<string>();
  const byCapability = new Map<string, CapabilityEpochResetV2[]>();
  for (const reset of resets) {
    if (ids.has(reset.resetId) || usedBindings.has(reset.incidentRecoveryBindingId)) mismatch("Epoch reset IDs and incident-recovery bindings are single-use.");
    ids.add(reset.resetId); usedBindings.add(reset.incidentRecoveryBindingId);
    const binding = incidents.get(reset.incidentRecoveryBindingId);
    if (!binding || binding.bindingDigest !== reset.incidentRecoveryBindingDigest) mismatch(`Reset ${reset.resetId} has orphan or drifted recovery binding.`);
    const list = byCapability.get(reset.capabilityId) ?? [];
    list.push(reset); byCapability.set(reset.capabilityId, list);
  }
  for (const [capabilityId, chain] of byCapability) {
    let current = anchorIndex.get(capabilityId);
    if (!current) mismatch(`Capability ${capabilityId} lacks a server-resolved epoch anchor.`);
    const seenEpochs = new Set([current.epochId]);
    for (const reset of [...chain].sort((a, b) => a.newEpochSequence - b.newEpochSequence)) {
      if (reset.priorEpochId !== current.epochId || reset.priorEpochSequence !== current.epochSequence
        || reset.newEpochSequence !== current.epochSequence + 1 || seenEpochs.has(reset.newEpochId)) {
        mismatch(`Capability ${capabilityId} epoch lineage has a gap, fork, cycle or reused successor.`);
      }
      const binding = incidents.get(reset.incidentRecoveryBindingId)!;
      const derived = deriveCapabilityEpochResetV2(binding, current);
      if (canonical(derived) !== canonical(reset)) mismatch(`Reset ${reset.resetId} was not derived server-side from the exact incident and prior epoch.`);
      seenEpochs.add(reset.newEpochId);
      current = { capabilityId, epochId: reset.newEpochId, epochSequence: reset.newEpochSequence, tenantId };
    }
  }
  return resets;
}

function bindV2Owners(
  owners: readonly CanonicalHumanOwnerContextV1[],
  bindings: readonly HumanAuthoritySourceBindingV1[],
  documents: readonly OperationsEvidenceDocumentV1[],
): void {
  if (owners.length !== bindings.length) authority("Every v2 structural owner must have exactly one source-bound v3 human membership.");
  for (const owner of owners) {
    const matches = bindings.filter((binding) => binding.tenantId === owner.tenantId
      && binding.issuerSubjectId === owner.ownerId && binding.canonicalRole === owner.role
      && binding.canonicalFunction === owner.function && binding.legacyAuthorityEvidenceRefId === owner.authorityEvidenceRefId);
    if (matches.length !== 1) authority(`Owner ${owner.ownerId}/${owner.function} does not resolve to exact source membership.`);
    const binding = matches[0];
    const evidence = evidenceById(documents, owner.authorityEvidenceRefId);
    if (binding.membershipSource.readbackId !== evidence.evidenceRefId
      || binding.membershipSource.readbackHash !== evidence.sha256) {
      mismatch(`Owner ${owner.ownerId}/${owner.function} membership readback does not match its exact supplied AUTHORITY evidence.`);
    }
  }
}

function bindV2Grants(
  legacy: readonly G2EffectAuthorityGrantV1[],
  grants: readonly G2EffectAuthorityGrantV2[],
  documents: readonly OperationsEvidenceDocumentV1[],
): void {
  if (legacy.length !== grants.length) authority("Every structural v2 G2 grant must have exactly one source-bound v2 successor grant.");
  for (const prior of legacy) {
    const match = grants.find((grant) => grant.legacyGrantId === prior.grantId);
    if (!match || match.tenantId !== prior.tenantId || match.actionId !== prior.actionId || match.effect !== prior.effect
      || match.requestedStage !== prior.requestedStage || match.issuerSubjectId !== prior.signerOwnerId
      || match.legacyAuthorityEvidenceRefId !== prior.authorityEvidenceRefId) {
      authority(`Legacy G2 grant ${prior.grantId} lacks exact source-bound successor parity.`);
    }
    const evidence = evidenceById(documents, prior.authorityEvidenceRefId);
    if (match.approvalSource.readbackId !== evidence.evidenceRefId || match.approvalSource.readbackHash !== evidence.sha256) {
      mismatch(`G2 grant ${match.grantId} approval readback does not match its exact supplied AUTHORITY evidence.`);
    }
  }
}

function bindV2IncidentRecovery(
  documents: readonly OperationsEvidenceDocumentV1[],
  bindings: readonly IncidentRecoverySourceBindingV1[],
  resets: readonly CapabilityEpochResetV2[],
): void {
  for (const binding of bindings) {
    const incident = documents.find((document) => document.contractVersion === "ProofIncident/v1"
      && "recordId" in document && document.recordId === binding.incidentRecordId) as ProofIncidentV1 | undefined;
    if (!incident || incident.payload.state !== "RESOLVED_VERIFIED" || incident.payload.acknowledgedAt !== binding.acknowledgedAt
      || incident.payload.resolvedAt !== binding.resolvedAt || !incident.payload.capabilityIds.includes(binding.capabilityId)
      || !incident.payload.resetCapabilityEpoch || !incident.payload.readbackEvidenceRefIds.includes(binding.incidentSource.readbackId)) {
      mismatch(`Incident recovery ${binding.bindingId} is not bound to an acknowledged RESOLVED_VERIFIED v2 incident.`);
    }
    const readback = evidenceById(documents, binding.incidentSource.readbackId);
    if (readback.artifactKind !== "SOURCE_READBACK" || readback.sha256 !== binding.incidentSource.readbackHash) {
      mismatch(`Incident recovery ${binding.bindingId} source readback hash/type mismatch.`);
    }
    if (resets.some((reset) => reset.incidentRecoveryBindingId === binding.bindingId)) {
      const recovery = evidenceById(documents, binding.recoverySource.readbackId);
      if (recovery.artifactKind !== "RECOVERY" || recovery.sha256 !== binding.recoverySource.readbackHash) {
        mismatch(`Incident recovery ${binding.bindingId} recovery receipt hash/type mismatch.`);
      }
    }
  }
}

function bindV2Resets(
  legacy: readonly { capabilityId: string; effectiveDate: string; incidentRecordId: string; newEpochId: string; priorEpochId: string; recoveryEvidenceRefId: string; resetId: string; tenantId: string }[],
  resets: readonly CapabilityEpochResetV2[],
): void {
  if (legacy.length !== resets.length) mismatch("Every structural v1 epoch reset must have exactly one verified v2 reset successor.");
  for (const prior of legacy) {
    const match = resets.find((reset) => reset.incidentRecordId === prior.incidentRecordId && reset.capabilityId === prior.capabilityId);
    if (!match || match.tenantId !== prior.tenantId || match.priorEpochId !== prior.priorEpochId
      || match.newEpochId !== prior.newEpochId || match.effectiveAt.slice(0, 10) !== prior.effectiveDate) {
      mismatch(`Legacy reset ${prior.resetId} lacks exact verified v2 successor parity.`);
    }
  }
}

function parseSourceReadback(
  value: unknown,
  tenantId: string,
  objectType: ExactAuthorityRecoverySourceReadbackV1["objectType"],
  label: string,
  assessmentTime: string,
): ExactAuthorityRecoverySourceReadbackV1 {
  const raw = exact(value, OPS_LEDGER_V3_SCHEMA_KEYS.sourceReadback, label);
  literal(raw.tenantId, tenantId, `${label}.tenantId`, "OPS_REFERENCE_MISMATCH");
  literal(raw.objectType, objectType, `${label}.objectType`, "OPS_REFERENCE_MISMATCH");
  const objectId = id(raw.objectId, `${label}.objectId`);
  const objectVersion = id(raw.objectVersion, `${label}.objectVersion`);
  const readbackObjectId = id(raw.readbackObjectId, `${label}.readbackObjectId`);
  const readbackObjectVersion = id(raw.readbackObjectVersion, `${label}.readbackObjectVersion`);
  if (readbackObjectId !== objectId || readbackObjectVersion !== objectVersion) mismatch(`${label} does not read back the exact source object/version.`);
  const readbackAt = timestamp(raw.readbackAt, `${label}.readbackAt`);
  if (readbackAt > assessmentTime) clock(`${label} readback is in the future.`);
  return {
    objectHash: sha(raw.objectHash, `${label}.objectHash`), objectId, objectType, objectVersion, readbackAt,
    readbackHash: sha(raw.readbackHash, `${label}.readbackHash`), readbackId: id(raw.readbackId, `${label}.readbackId`),
    readbackObjectId, readbackObjectVersion,
    sourceSystem: enumeration(raw.sourceSystem, ["LUZIONE_CORE", "LUZIONE_CRM_APP"], `${label}.sourceSystem`),
    tenantId,
  };
}

function parseEpochAnchor(value: unknown, tenantId: string, label: string): CapabilityEpochAnchorV1 {
  const raw = exact(value, OPS_LEDGER_V3_SCHEMA_KEYS.epochAnchor, label);
  literal(raw.tenantId, tenantId, `${label}.tenantId`, "OPS_REFERENCE_MISMATCH");
  return {
    capabilityId: id(raw.capabilityId, `${label}.capabilityId`),
    epochId: id(raw.epochId, `${label}.epochId`),
    epochSequence: nonnegativeInteger(raw.epochSequence, `${label}.epochSequence`),
    tenantId,
  };
}

function parseEpochReset(value: unknown, tenantId: string, label: string): CapabilityEpochResetV2 {
  const raw = exact(value, OPS_LEDGER_V3_SCHEMA_KEYS.epochReset, label);
  literal(raw.contractVersion, OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.capabilityEpochReset, `${label}.contractVersion`, "OPS_WRONG_VERSION");
  literal(raw.tenantId, tenantId, `${label}.tenantId`, "OPS_REFERENCE_MISMATCH");
  const withoutDigest: Omit<CapabilityEpochResetV2, "resetDigest"> = {
    capabilityId: id(raw.capabilityId, `${label}.capabilityId`),
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.capabilityEpochReset,
    effectiveAt: timestamp(raw.effectiveAt, `${label}.effectiveAt`),
    incidentRecordId: id(raw.incidentRecordId, `${label}.incidentRecordId`),
    incidentRecoveryBindingDigest: sha(raw.incidentRecoveryBindingDigest, `${label}.incidentRecoveryBindingDigest`),
    incidentRecoveryBindingId: id(raw.incidentRecoveryBindingId, `${label}.incidentRecoveryBindingId`),
    newEpochId: id(raw.newEpochId, `${label}.newEpochId`),
    newEpochSequence: nonnegativeInteger(raw.newEpochSequence, `${label}.newEpochSequence`),
    priorEpochId: id(raw.priorEpochId, `${label}.priorEpochId`),
    priorEpochSequence: nonnegativeInteger(raw.priorEpochSequence, `${label}.priorEpochSequence`),
    resetId: id(raw.resetId, `${label}.resetId`),
    tenantId,
  };
  const resetDigest = sha(raw.resetDigest, `${label}.resetDigest`);
  if (calculateCapabilityEpochResetDigest(withoutDigest) !== resetDigest) drift(`${label} digest mismatch.`);
  return { ...withoutDigest, resetDigest };
}

function sealCapabilityEpochReset(reset: CapabilityEpochResetV2): CapabilityEpochResetV2 {
  const withoutDigest = without(reset, "resetDigest");
  return { ...withoutDigest, resetDigest: calculateCapabilityEpochResetDigest(withoutDigest) };
}

function requireExactTrustedSet<T extends Record<string, unknown>>(
  actual: readonly T[],
  trusted: readonly T[],
  key: keyof T,
  label: string,
): void {
  if (actual.length !== trusted.length) authority(`${label} set differs from the server-resolved source snapshot.`);
  const trustedById = new Map(trusted.map((item) => [String(item[key]), item]));
  for (const item of actual) {
    const source = trustedById.get(String(item[key]));
    if (!source || canonical(source) !== canonical(item)) authority(`${label} ${String(item[key])} was re-sealed or substituted outside its source.`);
  }
}

function evidenceById(documents: readonly OperationsEvidenceDocumentV1[], evidenceRefId: string): EvidenceRefV1 {
  const evidence = documents.find((document) => document.contractVersion === "EvidenceRef/v1"
    && "evidenceRefId" in document && document.evidenceRefId === evidenceRefId) as EvidenceRefV1 | undefined;
  if (!evidence) mismatch(`Evidence ${evidenceRefId} is absent from the content-bound base ledger.`);
  return evidence;
}

function without<T extends Record<string, unknown>, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function canonical(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function exact(value: unknown, keys: readonly string[], label: string): JsonObject {
  const raw = object(value, label);
  if (!sameSet(Object.keys(raw), keys)) fail("OPS_FIELD_SET_MISMATCH", `${label} exact fields differ.`);
  return raw;
}
function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as JsonObject;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return value;
}
function id(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 3 || value.length > 240) invalid(`${label} must be a bounded exact identifier.`);
  return value;
}
function genuineHumanId(value: unknown, label: string): string {
  const result = id(value, label);
  if (/^(?:agent|service|workload|dev|test|sultan|model|automation|bot)(?::|$)/i.test(result)) authority(`${label} must be a genuine human subject.`);
  if (!result.startsWith("human:")) authority(`${label} must use the canonical human subject namespace.`);
  return result;
}
function sha(value: unknown, label: string, length: 40 | 64 = 64): string {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) invalid(`${label} must be an exact lowercase digest.`);
  return value;
}
function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) clock(`${label} must be a millisecond UTC timestamp.`);
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
function literal(value: unknown, expected: unknown, label: string, code: OperationsEvidenceErrorCode = "OPS_VALUE_INVALID"): void {
  if (value !== expected) fail(code, `${label} must equal ${String(expected)}.`);
}
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]);
}
function fail(code: OperationsEvidenceErrorCode, message: string): never { throw new OperationsEvidenceCompatibilityError(code, message); }
function authority(message: string): never { fail("OPS_AUTHORITY_DENIED", message); }
function clock(message: string): never { fail("OPS_CLOCK_INVALID", message); }
function drift(message: string): never { fail("OPS_MANIFEST_DRIFT", message); }
function invalid(message: string): never { fail("OPS_VALUE_INVALID", message); }
function mismatch(message: string): never { fail("OPS_REFERENCE_MISMATCH", message); }
