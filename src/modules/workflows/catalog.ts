import type { EffectClass } from "@/modules/autonomy/types";

export type WorkflowPack = {
  code: string;
  name: string;
  outcome: string;
  vertical: "CORE" | "LUXURY_HOME";
  capabilities: readonly string[];
  maximumEffectClass: EffectClass;
};

export const workflowPacks: readonly WorkflowPack[] = Object.freeze([
  {
    code: "growth.signal_to_account",
    name: "Growth signal to account",
    outcome: "Ingest, deduplicate, enrich, score and attach buying signals to an account.",
    vertical: "CORE",
    capabilities: ["analysis.read", "lead.score", "record.internal.update"],
    maximumEffectClass: "A2",
  },
  {
    code: "crm.lead_qualification",
    name: "Lead qualification and routing",
    outcome: "Qualify, explain, route and assign a lead under tenant SLAs.",
    vertical: "CORE",
    capabilities: ["analysis.read", "lead.score", "lead.route", "task.internal.create"],
    maximumEffectClass: "A1",
  },
  {
    code: "growth.outreach",
    name: "Outreach orchestration",
    outcome: "Draft personalized outreach and, when approved, enroll contacts in a provider sequence.",
    vertical: "CORE",
    capabilities: ["draft.internal.create", "outreach.sequence.enroll", "email.send"],
    maximumEffectClass: "A3",
  },
  {
    code: "crm.opportunity",
    name: "Opportunity progression",
    outcome: "Summarize an opportunity, recommend next actions and advance compliant stages.",
    vertical: "CORE",
    capabilities: ["analysis.read", "opportunity.next_action.create", "crm.stage.advance"],
    maximumEffectClass: "A2",
  },
  {
    code: "commercial.proposal",
    name: "Proposal generation",
    outcome: "Build, revise, approve and transmit a versioned commercial proposal.",
    vertical: "CORE",
    capabilities: ["proposal.artifact.create", "proposal.revision.create", "proposal.send"],
    maximumEffectClass: "A3",
  },
  {
    code: "work.task_copilot",
    name: "Task copilot",
    outcome: "Create, prioritize, update and complete work with evidence-linked receipts.",
    vertical: "CORE",
    capabilities: ["task.internal.create", "task.internal.update", "task.internal.complete"],
    maximumEffectClass: "A2",
  },
  {
    code: "service.customer_followup",
    name: "Customer follow-up",
    outcome: "Draft responses, create follow-ups and send only within tenant communication policy.",
    vertical: "CORE",
    capabilities: ["support.response.draft", "task.internal.create", "email.send"],
    maximumEffectClass: "A3",
  },
  {
    code: "fulfillment.exception",
    name: "Fulfillment exception management",
    outcome: "Triage delays, create recovery tasks and prepare supplier or customer communications.",
    vertical: "CORE",
    capabilities: ["fulfillment.exception.triage", "task.internal.create", "supplier.rfq.send"],
    maximumEffectClass: "A3",
  },
  {
    code: "luxury.design_partner",
    name: "Design partner pursuit",
    outcome: "Rank design firms, coordinate placement pursuits and build project-specific proposals.",
    vertical: "LUXURY_HOME",
    capabilities: ["lead.score", "opportunity.next_action.create", "proposal.artifact.create"],
    maximumEffectClass: "A1",
  },
]);

export function workflowPack(code: string) {
  return workflowPacks.find((pack) => pack.code === code) ?? null;
}
