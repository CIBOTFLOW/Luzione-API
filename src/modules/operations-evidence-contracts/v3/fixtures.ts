import type { EvidenceRefV1, OperationsEvidenceDocumentV1, ProofIncidentV1 } from "../contracts";
import {
  authorityGrantEvidenceFixtures,
  founderAuthorityEvidenceRefFixture,
  iremAuthorityEvidenceRefFixture,
  makeReadyOperationsEvidenceLedgerV2Fixture,
  operationsEvidenceLedgerFixtureClock,
  operationsEvidenceLedgerTenantId,
  operationsEvidenceLedgerV2Fixture,
} from "../v2/fixtures";
import { OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS, OPERATIONS_EVIDENCE_LEDGER_VERSION, type LuzioneOperationsEvidenceLedgerV2 } from "../v2/contracts";
import { calculateContentDigest, sealOperationsEvidenceLedgerV2 } from "../v2/sdk";
import { REQUIRED_PROOF_ENTRY_G2_EFFECTS } from "../v2/rules";
import {
  OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
  type CapabilityEpochAnchorV1,
  type CanonicalG2ApprovalSourceV1,
  type CanonicalIncidentRecoverySourceV1,
  type CanonicalProofIncidentSourceV1,
  type CanonicalTenantMembershipSourceV1,
  type ExactAuthorityRecoverySourceReadbackV1,
  type G2EffectAuthorityGrantV2,
  type HumanAuthoritySourceBindingV1,
  type IncidentRecoverySourceBindingV1,
  type LuzioneOperationsEvidenceLedgerV3,
  type OperationsEvidenceAuthorityRecoverySourceSnapshotV1,
  type OperationsEvidenceCanonicalSourceAttestationV1,
  type OperationsEvidenceCanonicalSourceObjectV1,
  type OperationsEvidenceCanonicalSourceReadbackV1,
  type OperationsEvidenceLedgerParseContextV3,
} from "./contracts";
import { OPS_V3_SYNTHETIC_SOURCE_TRUST_ROOT } from "./rules";
import {
  calculateCanonicalSourceAttestationDigest,
  calculateExactSourceBytesHash,
  calculateSourceSnapshotDigest,
  createGenesisOperationsEvidenceAppendStateV1,
  createInMemoryOperationsEvidenceAppendStateStoreV1,
  deriveCapabilityEpochResetV2,
  sealG2EffectAuthorityGrantV2,
  sealHumanAuthoritySourceBindingV1,
  sealIncidentRecoverySourceBindingV1,
  sealOperationsEvidenceLedgerV3,
} from "./sdk";

export const operationsEvidenceLedgerV3FixtureClock = operationsEvidenceLedgerFixtureClock;
export const operationsEvidenceLedgerV3TenantId = operationsEvidenceLedgerTenantId;

// Signatures are produced once by a non-authoritative synthetic key. Its private test seed is absent.
const SYNTHETIC_SIGNATURES: Readonly<Record<string, string>> = Object.freeze({
  "097cf286b90730ab262ca5b423cc8300cc502e784bdf7a7bafd93383604ff30f": "dhEU6JvGU/LH2mCnAcJXgOK+E0p1009AIU/zqhSHsrVwuKE3aWiHHp14QBeOAEYKO0D9xdOXHKwp2Cv+3bo9BQ==",
  "316890cfc4dd1e21bad0a8cb0e211ff142d89cfd65a9c7bcd8e8801e84485f1f": "JI8gRvpCUFXgJUcOrGvzoNemfUNoxQEirlv972cXfhFR4DJoEZrby370BmVY9ACd0988dLa2wx60tf0H4AKzDg==",
  "6442d1f79d306edc080400f985d5741958e49a74eeaa3f7aa159aa2078085700": "rKRzVsCs4RCP70JcePQIWeaWRzJKmh9PAWk2QO6m1Yh7rDIGBtvN2T53YqmFz2bSqKB0GyUR8ovDg7FU3LgUBQ==",
  "b7236cb7b7c16f73a426f3bc2a17861f48733aa1e76b555cf8e0220f4edb111e": "cvyQY6KDtN5UT0VGFndZCmHGZX87ul8d2TKB01rrZJGLnZ26HB1PFdvsqZhLSZVNviF0mBPGFMeD5bWQr+pXCA==",
  "de13864edda07a227bc8ed18a141b22067d561d2c9807f3dfc69a87a28af2dd1": "d3jwPLfg7uFSueN/cjaxObw3L80JOyehtXFjnDgUiywS+Honi7C5z1lW+Usod33r6cF3NL2aFWmNIhvNRu3kCw==",
  "e9d7255aec6fc16b36c20687d85e1d67405225462c596f801a3d2e50d3dce1db": "AMufY2EXtmiwbV8pqw4X7QU0dSYvZ2vqTj5dg9ft2GMWjmciFol5Oylci4pAkS1JWL0D39JeJT8x5p00+3NBDA==",
  "e9f924daa2aad875955874ea35babfa6dfcfe762cd791be5c31f7e95b8b05bc7": "y685Ir3mKHyowUoqvrrt9QqK53EMe4JyitHx0R3a+6O2kPHkDUEQWpyxwBRhzGYwtGof1+YaCRXLUmJWDccUAQ==",
  "f9beb9e6584a2619128ebcd2522316a5c6c465d68f67854bcc763f605f8f2a5b": "iecrQl1Ertc+9EY8MK/qlvKMGB/eNeEmpMHwGjJYO7TC6OYS1Qpe8W7iMEhtghBUonjTb/uPadjv2b3gTnxOBA==",
});

