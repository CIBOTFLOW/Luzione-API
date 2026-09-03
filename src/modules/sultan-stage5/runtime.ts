import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
  SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION,
  canonicalReadbackHash,
  outcomeExpectationBindingHash,
  outcomeExpectationHash,
  outcomeObservationHash,
  sultanInteractionReceiptHash,
  stage5EvidenceRefsHash,
  type CanonicalClaim,
  type CanonicalReadbackReceipt,
  type CanonicalReadbackRequest,
  type CanonicalReadbackStatus,
  type OutcomeClassification,
  type OutcomeObservationReceipt,
  type OutcomeObservationRequest,
  type OutcomeReasonCode,
  type Stage5AdmissionReceipt,
  stage5AdmissionReceiptHash,
} from "./contracts";

export type DerivedCanonicalReadback = {
  claims: readonly CanonicalClaim[];
  freshUntil: string | null;
  observedAt: string;
  sourceRefs: readonly string[];
  sourceVersion: string | null;
  status: CanonicalReadbackStatus;
};

export function buildCanonicalReadbackReceipt(input: {
  actor: ApiActor;
  apiDeploymentSha: string;
  derived: DerivedCanonicalReadback;
  request: CanonicalReadbackRequest;
}): CanonicalReadbackReceipt {
  if (input.actor.actorId !== "service:luzione-ui" && input.actor.actorId !== "service:sultan-os") {
    throw new Error("Canonical Sultan readbacks require an exact registered consumer workload.");
  }
  const claims = [...input.derived.claims].sort((left, right) => left.claimId.localeCompare(right.claimId));
  claims.forEach(assertCanonicalClaim);
  if (new Set(claims.map((claim) => claim.claimId)).size !== claims.length) {
    throw new Error("Canonical readback claim IDs must be unique.");
  }
  if (input.derived.status !== "AVAILABLE" && claims.length > 0) {
    throw new Error("Unavailable canonical readbacks cannot carry claims.");
  }
  if (claims.some((claim) => claim.kind !== "FACT" && claim.kind !== "CALCULATION")) {
    throw new Error("Canonical readbacks may contain facts and deterministic calculations only.");
  }
  const withoutHash: Omit<CanonicalReadbackReceipt, "idempotentReplay" | "readbackHash"> = {
    apiDeploymentSha: input.apiDeploymentSha,
    claims: Object.freeze(claims),
    consumer: {
      actorId: input.actor.actorId,
      deploymentSha: input.request.consumerDeploymentSha,
    },
    contractVersion: SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
    freshUntil: input.derived.freshUntil,
    idempotencyKey: input.request.idempotencyKey,
    observedAt: input.derived.observedAt,
    provenance: {
      authority: input.derived.status === "AVAILABLE" ? "CANONICAL_POSTGRES" : "NONE",
      sourceRefs: Object.freeze([...new Set(input.derived.sourceRefs)].sort()),
      sourceVersion: input.derived.sourceVersion,
    },
    readbackReceiptId: `s5read_${sha256([input.actor.tenantId, input.request.idempotencyKey]).slice(0, 32)}`,
    status: input.derived.status,
    subjectId: input.request.subjectId,
    subjectType: input.request.subjectType,
    tenantId: input.actor.tenantId,
  };
  return Object.freeze({
    ...withoutHash,
    idempotentReplay: false,
    readbackHash: canonicalReadbackHash(withoutHash),
  });
}

