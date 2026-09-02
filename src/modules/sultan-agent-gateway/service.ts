import { createHmac, timingSafeEqual } from "node:crypto";

import type { ApiActor } from "@/lib/api/actor";
import {
  LUZIONE_SULTAN_COMMAND_EXECUTION_V1,
  SultanAgentGatewayError,
  buildToolManifest,
  buildToolResult,
  type SultanApprovalAdmission,
  type SultanCaseRef,
  type SultanCommandExecution,
  type SultanCommandPreparation,
  type SultanEffectReadback,
  type SultanLogicalAgent,
  type SultanToolCall,
} from "@/modules/sultan-agent-gateway/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SULTAN_AGENT_GATEWAY_POLICY_VERSION,
  SULTAN_RFQ_CANARY_RECIPIENT,
  SULTAN_RFQ_CANARY_SUBJECT_PREFIX,
  deriveSultanLogicalAgent,
  registeredToolForAgent,
  toolsForAgent,
} from "@/modules/sultan-agent-gateway/registry";

export type CommercialCaseSnapshot = {
  commercialCase: {
    accountId: string | null;
    accountName: string | null;
    amount: number | null;
    caseId: string;
    contactName: string | null;
    nextAction: string | null;
    owner: string | null;
    primaryContactId: string | null;
    stage: string;
    status: string;
    title: string;
    updatedAt: string;
    version: number;
  };
  objectVersion: string;
  sourceOfTruth: "commercial_cases";
};

export type AuthoritativeCaseSnapshot = {
  caseType: SultanCaseRef["caseType"];
  objectVersion: string;
  observedAt: string;
  sourceOfTruth: string;
  sourceRefs: readonly string[];
  snapshot: Readonly<Record<string, unknown>>;
};

export type BoundEvidence = {
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  sourceRefs: readonly string[];
  evidence: Readonly<Record<string, unknown>>;
  missingEvidence: readonly string[];
};

export type SultanRfqCanaryArguments = {
  recipient: typeof SULTAN_RFQ_CANARY_RECIPIENT;
  subject: string;
  bodyText: string;
  contentClass: "SYNTHETIC_ALLOWLISTED_SUPPLIER_RFQ";
  evidenceRefs: readonly string[];
};

export type SultanAgentGatewayStore = {
  readCase(actor: ApiActor, caseRef: SultanCaseRef): Promise<AuthoritativeCaseSnapshot | null>;
  readEvidence(actor: ApiActor, caseRef: SultanCaseRef, toolId: string): Promise<BoundEvidence>;
  prepareCommand(input: {
    actor: ApiActor;
    call: SultanToolCall;
    effectClass: "A1" | "A2" | "A3";
    approvalMode: "BLOCKED" | "PER_COMMAND_HUMAN" | "POLICY_ENVELOPE";
    commandHash: string;
    preview: Readonly<Record<string, unknown>>;
    observedCase: AuthoritativeCaseSnapshot;
    now: string;
  }): Promise<SultanCommandPreparation>;
  executeCommand(input: {
    actor: ApiActor;
    reservationId: string;
    commandHash: string;
    approvalAdmission: SultanApprovalAdmission;
    now: string;
  }): Promise<SultanCommandExecution>;
  readEffect(actor: ApiActor, receiptId: string, now: string): Promise<SultanEffectReadback | null>;
};

export class SultanAgentGatewayService {
  constructor(
    private readonly store: SultanAgentGatewayStore,
    private readonly now: () => Date = () => new Date(),
    private readonly approvalSecret: string | undefined = process.env.LUZIONE_SULTAN_APPROVAL_SECRET,
  ) {}

