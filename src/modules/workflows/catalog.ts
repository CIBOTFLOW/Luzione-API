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
  {
    code: "luxury.supplier_onboarding",
    name: "Premium supplier onboarding",
    outcome: "Review supplier evidence, catalog quality and next actions without self-approving a supplier.",
    vertical: "LUXURY_HOME",
    capabilities: ["analysis.read", "partner.next_action.create", "catalog.correction.propose"],
    maximumEffectClass: "A1",
  },
  {
    code: "luxury.import_fulfillment",
    name: "International import fulfillment",
    outcome: "Evaluate and plan product, freight, document and delivery readiness without provider effects.",
    vertical: "LUXURY_HOME",
    capabilities: ["fulfillment.readiness.evaluate", "fulfillment.plan.create", "task.internal.create"],
    maximumEffectClass: "A1",
  },
  {
    code: "luxury.trade_compliance_review",
    name: "Trade compliance review",
    outcome: "Assemble effective-dated source evidence and route unresolved import/export requirements to human review.",
    vertical: "LUXURY_HOME",
    capabilities: ["analysis.read", "fulfillment.readiness.evaluate", "task.internal.create"],
    maximumEffectClass: "A1",
  },
  {
    code: "luxury.white_glove_delivery",
    name: "White-glove delivery coordination",
    outcome: "Plan and, only when separately approved, book a customer, carrier, warehouse and installer delivery window.",
    vertical: "LUXURY_HOME",
    capabilities: ["fulfillment.readiness.evaluate", "task.internal.create", "calendar.meeting.book"],
    maximumEffectClass: "A3",
  },
  {
    code: "luxury.room_plan_to_proposal",
    name: "Room plan to proposal",
    outcome: "Validate a reviewed exact-version room plan and attach it to an internal proposal revision.",
    vertical: "LUXURY_HOME",
    capabilities: ["analysis.read", "proposal.room_plan.attach", "proposal.revision.create"],
    maximumEffectClass: "A1",
  },
]);

export function workflowPack(code: string) {
  return workflowPacks.find((pack) => pack.code === code) ?? null;
}