function canonical(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function canonicalObjectId(value: OperationsEvidenceCanonicalSourceObjectV1): string {
  if (value.contractVersion === OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalTenantMembership) return value.subjectId;
  if (value.contractVersion === OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalG2Approval) return value.approvalId;
  if (value.contractVersion === OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalProofIncident) return value.incidentRecordId;
  return value.recoveryReceiptId;
}

function makeAttestation(
  object: OperationsEvidenceCanonicalSourceObjectV1,
  objectType: ExactAuthorityRecoverySourceReadbackV1["objectType"],
  readbackId: string,
  readbackAt: string,
): OperationsEvidenceCanonicalSourceAttestationV1 {
  const objectBytes = canonical(object);
  const objectHash = calculateExactSourceBytesHash(objectBytes);
  const readback: OperationsEvidenceCanonicalSourceReadbackV1 = {
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalSourceReadback,
    objectHash, objectId: canonicalObjectId(object), objectType, objectVersion: object.contractVersion,
    readbackAt, readbackId, sourceSystem: "LUZIONE_CRM_APP", tenantId: operationsEvidenceLedgerV3TenantId,
  };
  const readbackBytes = canonical(readback);
  const unsigned = {
    attestationId: `attestation:${readbackId}`,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalSourceAttestation,
    objectBytes, objectHash, objectId: readback.objectId, objectType, objectVersion: object.contractVersion,
    readbackBytes, readbackHash: calculateExactSourceBytesHash(readbackBytes), readbackId,
    signingKeyId: OPS_V3_SYNTHETIC_SOURCE_TRUST_ROOT.keyId, sourceSystem: readback.sourceSystem,
    tenantId: operationsEvidenceLedgerV3TenantId,
  } as const;
  const attestationDigest = calculateCanonicalSourceAttestationDigest(unsigned);
  return { ...unsigned, attestationDigest, signature: SYNTHETIC_SIGNATURES[attestationDigest] ?? "A".repeat(86) + "==" };
}

function exactReadback(attestation: OperationsEvidenceCanonicalSourceAttestationV1): ExactAuthorityRecoverySourceReadbackV1 {
  const readback = JSON.parse(attestation.readbackBytes) as OperationsEvidenceCanonicalSourceReadbackV1;
  return {
    objectHash: attestation.objectHash, objectId: attestation.objectId, objectType: attestation.objectType,
    objectVersion: attestation.objectVersion, readbackAt: readback.readbackAt, readbackHash: attestation.readbackHash,
    readbackId: attestation.readbackId, readbackObjectId: attestation.objectId,
    readbackObjectVersion: attestation.objectVersion, sourceSystem: attestation.sourceSystem, tenantId: attestation.tenantId,
  };
}

function resealSnapshot(
  humanAuthoritySourceBindings: readonly HumanAuthoritySourceBindingV1[],
  g2EffectAuthorityGrants: readonly G2EffectAuthorityGrantV2[],
  incidentRecoverySourceBindings: readonly IncidentRecoverySourceBindingV1[],
  sourceAttestations: readonly OperationsEvidenceCanonicalSourceAttestationV1[],
): OperationsEvidenceAuthorityRecoverySourceSnapshotV1 {
  const withoutDigest = {
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.sourceSnapshot,
    g2EffectAuthorityGrants, humanAuthoritySourceBindings, incidentRecoverySourceBindings,
    resolvedBy: "SYNTHETIC_TEST_HARNESS" as const, snapshotAt: "2026-09-05T04:30:00.000Z",
    sourceAttestations, tenantId: operationsEvidenceLedgerV3TenantId,
  };
  return { ...withoutDigest, snapshotDigest: calculateSourceSnapshotDigest(withoutDigest) };
}

function replaceEvidenceRefs(base: LuzioneOperationsEvidenceLedgerV2, replacements: readonly EvidenceRefV1[]): LuzioneOperationsEvidenceLedgerV2 {
  const index = new Map(replacements.map((item) => [item.evidenceRefId, item]));
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value !== null && typeof value === "object") {
      const row = value as Record<string, unknown>;
      if (row.contractVersion === "EvidenceRef/v1" && typeof row.evidenceRefId === "string" && index.has(row.evidenceRefId)) return structuredClone(index.get(row.evidenceRefId)!);
      return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, rewrite(item)]));
    }
    return value;
  };
  const entries = base.entries.map((entry) => {
    const document = rewrite(entry.document) as OperationsEvidenceDocumentV1;
    return { contentDigest: calculateContentDigest(document), document };
  });
  return sealOperationsEvidenceLedgerV2({
    assessmentTime: base.assessmentTime, authorityGrants: base.authorityGrants,
    capabilityEpochResets: base.capabilityEpochResets, contractVersion: base.contractVersion,
    dailyMetricBindings: base.dailyMetricBindings, effectAuthority: base.effectAuthority, entries,
    ledgerId: base.ledgerId, ownerContexts: base.ownerContexts,
    priorRecordSetDigest: base.priorRecordSetDigest, tenantId: base.tenantId,
  });
}

