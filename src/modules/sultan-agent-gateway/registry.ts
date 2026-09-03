import type {
  SultanCaseType,
  SultanLogicalAgent,
  SultanToolDescriptor,
} from "@/modules/sultan-agent-gateway/contracts";

export const SULTAN_AGENT_GATEWAY_POLICY_VERSION = "sultan-agent-gateway-policy.v1";
export const SULTAN_RFQ_CANARY_DESTINATION = "gmail.sultan-rfq-canary";
export const SULTAN_RFQ_CANARY_RECIPIENT = "hello@ciflow.io";
export const SULTAN_RFQ_CANARY_SUBJECT_PREFIX = "[SULTAN RFQ CANARY]";

const AGENT_BY_CASE_TYPE: Readonly<Partial<Record<SultanCaseType, SultanLogicalAgent>>> = Object.freeze({
  COMMERCIAL: Object.freeze({ agentId: "agent.luzione.revenue-steward", agentVersion: "v1" }),
  FULFILLMENT: Object.freeze({ agentId: "agent.luzione.fulfillment-steward", agentVersion: "v1" }),
  PARTNER_RELATIONSHIP: Object.freeze({ agentId: "agent.luzione.partner-network-steward", agentVersion: "v1" }),
  CATALOG_QUALITY: Object.freeze({ agentId: "agent.luzione.catalog-steward", agentVersion: "v1" }),
  ACCOUNT_RELATIONSHIP: Object.freeze({ agentId: "agent.luzione.account-relationship-steward", agentVersion: "v1" }),
  ECONOMIC_REVIEW: Object.freeze({ agentId: "agent.luzione.economic-integrity-steward", agentVersion: "v1" }),
});

const caseReadSchema = Object.freeze({
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
});

const campaignId = Object.freeze({ type: "string", pattern: "^sultan-campaign-[a-z0-9][a-z0-9-]{2,80}$" });
const boundedText = (maxLength: number) => Object.freeze({ type: "string", minLength: 1, maxLength });

const proposalRevisionSchema = Object.freeze({
  type: "object",
  properties: {
    campaignId,
    title: boundedText(180),
    revisionSummary: boundedText(2_000),
    contentMarkdown: boundedText(12_000),
  },
  required: ["campaignId", "title", "revisionSummary", "contentMarkdown"],
  additionalProperties: false,
});

const taskSchema = Object.freeze({
  type: "object",
  properties: {
    campaignId,
    title: boundedText(180),
    description: boundedText(2_000),
    priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH"] },
    dueAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
  },
  required: ["campaignId", "title", "description", "priority", "dueAt"],
  additionalProperties: false,
});

const noteSchema = Object.freeze({
  type: "object",
  properties: { campaignId, note: boundedText(4_000) },
  required: ["campaignId", "note"],
  additionalProperties: false,
});

const gmailDraftSchema = Object.freeze({
  type: "object",
  properties: {
    campaignId,
    recipient: { type: "string", const: SULTAN_RFQ_CANARY_RECIPIENT },
    subject: { type: "string", pattern: "^\\[SULTAN TEST DRAFT\\]", minLength: 24, maxLength: 180 },
    bodyText: boundedText(5_000),
  },
  required: ["campaignId", "recipient", "subject", "bodyText"],
  additionalProperties: false,
});

const rfqSchema = Object.freeze({
  type: "object",
  properties: {
    recipient: { type: "string", const: SULTAN_RFQ_CANARY_RECIPIENT },
    subject: { type: "string", minLength: 20, maxLength: 180 },
    bodyText: { type: "string", minLength: 20, maxLength: 5_000 },
    contentClass: { type: "string", const: "SYNTHETIC_ALLOWLISTED_SUPPLIER_RFQ" },
    evidenceRefs: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 512 },
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
    },
  },
  required: ["recipient", "subject", "bodyText", "contentClass", "evidenceRefs"],
  additionalProperties: false,
});

