import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const LUZIONE_SULTAN_TOOL_MANIFEST_V1 = "luzione-sultan-tool-manifest/v1" as const;
export const LUZIONE_SULTAN_TOOL_CALL_V1 = "luzione-sultan-tool-call/v1" as const;
export const LUZIONE_SULTAN_TOOL_RESULT_V1 = "luzione-sultan-tool-result/v1" as const;
export const LUZIONE_SULTAN_EFFECT_RECEIPT_V1 = "luzione-sultan-effect-receipt/v1" as const;
export const LUZIONE_SULTAN_READBACK_V1 = "luzione-sultan-readback/v1" as const;
export const LUZIONE_SULTAN_COMMAND_PREPARATION_V1 = "luzione-sultan-command-preparation/v1" as const;
export const LUZIONE_SULTAN_COMMAND_EXECUTION_V1 = "luzione-sultan-command-execution/v1" as const;

export type SultanEffectClass = "A0" | "A1" | "A2" | "A3";
export type SultanApprovalMode = "BLOCKED" | "PER_COMMAND_HUMAN" | "POLICY_ENVELOPE";
export type SultanCaseType =
  | "PORTFOLIO"
  | "COMMERCIAL"
  | "FULFILLMENT"
  | "PARTNER_RELATIONSHIP"
  | "CATALOG_QUALITY"
  | "ACCOUNT_RELATIONSHIP"
  | "ECONOMIC_REVIEW"
  | "FEP_CASE"
  | "CONTROL_REVIEW";

export type SultanCaseRef = {
  caseId: string;
  caseType: SultanCaseType;
  expectedVersion: string | null;
};

export type SultanLogicalAgent = {
  agentId: string;
  agentVersion: string;
};

export type SultanToolDescriptor = {
  toolId: string;
  toolVersion: string;
  description: string;
  capability: string;
  effectClass: SultanEffectClass;
  approvalMode: SultanApprovalMode;
  inputSchema: Readonly<Record<string, unknown>>;
  available: true;
  sourceOwner: "CIBOTFLOW/Luzione-API";
};

export type SultanToolManifest = {
  contractVersion: typeof LUZIONE_SULTAN_TOOL_MANIFEST_V1;
  generatedAt: string;
  tenantId: "luzione";
  workloadActorId: "service:sultan-os";
  logicalAgent: SultanLogicalAgent;
  caseRef: SultanCaseRef;
  policyVersion: string;
  manifestHash: string;
  tools: readonly SultanToolDescriptor[];
  discoveryGrantsAuthority: false;
};

export type SultanToolCall = {
  contractVersion: typeof LUZIONE_SULTAN_TOOL_CALL_V1;
  admissionReceiptId: string;
  operationId: string;
  runId: string;
  toolCallId: string;
  toolId: string;
  toolVersion: string;
  agent: SultanLogicalAgent;
  caseRef: SultanCaseRef;
  purpose: string;
  arguments: Readonly<Record<string, unknown>>;
  argumentsHash: string;
  contextRefs: readonly {
    sourceRef: string;
    sourceVersion: string;
    integrityHash: string;
    observedAt: string;
    freshness: "FRESH" | "STALE" | "UNKNOWN";
  }[];
  controlEvidence: {
    criticEventId: string;
    criticPayloadHash: string;
    criticVerdict: "AFFIRM";
  } | null;
};

export type SultanToolResult = {
  contractVersion: typeof LUZIONE_SULTAN_TOOL_RESULT_V1;
  operationId: string;
  toolCallId: string;
  toolId: string;
  status: "READY" | "BLOCKED" | "FAILED" | "AWAITING_APPROVAL" | "RECONCILIATION_REQUIRED";
  effectClass: SultanEffectClass;
  policyDecision: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL";
  sourceFreshness: "FRESH" | "STALE" | "UNKNOWN";
  sourceRefs: readonly string[];
  result: Readonly<Record<string, unknown>> | null;
  resultHash: string;
  failureCode: string | null;
  receiptRef: string | null;
  readbackRef: string | null;
  nextSafeAction: string;
};

export type SultanEffectReceipt = {
  contractVersion: typeof LUZIONE_SULTAN_EFFECT_RECEIPT_V1;
  receiptId: string;
  operationId: string;
  toolCallId: string;
  toolId: string;
  effectClass: "A1" | "A2" | "A3";
  state: "DISPATCH_PENDING" | "PROVIDER_ACCEPTED" | "SOURCE_CONFIRMED" | "RECONCILIATION_REQUIRED" | "BLOCKED" | "FAILED";
  idempotentReplay: boolean;
  providerRef: string | null;
  resultHash: string;
  createdAt: string;
  businessFinal: boolean;
};

export type SultanEffectReadback = {
  contractVersion: typeof LUZIONE_SULTAN_READBACK_V1;
  receiptId: string;
  observedAt: string;
  state: "NOT_DISPATCHED" | "PROVIDER_ACCEPTED" | "SOURCE_CONFIRMED" | "RECONCILIATION_REQUIRED" | "BLOCKED" | "FAILED";
  providerRef: string | null;
  sourceReadbackRef: string | null;
  authoritativeSource: string;
  businessFinal: boolean;
  deliveryProven: boolean;
  nextSafeAction: string;
};

export type SultanCommandPreparation = {
  contractVersion: typeof LUZIONE_SULTAN_COMMAND_PREPARATION_V1;
  admissionReceiptId: string;
  reservationId: string;
  operationId: string;
  runId: string;
  toolCallId: string;
  toolId: string;
  toolVersion: string;
  agent: SultanLogicalAgent;
  caseRef: SultanCaseRef;
  effectClass: "A1" | "A2" | "A3";
  approvalMode: SultanApprovalMode;
  commandHash: string;
  argumentsHash: string;
  state: "PREPARED" | "EXECUTED" | "CANCELLED" | "RECONCILIATION_REQUIRED";
  preview: Readonly<Record<string, unknown>>;
  expiresAt: string;
  executionAllowed: boolean;
  nextSafeAction: string;
  idempotentReplay: boolean;
};

export type SultanApprovalAdmission = {
  contractVersion: "sultan.human-approval-admission.v1";
  approvalId: string;
  operatorId: string;
  reservationId: string;
  commandHash: string;
  decision: "APPROVE";
  approvedAt: string;
  expiresAt: string;
  signature: string;
};

export type SultanCommandExecution = {
  contractVersion: typeof LUZIONE_SULTAN_COMMAND_EXECUTION_V1;
  reservationId: string;
  operationId: string;
  commandHash: string;
  state: "SOURCE_CONFIRMED" | "RECONCILIATION_REQUIRED";
  receipt: SultanEffectReceipt;
  readback: SultanEffectReadback;
  idempotentReplay: boolean;
  nextSafeAction: string;
};

export function buildToolManifest(input: Omit<SultanToolManifest, "contractVersion" | "manifestHash" | "discoveryGrantsAuthority">): SultanToolManifest {
  const unsigned = {
    contractVersion: LUZIONE_SULTAN_TOOL_MANIFEST_V1,
    ...input,
    discoveryGrantsAuthority: false as const,
  };
  return Object.freeze({ ...unsigned, manifestHash: sha256(unsigned) });
}

export function buildToolResult(input: Omit<SultanToolResult, "contractVersion" | "resultHash">): SultanToolResult {
  return Object.freeze({
    contractVersion: LUZIONE_SULTAN_TOOL_RESULT_V1,
    ...input,
    resultHash: sha256(input.result),
  });
}

export class SultanAgentGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SultanAgentGatewayError";
  }
}
