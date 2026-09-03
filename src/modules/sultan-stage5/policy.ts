import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION,
  SULTAN_STAGE5_ADMISSION_TIMING,
  SULTAN_STAGE5_POLICY_VERSION,
  stage5AdmissionReceiptHash,
  stage5EvidenceRefsHash,
  type CanonicalSubjectType,
  type Stage5AdmissionAssertion,
  type Stage5AdmissionReceipt,
  type Stage5Pins,
  type VerifiedCanonicalReadbackRef,
} from "./contracts";

type AgentPolicy = {
  agentId: string;
  agentVersion: string;
  capabilities: readonly string[];
  caseTypes: readonly Stage5AdmissionAssertion["caseRef"]["caseType"][];
  purposes: readonly string[];
};

export const stage5AgentRegistry: readonly AgentPolicy[] = Object.freeze([
  agentPolicy("agent.sultan.supervisor", ["PORTFOLIO"], ["analysis.read"], ["agent-case-post-inference"]),
  agentPolicy("agent.luzione.revenue-steward", ["COMMERCIAL"], ["analysis.read"], ["agent-case-post-inference"]),
  agentPolicy("agent.luzione.fulfillment-steward", ["FULFILLMENT"], ["analysis.read"], ["agent-case-post-inference"]),
  agentPolicy("agent.luzione.partner-network-steward", ["PARTNER_RELATIONSHIP"], ["analysis.read"], ["agent-case-post-inference"]),
  agentPolicy("agent.luzione.catalog-steward", ["CATALOG_QUALITY"], ["analysis.read"], ["agent-case-post-inference"]),
  agentPolicy("agent.luzione.account-relationship-steward", ["ACCOUNT_RELATIONSHIP"], ["analysis.read"], ["agent-case-post-inference"]),
  agentPolicy("agent.luzione.economic-integrity-steward", ["ECONOMIC_REVIEW"], ["analysis.read"], ["agent-case-post-inference"]),
  agentPolicy("agent.fep.case-steward", ["FEP_CASE"], ["analysis.read"], ["agent-case-post-inference"]),
]);

export const stage5NonConsumingAgentExclusions = Object.freeze([
  Object.freeze({ agentId: "agent.sultan.chat", agentVersion: "v1", reason: "Chat may consume canonical readbacks but has no durable agent-case run or API admission/effect pathway." }),
  Object.freeze({ agentId: "agent.control.independent-critic", agentVersion: "v1", reason: "Bound as the exact independent critic on a primary admission; it cannot self-admit as primary." }),
  Object.freeze({ agentId: "agent.control.readback-verifier", agentVersion: "v1", reason: "Consumes immutable API receipts inside Sultan OS and does not initiate API-admitted model inference." }),
  Object.freeze({ agentId: "agent.control.process-engineer", agentVersion: "v1", reason: "Consumes reviewed outcome evidence inside Sultan OS and has no direct API reasoning or effect capability." }),
]);

export type AdmissionEvaluation = {
  receipt: Stage5AdmissionReceipt;
  requestHash: string;
};

