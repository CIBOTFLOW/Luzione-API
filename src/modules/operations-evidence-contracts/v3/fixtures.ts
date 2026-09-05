import type { EvidenceRefV1, ProofIncidentV1 } from "../contracts";
import {
  authorityGrantEvidenceFixtures,
  founderAuthorityEvidenceRefFixture,
  iremAuthorityEvidenceRefFixture,
  makeReadyOperationsEvidenceLedgerV2Fixture,
  operationsEvidenceLedgerFixtureClock,
  operationsEvidenceLedgerTenantId,
  operationsEvidenceLedgerV2Fixture,
} from "../v2/fixtures";
import {
  OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_VERSION,
} from "../v2/contracts";
import { calculateContentDigest, sealOperationsEvidenceLedgerV2 } from "../v2/sdk";
import { REQUIRED_PROOF_ENTRY_G2_EFFECTS } from "../v2/rules";
import {
  OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS,
  OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
  type CapabilityEpochAnchorV1,
  type ExactAuthorityRecoverySourceReadbackV1,
  type G2EffectAuthorityGrantV2,
  type HumanAuthoritySourceBindingV1,
  type IncidentRecoverySourceBindingV1,
  type LuzioneOperationsEvidenceLedgerV3,
  type OperationsEvidenceAuthorityRecoverySourceSnapshotV1,
  type OperationsEvidenceLedgerParseContextV3,
} from "./contracts";
import {
  deriveCapabilityEpochResetV2,
  sealG2EffectAuthorityGrantV2,
  sealHumanAuthoritySourceBindingV1,
  sealIncidentRecoverySourceBindingV1,
  sealOperationsEvidenceLedgerV3,
} from "./sdk";

export const operationsEvidenceLedgerV3FixtureClock = operationsEvidenceLedgerFixtureClock;
export const operationsEvidenceLedgerV3TenantId = operationsEvidenceLedgerTenantId;

function sourceReadback(
  objectType: ExactAuthorityRecoverySourceReadbackV1["objectType"],
  objectId: string,
  readback: EvidenceRefV1,
  objectHash: string,
  readbackAt = "2026-09-05T03:00:00.000Z",
): ExactAuthorityRecoverySourceReadbackV1 {
  const objectVersion = `source-version:${objectType.toLowerCase()}:1`;
  return {
    objectHash,
    objectId,
    objectType,
    objectVersion,
    readbackAt,
    readbackHash: readback.sha256,
    readbackId: readback.evidenceRefId,
    readbackObjectId: objectId,
    readbackObjectVersion: objectVersion,
    sourceSystem: "LUZIONE_CRM_APP",
    tenantId: operationsEvidenceLedgerV3TenantId,
  };
}

export const humanAuthoritySourceBindingFixtures: readonly HumanAuthoritySourceBindingV1[] = [
  sealHumanAuthoritySourceBindingV1({
    bindingId: "human-source-binding:irem:platform-operations",
    canonicalFunction: "PLATFORM_OPERATIONS",
    canonicalRole: "IREM",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.humanAuthoritySourceBinding,
    issuerSubjectId: "human:irem",
    legacyAuthorityEvidenceRefId: iremAuthorityEvidenceRefFixture.evidenceRefId,
    membershipSource: sourceReadback("TENANT_MEMBERSHIP", "human:irem", iremAuthorityEvidenceRefFixture, "6".repeat(64)),
    membershipState: "ACTIVE",
    principalType: "HUMAN",
    revokedAt: null,
    supersededByBindingId: null,
    tenantId: operationsEvidenceLedgerV3TenantId,
    validFrom: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-10-01T00:00:00.000Z",
  }),
  sealHumanAuthoritySourceBindingV1({
    bindingId: "human-source-binding:founder",
    canonicalFunction: "FOUNDER",
    canonicalRole: "FOUNDER",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.humanAuthoritySourceBinding,
    issuerSubjectId: "human:founder",
    legacyAuthorityEvidenceRefId: founderAuthorityEvidenceRefFixture.evidenceRefId,
    membershipSource: sourceReadback("TENANT_MEMBERSHIP", "human:founder", founderAuthorityEvidenceRefFixture, "7".repeat(64)),
    membershipState: "ACTIVE",
    principalType: "HUMAN",
    revokedAt: null,
    supersededByBindingId: null,
    tenantId: operationsEvidenceLedgerV3TenantId,
    validFrom: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-10-01T00:00:00.000Z",
  }),
];

export const operationsEvidenceSourceSnapshotV1Fixture: OperationsEvidenceAuthorityRecoverySourceSnapshotV1 = {
  contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.sourceSnapshot,
  g2EffectAuthorityGrants: [],
  humanAuthoritySourceBindings: humanAuthoritySourceBindingFixtures,
  incidentRecoverySourceBindings: [],
  resolvedBy: "SYNTHETIC_TEST_HARNESS",
  snapshotAt: "2026-09-05T04:00:00.000Z",
  tenantId: operationsEvidenceLedgerV3TenantId,
};

