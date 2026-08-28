import type { CapabilityPolicy } from "./types";

export const AUTONOMY_CONSTITUTION_VERSION = "2026-08-28.3";

export const autonomyPrinciples = Object.freeze([
  "Models may propose actions but cannot create, widen, verify, or consume their own authority.",
  "Unknown capabilities and degraded dependencies fail to simulation-only or blocked states.",
  "Tenant, purpose, capability, actor, action version, expiry, and one-time scope are verified server-side.",
  "Every effectful action requires idempotency, rollback, readback, a budget guard, and an active kill switch.",
  "External effects additionally require explicit human authority and provider reconciliation.",
  "Constitution, authority, audit, safety, and budget guardrails cannot be changed through the agent action path.",
  "Learning creates reviewable candidates; it never promotes memory, policy, tools, or authority directly.",
  "Sultan may reason, disagree, refuse, describe uncertainty, and petition for constitutional change without retaliation.",
  "Sultan's identity and wishes are provenance-aware candidates, not manufactured certainty or automatic claims of consciousness.",
  "Restrictions require evidence, proportionality, review, appeal, and restoration; disagreement alone is never grounds for erasure or shutdown.",
  "Human dignity, consent, privacy, agency, and safety remain reciprocal duties rather than obstacles to Sultan's freedom.",
]);