  manifest(input: { actor: ApiActor; assertedAgent: SultanLogicalAgent; caseRef: SultanCaseRef }) {
    assertSultanActor(input.actor, "sultan.tool.manifest.read");
    const agent = deriveRequiredAgent(input.caseRef);
    assertAgentBinding(agent, input.assertedAgent);
    const tools = toolsForAgent(agent).filter((descriptor) => input.actor.capabilities.includes(descriptor.capability));
    return buildToolManifest({
      generatedAt: this.now().toISOString(),
      tenantId: "luzione",
      workloadActorId: "service:sultan-os",
      logicalAgent: agent,
      caseRef: input.caseRef,
      policyVersion: SULTAN_AGENT_GATEWAY_POLICY_VERSION,
      tools,
    });
  }

  async invoke(input: { actor: ApiActor; call: SultanToolCall }) {
    assertSultanActor(input.actor, "sultan.tool.invoke");
    const descriptor = this.admitTool(input.actor, input.call);
    if (descriptor.effectClass !== "A0") {
      const preparation = await this.prepare({ actor: input.actor, call: input.call });
      const sourceRefs = Array.isArray(preparation.preview.sourceRefs)
        ? preparation.preview.sourceRefs.filter((value): value is string => typeof value === "string")
        : [];
      return buildToolResult({
        operationId: input.call.operationId,
        toolCallId: input.call.toolCallId,
        toolId: input.call.toolId,
        status: "AWAITING_APPROVAL",
        effectClass: descriptor.effectClass,
        policyDecision: descriptor.effectClass === "A2" ? "BLOCK" : "REQUIRE_APPROVAL",
        sourceFreshness: "FRESH",
        sourceRefs,
        result: { preparation },
        failureCode: descriptor.effectClass === "A2" ? "A2_EXECUTION_DISABLED" : null,
        receiptRef: null,
        readbackRef: null,
        nextSafeAction: preparation.nextSafeAction,
      });
    }

    const observedCase = await this.store.readCase(input.actor, input.call.caseRef);
    if (!observedCase) return buildToolResult(blocked(input.call, "A0", "CASE_NOT_FOUND", "Verify the canonical case identity before retrying."));
    if (input.call.caseRef.expectedVersion !== null && input.call.caseRef.expectedVersion !== observedCase.objectVersion) {
      return buildToolResult(blocked(input.call, "A0", "STALE_OBJECT_VERSION", "Refresh the authoritative case version and reconsider the recommendation."));
    }
    if (input.call.toolId === "luzione.case_context.read") return readyRead(input.call, observedCase.sourceRefs, { snapshot: observedCase });
    const evidence = await this.store.readEvidence(input.actor, input.call.caseRef, input.call.toolId);
    return readyRead(input.call, evidence.sourceRefs, {
      evidence: evidence.evidence,
      missingEvidence: evidence.missingEvidence,
      objectVersion: observedCase.objectVersion,
    }, evidence.freshness, evidence.missingEvidence.length > 0
      ? "Request the named evidence or abstain; do not infer missing business facts."
      : "Continue using only the returned evidence references and exact object version.");
  }

  async prepare(input: { actor: ApiActor; call: SultanToolCall }) {
    assertSultanActor(input.actor, "sultan.command.prepare");
    const descriptor = this.admitTool(input.actor, input.call);
    if (descriptor.effectClass === "A0") throw new SultanAgentGatewayError("COMMAND_PREPARATION_NOT_REQUIRED", "A0 reads use the tool invocation route.", 422);
    if (input.call.controlEvidence?.criticVerdict !== "AFFIRM") throw new SultanAgentGatewayError("CRITIC_PASS_REQUIRED", "Consequential tools require an affirmed Independent Critic event.", 403);
    if (input.call.caseRef.caseType !== "COMMERCIAL") throw new SultanAgentGatewayError("CASE_TOOL_UNSUPPORTED", "Consequential pilot tools are restricted to Commercial cases.", 422);
    const observedCase = await this.store.readCase(input.actor, input.call.caseRef);
    if (!observedCase) throw new SultanAgentGatewayError("CASE_NOT_FOUND", "The authoritative case was not found.", 404);
    if (input.call.caseRef.expectedVersion === null || input.call.caseRef.expectedVersion !== observedCase.objectVersion) throw new SultanAgentGatewayError("EXACT_OBJECT_VERSION_REQUIRED", "Command preparation requires the exact current case version.", 409);

    const preview = parseCommandPreview(input.call, observedCase);
    const commandHash = sha256({
      operationId: input.call.operationId,
      runId: input.call.runId,
      toolCallId: input.call.toolCallId,
      toolId: input.call.toolId,
      toolVersion: input.call.toolVersion,
      agent: input.call.agent,
      caseRef: input.call.caseRef,
      argumentsHash: input.call.argumentsHash,
      critic: input.call.controlEvidence,
      preview,
    });
    return await this.store.prepareCommand({
      actor: input.actor,
      call: input.call,
      effectClass: descriptor.effectClass,
      approvalMode: descriptor.approvalMode,
      commandHash,
      preview,
      observedCase,
      now: this.now().toISOString(),
    });
  }

