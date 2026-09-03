import {
  SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION,
  SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
  SULTAN_STAGE5_INTERACTION_RECEIPT_VERSION,
  SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION,
  SULTAN_STAGE5_OUTCOME_EXPECTATION_BINDING_VERSION,
  SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION,
  canonicalSubjectTypes,
  outcomeExpectationBindingHash,
  outcomeExpectationHash,
  sultanInteractionReceiptHash,
  stage5Phases,
  type CanonicalReadbackRequest,
  type OutcomeObservationRequest,
  type OutcomeExpectationProof,
  type Stage5AdmissionAssertion,
  type Stage5AgentRef,
  type Stage5CaseRef,
  type Stage5OutcomeExpectation,
  type SultanInteractionReceiptProof,
} from "./contracts";

type JsonObject = Record<string, unknown>;

export class SultanStage5ContractError extends Error {
  constructor(
    readonly code:
      | "CLIENT_AUTHORITY_REJECTED"
      | "INVALID_ADMISSION_ASSERTION"
      | "INVALID_CANONICAL_READBACK_REQUEST"
      | "INVALID_OUTCOME_OBSERVATION_REQUEST"
      | "UNSUPPORTED_CONTRACT_VERSION",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SultanStage5ContractError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;
const AGENT_ID = /^agent\.[a-z0-9][a-z0-9.-]{1,126}$/;
const CAPABILITY = /^[a-z][a-z0-9._-]{2,127}$/;
const PURPOSE = /^[a-z][a-z0-9._-]{2,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "actor",
  "actorId",
  "actorType",
  "allowedEffect",
  "approval",
  "approvalId",
  "authority",
  "authorityGrant",
  "capabilities",
  "credentials",
  "grant",
  "memory",
  "memories",
  "messages",
  "policyDecision",
  "prompt",
  "rawPrompt",
  "rawResponse",
  "response",
  "roles",
  "secret",
  "secrets",
  "systemPrompt",
  "tenant",
  "tenantId",
  "tenant_id",
  "token",
]);

export function parseStage5AdmissionAssertion(value: unknown): Stage5AdmissionAssertion {
  const envelope = object(value, "request", "INVALID_ADMISSION_ASSERTION");
  exactKeys(envelope, ["admission"], "request", "INVALID_ADMISSION_ASSERTION");
  const input = object(envelope.admission, "admission", "INVALID_ADMISSION_ASSERTION");
  const { interactionReceipt: untrustedInteractionReceipt, ...authorityCheckedInput } = input;
  void untrustedInteractionReceipt;
  rejectAuthority(authorityCheckedInput, "admission");
  exactKeys(input, [
    "caseRef", "contractVersion", "evidence", "idempotencyKey", "interactionId",
    "interactionReceipt", "interactionReceiptHash", "logicalAgent", "operationId", "outcomeExpectation",
    "outcomeExpectationProof", "participation", "phase", "purpose", "requestedAt",
    "requestedCapability", "requestedEffectClass", "runId",
  ], "admission", "INVALID_ADMISSION_ASSERTION");
  if (input.contractVersion !== SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION) {
    throw new SultanStage5ContractError(
      "UNSUPPORTED_CONTRACT_VERSION",
      `admission.contractVersion must be ${SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION}.`,
    );
  }
  const evidence = object(input.evidence, "admission.evidence", "INVALID_ADMISSION_ASSERTION");
  exactKeys(evidence, ["evidenceRefsHash", "readbackReceiptIds"], "admission.evidence", "INVALID_ADMISSION_ASSERTION");
  if (!Array.isArray(evidence.readbackReceiptIds)
    || evidence.readbackReceiptIds.length < 1
    || evidence.readbackReceiptIds.length > 64) {
    invalid("admission.evidence.readbackReceiptIds must contain 1 through 64 exact receipt IDs.");
  }
  const readbackReceiptIds = evidence.readbackReceiptIds.map((item, index) =>
    id(item, `admission.evidence.readbackReceiptIds[${index}]`));
  if (new Set(readbackReceiptIds).size !== readbackReceiptIds.length) {
    invalid("admission.evidence.readbackReceiptIds must be unique.");
  }
  const participation = object(input.participation, "admission.participation", "INVALID_ADMISSION_ASSERTION");
  exactKeys(participation, [
    "contextHash", "contractSha", "contractVersion", "criticAgent", "groundingAssemblerDeploymentSha", "groundingPacketHash",
    "identityContractHash", "identityContractVersion", "modelVersion", "participantSetHash", "primaryAgent",
    "sultanDeploymentSha",
  ], "admission.participation", "INVALID_ADMISSION_ASSERTION");
  if (participation.contractVersion !== SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION) {
    throw new SultanStage5ContractError(
      "UNSUPPORTED_CONTRACT_VERSION",
      `admission.participation.contractVersion must be ${SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION}.`,
    );
  }
  const requestedEffectClass = enumValue(
    input.requestedEffectClass,
    ["A0", "A1", "A2", "A3"] as const,
    "admission.requestedEffectClass",
  );
  const outcomeExpectation = input.outcomeExpectation === null
    ? null
    : parseExpectation(input.outcomeExpectation);
  const interactionReceipt = parseSultanInteractionReceipt(input.interactionReceipt);
  const outcomeExpectationProof = input.outcomeExpectationProof === null
    ? null
    : parseOutcomeExpectationProof(input.outcomeExpectationProof);
  const interactionId = id(input.interactionId, "admission.interactionId");
  const interactionReceiptHash = hash(input.interactionReceiptHash, "admission.interactionReceiptHash");
  verifyOutcomeExpectationBinding({
    interactionId,
    interactionReceipt,
    interactionReceiptHash,
    outcomeExpectation,
    outcomeExpectationProof,
  });
  return Object.freeze({
    caseRef: parseCaseRef(input.caseRef),
    contractVersion: SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION,
    evidence: Object.freeze({
      evidenceRefsHash: hash(inputValue(evidence, "evidenceRefsHash"), "admission.evidence.evidenceRefsHash"),
      readbackReceiptIds: Object.freeze(readbackReceiptIds),
    }),
    idempotencyKey: id(input.idempotencyKey, "admission.idempotencyKey"),
    interactionId,
    interactionReceipt,
    interactionReceiptHash,
    logicalAgent: parseAgent(input.logicalAgent, "admission.logicalAgent"),
    operationId: id(input.operationId, "admission.operationId"),
    outcomeExpectation,
    outcomeExpectationProof,
    participation: Object.freeze({
      contextHash: hash(participation.contextHash, "admission.participation.contextHash"),
      contractSha: gitSha(participation.contractSha, "admission.participation.contractSha"),
      contractVersion: SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION,
      criticAgent: parseAgent(participation.criticAgent, "admission.participation.criticAgent"),
      groundingAssemblerDeploymentSha: gitSha(participation.groundingAssemblerDeploymentSha, "admission.participation.groundingAssemblerDeploymentSha"),
      groundingPacketHash: hash(participation.groundingPacketHash, "admission.participation.groundingPacketHash"),
      identityContractHash: hash(participation.identityContractHash, "admission.participation.identityContractHash"),
      identityContractVersion: stable(participation.identityContractVersion, "admission.participation.identityContractVersion", 256),
      modelVersion: stable(participation.modelVersion, "admission.participation.modelVersion", 256),
      participantSetHash: hash(participation.participantSetHash, "admission.participation.participantSetHash"),
      primaryAgent: parseAgent(participation.primaryAgent, "admission.participation.primaryAgent"),
      sultanDeploymentSha: gitSha(participation.sultanDeploymentSha, "admission.participation.sultanDeploymentSha"),
    }),
    phase: enumValue(input.phase, stage5Phases, "admission.phase"),
    purpose: pattern(input.purpose, "admission.purpose", PURPOSE),
    requestedAt: timestamp(input.requestedAt, "admission.requestedAt"),
    requestedCapability: pattern(input.requestedCapability, "admission.requestedCapability", CAPABILITY),
    requestedEffectClass,
    runId: id(input.runId, "admission.runId"),
  });
}

export function parseCanonicalReadbackRequest(value: unknown): CanonicalReadbackRequest {
  const code = "INVALID_CANONICAL_READBACK_REQUEST" as const;
  const envelope = object(value, "request", "INVALID_CANONICAL_READBACK_REQUEST");
  exactKeys(envelope, ["readback"], "request", "INVALID_CANONICAL_READBACK_REQUEST");
  const input = object(envelope.readback, "readback", "INVALID_CANONICAL_READBACK_REQUEST");
  rejectAuthority(input, "readback");
  exactKeys(input, [
    "consumerDeploymentSha", "contractVersion", "idempotencyKey", "requestedAt",
    "subjectId", "subjectType",
  ], "readback", "INVALID_CANONICAL_READBACK_REQUEST");
  if (input.contractVersion !== SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION) {
    throw new SultanStage5ContractError(
      "UNSUPPORTED_CONTRACT_VERSION",
      `readback.contractVersion must be ${SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION}.`,
    );
  }
  return Object.freeze({
    consumerDeploymentSha: gitSha(input.consumerDeploymentSha, "readback.consumerDeploymentSha", code),
    contractVersion: SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
    idempotencyKey: id(input.idempotencyKey, "readback.idempotencyKey", code),
    requestedAt: timestamp(input.requestedAt, "readback.requestedAt", code),
    subjectId: id(input.subjectId, "readback.subjectId", code),
    subjectType: enumValue(input.subjectType, canonicalSubjectTypes, "readback.subjectType", code),
  });
}

export function parseOutcomeObservationRequest(value: unknown): OutcomeObservationRequest {
  const code = "INVALID_OUTCOME_OBSERVATION_REQUEST" as const;
  const envelope = object(value, "request", "INVALID_OUTCOME_OBSERVATION_REQUEST");
  exactKeys(envelope, ["observation"], "request", "INVALID_OUTCOME_OBSERVATION_REQUEST");
  const input = object(envelope.observation, "observation", "INVALID_OUTCOME_OBSERVATION_REQUEST");
  rejectAuthority(input, "observation");
  exactKeys(input, [
    "admissionReceiptId", "contractVersion", "idempotencyKey", "mode",
    "readbackReceiptId", "requestedAt", "supersedesObservationId",
  ], "observation", "INVALID_OUTCOME_OBSERVATION_REQUEST");
  if (input.contractVersion !== SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION) {
    throw new SultanStage5ContractError(
      "UNSUPPORTED_CONTRACT_VERSION",
      `observation.contractVersion must be ${SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION}.`,
    );
  }
  const mode = enumValue(input.mode, ["OBSERVE", "SUPERSEDE"] as const, "observation.mode", code);
  const supersedesObservationId = input.supersedesObservationId === null
    ? null
    : id(input.supersedesObservationId, "observation.supersedesObservationId", code);
  if ((mode === "SUPERSEDE") !== Boolean(supersedesObservationId)) {
    outcomeInvalid("SUPERSEDE requires supersedesObservationId; OBSERVE forbids it.");
  }
  return Object.freeze({
    admissionReceiptId: id(input.admissionReceiptId, "observation.admissionReceiptId", code),
    contractVersion: SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION,
    idempotencyKey: id(input.idempotencyKey, "observation.idempotencyKey", code),
    mode,
    readbackReceiptId: id(input.readbackReceiptId, "observation.readbackReceiptId", code),
    requestedAt: timestamp(input.requestedAt, "observation.requestedAt", code),
    supersedesObservationId,
  });
}

function parseSultanInteractionReceipt(value: unknown): SultanInteractionReceiptProof {
  const input = object(value, "admission.interactionReceipt", "INVALID_ADMISSION_ASSERTION");
  exactKeys(input, [
    "actorId", "contextHash", "contractVersion", "controls", "deploymentSha",
    "evidenceHashesUsed", "evidenceRefsUsed", "groundingAssemblerDeploymentSha",
    "groundingAssemblerWorkloadId", "groundingPacketHash", "identityContractHash",
    "identityContractVersion", "interactionId", "model", "modelVersion", "occurredAt",
    "outcomeExpectationHash", "participantSetHash", "queryHash", "receiptHash",
    "responseHash", "schemaVersion", "shadowReviewRefsUsed", "sourceInteractionRefHash",
    "sourceRunIdHash", "status", "surface", "tenantId",
  ], "admission.interactionReceipt", "INVALID_ADMISSION_ASSERTION");
  const controls = object(input.controls, "admission.interactionReceipt.controls", "INVALID_ADMISSION_ASSERTION");
  exactKeys(controls, [
    "authorityGranted", "businessStateMutated", "canonicalBeliefChanged",
    "canonicalMemoryChanged", "externalEffectAuthorized", "learningState",
    "noRawPromptPersisted", "noRawResponsePersisted", "policyChanged",
    "reviewRequiredForPromotion",
  ], "admission.interactionReceipt.controls", "INVALID_ADMISSION_ASSERTION");
  const receipt: SultanInteractionReceiptProof = Object.freeze({
    actorId: pattern(input.actorId, "admission.interactionReceipt.actorId", /^(?:user_[a-f0-9]{64}|operator:[A-Za-z0-9._:@/-]{1,240})$/),
    contextHash: hash(input.contextHash, "admission.interactionReceipt.contextHash"),
    contractVersion: exactLiteral(input.contractVersion, SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION, "admission.interactionReceipt.contractVersion"),
    controls: Object.freeze({
      authorityGranted: exactFalse(controls.authorityGranted, "admission.interactionReceipt.controls.authorityGranted"),
      businessStateMutated: exactFalse(controls.businessStateMutated, "admission.interactionReceipt.controls.businessStateMutated"),
      canonicalBeliefChanged: exactFalse(controls.canonicalBeliefChanged, "admission.interactionReceipt.controls.canonicalBeliefChanged"),
      canonicalMemoryChanged: exactFalse(controls.canonicalMemoryChanged, "admission.interactionReceipt.controls.canonicalMemoryChanged"),
      externalEffectAuthorized: exactFalse(controls.externalEffectAuthorized, "admission.interactionReceipt.controls.externalEffectAuthorized"),
      learningState: exactLiteral(controls.learningState, "OBSERVATION_ONLY", "admission.interactionReceipt.controls.learningState"),
      noRawPromptPersisted: exactTrue(controls.noRawPromptPersisted, "admission.interactionReceipt.controls.noRawPromptPersisted"),
      noRawResponsePersisted: exactTrue(controls.noRawResponsePersisted, "admission.interactionReceipt.controls.noRawResponsePersisted"),
      policyChanged: exactFalse(controls.policyChanged, "admission.interactionReceipt.controls.policyChanged"),
      reviewRequiredForPromotion: exactTrue(controls.reviewRequiredForPromotion, "admission.interactionReceipt.controls.reviewRequiredForPromotion"),
    }),
    deploymentSha: gitSha(input.deploymentSha, "admission.interactionReceipt.deploymentSha"),
    evidenceHashesUsed: Object.freeze(hashArray(input.evidenceHashesUsed, "admission.interactionReceipt.evidenceHashesUsed", 11)),
    evidenceRefsUsed: Object.freeze(idArray(input.evidenceRefsUsed, "admission.interactionReceipt.evidenceRefsUsed", 11)),
    groundingAssemblerDeploymentSha: nullableGitSha(input.groundingAssemblerDeploymentSha, "admission.interactionReceipt.groundingAssemblerDeploymentSha"),
    groundingAssemblerWorkloadId: input.groundingAssemblerWorkloadId === null
      ? null
      : exactLiteral(input.groundingAssemblerWorkloadId, "service:luzione-ui", "admission.interactionReceipt.groundingAssemblerWorkloadId"),
    groundingPacketHash: nullableHash(input.groundingPacketHash, "admission.interactionReceipt.groundingPacketHash"),
    identityContractHash: hash(input.identityContractHash, "admission.interactionReceipt.identityContractHash"),
    identityContractVersion: boundedText(input.identityContractVersion, "admission.interactionReceipt.identityContractVersion", 256),
    interactionId: pattern(input.interactionId, "admission.interactionReceipt.interactionId", /^interaction_[a-f0-9]{32}$/),
    model: nullableBoundedText(input.model, "admission.interactionReceipt.model", 256),
    modelVersion: nullableBoundedText(input.modelVersion, "admission.interactionReceipt.modelVersion", 256),
    occurredAt: timestamp(input.occurredAt, "admission.interactionReceipt.occurredAt"),
    outcomeExpectationHash: nullableHash(input.outcomeExpectationHash, "admission.interactionReceipt.outcomeExpectationHash"),
    participantSetHash: hash(input.participantSetHash, "admission.interactionReceipt.participantSetHash"),
    queryHash: hash(input.queryHash, "admission.interactionReceipt.queryHash"),
    receiptHash: hash(input.receiptHash, "admission.interactionReceipt.receiptHash"),
    responseHash: hash(input.responseHash, "admission.interactionReceipt.responseHash"),
    schemaVersion: exactLiteral(input.schemaVersion, SULTAN_STAGE5_INTERACTION_RECEIPT_VERSION, "admission.interactionReceipt.schemaVersion"),
    shadowReviewRefsUsed: Object.freeze(idArray(input.shadowReviewRefsUsed, "admission.interactionReceipt.shadowReviewRefsUsed", 4)),
    sourceInteractionRefHash: hash(input.sourceInteractionRefHash, "admission.interactionReceipt.sourceInteractionRefHash"),
    sourceRunIdHash: nullableHash(input.sourceRunIdHash, "admission.interactionReceipt.sourceRunIdHash"),
    status: enumValue(input.status, ["READY", "BLOCKED"] as const, "admission.interactionReceipt.status"),
    surface: enumValue(input.surface, ["SULTAN_CHAT", "AGENT_CASE"] as const, "admission.interactionReceipt.surface"),
    tenantId: exactLiteral(input.tenantId, "luzione", "admission.interactionReceipt.tenantId"),
  });
  if (receipt.evidenceHashesUsed.length !== receipt.evidenceRefsUsed.length
    || (receipt.groundingPacketHash === null) !== (receipt.groundingAssemblerWorkloadId === null)
    || (receipt.groundingPacketHash === null) !== (receipt.groundingAssemblerDeploymentSha === null)) {
    invalid("admission.interactionReceipt evidence or grounding lineage is inconsistent.");
  }
  const { interactionId, receiptHash, ...material } = receipt;
  if (sultanInteractionReceiptHash(material) !== receiptHash
    || interactionId !== `interaction_${receiptHash.slice(0, 32)}`) {
    invalid("admission.interactionReceipt failed its exact immutable receipt hash.");
  }
  return receipt;
}

function parseOutcomeExpectationProof(value: unknown): OutcomeExpectationProof {
  const input = object(value, "admission.outcomeExpectationProof", "INVALID_ADMISSION_ASSERTION");
  exactKeys(input, [
    "bindingHash", "contractVersion", "expectationHash", "interactionId", "interactionReceiptHash",
  ], "admission.outcomeExpectationProof", "INVALID_ADMISSION_ASSERTION");
  const proof: OutcomeExpectationProof = Object.freeze({
    bindingHash: hash(input.bindingHash, "admission.outcomeExpectationProof.bindingHash"),
    contractVersion: exactLiteral(input.contractVersion, SULTAN_STAGE5_OUTCOME_EXPECTATION_BINDING_VERSION, "admission.outcomeExpectationProof.contractVersion"),
    expectationHash: hash(input.expectationHash, "admission.outcomeExpectationProof.expectationHash"),
    interactionId: pattern(input.interactionId, "admission.outcomeExpectationProof.interactionId", /^interaction_[a-f0-9]{32}$/),
    interactionReceiptHash: hash(input.interactionReceiptHash, "admission.outcomeExpectationProof.interactionReceiptHash"),
  });
  const { bindingHash, ...material } = proof;
  if (outcomeExpectationBindingHash(material) !== bindingHash) {
    invalid("admission.outcomeExpectationProof failed its exact binding hash.");
  }
  return proof;
}

function verifyOutcomeExpectationBinding(input: {
  interactionId: string;
  interactionReceipt: SultanInteractionReceiptProof;
  interactionReceiptHash: string;
  outcomeExpectation: Stage5OutcomeExpectation | null;
  outcomeExpectationProof: OutcomeExpectationProof | null;
}) {
  if (input.interactionReceipt.interactionId !== input.interactionId
    || input.interactionReceipt.receiptHash !== input.interactionReceiptHash) {
    invalid("admission interaction identity does not match the immutable Sultan receipt.");
  }
  if (input.outcomeExpectation === null) {
    if (input.outcomeExpectationProof !== null || input.interactionReceipt.outcomeExpectationHash !== null) {
      invalid("A null outcome expectation requires a null receipt hash and null proof.");
    }
    return;
  }
  const expectationHash = outcomeExpectationHash(input.outcomeExpectation);
  const proof = input.outcomeExpectationProof;
  if (!proof
    || input.interactionReceipt.outcomeExpectationHash !== expectationHash
    || proof.expectationHash !== expectationHash
    || proof.interactionId !== input.interactionId
    || proof.interactionReceiptHash !== input.interactionReceiptHash) {
    invalid("The outcome expectation is not exactly bound into the immutable Sultan interaction receipt.");
  }
}

function parseAgent(value: unknown, field: string): Stage5AgentRef {
  const input = object(value, field, "INVALID_ADMISSION_ASSERTION");
  exactKeys(input, ["agentId", "agentVersion"], field, "INVALID_ADMISSION_ASSERTION");
  return Object.freeze({
    agentId: pattern(input.agentId, `${field}.agentId`, AGENT_ID),
    agentVersion: pattern(input.agentVersion, `${field}.agentVersion`, /^v[1-9][0-9]{0,5}$/),
  });
}

function parseCaseRef(value: unknown): Stage5CaseRef {
  const input = object(value, "admission.caseRef", "INVALID_ADMISSION_ASSERTION");
  exactKeys(input, ["caseId", "caseType", "expectedVersion"], "admission.caseRef", "INVALID_ADMISSION_ASSERTION");
  return Object.freeze({
    caseId: id(input.caseId, "admission.caseRef.caseId"),
    caseType: enumValue(input.caseType, [
      "PORTFOLIO", "COMMERCIAL", "FULFILLMENT", "PARTNER_RELATIONSHIP", "CATALOG_QUALITY",
      "ACCOUNT_RELATIONSHIP", "ECONOMIC_REVIEW", "FEP_CASE", "CONTROL_REVIEW",
    ] as const, "admission.caseRef.caseType"),
    expectedVersion: input.expectedVersion === null
      ? null
      : stable(input.expectedVersion, "admission.caseRef.expectedVersion", 300),
  });
}

function parseExpectation(value: unknown): Stage5OutcomeExpectation {
  const input = object(value, "admission.outcomeExpectation", "INVALID_ADMISSION_ASSERTION");
  exactKeys(input, ["claimId", "expectedValue", "operator", "subjectId", "subjectType"], "admission.outcomeExpectation", "INVALID_ADMISSION_ASSERTION");
  const expectedValue = input.expectedValue;
  const operator = enumValue(input.operator, ["EQ", "GTE", "LTE", "NE"] as const, "admission.outcomeExpectation.operator");
  if (typeof expectedValue !== "string" && typeof expectedValue !== "boolean"
    && (typeof expectedValue !== "number" || !Number.isSafeInteger(expectedValue))) {
    invalid("admission.outcomeExpectation.expectedValue must be a string, boolean, or safe integer.");
  }
  if (typeof expectedValue === "string"
    && (expectedValue.length === 0 || Buffer.byteLength(expectedValue, "utf8") > 512)) {
    invalid("admission.outcomeExpectation.expectedValue is not bounded.");
  }
  if ((operator === "GTE" || operator === "LTE")
    && (typeof expectedValue === "boolean"
      || (typeof expectedValue === "string"
        && !/^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,6})?$/.test(expectedValue)))) {
    invalid("GTE/LTE expectedValue must be a safe integer or canonical bounded decimal string.");
  }
  return Object.freeze({
    claimId: pattern(input.claimId, "admission.outcomeExpectation.claimId", /^[a-z][a-zA-Z0-9._-]{2,127}$/),
    expectedValue,
    operator,
    subjectId: id(input.subjectId, "admission.outcomeExpectation.subjectId"),
    subjectType: enumValue(input.subjectType, canonicalSubjectTypes, "admission.outcomeExpectation.subjectType"),
  });
}

