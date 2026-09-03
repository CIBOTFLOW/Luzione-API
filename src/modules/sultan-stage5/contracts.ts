import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION = "luzione-sultan-api-admission/v1" as const;
export const SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION = "luzione-canonical-business-readback/v1" as const;
export const SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION = "luzione-sultan-outcome-observation/v1" as const;
export const SULTAN_STAGE5_POLICY_VERSION = "luzione-sultan-stage5-policy/2026-09-02.v1" as const;
export const SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION = "sultan.stage5-developmental-participation.v2" as const;
export const SULTAN_STAGE5_ADMISSION_TIMING = "POST_INFERENCE" as const;
export const SULTAN_STAGE5_INTERACTION_RECEIPT_VERSION = "sultan.developmental-interaction-receipt.v2" as const;
export const SULTAN_STAGE5_OUTCOME_EXPECTATION_BINDING_VERSION = "sultan.outcome-expectation-binding/v1" as const;

export const stage5Phases = [
  "REASONING",
  "SIMULATION",
  "ACTION_PREPARATION",
  "EXECUTION",
  "OBSERVATION",
] as const;
export type Stage5Phase = (typeof stage5Phases)[number];

export const canonicalSubjectTypes = [
  "ORDER",
  "SHIPMENT",
  "ACCOUNT",
  "OPPORTUNITY",
  "COMMITMENT",
  "LOGISTICS",
  "ECONOMIC_CALCULATION",
  "FEP_ALLOCATION",
] as const;
export type CanonicalSubjectType = (typeof canonicalSubjectTypes)[number];

export type Stage5CaseRef = {
  caseId: string;
  caseType:
    | "PORTFOLIO"
    | "COMMERCIAL"
    | "FULFILLMENT"
    | "PARTNER_RELATIONSHIP"
    | "CATALOG_QUALITY"
    | "ACCOUNT_RELATIONSHIP"
    | "ECONOMIC_REVIEW"
    | "FEP_CASE"
    | "CONTROL_REVIEW";
  expectedVersion: string | null;
};

export type Stage5AgentRef = {
  agentId: string;
  agentVersion: string;
};

export type Stage5OutcomeExpectation = {
  claimId: string;
  expectedValue: boolean | number | string;
  operator: "EQ" | "GTE" | "LTE" | "NE";
  subjectId: string;
  subjectType: CanonicalSubjectType;
};

export type SultanInteractionReceiptProof = {
  actorId: string;
  contextHash: string;
  contractVersion: typeof SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION;
  controls: {
    authorityGranted: false;
    businessStateMutated: false;
    canonicalBeliefChanged: false;
    canonicalMemoryChanged: false;
    externalEffectAuthorized: false;
    learningState: "OBSERVATION_ONLY";
    noRawPromptPersisted: true;
    noRawResponsePersisted: true;
    policyChanged: false;
    reviewRequiredForPromotion: true;
  };
  deploymentSha: string;
  evidenceHashesUsed: readonly string[];
  evidenceRefsUsed: readonly string[];
  groundingAssemblerDeploymentSha: string | null;
  groundingAssemblerWorkloadId: "service:luzione-ui" | null;
  groundingPacketHash: string | null;
  identityContractHash: string;
  identityContractVersion: string;
  interactionId: string;
  model: string | null;
  modelVersion: string | null;
  occurredAt: string;
  outcomeExpectationHash: string | null;
  participantSetHash: string;
  queryHash: string;
  receiptHash: string;
  responseHash: string;
  schemaVersion: typeof SULTAN_STAGE5_INTERACTION_RECEIPT_VERSION;
  shadowReviewRefsUsed: readonly string[];
  sourceInteractionRefHash: string;
  sourceRunIdHash: string | null;
  status: "READY" | "BLOCKED";
  surface: "SULTAN_CHAT" | "AGENT_CASE";
  tenantId: "luzione";
};

export type OutcomeExpectationProof = {
  bindingHash: string;
  contractVersion: typeof SULTAN_STAGE5_OUTCOME_EXPECTATION_BINDING_VERSION;
  expectationHash: string;
  interactionId: string;
  interactionReceiptHash: string;
};

export type Stage5AdmissionAssertion = {
  caseRef: Stage5CaseRef;
  contractVersion: typeof SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION;
  evidence: {
    evidenceRefsHash: string;
    readbackReceiptIds: readonly string[];
  };
  idempotencyKey: string;
  interactionId: string;
  interactionReceipt: SultanInteractionReceiptProof;
  interactionReceiptHash: string;
  logicalAgent: Stage5AgentRef;
  operationId: string;
  outcomeExpectation: Stage5OutcomeExpectation | null;
  outcomeExpectationProof: OutcomeExpectationProof | null;
  participation: {
    contextHash: string;
    contractSha: string;
    contractVersion: typeof SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION;
    criticAgent: Stage5AgentRef;
    groundingAssemblerDeploymentSha: string;
    groundingPacketHash: string;
    identityContractHash: string;
    identityContractVersion: string;
    modelVersion: string;
    participantSetHash: string;
    primaryAgent: Stage5AgentRef;
    sultanDeploymentSha: string;
  };
  phase: Stage5Phase;
  purpose: string;
  requestedAt: string;
  requestedCapability: string;
  requestedEffectClass: "A0" | "A1" | "A2" | "A3";
  runId: string;
};