function evidenceForAttestation(template: EvidenceRefV1, attestation: OperationsEvidenceCanonicalSourceAttestationV1): EvidenceRefV1 {
  return { ...structuredClone(template), sha256: attestation.readbackHash };
}

const iremMembership: CanonicalTenantMembershipSourceV1 = {
  canonicalFunction: "PLATFORM_OPERATIONS", canonicalRole: "IREM",
  contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalTenantMembership,
  membershipState: "ACTIVE", principalType: "HUMAN", revokedAt: null, subjectId: "human:irem",
  supersededByBindingId: null, tenantId: operationsEvidenceLedgerV3TenantId,
  validFrom: "2026-09-01T00:00:00.000Z", validUntil: "2026-10-01T00:00:00.000Z",
};
const founderMembership: CanonicalTenantMembershipSourceV1 = {
  canonicalFunction: "FOUNDER", canonicalRole: "FOUNDER",
  contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalTenantMembership,
  membershipState: "ACTIVE", principalType: "HUMAN", revokedAt: null, subjectId: "human:founder",
  supersededByBindingId: null, tenantId: operationsEvidenceLedgerV3TenantId,
  validFrom: "2026-09-01T00:00:00.000Z", validUntil: "2026-10-01T00:00:00.000Z",
};

export const humanSourceAttestations: readonly OperationsEvidenceCanonicalSourceAttestationV1[] = [
  makeAttestation(iremMembership, "TENANT_MEMBERSHIP", iremAuthorityEvidenceRefFixture.evidenceRefId, "2026-09-05T03:00:00.000Z"),
  makeAttestation(founderMembership, "TENANT_MEMBERSHIP", founderAuthorityEvidenceRefFixture.evidenceRefId, "2026-09-05T03:00:00.000Z"),
];

export const humanAuthoritySourceBindingFixtures: readonly HumanAuthoritySourceBindingV1[] = [
  sealHumanAuthoritySourceBindingV1({
    bindingId: "human-source-binding:irem:platform-operations", canonicalFunction: "PLATFORM_OPERATIONS", canonicalRole: "IREM",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.humanAuthoritySourceBinding,
    issuerSubjectId: "human:irem", legacyAuthorityEvidenceRefId: iremAuthorityEvidenceRefFixture.evidenceRefId,
    membershipSource: exactReadback(humanSourceAttestations[0]), membershipState: "ACTIVE", principalType: "HUMAN",
    revokedAt: null, supersededByBindingId: null, tenantId: operationsEvidenceLedgerV3TenantId,
    validFrom: iremMembership.validFrom, validUntil: iremMembership.validUntil,
  }),
  sealHumanAuthoritySourceBindingV1({
    bindingId: "human-source-binding:founder", canonicalFunction: "FOUNDER", canonicalRole: "FOUNDER",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.humanAuthoritySourceBinding,
    issuerSubjectId: "human:founder", legacyAuthorityEvidenceRefId: founderAuthorityEvidenceRefFixture.evidenceRefId,
    membershipSource: exactReadback(humanSourceAttestations[1]), membershipState: "ACTIVE", principalType: "HUMAN",
    revokedAt: null, supersededByBindingId: null, tenantId: operationsEvidenceLedgerV3TenantId,
    validFrom: founderMembership.validFrom, validUntil: founderMembership.validUntil,
  }),
];