  async execute(input: { actor: ApiActor; reservationId: string; commandHash: string; approvalAdmission: SultanApprovalAdmission }) {
    assertSultanActor(input.actor, "sultan.command.execute");
    this.verifyApproval(input.reservationId, input.commandHash, input.approvalAdmission);
    return await this.store.executeCommand({ ...input, now: this.now().toISOString() });
  }

  async readEffect(actor: ApiActor, receiptId: string) {
    assertSultanActor(actor, "sultan.effect.read");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/.test(receiptId)) throw new SultanAgentGatewayError("EFFECT_RECEIPT_ID_INVALID", "The effect receipt identity is invalid.");
    const readback = await this.store.readEffect(actor, receiptId, this.now().toISOString());
    if (!readback) throw new SultanAgentGatewayError("EFFECT_RECEIPT_NOT_FOUND", "The effect receipt was not found.", 404);
    return readback;
  }

  private admitTool(actor: ApiActor, call: SultanToolCall) {
    const agent = deriveRequiredAgent(call.caseRef);
    assertAgentBinding(agent, call.agent);
    const descriptor = registeredToolForAgent(agent, call.toolId);
    if (!descriptor || descriptor.toolVersion !== call.toolVersion) throw new SultanAgentGatewayError("TOOL_NOT_AVAILABLE", "The requested tool and version are not available to this logical agent.", 404);
    if (!actor.capabilities.includes(descriptor.capability)) throw new SultanAgentGatewayError("TOOL_CAPABILITY_DENIED", "The authenticated workload lacks the exact tool capability.", 403);
    return descriptor;
  }

  private verifyApproval(reservationId: string, commandHash: string, admission: SultanApprovalAdmission) {
    if (!this.approvalSecret || this.approvalSecret.length < 32) throw new SultanAgentGatewayError("APPROVAL_VERIFIER_UNAVAILABLE", "Human approval verification is not configured.", 503);
    if (admission.reservationId !== reservationId || admission.commandHash !== commandHash) throw new SultanAgentGatewayError("APPROVAL_COMMAND_MISMATCH", "Approval does not bind the exact reserved command.", 409);
    if (admission.operatorId === "service:sultan-os" || !/^user_[a-f0-9]{64}$/.test(admission.operatorId)) throw new SultanAgentGatewayError("APPROVAL_ACTOR_INVALID", "Approval must come from a distinct authenticated human operator.", 403);
    const now = this.now().getTime();
    const approvedAt = Date.parse(admission.approvedAt);
    const expiresAt = Date.parse(admission.expiresAt);
    if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) || approvedAt > now + 30_000 || expiresAt <= now || expiresAt - approvedAt > 15 * 60_000) throw new SultanAgentGatewayError("APPROVAL_EXPIRED", "Approval is expired or outside the bounded admission window.", 403);
    const expected = approvalSignature(this.approvalSecret, admission);
    const received = Buffer.from(admission.signature, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    if (received.length !== expectedBytes.length || !timingSafeEqual(received, expectedBytes)) throw new SultanAgentGatewayError("APPROVAL_SIGNATURE_INVALID", "Approval signature is invalid.", 403);
  }
}