export function evaluateStage5Admission(input: {
  actor: ApiActor;
  assertion: Stage5AdmissionAssertion;
  decidedAt: string;
  pins: Stage5Pins;
  readbacks: readonly VerifiedCanonicalReadbackRef[];
  requestHash: string;
}): AdmissionEvaluation {
  const { actor, assertion, pins } = input;
  const reasons: string[] = [];
  const policy = stage5AgentRegistry.find((candidate) =>
    candidate.agentId === assertion.logicalAgent.agentId
    && candidate.agentVersion === assertion.logicalAgent.agentVersion);

  if (actor.source !== "vercel-oidc" || actor.actorId !== "service:sultan-os" || actor.actorType !== "service") {
    reasons.push("SULTAN_WORKLOAD_IDENTITY_REQUIRED");
  }
  if (actor.tenantId !== "luzione") reasons.push("TENANT_BINDING_MISMATCH");
  if (!actor.capabilities.includes("sultan.stage5.admission.request")) reasons.push("ADMISSION_CAPABILITY_MISSING");
  if (!actor.capabilities.includes(assertion.requestedCapability)) reasons.push("WORKLOAD_CAPABILITY_MISMATCH");
  if (!policy) {
    reasons.push("AGENT_REGISTRATION_MISSING");
  } else {
    if (!policy.caseTypes.includes(assertion.caseRef.caseType)) reasons.push("AGENT_CASE_SCOPE_MISMATCH");
    if (!policy.purposes.includes(assertion.purpose)) reasons.push("AGENT_PURPOSE_MISMATCH");
    if (!phaseCapabilityAllowed(assertion, policy)) reasons.push("AGENT_CAPABILITY_MISMATCH");
  }
  if (!sameAgent(assertion.logicalAgent, assertion.participation.primaryAgent)) {
    reasons.push("PRIMARY_AGENT_MISMATCH");
  }
  if (assertion.phase === "EXECUTION") {
    reasons.push("EXECUTION_BOUNDARY_SEPARATION_REQUIRED");
  }
  if (assertion.participation.criticAgent.agentId !== "agent.control.independent-critic"
    || assertion.participation.criticAgent.agentVersion !== "v1") {
    reasons.push("INDEPENDENT_CRITIC_IDENTITY_MISMATCH");
  }
  if (assertion.participation.contractVersion !== pins.participationContractVersion) {
    reasons.push("PARTICIPATION_CONTRACT_VERSION_MISMATCH");
  }
  if (assertion.participation.contractSha !== pins.participationContractSha) {
    reasons.push("PARTICIPATION_CONTRACT_SHA_MISMATCH");
  }
  if (assertion.participation.sultanDeploymentSha !== pins.sultanDeploymentSha) {
    reasons.push("SULTAN_DEPLOYMENT_SHA_MISMATCH");
  }
  if (assertion.participation.groundingAssemblerDeploymentSha !== pins.uiDeploymentSha) {
    reasons.push("UI_DEPLOYMENT_SHA_MISMATCH");
  }
  if (assertion.interactionReceipt.tenantId !== actor.tenantId) {
    reasons.push("INTERACTION_RECEIPT_TENANT_MISMATCH");
  }
  const expectedSurface = "AGENT_CASE";
  if (assertion.interactionReceipt.surface !== expectedSurface) {
    reasons.push("INTERACTION_RECEIPT_SURFACE_MISMATCH");
  }
  if (assertion.interactionReceipt.status !== "READY") {
    reasons.push("INTERACTION_RECEIPT_NOT_READY");
  }
  if (assertion.interactionReceipt.interactionId !== assertion.interactionId
    || assertion.interactionReceipt.receiptHash !== assertion.interactionReceiptHash) {
    reasons.push("INTERACTION_RECEIPT_IDENTITY_MISMATCH");
  }
  if (assertion.interactionReceipt.sourceRunIdHash !== sha256(assertion.runId)) {
    reasons.push("INTERACTION_RUN_HASH_MISMATCH");
  }
  if (assertion.interactionReceipt.contextHash !== assertion.participation.contextHash) {
    reasons.push("INTERACTION_CONTEXT_HASH_MISMATCH");
  }
  if (assertion.interactionReceipt.deploymentSha !== assertion.participation.sultanDeploymentSha
    || assertion.interactionReceipt.deploymentSha !== pins.sultanDeploymentSha) {
    reasons.push("INTERACTION_DEPLOYMENT_SHA_MISMATCH");
  }
  if (assertion.interactionReceipt.groundingPacketHash !== assertion.participation.groundingPacketHash) {
    reasons.push("INTERACTION_GROUNDING_HASH_MISMATCH");
  }
  if (assertion.interactionReceipt.groundingAssemblerWorkloadId !== "service:luzione-ui"
    || assertion.interactionReceipt.groundingAssemblerDeploymentSha !== assertion.participation.groundingAssemblerDeploymentSha
    || assertion.interactionReceipt.groundingAssemblerDeploymentSha !== pins.uiDeploymentSha) {
    reasons.push("INTERACTION_GROUNDING_ASSEMBLER_MISMATCH");
  }
  if (assertion.interactionReceipt.identityContractHash !== assertion.participation.identityContractHash
    || assertion.interactionReceipt.identityContractVersion !== assertion.participation.identityContractVersion) {
    reasons.push("INTERACTION_IDENTITY_CONTRACT_MISMATCH");
  }
  if (assertion.interactionReceipt.participantSetHash !== assertion.participation.participantSetHash) {
    reasons.push("INTERACTION_PARTICIPANT_SET_MISMATCH");
  }
  if (assertion.interactionReceipt.modelVersion !== assertion.participation.modelVersion) {
    reasons.push("INTERACTION_MODEL_VERSION_MISMATCH");
  }
  if (assertion.interactionReceipt.occurredAt !== assertion.requestedAt) {
    reasons.push("INTERACTION_TIMESTAMP_MISMATCH");
  }

  const requestMillis = Date.parse(assertion.requestedAt);
  const decisionMillis = Date.parse(input.decidedAt);
  if (!Number.isFinite(requestMillis) || !Number.isFinite(decisionMillis)
    || requestMillis > decisionMillis + 30_000
    || decisionMillis - requestMillis > pins.maximumEvidenceAgeMs) {
    reasons.push("ADMISSION_REQUEST_STALE");
  }
  if (input.readbacks.length !== assertion.evidence.readbackReceiptIds.length) {
    reasons.push("EVIDENCE_RECEIPT_MISSING");
  }
  const expectedReceiptIds = [...assertion.evidence.readbackReceiptIds].sort();
  const observedReceiptIds = input.readbacks.map((readback) => readback.readbackReceiptId).sort();
  if (JSON.stringify(expectedReceiptIds) !== JSON.stringify(observedReceiptIds)) {
    reasons.push("EVIDENCE_RECEIPT_SET_MISMATCH");
  }
  if (input.readbacks.some((readback) => readback.tenantId !== actor.tenantId)) {
    reasons.push("CROSS_TENANT_EVIDENCE");
  }
  if (input.readbacks.some((readback) => readback.apiDeploymentSha !== pins.apiDeploymentSha)) {
    reasons.push("CANONICAL_READBACK_API_SHA_MISMATCH");
  }
  if (input.readbacks.some((readback) => readback.status !== "AVAILABLE")) {
    reasons.push("EVIDENCE_NOT_AVAILABLE");
  }
  if (input.readbacks.some((readback) => !readback.freshUntil
    || Date.parse(readback.freshUntil) <= decisionMillis
    || decisionMillis - Date.parse(readback.observedAt) > pins.maximumEvidenceAgeMs)) {
    reasons.push("EVIDENCE_STALE");
  }
  const hasUiGroundingEvidence = input.readbacks.some((readback) =>
    readback.consumerActorId === "service:luzione-ui"
    && readback.consumerReleaseSha === pins.uiDeploymentSha);
  if (!hasUiGroundingEvidence) reasons.push("UI_GROUNDING_READBACK_REQUIRED");
  if (assertion.outcomeExpectation && !input.readbacks.some((readback) =>
    readback.subjectId === assertion.outcomeExpectation?.subjectId
    && readback.subjectType === assertion.outcomeExpectation.subjectType)) {
    reasons.push("OUTCOME_EXPECTATION_SUBJECT_NOT_GROUNDED");
  }
  if (assertion.outcomeExpectation
    && !outcomeSubjectAllowedForCase(assertion.caseRef.caseType, assertion.outcomeExpectation.subjectType)) {
    reasons.push("OUTCOME_EXPECTATION_CASE_SCOPE_MISMATCH");
  }
  const evidenceRefsHash = stage5EvidenceRefsHash(input.readbacks);
  if (assertion.evidence.evidenceRefsHash !== evidenceRefsHash) {
    reasons.push("EVIDENCE_HASH_MISMATCH");
  }
  const consumedEvidence = exactConsumedEvidence(assertion, input.readbacks);
  if (consumedEvidence === null) {
    reasons.push("INTERACTION_CONSUMED_EVIDENCE_MISMATCH");
  }
  if (assertion.outcomeExpectation && !consumedEvidence?.some((evidence) => {
    const readback = input.readbacks.find((candidate) =>
      candidate.readbackReceiptId === evidence.readbackReceiptId);
    return evidence.claimId === assertion.outcomeExpectation?.claimId
      && readback?.subjectId === assertion.outcomeExpectation.subjectId
      && readback.subjectType === assertion.outcomeExpectation.subjectType;
  })) {
    reasons.push("OUTCOME_EXPECTATION_CLAIM_NOT_EXACTLY_CONSUMED");
  }

  if (assertion.purpose === "agent-case-post-inference"
    && (assertion.phase !== "SIMULATION"
      || assertion.requestedCapability !== "analysis.read"
      || assertion.requestedEffectClass !== "A0"
      || assertion.interactionReceipt.surface !== "AGENT_CASE")) {
    reasons.push("POST_INFERENCE_PURPOSE_SCOPE_MISMATCH");
  }
  const requestedNoEffect = assertion.requestedEffectClass === "A0";
  const noEffectPhase = assertion.phase === "REASONING"
    || assertion.phase === "SIMULATION"
    || assertion.phase === "OBSERVATION";
  if (noEffectPhase && !requestedNoEffect) reasons.push("PHASE_EFFECT_MISMATCH");
  if (!noEffectPhase && requestedNoEffect) reasons.push("PHASE_EFFECT_MISMATCH");

  const denial = reasons.length > 0;
  const separateReview = !denial && !noEffectPhase;
  const status = denial
    ? "DENIED" as const
    : separateReview
      ? "SEPARATE_REVIEW_REQUIRED" as const
      : "ADMITTED_NO_EFFECT" as const;
  const receiptWithoutHash: Omit<Stage5AdmissionReceipt, "idempotentReplay" | "receiptHash"> = {
    admittedEffectClass: status === "ADMITTED_NO_EFFECT" ? "A0" : "NONE",
    admissionTiming: SULTAN_STAGE5_ADMISSION_TIMING,
    admissionReceiptId: admissionReceiptId(actor.tenantId, assertion.operationId),
    apiDeploymentSha: pins.apiDeploymentSha,
    authorizesInference: false,
    caseRef: assertion.caseRef,
    contractVersion: SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION,
    credentialActor: {
      actorId: actor.actorId,
      actorType: actor.actorType,
      source: actor.source,
      tenantId: actor.tenantId,
    },
    decidedAt: input.decidedAt,
    effectAuthority: status === "ADMITTED_NO_EFFECT"
      ? "NO_EFFECT"
      : status === "SEPARATE_REVIEW_REQUIRED"
        ? "SEPARATE_REVIEW_REQUIRED"
        : "NOT_GRANTED",
    evidence: {
      consumedEvidence: Object.freeze(consumedEvidence ?? []),
      evidenceRefsHash,
      readbackReceiptIds: Object.freeze(observedReceiptIds),
      sourceVerification: denial ? "FAILED" : "API_CANONICAL_READBACKS_VERIFIED_CONTEXT_HASH_SULTAN_ASSERTED",
    },
    externalEffectsAuthorized: false,
    idempotencyKey: assertion.idempotencyKey,
    interactionId: assertion.interactionId,
    interactionReceipt: assertion.interactionReceipt,
    interactionReceiptHash: assertion.interactionReceiptHash,
    logicalAgent: assertion.logicalAgent,
    operationId: assertion.operationId,
    outcomeExpectation: assertion.outcomeExpectation,
    outcomeExpectationBinding: {
      expectationHash: assertion.outcomeExpectationProof?.expectationHash ?? null,
      interactionReceiptBound: true,
      proofHash: assertion.outcomeExpectationProof?.bindingHash ?? null,
      source: assertion.outcomeExpectationProof
        ? "AUTHENTICATED_SULTAN_INTERACTION_RECEIPT"
        : "NONE",
    },
    outcomeExpectationProof: assertion.outcomeExpectationProof,
    participation: assertion.participation,
    phase: assertion.phase,
    policyVersion: SULTAN_STAGE5_POLICY_VERSION,
    purpose: assertion.purpose,
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    requestedAt: assertion.requestedAt,
    requestedCapability: assertion.requestedCapability,
    requestedEffectClass: assertion.requestedEffectClass,
    runId: assertion.runId,
    status,
  };
  return {
    receipt: Object.freeze({
      ...receiptWithoutHash,
      idempotentReplay: false,
      receiptHash: stage5AdmissionReceiptHash(receiptWithoutHash),
    }),
    requestHash: input.requestHash,
  };
}