export function deriveOutcomeClassification(input: {
  admission: Stage5AdmissionReceipt;
  readback: CanonicalReadbackReceipt;
  request: OutcomeObservationRequest;
}): { classification: OutcomeClassification; claim: CanonicalClaim | null; reasonCode: OutcomeReasonCode } {
  if (input.request.mode === "SUPERSEDE") {
    return { classification: "SUPERSEDED", claim: null, reasonCode: "NEWER_CANONICAL_OBSERVATION_SUPERSEDES_PRIOR" };
  }
  const expectation = input.admission.outcomeExpectation;
  if (!expectation) return { classification: "UNRESOLVED", claim: null, reasonCode: "NO_STRUCTURED_EXPECTATION" };
  if (input.readback.subjectId !== expectation.subjectId || input.readback.subjectType !== expectation.subjectType) {
    return { classification: "UNRESOLVED", claim: null, reasonCode: "EXPECTED_SUBJECT_NOT_OBSERVED" };
  }
  if (input.readback.status !== "AVAILABLE") {
    return { classification: "UNRESOLVED", claim: null, reasonCode: "CANONICAL_READBACK_UNAVAILABLE" };
  }
  const claim = input.readback.claims.find((candidate) => candidate.claimId === expectation.claimId) ?? null;
  if (!claim || claim.value === null) {
    return { classification: "UNRESOLVED", claim, reasonCode: "EXPECTED_CLAIM_NOT_OBSERVED" };
  }
  const matches = compare(expectation.expectedValue, claim.value, expectation.operator);
  if (matches === null) return { classification: "UNRESOLVED", claim, reasonCode: "CLAIM_TYPES_NOT_COMPARABLE" };
  return matches
    ? { classification: "CONFIRMED", claim, reasonCode: "CANONICAL_CLAIM_MATCHED" }
    : { classification: "REFUTED", claim, reasonCode: "CANONICAL_CLAIM_CONTRADICTED" };
}

export function buildOutcomeObservationReceipt(input: {
  actor: ApiActor;
  admission: Stage5AdmissionReceipt;
  apiDeploymentSha: string;
  classification: ReturnType<typeof deriveOutcomeClassification>;
  observedAt: string;
  readback: CanonicalReadbackReceipt;
  request: OutcomeObservationRequest;
}): OutcomeObservationReceipt {
  if ((input.actor.actorId !== "service:luzione-ui" && input.actor.actorId !== "service:sultan-os")
    || input.actor.actorType !== "service" || input.actor.tenantId !== "luzione") {
    throw new Error("Outcome observations require an exact registered Luzione workload and tenant.");
  }
  const withoutHash: Omit<OutcomeObservationReceipt, "idempotentReplay" | "receiptHash"> = {
    admissionLineage: {
      admissionReceiptHash: input.admission.receiptHash,
      apiDeploymentSha: input.admission.apiDeploymentSha,
      contextHash: input.admission.participation.contextHash,
      groundingPacketHash: input.admission.participation.groundingPacketHash,
      interactionId: input.admission.interactionId,
      interactionReceiptHash: input.admission.interactionReceiptHash,
      operationId: input.admission.operationId,
      runId: input.admission.runId,
      sultanDeploymentSha: input.admission.participation.sultanDeploymentSha,
    },
    admissionReceiptId: input.admission.admissionReceiptId,
    apiDeploymentSha: input.apiDeploymentSha,
    classification: input.classification.classification,
    contractVersion: SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION,
    evidence: {
      apiDeploymentSha: input.readback.apiDeploymentSha,
      claimId: input.classification.claim?.claimId ?? null,
      observedValue: input.classification.claim?.value ?? null,
      readbackHash: input.readback.readbackHash,
      readbackReceiptId: input.readback.readbackReceiptId,
      sourceRefs: input.readback.provenance.sourceRefs,
    },
    expectationBinding: input.admission.outcomeExpectationBinding,
    idempotencyKey: input.request.idempotencyKey,
    observationId: `s5out_${sha256([input.actor.tenantId, input.request.idempotencyKey]).slice(0, 32)}`,
    observedAt: input.observedAt,
    observer: {
      actorId: input.actor.actorId,
      actorType: input.actor.actorType,
      tenantId: input.actor.tenantId,
    },
    observationRequest: input.request,
    reasonCode: input.classification.reasonCode,
    supersedesObservationId: input.request.supersedesObservationId,
  };
  return Object.freeze({
    ...withoutHash,
    idempotentReplay: false,
    receiptHash: outcomeObservationHash(withoutHash),
  });
}