const TOOL_REGISTRY: readonly SultanToolDescriptor[] = Object.freeze([
  Object.freeze({
    toolId: "luzione.case_context.read",
    toolVersion: "v1",
    description: "Read the exact tenant-bound authoritative case snapshot and object version.",
    capability: "sultan.case.read",
    effectClass: "A0",
    approvalMode: "BLOCKED",
    inputSchema: caseReadSchema,
    available: true,
    sourceOwner: "CIBOTFLOW/Luzione-API",
  }),
  Object.freeze({
    toolId: "luzione.missing_evidence.read",
    toolVersion: "v1",
    description: "Derive named evidence gaps from the authoritative case snapshot without mutation.",
    capability: "sultan.case.read",
    effectClass: "A0",
    approvalMode: "BLOCKED",
    inputSchema: caseReadSchema,
    available: true,
    sourceOwner: "CIBOTFLOW/Luzione-API",
  }),
  readTool("luzione.account_activity.read", "Read bounded account and case activity evidence."),
  readTool("luzione.proposal_evidence.read", "Read the latest internal proposal evidence and exact version."),
  readTool("luzione.supplier_facts.read", "Read supplier evidence already bound to the commercial case."),
  readTool("luzione.order_fulfillment.read", "Read the authoritative order and latest no-effect fulfillment intent."),
  readTool("luzione.catalog_evidence.read", "Read the current Shopify catalog projection and freshness evidence."),
  actionTool("luzione.proposal_revision.create", "Prepare and record a versioned internal proposal revision without send authority.", proposalRevisionSchema),
  actionTool("luzione.task.create", "Prepare and record a reversible internal task for the exact case.", taskSchema),
  actionTool("luzione.note.append", "Prepare and append a campaign-labelled internal case note.", noteSchema),
  actionTool("luzione.gmail_draft.create", "Prepare and record an internal test Gmail draft without provider dispatch.", gmailDraftSchema),
  Object.freeze({
    toolId: "luzione.supplier_rfq_email.send",
    toolVersion: "v1",
    description: "Reserve one tightly constrained external RFQ canary email. Luzione policy and a live envelope decide authority.",
    capability: "sultan.rfq.canary.send",
    effectClass: "A2",
    approvalMode: "POLICY_ENVELOPE",
    inputSchema: rfqSchema,
    available: true,
    sourceOwner: "CIBOTFLOW/Luzione-API",
  }),
]);

export function deriveSultanLogicalAgent(caseType: SultanCaseType) {
  return AGENT_BY_CASE_TYPE[caseType] ?? null;
}

export function toolsForAgent(agent: SultanLogicalAgent) {
  if (agent.agentId === "agent.luzione.revenue-steward") {
    return TOOL_REGISTRY.filter((descriptor) => !["luzione.order_fulfillment.read", "luzione.catalog_evidence.read"].includes(descriptor.toolId));
  }
  if (agent.agentId === "agent.luzione.fulfillment-steward") {
    return TOOL_REGISTRY.filter((descriptor) => ["luzione.case_context.read", "luzione.missing_evidence.read", "luzione.order_fulfillment.read"].includes(descriptor.toolId));
  }
  if (agent.agentId === "agent.luzione.catalog-steward") {
    return TOOL_REGISTRY.filter((descriptor) => ["luzione.case_context.read", "luzione.missing_evidence.read", "luzione.catalog_evidence.read"].includes(descriptor.toolId));
  }
  return [];
}

export function registeredToolForAgent(agent: SultanLogicalAgent, toolId: string) {
  return toolsForAgent(agent).find((descriptor) => descriptor.toolId === toolId) ?? null;
}

function readTool(toolId: string, description: string): SultanToolDescriptor {
  return Object.freeze({
    toolId,
    toolVersion: "v1",
    description,
    capability: "sultan.case.read",
    effectClass: "A0",
    approvalMode: "BLOCKED",
    inputSchema: caseReadSchema,
    available: true,
    sourceOwner: "CIBOTFLOW/Luzione-API",
  });
}

function actionTool(
  toolId: string,
  description: string,
  inputSchema: Readonly<Record<string, unknown>>,
): SultanToolDescriptor {
  return Object.freeze({
    toolId,
    toolVersion: "v1",
    description,
    capability: "sultan.internal.command",
    effectClass: "A1",
    approvalMode: "PER_COMMAND_HUMAN",
    inputSchema,
    available: true,
    sourceOwner: "CIBOTFLOW/Luzione-API",
  });
}