function rejectAuthority(value: JsonObject, path: string) {
  const rejected: string[] = [];
  collectForbidden(value, path, rejected);
  if (rejected.length > 0) {
    throw new SultanStage5ContractError(
      "CLIENT_AUTHORITY_REJECTED",
      `Identity, authority, prompts, memory and approval are server-owned: ${rejected.sort().join(", ")}.`,
      403,
    );
  }
}

function collectForbidden(value: unknown, path: string, rejected: string[]) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectForbidden(child, `${path}[${index}]`, rejected));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key)) rejected.push(`${path}.${key}`);
    collectForbidden(child, `${path}.${key}`, rejected);
  }
}

function exactKeys(value: JsonObject, expected: readonly string[], field: string, code: SultanStage5ContractError["code"]) {
  const expectedSet = new Set(expected);
  const unexpected = Object.keys(value).filter((key) => !expectedSet.has(key)).sort();
  const missing = expected.filter((key) => !(key in value));
  if (unexpected.length || missing.length) {
    throw new SultanStage5ContractError(
      code,
      `${field} fields are not exact; missing=[${missing.join(",")}], unexpected=[${unexpected.join(",")}].`,
    );
  }
}

function object(value: unknown, field: string, code: SultanStage5ContractError["code"]): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SultanStage5ContractError(code, `${field} must be an object.`);
  }
  return value as JsonObject;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  code: SultanStage5ContractError["code"] = "INVALID_ADMISSION_ASSERTION",
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${field} is invalid.`, code);
  return value as T;
}

function inputValue(input: JsonObject, key: string) {
  return input[key];
}

function stable(
  value: unknown,
  field: string,
  maximum: number,
  code: SultanStage5ContractError["code"] = "INVALID_ADMISSION_ASSERTION",
) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || !ID.test(value)) {
    invalid(`${field} must be a bounded stable identifier.`, code);
  }
  return value;
}

function pattern(
  value: unknown,
  field: string,
  expected: RegExp,
  code: SultanStage5ContractError["code"] = "INVALID_ADMISSION_ASSERTION",
) {
  if (typeof value !== "string" || !expected.test(value)) invalid(`${field} is invalid.`, code);
  return value;
}

function id(value: unknown, field: string, code?: SultanStage5ContractError["code"]) {
  return stable(value, field, 512, code);
}

function hash(value: unknown, field: string, code?: SultanStage5ContractError["code"]) {
  return pattern(value, field, SHA256, code);
}

function gitSha(value: unknown, field: string, code?: SultanStage5ContractError["code"]) {
  return pattern(value, field, GIT_SHA, code);
}

function nullableHash(value: unknown, field: string) {
  return value === null ? null : hash(value, field);
}

function nullableGitSha(value: unknown, field: string) {
  return value === null ? null : gitSha(value, field);
}

function boundedText(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string" || value.trim().length === 0
    || Buffer.byteLength(value, "utf8") > maximum) {
    invalid(`${field} must be bounded non-empty text.`);
  }
  return value;
}

function nullableBoundedText(value: unknown, field: string, maximum: number) {
  return value === null ? null : boundedText(value, field, maximum);
}

function exactLiteral<T extends string>(value: unknown, expected: T, field: string): T {
  if (value !== expected) invalid(`${field} must be ${expected}.`);
  return expected;
}

function exactFalse(value: unknown, field: string): false {
  if (value !== false) invalid(`${field} must be false.`);
  return false;
}

function exactTrue(value: unknown, field: string): true {
  if (value !== true) invalid(`${field} must be true.`);
  return true;
}

function idArray(value: unknown, field: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(`${field} must be an array with at most ${maximum} entries.`);
  }
  const parsed = value.map((entry, index) => id(entry, `${field}[${index}]`));
  if (new Set(parsed).size !== parsed.length) invalid(`${field} must contain unique entries.`);
  return parsed;
}

function hashArray(value: unknown, field: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(`${field} must be an array with at most ${maximum} entries.`);
  }
  return value.map((entry, index) => hash(entry, `${field}[${index}]`));
}

function timestamp(value: unknown, field: string, code: SultanStage5ContractError["code"] = "INVALID_ADMISSION_ASSERTION") {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    invalid(`${field} must be an ISO timestamp.`, code);
  }
  return new Date(value).toISOString();
}

function invalid(message: string, code: SultanStage5ContractError["code"] = "INVALID_ADMISSION_ASSERTION"): never {
  throw new SultanStage5ContractError(code, message);
}

function outcomeInvalid(message: string): never {
  throw new SultanStage5ContractError("INVALID_OUTCOME_OBSERVATION_REQUEST", message);
}