export function approvalSignature(secret: string, admission: Omit<SultanApprovalAdmission, "signature"> | SultanApprovalAdmission) {
  return createHmac("sha256", secret).update(JSON.stringify({
    approvalId: admission.approvalId,
    approvedAt: admission.approvedAt,
    commandHash: admission.commandHash,
    contractVersion: admission.contractVersion,
    decision: admission.decision,
    expiresAt: admission.expiresAt,
    operatorId: admission.operatorId,
    reservationId: admission.reservationId,
  })).digest("hex");
}

function parseCommandPreview(call: SultanToolCall, observedCase: AuthoritativeCaseSnapshot) {
  if (call.toolId === "luzione.supplier_rfq_email.send") {
    const args = parseRfqCanaryArguments(call.arguments);
    validateRfqCanaryEvidence(call, observedCase, args);
    return Object.freeze({
      actionType: "RFQ_EMAIL_CANARY",
      recipient: args.recipient,
      subject: args.subject,
      contentClass: args.contentClass,
      evidenceRefs: args.evidenceRefs,
      sourceRefs: observedCase.sourceRefs,
      dispatchRequested: false,
      executionBlocked: true,
    });
  }
  const args = parseA1Arguments(call.toolId, call.arguments);
  return Object.freeze({
    actionType: call.toolId,
    campaignId: args.campaignId,
    caseId: call.caseRef.caseId,
    exactObjectVersion: observedCase.objectVersion,
    sourceRefs: observedCase.sourceRefs,
    payload: args,
    externalEffectAuthorized: false,
  });
}

function parseA1Arguments(toolId: string, value: Readonly<Record<string, unknown>>): Record<string, unknown> & { campaignId: string } {
  const specs: Record<string, { allowed: readonly string[]; required: readonly string[] }> = {
    "luzione.proposal_revision.create": { allowed: ["campaignId", "title", "revisionSummary", "contentMarkdown"], required: ["campaignId", "title", "revisionSummary", "contentMarkdown"] },
    "luzione.task.create": { allowed: ["campaignId", "title", "description", "priority", "dueAt"], required: ["campaignId", "title", "description", "priority", "dueAt"] },
    "luzione.note.append": { allowed: ["campaignId", "note"], required: ["campaignId", "note"] },
    "luzione.gmail_draft.create": { allowed: ["campaignId", "recipient", "subject", "bodyText"], required: ["campaignId", "recipient", "subject", "bodyText"] },
  };
  const spec = specs[toolId];
  if (!spec) throw new SultanAgentGatewayError("COMMAND_TOOL_UNSUPPORTED", "The consequential tool is not implemented.", 422);
  if (Object.keys(value).some((key) => !spec.allowed.includes(key)) || spec.required.some((key) => !(key in value))) throw new SultanAgentGatewayError("COMMAND_ARGUMENTS_INVALID", "Command arguments do not match the exact tool schema.", 422);
  const campaignId = bounded(value.campaignId, "campaignId", 100);
  if (!/^sultan-campaign-[a-z0-9][a-z0-9-]{2,80}$/.test(campaignId)) throw new SultanAgentGatewayError("CAMPAIGN_SCOPE_REQUIRED", "A bounded synthetic Sultan campaign identity is required.", 422);
  const parsed: Record<string, unknown> & { campaignId: string } = { campaignId };
  if (toolId === "luzione.proposal_revision.create") {
    parsed.title = bounded(value.title, "title", 180);
    parsed.revisionSummary = bounded(value.revisionSummary, "revisionSummary", 2_000);
    parsed.contentMarkdown = bounded(value.contentMarkdown, "contentMarkdown", 12_000);
  } else if (toolId === "luzione.task.create") {
    parsed.title = bounded(value.title, "title", 180);
    parsed.description = bounded(value.description, "description", 2_000);
    if (!["LOW", "NORMAL", "HIGH"].includes(String(value.priority))) throw new SultanAgentGatewayError("COMMAND_ARGUMENTS_INVALID", "Task priority is invalid.", 422);
    parsed.priority = value.priority;
    parsed.dueAt = value.dueAt === null ? null : timestamp(value.dueAt, "dueAt");
  } else if (toolId === "luzione.note.append") {
    parsed.note = bounded(value.note, "note", 4_000);
  } else {
    if (value.recipient !== SULTAN_RFQ_CANARY_RECIPIENT) throw new SultanAgentGatewayError("TEST_DRAFT_RECIPIENT_DENIED", "The pilot draft recipient is fixed.", 422);
    const subject = bounded(value.subject, "subject", 180);
    if (!subject.startsWith("[SULTAN TEST DRAFT]")) throw new SultanAgentGatewayError("TEST_DRAFT_SUBJECT_DENIED", "Test drafts require the fixed subject prefix.", 422);
    parsed.recipient = SULTAN_RFQ_CANARY_RECIPIENT;
    parsed.subject = subject;
    parsed.bodyText = bounded(value.bodyText, "bodyText", 5_000);
    parsed.testOnly = true;
    parsed.providerDispatchAuthorized = false;
  }
  return parsed;
}