const baseWithHumanReadbacks = replaceEvidenceRefs(operationsEvidenceLedgerV2Fixture, [
  evidenceForAttestation(iremAuthorityEvidenceRefFixture, humanSourceAttestations[0]),
  evidenceForAttestation(founderAuthorityEvidenceRefFixture, humanSourceAttestations[1]),
]);

export const operationsEvidenceSourceSnapshotV1Fixture = resealSnapshot(humanAuthoritySourceBindingFixtures, [], [], humanSourceAttestations);

export const operationsEvidenceLedgerV3Fixture: LuzioneOperationsEvidenceLedgerV3 = sealOperationsEvidenceLedgerV3({
  assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime, baseLedger: baseWithHumanReadbacks,
  capabilityEpochResets: [], contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
  creditCeiling: { g2: 0, production: 0, proofDays: 0 }, decisionPolicy: "ZERO_CREDIT_PENDING_ASSURANCE_04",
  effectAuthority: "NO_EFFECT", g2EffectAuthorityGrants: [], humanAuthoritySourceBindings: humanAuthoritySourceBindingFixtures,
  incidentRecoverySourceBindings: [], ledgerId: baseWithHumanReadbacks.ledgerId,
  sourcePackets: { l2: "ABSENT", l3: "ABSENT" }, tenantId: operationsEvidenceLedgerV3TenantId,
});

function contextFor(ledgerId: string, snapshot: OperationsEvidenceAuthorityRecoverySourceSnapshotV1, anchors: readonly CapabilityEpochAnchorV1[] = []): OperationsEvidenceLedgerParseContextV3 {
  return {
    assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime,
    appendStateStore: createInMemoryOperationsEvidenceAppendStateStoreV1([createGenesisOperationsEvidenceAppendStateV1(operationsEvidenceLedgerV3TenantId, ledgerId, anchors)]),
    sourceSnapshot: snapshot,
  };
}

export const operationsEvidenceLedgerV3FixtureContext = contextFor(baseWithHumanReadbacks.ledgerId, operationsEvidenceSourceSnapshotV1Fixture);

export function makeBasicOperationsEvidenceLedgerV3Fixture(): { context: OperationsEvidenceLedgerParseContextV3; ledger: LuzioneOperationsEvidenceLedgerV3 } {
  return { context: contextFor(operationsEvidenceLedgerV3Fixture.ledgerId, operationsEvidenceSourceSnapshotV1Fixture), ledger: structuredClone(operationsEvidenceLedgerV3Fixture) };
}