function phaseCapabilityAllowed(assertion: Stage5AdmissionAssertion, policy: AgentPolicy) {
  if (assertion.phase === "EXECUTION") return false;
  return policy.capabilities.includes(assertion.requestedCapability);
}

function exactConsumedEvidence(
  assertion: Stage5AdmissionAssertion,
  readbacks: readonly VerifiedCanonicalReadbackRef[],
): Stage5AdmissionReceipt["evidence"]["consumedEvidence"] | null {
  if (assertion.interactionReceipt.evidenceRefsUsed.length
    !== assertion.interactionReceipt.evidenceHashesUsed.length) return null;
  const readbacksById = new Map(readbacks.map((readback) => [readback.readbackReceiptId, readback]));
  const claimedIds = new Set(assertion.evidence.readbackReceiptIds);
  const usedIds = new Set<string>();
  const consumed: Array<Stage5AdmissionReceipt["evidence"]["consumedEvidence"][number]> = [];
  for (const [index, evidenceRef] of assertion.interactionReceipt.evidenceRefsUsed.entries()) {
    const match = /^(s5read_[a-f0-9]{32})\/([a-z][a-zA-Z0-9._-]{2,127})$/.exec(evidenceRef);
    if (!match) {
      if (evidenceRef.startsWith("s5read_")) return null;
      continue;
    }
    const [, readbackReceiptId, claimId] = match;
    if (!claimedIds.has(readbackReceiptId)) return null;
    const readback = readbacksById.get(readbackReceiptId);
    const evidenceHash = assertion.interactionReceipt.evidenceHashesUsed[index];
    const exactClaim = readback?.claimEvidence.find((claim) =>
      claim.claimId === claimId
      && claim.evidenceRef === evidenceRef
      && claim.evidenceHash === evidenceHash);
    if (!readback || !exactClaim) return null;
    usedIds.add(readbackReceiptId);
    consumed.push(Object.freeze({
      claimId,
      evidenceHash,
      evidenceRef,
      readbackHash: readback.readbackHash,
      readbackReceiptId,
    }));
  }
  if (usedIds.size !== claimedIds.size
    || [...claimedIds].some((receiptId) => !usedIds.has(receiptId))) return null;
  return Object.freeze(consumed.sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef)));
}