export function verifyOutcomeObservationReceipt(input: {
  admission: Stage5AdmissionReceipt;
  expectedApiDeploymentSha: string;
  readback: CanonicalReadbackReceipt;
  receipt: OutcomeObservationReceipt;
}) {
  const { idempotentReplay, receiptHash, ...withoutHash } = input.receipt;
  void idempotentReplay;
  const request = input.receipt.observationRequest;
  const derived = deriveOutcomeClassification({
    admission: input.admission,
    readback: input.readback,
    request,
  });
  const terminal = input.receipt.classification === "CONFIRMED"
    || input.receipt.classification === "REFUTED";
  return outcomeObservationHash(withoutHash) === receiptHash
    && verifyStage5AdmissionReceiptIntegrity(input.admission)
    && verifyCanonicalReadbackReceiptIntegrity(input.readback)
    && input.receipt.observer.tenantId === input.admission.credentialActor.tenantId
    && input.receipt.observer.tenantId === input.readback.tenantId
    && input.receipt.observer.actorType === "service"
    && (input.receipt.observer.actorId === "service:luzione-ui"
      || input.receipt.observer.actorId === "service:sultan-os")
    && input.receipt.observationId
      === `s5out_${sha256([input.receipt.observer.tenantId, input.receipt.idempotencyKey]).slice(0, 32)}`
    && input.receipt.admissionReceiptId === input.admission.admissionReceiptId
    && request.contractVersion === SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION
    && request.admissionReceiptId === input.receipt.admissionReceiptId
    && request.readbackReceiptId === input.receipt.evidence.readbackReceiptId
    && request.idempotencyKey === input.receipt.idempotencyKey
    && request.supersedesObservationId === input.receipt.supersedesObservationId
    && ((request.mode === "SUPERSEDE") === (request.supersedesObservationId !== null))
    && Number.isFinite(Date.parse(request.requestedAt))
    && Date.parse(request.requestedAt) >= Date.parse(input.receipt.observedAt)
    && input.receipt.observedAt === input.readback.observedAt
    && Date.parse(input.receipt.observedAt) >= Date.parse(input.admission.decidedAt)
    && input.receipt.classification === derived.classification
    && input.receipt.reasonCode === derived.reasonCode
    && input.receipt.evidence.claimId === (derived.claim?.claimId ?? null)
    && input.receipt.evidence.observedValue === (derived.claim?.value ?? null)
    && sha256(input.receipt.evidence.sourceRefs) === sha256(input.readback.provenance.sourceRefs)
    && (!terminal || input.receipt.expectationBinding.expectationHash !== null)
    && input.receipt.apiDeploymentSha === input.expectedApiDeploymentSha
    && input.receipt.admissionLineage.admissionReceiptHash === input.admission.receiptHash
    && input.receipt.admissionLineage.apiDeploymentSha === input.admission.apiDeploymentSha
    && input.receipt.admissionLineage.contextHash === input.admission.participation.contextHash
    && input.receipt.admissionLineage.groundingPacketHash === input.admission.participation.groundingPacketHash
    && input.receipt.admissionLineage.interactionId === input.admission.interactionId
    && input.receipt.admissionLineage.interactionReceiptHash === input.admission.interactionReceiptHash
    && input.receipt.admissionLineage.operationId === input.admission.operationId
    && input.receipt.admissionLineage.runId === input.admission.runId
    && input.receipt.admissionLineage.sultanDeploymentSha === input.admission.participation.sultanDeploymentSha
    && input.receipt.evidence.apiDeploymentSha === input.readback.apiDeploymentSha
    && input.receipt.evidence.readbackHash === input.readback.readbackHash
    && input.receipt.evidence.readbackReceiptId === input.readback.readbackReceiptId
    && input.receipt.expectationBinding.expectationHash
      === input.admission.outcomeExpectationBinding.expectationHash
    && input.receipt.expectationBinding.interactionReceiptBound
      === input.admission.outcomeExpectationBinding.interactionReceiptBound
    && input.receipt.expectationBinding.proofHash
      === input.admission.outcomeExpectationBinding.proofHash
    && input.receipt.expectationBinding.source
      === input.admission.outcomeExpectationBinding.source;
}

export function verifyCanonicalReadbackReceiptIntegrity(receipt: CanonicalReadbackReceipt) {
  const { idempotentReplay, readbackHash, ...hashMaterial } = receipt;
  void idempotentReplay;
  return canonicalReadbackHash(hashMaterial) === readbackHash
    && receipt.readbackReceiptId
      === `s5read_${sha256([receipt.tenantId, receipt.idempotencyKey]).slice(0, 32)}`;
}