export const operationsEvidenceLedgerV3Fixture: LuzioneOperationsEvidenceLedgerV3 = sealOperationsEvidenceLedgerV3({
  assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime,
  baseLedger: operationsEvidenceLedgerV2Fixture,
  capabilityEpochResets: [],
  contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
  creditCeiling: { g2: 0, production: 0, proofDays: 0 },
  decisionPolicy: "ZERO_CREDIT_PENDING_ASSURANCE_03",
  effectAuthority: "NO_EFFECT",
  g2EffectAuthorityGrants: [],
  humanAuthoritySourceBindings: humanAuthoritySourceBindingFixtures,
  incidentRecoverySourceBindings: [],
  ledgerId: operationsEvidenceLedgerV2Fixture.ledgerId,
  sourcePackets: { l2: "ABSENT", l3: "ABSENT" },
  tenantId: operationsEvidenceLedgerV3TenantId,
});

export const operationsEvidenceLedgerV3FixtureContext: OperationsEvidenceLedgerParseContextV3 = {
  assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime,
  capabilityEpochAnchors: [],
  sourceSnapshot: operationsEvidenceSourceSnapshotV1Fixture,
};

export function makeSourceBoundReadyOperationsEvidenceLedgerV3Fixture(): {
  context: OperationsEvidenceLedgerParseContextV3;
  ledger: LuzioneOperationsEvidenceLedgerV3;
} {
  const baseLedger = makeReadyOperationsEvidenceLedgerV2Fixture();
  const founder = humanAuthoritySourceBindingFixtures.find((binding) => binding.canonicalRole === "FOUNDER")!;
  const grants: G2EffectAuthorityGrantV2[] = REQUIRED_PROOF_ENTRY_G2_EFFECTS.map((requirement, index) => {
    const evidence = authorityGrantEvidenceFixtures[index];
    return sealG2EffectAuthorityGrantV2({
      actionId: requirement.actionId,
      approvalAppendOnly: true,
      approvalSource: sourceReadback("G2_APPROVAL", `approval:${requirement.actionId}`, evidence, String(index + 2).repeat(64)),
      approvalState: "APPROVED",
      contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.g2EffectAuthorityGrant,
      effect: requirement.effect,
      expiresAt: "2026-09-06T12:00:00.000Z",
      grantId: `source-grant:${requirement.effect.toLowerCase()}`,
      humanAuthorityBindingDigest: founder.bindingDigest,
      humanAuthorityBindingId: founder.bindingId,
      issuedAt: "2026-09-05T01:00:00.000Z",
      issuerSubjectId: founder.issuerSubjectId,
      legacyAuthorityEvidenceRefId: evidence.evidenceRefId,
      legacyGrantId: baseLedger.authorityGrants[index].grantId,
      requestedStage: requirement.requestedStage,
      revokedAt: null,
      state: "GRANTED",
      supersededByGrantId: null,
      tenantId: operationsEvidenceLedgerV3TenantId,
      validFrom: "2026-09-05T01:00:00.000Z",
    });
  });
  const snapshot: OperationsEvidenceAuthorityRecoverySourceSnapshotV1 = {
    ...operationsEvidenceSourceSnapshotV1Fixture,
    g2EffectAuthorityGrants: grants,
  };
  return {
    context: { assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime, capabilityEpochAnchors: [], sourceSnapshot: snapshot },
    ledger: sealOperationsEvidenceLedgerV3({
      assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime,
      baseLedger,
      capabilityEpochResets: [],
      contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
      creditCeiling: { g2: 0, production: 0, proofDays: 0 },
      decisionPolicy: "ZERO_CREDIT_PENDING_ASSURANCE_03",
      effectAuthority: "NO_EFFECT",
      g2EffectAuthorityGrants: grants,
      humanAuthoritySourceBindings: humanAuthoritySourceBindingFixtures,
      incidentRecoverySourceBindings: [],
      ledgerId: baseLedger.ledgerId,
      sourcePackets: { l2: "ABSENT", l3: "ABSENT" },
      tenantId: operationsEvidenceLedgerV3TenantId,
    }),
  };
}