export type VerifiedCanonicalReadbackRef = {
  apiDeploymentSha: string;
  claimEvidence: readonly {
    claimId: string;
    evidenceHash: string;
    evidenceRef: string;
  }[];
  consumerActorId: "service:luzione-ui" | "service:sultan-os";
  consumerReleaseSha: string;
  freshUntil: string | null;
  observedAt: string;
  readbackHash: string;
  readbackReceiptId: string;
  sourceRefs: readonly string[];
  sourceVersion: string | null;
  status: CanonicalReadbackStatus;
  subjectId: string;
  subjectType: CanonicalSubjectType;
  tenantId: string;
};

export type Stage5AdmissionStatus = "ADMITTED_NO_EFFECT" | "DENIED" | "SEPARATE_REVIEW_REQUIRED";

export type Stage5AdmissionReceipt = {
  admittedEffectClass: "A0" | "NONE";
  admissionTiming: typeof SULTAN_STAGE5_ADMISSION_TIMING;
  admissionReceiptId: string;
  apiDeploymentSha: string;
  authorizesInference: false;
  caseRef: Stage5CaseRef;
  contractVersion: typeof SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION;
  credentialActor: {
    actorId: string;
    actorType: "agent" | "service" | "user";
    source: "service-token" | "vercel-oidc";
    tenantId: string;
  };
  decidedAt: string;
  effectAuthority: "NO_EFFECT" | "NOT_GRANTED" | "SEPARATE_REVIEW_REQUIRED";
  evidence: {
    consumedEvidence: readonly {
      claimId: string;
      evidenceHash: string;
      evidenceRef: string;
      readbackHash: string;
      readbackReceiptId: string;
    }[];
    evidenceRefsHash: string;
    readbackReceiptIds: readonly string[];
    sourceVerification: "API_CANONICAL_READBACKS_VERIFIED_CONTEXT_HASH_SULTAN_ASSERTED" | "FAILED";
  };
  externalEffectsAuthorized: false;
  idempotentReplay: boolean;
  idempotencyKey: string;
  interactionId: string;
  interactionReceipt: SultanInteractionReceiptProof;
  interactionReceiptHash: string;
  logicalAgent: Stage5AgentRef;
  operationId: string;
  outcomeExpectation: Stage5OutcomeExpectation | null;
  outcomeExpectationBinding: {
    expectationHash: string | null;
    interactionReceiptBound: true;
    proofHash: string | null;
    source: "AUTHENTICATED_SULTAN_INTERACTION_RECEIPT" | "NONE";
  };
  outcomeExpectationProof: OutcomeExpectationProof | null;
  participation: Stage5AdmissionAssertion["participation"];
  phase: Stage5Phase;
  policyVersion: typeof SULTAN_STAGE5_POLICY_VERSION;
  purpose: string;
  reasonCodes: readonly string[];
  receiptHash: string;
  requestedAt: string;
  requestedCapability: string;
  requestedEffectClass: Stage5AdmissionAssertion["requestedEffectClass"];
  runId: string;
  status: Stage5AdmissionStatus;
};

export type Stage5Pins = {
  apiDeploymentSha: string;
  maximumEvidenceAgeMs: number;
  participationContractSha: string;
  participationContractVersion: typeof SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION;
  sultanDeploymentSha: string;
  uiDeploymentSha: string;
};

export type CanonicalClaim = {
  claimId: string;
  kind: "CALCULATION" | "FACT";
  unit: string | null;
  value: boolean | number | string | null;
  valueType: "BOOLEAN" | "INTEGER" | "MONEY_MINOR" | "NUMBER" | "STRING" | "TIMESTAMP";
};

export type CanonicalReadbackStatus =
  | "AVAILABLE"
  | "NOT_FOUND"
  | "SCHEMA_MISMATCH"
  | "SOURCE_UNAVAILABLE";

export type CanonicalReadbackRequest = {
  consumerDeploymentSha: string;
  contractVersion: typeof SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION;
  idempotencyKey: string;
  requestedAt: string;
  subjectId: string;
  subjectType: CanonicalSubjectType;
};

export type CanonicalReadbackReceipt = {
  apiDeploymentSha: string;
  claims: readonly CanonicalClaim[];
  consumer: {
    actorId: "service:luzione-ui" | "service:sultan-os";
    deploymentSha: string;
  };
  contractVersion: typeof SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION;
  freshUntil: string | null;
  idempotentReplay: boolean;
  idempotencyKey: string;
  observedAt: string;
  provenance: {
    authority: "CANONICAL_POSTGRES" | "NONE";
    sourceRefs: readonly string[];
    sourceVersion: string | null;
  };
  readbackHash: string;
  readbackReceiptId: string;
  status: CanonicalReadbackStatus;
  subjectId: string;
  subjectType: CanonicalSubjectType;
  tenantId: string;
};