export function verifyStage5AdmissionReceiptIntegrity(receipt: Stage5AdmissionReceipt) {
  const { idempotentReplay, receiptHash, ...hashMaterial } = receipt;
  void idempotentReplay;
  const interaction = receipt.interactionReceipt;
  const {
    interactionId: sourceInteractionId,
    receiptHash: sourceReceiptHash,
    ...sourceHashMaterial
  } = interaction;
  const proof = receipt.outcomeExpectationProof;
  const expectationHash = receipt.outcomeExpectation
    ? outcomeExpectationHash(receipt.outcomeExpectation)
    : null;
  const proofHashValid = proof === null
    ? expectationHash === null
    : outcomeExpectationBindingHash({
      contractVersion: proof.contractVersion,
      expectationHash: proof.expectationHash,
      interactionId: proof.interactionId,
      interactionReceiptHash: proof.interactionReceiptHash,
    }) === proof.bindingHash
      && proof.expectationHash === expectationHash
      && proof.interactionId === receipt.interactionId
      && proof.interactionReceiptHash === receipt.interactionReceiptHash;
  const interactionEvidence = interaction.evidenceRefsUsed.map((evidenceRef, index) => ({
    evidenceHash: interaction.evidenceHashesUsed[index],
    evidenceRef,
  })).filter(({ evidenceRef }) => evidenceRef.startsWith("s5read_"));
  const consumedEvidence = receipt.evidence.consumedEvidence.map(({ evidenceHash, evidenceRef }) => ({
    evidenceHash,
    evidenceRef,
  }));
  const readbackRefs = [...new Map(receipt.evidence.consumedEvidence.map((evidence) => [
    evidence.readbackReceiptId,
    {
      readbackHash: evidence.readbackHash,
      readbackReceiptId: evidence.readbackReceiptId,
    },
  ])).values()];
  const readbackLineage = new Map<string, string>();
  const exactConsumedLineage = receipt.evidence.consumedEvidence.every((evidence) => {
    const priorHash = readbackLineage.get(evidence.readbackReceiptId);
    readbackLineage.set(evidence.readbackReceiptId, evidence.readbackHash);
    return (priorHash === undefined || priorHash === evidence.readbackHash)
      && evidence.evidenceRef === `${evidence.readbackReceiptId}/${evidence.claimId}`;
  });
  const consumedEvidenceRefs = receipt.evidence.consumedEvidence.map((evidence) => evidence.evidenceRef);
  const receiptReadbackIds = [...receipt.evidence.readbackReceiptIds].sort();
  const deniedWithoutVerifiedConsumedEvidence = receipt.status === "DENIED"
    && receipt.evidence.sourceVerification === "FAILED"
    && receipt.evidence.consumedEvidence.length === 0;
  const exactVerifiedEvidence = sha256(interactionEvidence.sort(evidencePairOrder))
      === sha256(consumedEvidence.sort(evidencePairOrder))
    && exactConsumedLineage
    && new Set(consumedEvidenceRefs).size === consumedEvidenceRefs.length
    && sha256(receiptReadbackIds) === sha256([...readbackLineage.keys()].sort())
    && stage5EvidenceRefsHash(readbackRefs) === receipt.evidence.evidenceRefsHash;
  return stage5AdmissionReceiptHash(hashMaterial) === receiptHash
    && receipt.admissionReceiptId
      === `s5admit_${sha256([receipt.credentialActor.tenantId, receipt.operationId]).slice(0, 32)}`
    && sultanInteractionReceiptHash(sourceHashMaterial) === sourceReceiptHash
    && sourceInteractionId === `interaction_${sourceReceiptHash.slice(0, 32)}`
    && sourceInteractionId === receipt.interactionId
    && sourceReceiptHash === receipt.interactionReceiptHash
    && interaction.evidenceRefsUsed.length === interaction.evidenceHashesUsed.length
    && new Set(receiptReadbackIds).size === receiptReadbackIds.length
    && ((receipt.status === "DENIED") === (receipt.evidence.sourceVerification === "FAILED"))
    && (deniedWithoutVerifiedConsumedEvidence || exactVerifiedEvidence)
    && proofHashValid
    && interaction.outcomeExpectationHash === expectationHash
    && receipt.outcomeExpectationBinding.expectationHash === expectationHash
    && receipt.outcomeExpectationBinding.interactionReceiptBound === true
    && receipt.outcomeExpectationBinding.proofHash === (proof?.bindingHash ?? null)
    && receipt.outcomeExpectationBinding.source === (proof
      ? "AUTHENTICATED_SULTAN_INTERACTION_RECEIPT"
      : "NONE");
}