export function makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture(): { context: OperationsEvidenceLedgerParseContextV3; ledger: LuzioneOperationsEvidenceLedgerV3 } {
  const baseTemplate = makeReadyOperationsEvidenceLedgerV2Fixture();
  const founder = humanAuthoritySourceBindingFixtures.find((binding) => binding.canonicalRole === "FOUNDER")!;
  const approvalAttestations = REQUIRED_PROOF_ENTRY_G2_EFFECTS.map((requirement, index) => {
    const object: CanonicalG2ApprovalSourceV1 = {
      actionId: requirement.actionId, approvalId: `approval:${requirement.actionId}`, approvalState: "APPROVED",
      contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalG2Approval,
      effect: requirement.effect, expiresAt: "2026-09-06T12:00:00.000Z", issuedAt: "2026-09-05T01:00:00.000Z",
      requestedStage: requirement.requestedStage, revokedAt: null, signerSubjectId: founder.issuerSubjectId,
      state: "GRANTED", supersededByGrantId: null, tenantId: operationsEvidenceLedgerV3TenantId, validFrom: "2026-09-05T01:00:00.000Z",
    };
    return makeAttestation(object, "G2_APPROVAL", authorityGrantEvidenceFixtures[index].evidenceRefId, "2026-09-05T03:00:00.000Z");
  });
  const baseLedger = replaceEvidenceRefs(baseTemplate, [
    evidenceForAttestation(iremAuthorityEvidenceRefFixture, humanSourceAttestations[0]),
    evidenceForAttestation(founderAuthorityEvidenceRefFixture, humanSourceAttestations[1]),
    ...approvalAttestations.map((attestation, index) => evidenceForAttestation(authorityGrantEvidenceFixtures[index], attestation)),
  ]);
  const grants = REQUIRED_PROOF_ENTRY_G2_EFFECTS.map((requirement, index) => sealG2EffectAuthorityGrantV2({
    actionId: requirement.actionId, approvalAppendOnly: true, approvalSource: exactReadback(approvalAttestations[index]),
    approvalState: "APPROVED", contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.g2EffectAuthorityGrant,
    effect: requirement.effect, expiresAt: "2026-09-06T12:00:00.000Z",
    grantId: `source-grant:${requirement.effect.toLowerCase()}`, humanAuthorityBindingDigest: founder.bindingDigest,
    humanAuthorityBindingId: founder.bindingId, issuedAt: "2026-09-05T01:00:00.000Z", issuerSubjectId: founder.issuerSubjectId,
    legacyAuthorityEvidenceRefId: authorityGrantEvidenceFixtures[index].evidenceRefId, legacyGrantId: baseLedger.authorityGrants[index].grantId,
    requestedStage: requirement.requestedStage, revokedAt: null, state: "GRANTED", supersededByGrantId: null,
    tenantId: operationsEvidenceLedgerV3TenantId, validFrom: "2026-09-05T01:00:00.000Z",
  }));
  const snapshot = resealSnapshot(humanAuthoritySourceBindingFixtures, grants, [], [...humanSourceAttestations, ...approvalAttestations]);
  const ledger = sealOperationsEvidenceLedgerV3({
    assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime, baseLedger, capabilityEpochResets: [],
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_VERSION, creditCeiling: { g2: 0, production: 0, proofDays: 0 },
    decisionPolicy: "ZERO_CREDIT_PENDING_ASSURANCE_04", effectAuthority: "NO_EFFECT", g2EffectAuthorityGrants: grants,
    humanAuthoritySourceBindings: humanAuthoritySourceBindingFixtures, incidentRecoverySourceBindings: [], ledgerId: baseLedger.ledgerId,
    sourcePackets: { l2: "ABSENT", l3: "ABSENT" }, tenantId: operationsEvidenceLedgerV3TenantId,
  });
  return { context: contextFor(ledger.ledgerId, snapshot), ledger };
}