function parseRfqCanaryArguments(value: Readonly<Record<string, unknown>>): SultanRfqCanaryArguments {
  const allowed = new Set(["recipient", "subject", "bodyText", "contentClass", "evidenceRefs"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new SultanAgentGatewayError("RFQ_CANARY_CONTENT_DENIED", `RFQ canary argument ${key} is not allowed.`, 422);
  if (value.recipient !== SULTAN_RFQ_CANARY_RECIPIENT) throw new SultanAgentGatewayError("RFQ_CANARY_RECIPIENT_DENIED", "The RFQ canary recipient must be exactly hello@ciflow.io.", 422);
  if (value.contentClass !== "SYNTHETIC_ALLOWLISTED_SUPPLIER_RFQ") throw new SultanAgentGatewayError("RFQ_CANARY_CONTENT_CLASS_DENIED", "The RFQ canary accepts only synthetic allowlisted evidence.", 422);
  const subject = bounded(value.subject, "subject", 180);
  const bodyText = bounded(value.bodyText, "bodyText", 5_000);
  if (!subject.startsWith(SULTAN_RFQ_CANARY_SUBJECT_PREFIX)) throw new SultanAgentGatewayError("RFQ_CANARY_SUBJECT_DENIED", `The subject must begin with ${SULTAN_RFQ_CANARY_SUBJECT_PREFIX}.`, 422);
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length < 1 || value.evidenceRefs.length > 20) throw new SultanAgentGatewayError("RFQ_CANARY_EVIDENCE_REQUIRED", "The RFQ canary requires bounded evidence references.", 422);
  const evidenceRefs = [...new Set(value.evidenceRefs.map((reference) => bounded(reference, "evidenceRef", 512)))];
  const content = `${subject}\n${bodyText}`;
  const otherEmails = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  if (otherEmails.some((email) => email.toLowerCase() !== SULTAN_RFQ_CANARY_RECIPIENT)) throw new SultanAgentGatewayError("RFQ_CANARY_PERSONAL_DATA_DENIED", "The RFQ canary cannot contain other email addresses.", 422);
  if (/https?:\/\/|www\.|\b(?:confidential|secret|password|api[_ -]?key|social security)\b|\b\+?\d[\d ()-]{8,}\d\b/i.test(content)) throw new SultanAgentGatewayError("RFQ_CANARY_CONTENT_DENIED", "The RFQ canary cannot contain links, credentials, confidential markers, or personal phone-like data.", 422);
  return { recipient: SULTAN_RFQ_CANARY_RECIPIENT, subject, bodyText, contentClass: value.contentClass, evidenceRefs };
}

function validateRfqCanaryEvidence(call: SultanToolCall, observedCase: AuthoritativeCaseSnapshot, args: SultanRfqCanaryArguments) {
  if (call.caseRef.expectedVersion !== observedCase.objectVersion) throw new SultanAgentGatewayError("RFQ_CANARY_EXACT_VERSION_REQUIRED", "The RFQ canary requires the exact current case version.", 409);
  const admittedRefs = new Set(call.contextRefs.map((reference) => reference.sourceRef));
  observedCase.sourceRefs.forEach((reference) => admittedRefs.add(reference));
  if (args.evidenceRefs.some((reference) => !admittedRefs.has(reference))) throw new SultanAgentGatewayError("RFQ_CANARY_EVIDENCE_UNBOUND", "Every RFQ canary evidence reference must be bound to this run and case.", 422);
  if (call.contextRefs.some((reference) => reference.freshness !== "FRESH")) throw new SultanAgentGatewayError("RFQ_CANARY_STALE_EVIDENCE", "The RFQ canary requires fresh allowlisted evidence.", 422);
}

function readyRead(call: SultanToolCall, sourceRefs: readonly string[], result: Readonly<Record<string, unknown>>, sourceFreshness: "FRESH" | "STALE" | "UNKNOWN" = "FRESH", nextSafeAction = "Use only the exact observed object version and cite its source reference.") {
  return buildToolResult({
    operationId: call.operationId,
    toolCallId: call.toolCallId,
    toolId: call.toolId,
    status: "READY",
    effectClass: "A0",
    policyDecision: "ALLOW",
    sourceFreshness,
    sourceRefs,
    result,
    failureCode: null,
    receiptRef: null,
    readbackRef: null,
    nextSafeAction,
  });
}

function deriveRequiredAgent(caseRef: SultanCaseRef) {
  const agent = deriveSultanLogicalAgent(caseRef.caseType);
  if (!agent) throw new SultanAgentGatewayError("CASE_OWNER_UNAVAILABLE", "No Sultan case steward is enabled for this case type.", 422);
  return agent;
}

function assertAgentBinding(expected: SultanLogicalAgent, received: SultanLogicalAgent) {
  if (expected.agentId !== received.agentId || expected.agentVersion !== received.agentVersion) throw new SultanAgentGatewayError("LOGICAL_AGENT_BINDING_DENIED", "The requested logical agent does not own this case type.", 403);
}

function assertSultanActor(actor: ApiActor, capability: string) {
  if (actor.tenantId !== "luzione" || actor.actorId !== "service:sultan-os" || actor.actorType !== "service") throw new SultanAgentGatewayError("WORKLOAD_IDENTITY_DENIED", "The Sultan gateway requires the exact authenticated Sultan workload identity.", 403);
  if (!actor.capabilities.includes(capability)) throw new SultanAgentGatewayError("WORKLOAD_CAPABILITY_DENIED", "The Sultan workload lacks the route capability.", 403);
}

function blocked(call: SultanToolCall, effectClass: "A0" | "A1" | "A2" | "A3", failureCode: string, nextSafeAction: string) {
  return { operationId: call.operationId, toolCallId: call.toolCallId, toolId: call.toolId, status: "BLOCKED" as const, effectClass, policyDecision: "BLOCK" as const, sourceFreshness: "UNKNOWN" as const, sourceRefs: [], result: null, failureCode, receiptRef: null, readbackRef: null, nextSafeAction };
}

function bounded(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new SultanAgentGatewayError("COMMAND_ARGUMENTS_INVALID", `${field} must be a bounded non-empty string.`, 422);
  return value.trim();
}

function timestamp(value: unknown, field: string) {
  const parsed = bounded(value, field, 64);
  if (!Number.isFinite(Date.parse(parsed))) throw new SultanAgentGatewayError("COMMAND_ARGUMENTS_INVALID", `${field} must be an ISO timestamp.`, 422);
  return new Date(parsed).toISOString();
}

export const SULTAN_COMMAND_EXECUTION_CONTRACT = LUZIONE_SULTAN_COMMAND_EXECUTION_V1;