function sameAgent(left: Stage5AdmissionAssertion["logicalAgent"], right: Stage5AdmissionAssertion["logicalAgent"]) {
  return left.agentId === right.agentId && left.agentVersion === right.agentVersion;
}

function outcomeSubjectAllowedForCase(
  caseType: Stage5AdmissionAssertion["caseRef"]["caseType"],
  subjectType: CanonicalSubjectType,
) {
  const allowed: Record<Stage5AdmissionAssertion["caseRef"]["caseType"], readonly CanonicalSubjectType[]> = {
    PORTFOLIO: ["ORDER", "SHIPMENT", "ACCOUNT", "OPPORTUNITY", "COMMITMENT", "LOGISTICS", "ECONOMIC_CALCULATION", "FEP_ALLOCATION"],
    COMMERCIAL: ["ACCOUNT", "OPPORTUNITY", "COMMITMENT"],
    FULFILLMENT: ["ORDER", "SHIPMENT", "LOGISTICS", "COMMITMENT"],
    PARTNER_RELATIONSHIP: ["ACCOUNT", "COMMITMENT"],
    CATALOG_QUALITY: ["ORDER", "COMMITMENT"],
    ACCOUNT_RELATIONSHIP: ["ACCOUNT", "OPPORTUNITY", "COMMITMENT"],
    ECONOMIC_REVIEW: ["ECONOMIC_CALCULATION", "ORDER", "OPPORTUNITY", "COMMITMENT"],
    FEP_CASE: ["FEP_ALLOCATION", "ECONOMIC_CALCULATION", "COMMITMENT"],
    CONTROL_REVIEW: ["COMMITMENT"],
  };
  return allowed[caseType].includes(subjectType);
}

function admissionReceiptId(tenantId: string, operationId: string) {
  return `s5admit_${sha256([tenantId, operationId]).slice(0, 32)}`;
}

function agentPolicy(
  agentId: string,
  caseTypes: AgentPolicy["caseTypes"],
  capabilities: readonly string[],
  purposes: readonly string[],
): AgentPolicy {
  const registeredCapabilities = purposes.includes("outcome-observation")
    ? [...new Set([...capabilities, "sultan.outcome.observe"])]
    : [...capabilities];
  return Object.freeze({ agentId, agentVersion: "v1", capabilities: Object.freeze(registeredCapabilities), caseTypes: Object.freeze(caseTypes), purposes: Object.freeze(purposes) });
}