export function makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture(): { anchor: CapabilityEpochAnchorV1; context: OperationsEvidenceLedgerParseContextV3; incidentBinding: IncidentRecoverySourceBindingV1; ledger: LuzioneOperationsEvidenceLedgerV3 } {
  const mutable = structuredClone(baseWithHumanReadbacks);
  const template = mutable.entries.find((entry) => entry.document.contractVersion === "EvidenceRef/v1")!.document as EvidenceRefV1;
  const incident = mutable.entries.find((entry) => entry.document.contractVersion === "ProofIncident/v1")!.document as ProofIncidentV1;
  Object.assign(incident.payload, {
    acknowledgedAt: "2026-09-04T02:05:00.000Z", capabilityIds: ["crm.support"], openedAt: "2026-09-04T02:00:00.000Z",
    readbackEvidenceRefIds: ["evidence:incident:resolved-readback"], resetCapabilityEpoch: true,
    resolvedAt: "2026-09-04T03:00:00.000Z", severity: "P1", state: "RESOLVED_VERIFIED",
  });
  const incidentObject: CanonicalProofIncidentSourceV1 = {
    acknowledgedAt: incident.payload.acknowledgedAt!, capabilityId: "crm.support",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalProofIncident,
    incidentRecordId: incident.recordId, openedAt: incident.payload.openedAt, resetCapabilityEpoch: true,
    resolvedAt: incident.payload.resolvedAt!, state: "RESOLVED_VERIFIED", tenantId: operationsEvidenceLedgerV3TenantId,
  };
  const recoveryObject: CanonicalIncidentRecoverySourceV1 = {
    capabilityId: "crm.support", completedAt: "2026-09-04T04:00:00.000Z",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.canonicalIncidentRecovery,
    incidentRecordId: incident.recordId, recoveryReceiptId: "recovery-receipt:crm-support:1", state: "VERIFIED",
    tenantId: operationsEvidenceLedgerV3TenantId,
  };
  const incidentAttestation = makeAttestation(incidentObject, "PROOF_INCIDENT", "evidence:incident:resolved-readback", "2026-09-04T03:30:00.000Z");
  const recoveryAttestation = makeAttestation(recoveryObject, "RECOVERY_RECEIPT", "evidence:incident:recovery-receipt", "2026-09-04T04:10:00.000Z");
  const incidentReadback = evidenceForAttestation({ ...structuredClone(template), artifactKind: "SOURCE_READBACK", evidenceRefId: incidentAttestation.readbackId }, incidentAttestation);
  const recoveryReadback = evidenceForAttestation({ ...structuredClone(template), artifactKind: "RECOVERY", evidenceRefId: recoveryAttestation.readbackId }, recoveryAttestation);
  mutable.entries = [
    ...mutable.entries.map((entry) => ({ contentDigest: calculateContentDigest(entry.document), document: entry.document })),
    { contentDigest: calculateContentDigest(incidentReadback), document: incidentReadback },
    { contentDigest: calculateContentDigest(recoveryReadback), document: recoveryReadback },
  ];
  const incidentBinding = sealIncidentRecoverySourceBindingV1({
    acknowledgedAt: incidentObject.acknowledgedAt, bindingId: "incident-recovery-binding:crm-support:1", capabilityId: "crm.support",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.incidentRecoverySourceBinding,
    incidentRecordId: incident.recordId, incidentSource: exactReadback(incidentAttestation), incidentState: "RESOLVED_VERIFIED",
    openedAt: incidentObject.openedAt, recoveryCompletedAt: recoveryObject.completedAt, recoveryIncidentRecordId: incident.recordId,
    recoverySource: exactReadback(recoveryAttestation), recoveryState: "VERIFIED", resolvedAt: incidentObject.resolvedAt,
    revokedAt: null, supersededByBindingId: null, tenantId: operationsEvidenceLedgerV3TenantId,
  });
  const anchor: CapabilityEpochAnchorV1 = { capabilityId: "crm.support", epochId: "epoch:crm-support:1", epochSequence: 1, tenantId: operationsEvidenceLedgerV3TenantId };
  const reset = deriveCapabilityEpochResetV2(incidentBinding, anchor);
  mutable.capabilityEpochResets = [{
    capabilityId: reset.capabilityId, contractVersion: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.capabilityEpochReset,
    effectiveDate: reset.effectiveAt.slice(0, 10), incidentRecordId: reset.incidentRecordId, newEpochId: reset.newEpochId,
    priorEpochId: reset.priorEpochId, recoveryEvidenceRefId: recoveryReadback.evidenceRefId,
    resetId: "legacy-reset:crm-support:1", tenantId: operationsEvidenceLedgerV3TenantId,
  }];
  const baseLedger = sealOperationsEvidenceLedgerV2({
    assessmentTime: mutable.assessmentTime, authorityGrants: mutable.authorityGrants,
    capabilityEpochResets: mutable.capabilityEpochResets, contractVersion: OPERATIONS_EVIDENCE_LEDGER_VERSION,
    dailyMetricBindings: mutable.dailyMetricBindings, effectAuthority: "NO_EFFECT", entries: mutable.entries,
    ledgerId: mutable.ledgerId, ownerContexts: mutable.ownerContexts,
    priorRecordSetDigest: mutable.priorRecordSetDigest, tenantId: mutable.tenantId,
  });
  const snapshot = resealSnapshot(humanAuthoritySourceBindingFixtures, [], [incidentBinding], [...humanSourceAttestations, incidentAttestation, recoveryAttestation]);
  const ledger = sealOperationsEvidenceLedgerV3({
    assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime, baseLedger, capabilityEpochResets: [reset],
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_VERSION, creditCeiling: { g2: 0, production: 0, proofDays: 0 },
    decisionPolicy: "ZERO_CREDIT_PENDING_ASSURANCE_04", effectAuthority: "NO_EFFECT", g2EffectAuthorityGrants: [],
    humanAuthoritySourceBindings: humanAuthoritySourceBindingFixtures, incidentRecoverySourceBindings: [incidentBinding],
    ledgerId: baseLedger.ledgerId, sourcePackets: { l2: "ABSENT", l3: "ABSENT" }, tenantId: operationsEvidenceLedgerV3TenantId,
  });
  return { anchor, context: contextFor(ledger.ledgerId, snapshot, [anchor]), incidentBinding, ledger };
}