function evidencePairOrder(
  left: { evidenceRef: string },
  right: { evidenceRef: string },
) {
  return left.evidenceRef.localeCompare(right.evidenceRef);
}

export function unavailableCanonicalReadback(
  status: Exclude<CanonicalReadbackStatus, "AVAILABLE">,
  observedAt: string,
): DerivedCanonicalReadback {
  return Object.freeze({ claims: Object.freeze([]), freshUntil: null, observedAt, sourceRefs: Object.freeze([]), sourceVersion: null, status });
}

function compare(
  expected: boolean | number | string,
  observed: boolean | number | string,
  operator: "EQ" | "GTE" | "LTE" | "NE",
) {
  if (operator === "EQ" || operator === "NE") {
    if (typeof expected !== typeof observed) return null;
    const equal = expected === observed;
    return operator === "EQ" ? equal : !equal;
  }
  const expectedNumber = exactComparableNumber(expected);
  const observedNumber = exactComparableNumber(observed);
  if (expectedNumber === null || observedNumber === null) return null;
  const scale = Math.max(expectedNumber.scale, observedNumber.scale);
  const expectedCoefficient = expectedNumber.coefficient * (BigInt(10) ** BigInt(scale - expectedNumber.scale));
  const observedCoefficient = observedNumber.coefficient * (BigInt(10) ** BigInt(scale - observedNumber.scale));
  return operator === "GTE"
    ? observedCoefficient >= expectedCoefficient
    : observedCoefficient <= expectedCoefficient;
}

function exactComparableNumber(value: boolean | number | string) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    return { coefficient: BigInt(value), scale: 0 };
  }
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,6})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${whole}${fraction}`) * (negative ? BigInt(-1) : BigInt(1));
  return { coefficient, scale: fraction.length };
}

function assertCanonicalClaim(claim: CanonicalClaim) {
  if (!/^[a-z][a-zA-Z0-9._-]{2,127}$/.test(claim.claimId)) {
    throw new Error("Canonical claim ID is invalid.");
  }
  if (claim.kind !== "FACT" && claim.kind !== "CALCULATION") {
    throw new Error(`${claim.claimId} has an invalid epistemic kind.`);
  }
  if (claim.unit !== null
    && (typeof claim.unit !== "string" || Buffer.byteLength(claim.unit, "utf8") > 128)) {
    throw new Error(`${claim.claimId} has an invalid unit.`);
  }
  if (claim.value === null) return;
  if (claim.valueType === "BOOLEAN" && typeof claim.value === "boolean") return;
  if (claim.valueType === "INTEGER"
    && typeof claim.value === "number" && Number.isSafeInteger(claim.value)) return;
  if (claim.valueType === "MONEY_MINOR"
    && ((typeof claim.value === "number" && Number.isSafeInteger(claim.value))
      || (typeof claim.value === "string" && /^-?(0|[1-9][0-9]{0,14})$/.test(claim.value)))) return;
  if (claim.valueType === "NUMBER"
    && ((typeof claim.value === "number" && Number.isSafeInteger(claim.value))
      || (typeof claim.value === "string"
        && /^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,6})?$/.test(claim.value)))) return;
  if (claim.valueType === "STRING" && typeof claim.value === "string"
    && Buffer.byteLength(claim.value, "utf8") <= 2_048) return;
  if (claim.valueType === "TIMESTAMP" && typeof claim.value === "string"
    && Number.isFinite(Date.parse(claim.value))
    && new Date(claim.value).toISOString() === claim.value) return;
  throw new Error(`${claim.claimId} value does not match its exact canonical valueType.`);
}