export function makeVerifiedIncidentResetOperationsEvidenceLedgerV3Fixture(): {
  anchor: CapabilityEpochAnchorV1;
  context: OperationsEvidenceLedgerParseContextV3;
  incidentBinding: IncidentRecoverySourceBindingV1;
  ledger: LuzioneOperationsEvidenceLedgerV3;
} {
  const mutable = structuredClone(operationsEvidenceLedgerV2Fixture);
  const template = mutable.entries.find((entry) => entry.document.contractVersion === "EvidenceRef/v1")!.document as EvidenceRefV1;
  const incidentReadback: EvidenceRefV1 = {
    ...structuredClone(template),
    artifactKind: "SOURCE_READBACK",
    evidenceRefId: "evidence:incident:resolved-readback",
    observedAt: "2026-09-05T03:30:00.000Z",
    sha256: "8".repeat(64),
  };
  const recoveryReadback: EvidenceRefV1 = {
    ...structuredClone(template),
    artifactKind: "RECOVERY",
    evidenceRefId: "evidence:incident:recovery-receipt",
    observedAt: "2026-09-05T04:10:00.000Z",
    sha256: "9".repeat(64),
  };
  mutable.entries = [...mutable.entries,
    { contentDigest: calculateContentDigest(incidentReadback), document: incidentReadback },
    { contentDigest: calculateContentDigest(recoveryReadback), document: recoveryReadback },
  ];
  const incident = mutable.entries.find((entry) => entry.document.contractVersion === "ProofIncident/v1")!.document as ProofIncidentV1;
  incident.payload.acknowledgedAt = "2026-09-05T02:05:00.000Z";
  incident.payload.capabilityIds = ["crm.support"];
  incident.payload.openedAt = "2026-09-05T02:00:00.000Z";
  incident.payload.readbackEvidenceRefIds = [incidentReadback.evidenceRefId];
  incident.payload.resetCapabilityEpoch = true;
  incident.payload.resolvedAt = "2026-09-05T03:00:00.000Z";
  incident.payload.severity = "P1";
  incident.payload.state = "RESOLVED_VERIFIED";
  const incidentBinding = sealIncidentRecoverySourceBindingV1({
    acknowledgedAt: incident.payload.acknowledgedAt,
    bindingId: "incident-recovery-binding:crm-support:1",
    capabilityId: "crm.support",
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_AUXILIARY_VERSIONS.incidentRecoverySourceBinding,
    incidentRecordId: incident.recordId,
    incidentSource: sourceReadback("PROOF_INCIDENT", incident.recordId, incidentReadback, calculateContentDigest(incident), "2026-09-05T03:30:00.000Z"),
    incidentState: "RESOLVED_VERIFIED",
    openedAt: incident.payload.openedAt,
    recoveryCompletedAt: "2026-09-05T04:00:00.000Z",
    recoveryIncidentRecordId: incident.recordId,
    recoverySource: sourceReadback("RECOVERY_RECEIPT", "recovery-receipt:crm-support:1", recoveryReadback, "a".repeat(64), "2026-09-05T04:10:00.000Z"),
    recoveryState: "VERIFIED",
    resolvedAt: incident.payload.resolvedAt,
    revokedAt: null,
    supersededByBindingId: null,
    tenantId: operationsEvidenceLedgerV3TenantId,
  });
  const anchor: CapabilityEpochAnchorV1 = {
    capabilityId: "crm.support",
    epochId: "epoch:crm-support:1",
    epochSequence: 1,
    tenantId: operationsEvidenceLedgerV3TenantId,
  };
  const reset = deriveCapabilityEpochResetV2(incidentBinding, anchor);
  mutable.capabilityEpochResets = [{
    capabilityId: reset.capabilityId,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_AUXILIARY_VERSIONS.capabilityEpochReset,
    effectiveDate: reset.effectiveAt.slice(0, 10),
    incidentRecordId: reset.incidentRecordId,
    newEpochId: reset.newEpochId,
    priorEpochId: reset.priorEpochId,
    recoveryEvidenceRefId: recoveryReadback.evidenceRefId,
    resetId: "legacy-reset:crm-support:1",
    tenantId: operationsEvidenceLedgerV3TenantId,
  }];
  const baseLedger = sealOperationsEvidenceLedgerV2({
    assessmentTime: mutable.assessmentTime,
    authorityGrants: mutable.authorityGrants,
    capabilityEpochResets: mutable.capabilityEpochResets,
    contractVersion: OPERATIONS_EVIDENCE_LEDGER_VERSION,
    dailyMetricBindings: mutable.dailyMetricBindings,
    effectAuthority: "NO_EFFECT",
    entries: mutable.entries,
    ledgerId: mutable.ledgerId,
    ownerContexts: mutable.ownerContexts,
    priorRecordSetDigest: mutable.priorRecordSetDigest,
    tenantId: mutable.tenantId,
  });
  const snapshot: OperationsEvidenceAuthorityRecoverySourceSnapshotV1 = {
    ...operationsEvidenceSourceSnapshotV1Fixture,
    incidentRecoverySourceBindings: [incidentBinding],
  };
  return {
    anchor,
    context: { assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime, capabilityEpochAnchors: [anchor], sourceSnapshot: snapshot },
    incidentBinding,
    ledger: sealOperationsEvidenceLedgerV3({
      assessmentTime: operationsEvidenceLedgerV3FixtureClock.assessmentTime,
      baseLedger,
      capabilityEpochResets: [reset],
      contractVersion: OPERATIONS_EVIDENCE_LEDGER_V3_VERSION,
      creditCeiling: { g2: 0, production: 0, proofDays: 0 },
      decisionPolicy: "ZERO_CREDIT_PENDING_ASSURANCE_03",
      effectAuthority: "NO_EFFECT",
      g2EffectAuthorityGrants: [],
      humanAuthoritySourceBindings: humanAuthoritySourceBindingFixtures,
      incidentRecoverySourceBindings: [incidentBinding],
      ledgerId: baseLedger.ledgerId,
      sourcePackets: { l2: "ABSENT", l3: "ABSENT" },
      tenantId: operationsEvidenceLedgerV3TenantId,
    }),
  };
}