export type OutcomeObservationRequest = {
  admissionReceiptId: string;
  contractVersion: typeof SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION;
  idempotencyKey: string;
  mode: "OBSERVE" | "SUPERSEDE";
  readbackReceiptId: string;
  requestedAt: string;
  supersedesObservationId: string | null;
};

export type OutcomeClassification = "CONFIRMED" | "REFUTED" | "SUPERSEDED" | "UNRESOLVED";
export type OutcomeReasonCode =
  | "CANONICAL_CLAIM_CONTRADICTED"
  | "CANONICAL_CLAIM_MATCHED"
  | "CANONICAL_READBACK_UNAVAILABLE"
  | "CLAIM_TYPES_NOT_COMPARABLE"
  | "EXPECTED_CLAIM_NOT_OBSERVED"
  | "EXPECTED_SUBJECT_NOT_OBSERVED"
  | "NEWER_CANONICAL_OBSERVATION_SUPERSEDES_PRIOR"
  | "NO_STRUCTURED_EXPECTATION";

export type OutcomeObservationReceipt = {
  admissionLineage: {
    admissionReceiptHash: string;
    apiDeploymentSha: string;
    contextHash: string;
    groundingPacketHash: string;
    interactionId: string;
    interactionReceiptHash: string;
    operationId: string;
    runId: string;
    sultanDeploymentSha: string;
  };
  admissionReceiptId: string;
  apiDeploymentSha: string;
  classification: OutcomeClassification;
  contractVersion: typeof SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION;
  evidence: {
    apiDeploymentSha: string;
    claimId: string | null;
    observedValue: boolean | number | string | null;
    readbackHash: string;
    readbackReceiptId: string;
    sourceRefs: readonly string[];
  };
  expectationBinding: {
    expectationHash: string | null;
    interactionReceiptBound: true;
    proofHash: string | null;
    source: "AUTHENTICATED_SULTAN_INTERACTION_RECEIPT" | "NONE";
  };
  idempotentReplay: boolean;
  idempotencyKey: string;
  observationId: string;
  observedAt: string;
  observer: {
    actorId: "service:luzione-ui" | "service:sultan-os";
    actorType: "service";
    tenantId: "luzione";
  };
  observationRequest: OutcomeObservationRequest;
  reasonCode: OutcomeReasonCode;
  receiptHash: string;
  supersedesObservationId: string | null;
};

export function stage5AdmissionRequestHash(assertion: Stage5AdmissionAssertion) {
  return sha256(assertion);
}

export function stage5EvidenceRefsHash(
  readbacks: readonly Pick<VerifiedCanonicalReadbackRef, "readbackHash" | "readbackReceiptId">[],
) {
  return sha256([...readbacks]
    .map((readback) => ({ receiptId: readback.readbackReceiptId, readbackHash: readback.readbackHash }))
    .sort((left, right) => left.receiptId.localeCompare(right.receiptId)));
}

export function stage5AdmissionReceiptHash(receipt: Omit<Stage5AdmissionReceipt, "idempotentReplay" | "receiptHash">) {
  return sha256(receipt);
}

export function sultanInteractionReceiptHash(
  receipt: Omit<SultanInteractionReceiptProof, "interactionId" | "receiptHash">,
) {
  return sha256(receipt);
}

export function outcomeExpectationHash(expectation: Stage5OutcomeExpectation) {
  return sha256(expectation);
}

export function outcomeExpectationBindingHash(
  proof: Omit<OutcomeExpectationProof, "bindingHash">,
) {
  return sha256(proof);
}

export function canonicalReadbackHash(receipt: Omit<CanonicalReadbackReceipt, "idempotentReplay" | "readbackHash">) {
  return sha256(receipt);
}

export function canonicalClaimEvidenceBinding(
  receipt: Pick<CanonicalReadbackReceipt, "readbackReceiptId" | "subjectType">,
  claim: CanonicalClaim,
) {
  const title = boundedEvidenceText(`${receipt.subjectType} ${claim.claimId}`, 300);
  const excerpt = boundedEvidenceText(
    `${claim.claimId} = ${claim.value === null ? "null" : JSON.stringify(claim.value)}${claim.unit ? ` ${claim.unit}` : ""}.`,
    2_000,
  );
  return Object.freeze({
    claimId: claim.claimId,
    evidenceHash: sha256({ title: title.trim(), excerpt: excerpt.trim() }),
    evidenceRef: `${receipt.readbackReceiptId}/${claim.claimId}`,
  });
}

export function outcomeObservationHash(receipt: Omit<OutcomeObservationReceipt, "idempotentReplay" | "receiptHash">) {
  return sha256(receipt);
}

function boundedEvidenceText(value: string, bytes: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (Buffer.byteLength(normalized, "utf8") <= bytes) return normalized;
  return Buffer.from(normalized, "utf8")
    .subarray(0, bytes)
    .toString("utf8")
    .replace(/�+$/g, "")
    .trim();
}
