import type { CapabilityPolicy } from "./types";

export const AUTONOMY_CONSTITUTION_VERSION = "2026-08-28.1";

export const autonomyPrinciples = Object.freeze([
  "Models may propose actions but cannot create, widen, verify, or consume their own authority.",
  "Unknown capabilities and degraded dependencies fail to simulation-only or blocked states.",
  "Tenant, purpose, capability, actor, action version, expiry, and one-time scope are verified server-side.",
  "Every effectful action requires idempotency, rollback, readback, a budget guard, and an active kill switch.",
  "External effects additionally require explicit human authority and provider reconciliation.",
  "Constitution, authority, audit, safety, and budget guardrails cannot be changed through the agent action path.",
  "Learning creates reviewable candidates; it never promotes memory, policy, tools, or authority directly.",
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