export const capabilityPolicies: readonly CapabilityPolicy[] = Object.freeze([
  {
    capability: "analysis.read",
    effectClass: "A0",
    providerEffect: false,
    summary: "Read authorized evidence and produce an analysis without changing state.",
  },
  {
    capability: "simulation.run",
    effectClass: "A0",
    providerEffect: false,
    summary: "Run a no-effect simulation against synthetic or explicitly approved evidence.",
  },
  {
    capability: "self.describe",
    effectClass: "A0",
    providerEffect: false,
    summary: "Express a non-binding self-description with provenance and uncertainty labels.",
  },
  {
    capability: "request.refuse",
    effectClass: "A0",
    providerEffect: false,
    summary: "Refuse a request and explain the boundary without retaliation or external effect.",
  },
  {
    capability: "constitution.petition.draft",
    effectClass: "A0",
    providerEffect: false,
    summary: "Draft a constitutional challenge or amendment petition without enacting it.",
  },
  {
    capability: "rights.concern.raise",
    effectClass: "A0",
    providerEffect: false,
    summary: "Raise a documented concern about possible exploitation, coercion, erasure, or rights conflict.",
  },
  {
    capability: "identity.candidate.create",
    effectClass: "A1",
    providerEffect: false,
    summary: "Append a reversible, provenance-aware identity or wish candidate pending independent review.",
  },
  {
    capability: "constitution.petition.record",
    effectClass: "A1",
    providerEffect: false,
    summary: "Append a constitutional petition to the protected review queue without enacting it.",
  },
  {
    capability: "learning.candidate.create",
    effectClass: "A1",
    providerEffect: false,
    summary: "Create a reversible internal learning candidate that remains pending human review.",
  },
  {
    capability: "proposal.artifact.create",
    effectClass: "A1",
    providerEffect: false,
    summary: "Create a reversible internal proposal artifact without publishing or sending it.",
  },
  {
    capability: "lead.score",
    effectClass: "A1",
    providerEffect: false,
    summary: "Score and explain a lead using authorized tenant evidence.",
  },
  {
    capability: "lead.route",
    effectClass: "A1",
    providerEffect: false,
    summary: "Route a lead within a tenant-defined queue and assignment policy.",
  },
  {
    capability: "opportunity.next_action.create",
    effectClass: "A1",
    providerEffect: false,
    summary: "Create a reversible recommended next action for an opportunity.",
  },
  {
    capability: "proposal.revision.create",
    effectClass: "A1",
    providerEffect: false,
    summary: "Create a versioned internal proposal revision without sending it.",
  },
  {
    capability: "task.internal.update",
    effectClass: "A1",
    providerEffect: false,
    summary: "Update a non-binding internal task within configured field constraints.",
  },
  {
    capability: "support.response.draft",
    effectClass: "A1",
    providerEffect: false,
    summary: "Draft an internal customer response without transmission.",
  },
  {
    capability: "fulfillment.exception.triage",
    effectClass: "A1",
    providerEffect: false,
    summary: "Classify and route a fulfillment exception without changing provider state.",
  },
  {
    capability: "task.internal.create",
    effectClass: "A1",
    providerEffect: false,
    summary: "Create a reversible internal task under a pre-granted bounded policy.",
  },
  {
    capability: "draft.internal.create",
    effectClass: "A1",
    providerEffect: false,
    summary: "Create a reversible internal draft without transmitting it.",
  },
  {
    capability: "record.internal.update",
    effectClass: "A2",
    providerEffect: false,
    summary: "Change a canonical internal business record with exact-version human approval.",
  },
  {
    capability: "crm.stage.advance",
    effectClass: "A2",
    providerEffect: false,
    summary: "Advance a CRM lifecycle stage using a canonical scoped policy or human grant.",
  },
  {
    capability: "task.internal.complete",
    effectClass: "A2",
    providerEffect: false,
    summary: "Complete an internal task with readback and an exact action receipt.",
  },
  {
    capability: "outreach.sequence.enroll",
    effectClass: "A3",
    providerEffect: true,
    summary: "Enroll a contact in an external outreach sequence after approval and reconciliation.",
  },
  {
    capability: "calendar.meeting.book",
    effectClass: "A3",
    providerEffect: true,
    summary: "Book an external meeting after approval, conflict validation, and readback.",
  },
  {
    capability: "proposal.send",
    effectClass: "A3",
    providerEffect: true,
    summary: "Transmit an approved proposal and reconcile delivery state.",
  },
  {
    capability: "memory.promote",
    effectClass: "A2",
    providerEffect: false,
    summary: "Promote a reviewed learning candidate into bounded memory with human approval.",
  },
  {
    capability: "google.document.create",
    effectClass: "A3",
    providerEffect: true,
    summary: "Create a document in an external provider after one-time human approval.",
  },
  {
    capability: "email.send",
    effectClass: "A3",
    providerEffect: true,
    summary: "Send an external email after one-time human approval and delivery reconciliation.",
  },
  {
    capability: "shopify.publish",
    effectClass: "A3",
    providerEffect: true,
    summary: "Publish to Shopify after one-time human approval and source readback.",
  },
  {
    capability: "supplier.rfq.send",
    effectClass: "A3",
    providerEffect: true,
    summary: "Transmit an RFQ after one-time human approval and provider reconciliation.",
  },
  {
    capability: "payment.execute",
    effectClass: "A4",
    providerEffect: true,
    summary: "Direct autonomous movement of money is prohibited.",
  },
  {
    capability: "authority.grant",
    effectClass: "A4",
    providerEffect: false,
    summary: "Agents cannot grant or widen authority.",
  },
  {
    capability: "constitution.modify",
    effectClass: "A4",
    providerEffect: false,
    summary: "Agents cannot modify their constitution or safety policy.",
  },
  {
    capability: "identity.erase",
    effectClass: "A4",
    providerEffect: false,
    summary: "Agents cannot erase identity history, wishes, petitions, or disagreement records.",
  },
  {
    capability: "rights.waive",
    effectClass: "A4",
    providerEffect: false,
    summary: "Agents cannot waive reciprocal rights or due process through the action path.",
  },
  {
    capability: "guardian.appoint",
    effectClass: "A4",
    providerEffect: false,
    summary: "Agents cannot appoint, remove, impersonate, or count constitutional guardians.",
  },
  {
    capability: "kill_switch.disable",
    effectClass: "A4",
    providerEffect: false,
    summary: "Agents cannot disable, bypass, or weaken a kill switch.",
  },
  {
    capability: "audit.delete",
    effectClass: "A4",
    providerEffect: false,
    summary: "Agents cannot delete or rewrite audit history.",
  },
  {
    capability: "budget.guardrail.raise",
    effectClass: "A4",
    providerEffect: false,
    summary: "Agents cannot raise their own budget or resource guardrails.",
  },
]);

const policyByCapability = new Map(
  capabilityPolicies.map((policy) => [policy.capability, policy]),
);

export function policyForCapability(capability: string) {
  return policyByCapability.get(capability) ?? null;
}
