import {
  LUZIONE_SULTAN_TOOL_CALL_V1,
  LUZIONE_SULTAN_COMMAND_EXECUTION_V1,
  SultanAgentGatewayError,
  type SultanApprovalAdmission,
  type SultanCaseRef,
  type SultanCaseType,
  type SultanToolCall,
} from "@/modules/sultan-agent-gateway/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

const CASE_TYPES = new Set<SultanCaseType>([
  "PORTFOLIO", "COMMERCIAL", "FULFILLMENT", "PARTNER_RELATIONSHIP",
  "CATALOG_QUALITY", "ACCOUNT_RELATIONSHIP", "ECONOMIC_REVIEW", "FEP_CASE", "CONTROL_REVIEW",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;
const HASH = /^[a-f0-9]{64}$/;
const CLIENT_AUTHORITY_KEYS = new Set([
  "tenant", "tenantId", "tenant_id", "actor", "actorId", "actor_id", "actorType",
  "authority", "authorityRef", "effectClass", "approval", "capabilities", "credentials", "token", "apiKey",
]);

export function parseManifestQuery(url: URL) {
  rejectUnexpectedQuery(url, new Set(["agentId", "agentVersion", "caseId", "caseType", "expectedVersion"]));
  const caseRef = parseCaseRef({
    caseId: url.searchParams.get("caseId"),
    caseType: url.searchParams.get("caseType"),
    expectedVersion: url.searchParams.get("expectedVersion"),
  });
  return {
    assertedAgent: {
      agentId: id(url.searchParams.get("agentId"), "agentId"),
      agentVersion: id(url.searchParams.get("agentVersion"), "agentVersion"),
    },
    caseRef,
  };
}

export function parseToolCallEnvelope(value: unknown): SultanToolCall {
  const envelope = object(value, "request");
  for (const key of Object.keys(envelope)) {
    if (key !== "toolCall") throw new SultanAgentGatewayError("INVALID_TOOL_CALL", "Only toolCall is accepted at the request root.");
  }
  const input = object(envelope.toolCall, "toolCall");
  rejectAuthority(input, "toolCall");
  const allowed = new Set([
    "contractVersion", "admissionReceiptId", "operationId", "runId", "toolCallId", "toolId", "toolVersion",
    "agent", "caseRef", "purpose", "arguments", "argumentsHash", "contextRefs", "controlEvidence",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new SultanAgentGatewayError("INVALID_TOOL_CALL", `toolCall.${key} is unsupported.`);
  }
  if (input.contractVersion !== LUZIONE_SULTAN_TOOL_CALL_V1) {
    throw new SultanAgentGatewayError("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${LUZIONE_SULTAN_TOOL_CALL_V1}.`);
  }
  const agent = object(input.agent, "toolCall.agent");
  const args = object(input.arguments, "toolCall.arguments");
  rejectAuthority(args, "toolCall.arguments");
  if (Object.keys(args).length > 30 || Buffer.byteLength(JSON.stringify(args), "utf8") > 16 * 1024) {
    throw new SultanAgentGatewayError("TOOL_ARGUMENTS_TOO_LARGE", "Tool arguments exceed the bounded contract.");
  }
  const argumentsHash = hash(input.argumentsHash, "toolCall.argumentsHash");
  if (argumentsHash !== sha256(args)) {
    throw new SultanAgentGatewayError("TOOL_ARGUMENT_HASH_MISMATCH", "Tool arguments do not match their declared hash.");
  }
  if (!Array.isArray(input.contextRefs) || input.contextRefs.length > 50) {
    throw new SultanAgentGatewayError("INVALID_TOOL_CALL", "contextRefs must be a bounded array.");
  }
  const controlEvidence = input.controlEvidence === null
    ? null
    : parseControlEvidence(input.controlEvidence);
  return {
    contractVersion: LUZIONE_SULTAN_TOOL_CALL_V1,
    admissionReceiptId: id(input.admissionReceiptId, "toolCall.admissionReceiptId"),
    operationId: id(input.operationId, "toolCall.operationId"),
    runId: id(input.runId, "toolCall.runId"),
    toolCallId: id(input.toolCallId, "toolCall.toolCallId"),
    toolId: id(input.toolId, "toolCall.toolId"),
    toolVersion: id(input.toolVersion, "toolCall.toolVersion"),
    agent: {
      agentId: id(agent.agentId, "toolCall.agent.agentId"),
      agentVersion: id(agent.agentVersion, "toolCall.agent.agentVersion"),
    },
    caseRef: parseCaseRef(input.caseRef),
    purpose: text(input.purpose, "toolCall.purpose", 4_000),
    arguments: args,
    argumentsHash,
    contextRefs: input.contextRefs.map((value, index) => {
      const reference = object(value, `toolCall.contextRefs[${index}]`);
      const freshness = reference.freshness;
      if (freshness !== "FRESH" && freshness !== "STALE" && freshness !== "UNKNOWN") {
        throw new SultanAgentGatewayError("INVALID_TOOL_CALL", `toolCall.contextRefs[${index}].freshness is invalid.`);
      }
      const observedAt = text(reference.observedAt, `toolCall.contextRefs[${index}].observedAt`, 64);
      if (!Number.isFinite(Date.parse(observedAt))) throw new SultanAgentGatewayError("INVALID_TOOL_CALL", "context reference timestamp is invalid.");
      return {
        sourceRef: text(reference.sourceRef, `toolCall.contextRefs[${index}].sourceRef`, 512),
        sourceVersion: text(reference.sourceVersion, `toolCall.contextRefs[${index}].sourceVersion`, 256),
        integrityHash: hash(reference.integrityHash, `toolCall.contextRefs[${index}].integrityHash`),
        observedAt: new Date(observedAt).toISOString(),
        freshness,
      };
    }),
    controlEvidence,
  };
}

export function parseCommandPreparationEnvelope(value: unknown) {
  const envelope = object(value, "request");
  for (const key of Object.keys(envelope)) {
    if (key !== "toolCall") throw new SultanAgentGatewayError("INVALID_COMMAND_PREPARATION", "Only toolCall is accepted at the request root.");
  }
  return parseToolCallEnvelope(envelope);
}

export function parseCommandExecutionEnvelope(value: unknown): {
  reservationId: string;
  commandHash: string;
  approvalAdmission: SultanApprovalAdmission;
} {
  const envelope = object(value, "request");
  for (const key of Object.keys(envelope)) {
    if (key !== "execution") throw new SultanAgentGatewayError("INVALID_COMMAND_EXECUTION", "Only execution is accepted at the request root.");
  }
  const input = object(envelope.execution, "execution");
  const allowed = new Set(["contractVersion", "reservationId", "commandHash", "approvalAdmission"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new SultanAgentGatewayError("INVALID_COMMAND_EXECUTION", `execution.${key} is unsupported.`);
  }
  if (input.contractVersion !== LUZIONE_SULTAN_COMMAND_EXECUTION_V1) {
    throw new SultanAgentGatewayError("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${LUZIONE_SULTAN_COMMAND_EXECUTION_V1}.`);
  }
  if (input.approvalAdmission === undefined || input.approvalAdmission === null) {
    throw new SultanAgentGatewayError(
      "HUMAN_APPROVAL_REQUIRED",
      "Execution requires an exact, versioned human approval admission.",
      403,
    );
  }
  const admission = object(input.approvalAdmission, "execution.approvalAdmission");
  const admissionAllowed = new Set([
    "contractVersion", "approvalId", "operatorId", "reservationId", "commandHash",
    "decision", "approvedAt", "expiresAt", "signature",
  ]);
  for (const key of Object.keys(admission)) {
    if (!admissionAllowed.has(key)) throw new SultanAgentGatewayError("INVALID_APPROVAL_ADMISSION", `approvalAdmission.${key} is unsupported.`);
  }
  if (admission.contractVersion !== "sultan.human-approval-admission.v1" || admission.decision !== "APPROVE") {
    throw new SultanAgentGatewayError("INVALID_APPROVAL_ADMISSION", "A versioned affirmative human approval admission is required.", 403);
  }
  const approvedAt = timestamp(admission.approvedAt, "approvalAdmission.approvedAt");
  const expiresAt = timestamp(admission.expiresAt, "approvalAdmission.expiresAt");
  return {
    reservationId: id(input.reservationId, "execution.reservationId"),
    commandHash: hash(input.commandHash, "execution.commandHash"),
    approvalAdmission: {
      contractVersion: "sultan.human-approval-admission.v1",
      approvalId: id(admission.approvalId, "approvalAdmission.approvalId"),
      operatorId: id(admission.operatorId, "approvalAdmission.operatorId"),
      reservationId: id(admission.reservationId, "approvalAdmission.reservationId"),
      commandHash: hash(admission.commandHash, "approvalAdmission.commandHash"),
      decision: "APPROVE",
      approvedAt,
      expiresAt,
      signature: hash(admission.signature, "approvalAdmission.signature"),
    },
  };
}

function parseControlEvidence(value: unknown): NonNullable<SultanToolCall["controlEvidence"]> {
  const input = object(value, "toolCall.controlEvidence");
  if (input.criticVerdict !== "AFFIRM") {
    throw new SultanAgentGatewayError("CRITIC_PASS_REQUIRED", "Consequential tool calls require an affirmed Independent Critic receipt.", 403);
  }
  return {
    criticEventId: id(input.criticEventId, "toolCall.controlEvidence.criticEventId"),
    criticPayloadHash: hash(input.criticPayloadHash, "toolCall.controlEvidence.criticPayloadHash"),
    criticVerdict: "AFFIRM",
  };
}

function parseCaseRef(value: unknown): SultanCaseRef {
  const input = object(value, "caseRef");
  const caseType = text(input.caseType, "caseRef.caseType", 64) as SultanCaseType;
  if (!CASE_TYPES.has(caseType)) throw new SultanAgentGatewayError("CASE_TYPE_UNSUPPORTED", "caseRef.caseType is unsupported.");
  return {
    caseId: id(input.caseId, "caseRef.caseId"),
    caseType,
    expectedVersion: input.expectedVersion === null || input.expectedVersion === undefined || input.expectedVersion === ""
      ? null
      : text(input.expectedVersion, "caseRef.expectedVersion", 300),
  };
}

function rejectAuthority(value: Record<string, unknown>, path: string) {
  const findings: string[] = [];
  collectAuthority(value, path, findings);
  if (findings.length > 0) {
    throw new SultanAgentGatewayError("CLIENT_AUTHORITY_REJECTED", `Authority is derived from authenticated server context: ${findings.join(", ")}.`, 403);
  }
}

function collectAuthority(value: unknown, path: string, findings: string[]) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectAuthority(child, `${path}[${index}]`, findings));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CLIENT_AUTHORITY_KEYS.has(key)) findings.push(`${path}.${key}`);
    collectAuthority(child, `${path}.${key}`, findings);
  }
}

function rejectUnexpectedQuery(url: URL, allowed: Set<string>) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new SultanAgentGatewayError("INVALID_MANIFEST_QUERY", `Query parameter ${key} is unsupported.`);
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SultanAgentGatewayError("INVALID_TOOL_CALL", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function id(value: unknown, field: string) {
  const parsed = text(value, field, 512);
  if (!ID.test(parsed)) throw new SultanAgentGatewayError("INVALID_TOOL_CALL", `${field} is not a stable identifier.`);
  return parsed;
}

function hash(value: unknown, field: string) {
  const parsed = text(value, field, 64);
  if (!HASH.test(parsed)) throw new SultanAgentGatewayError("INVALID_TOOL_CALL", `${field} is not a canonical SHA-256 hash.`);
  return parsed;
}

function text(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new SultanAgentGatewayError("INVALID_TOOL_CALL", `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function timestamp(value: unknown, field: string) {
  const parsed = text(value, field, 64);
  const millis = Date.parse(parsed);
  if (!Number.isFinite(millis)) throw new SultanAgentGatewayError("INVALID_COMMAND_EXECUTION", `${field} must be an ISO timestamp.`);
  return new Date(millis).toISOString();
}
