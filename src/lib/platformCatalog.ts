export type PlatformArea = {
  id: string;
  label: string;
  summary: string;
  owns: string[];
  apiRoutes: string[];
  status: "foundation" | "planned" | "read-only";
};

export const platformAreas: PlatformArea[] = [
  {
    id: "objects",
    label: "Objects",
    summary: "Canonical business identity, relationships, versions and state machines.",
    owns: ["Account", "Contact", "Lead", "Opportunity", "Commercial Case", "Proposal Version", "Order", "Shipment", "Campaign", "Customer Issue"],
    apiRoutes: ["/api/v1/catalog"],
    status: "foundation",
  },
  {
    id: "commands",
    label: "Commands & Events",
    summary: "Typed intent, atomic receipts, universal events, inbox/outbox and delivery chronology.",
    owns: ["LifecycleCommand", "CommandReceipt", "UniversalEventEnvelope", "OutboxMessage", "InboxMessage", "IdempotencyConflict"],
    apiRoutes: ["/api/v1/platform-guarantees"],
    status: "foundation",
  },
  {
    id: "workflows",
    label: "Workflows",
    summary: "Durable flow state, checkpoints, waits, timers, human tasks, compensation and safe continuation.",
    owns: ["WorkflowDefinition", "WorkflowInstance", "WorkflowCheckpoint", "HumanTask", "Timer", "Continuation", "RecoveryReceipt"],
    apiRoutes: ["/api/v1/platform-guarantees"],
    status: "foundation",
  },
  {
    id: "integrations",
    label: "Integrations",
    summary: "Provider adapters, OAuth, webhooks, synchronization, mappings, acknowledgement and readback.",
    owns: ["ProviderConnection", "WebhookSubscription", "SyncJob", "DataMapping", "ProviderReadback", "ProviderHealth"],
    apiRoutes: ["/api/v1/catalog/shopify/projections"],
    status: "foundation",
  },
  {
    id: "data",
    label: "Data",
    summary: "Imports, matching, deduplication, identity resolution, provenance, reconciliation and correction.",
    owns: ["ImportJob", "IdentityMatch", "DeduplicationDecision", "SourceReference", "ReconciliationCase", "Correction"],
    apiRoutes: ["/api/v1/catalog/shopify/projections"],
    status: "foundation",
  },
  {
    id: "access",
    label: "Access",
    summary: "Tenant, actor, roles, permissions, consent, suppression and service authority.",
    owns: ["Tenant", "Actor", "Role", "Permission", "ServiceAccount", "Consent", "Suppression", "RLSReadiness", "TenantLicense", "ModuleEntitlement"],
    apiRoutes: [
      "/api/v1/security/rls-readiness",
      "/api/v1/licensing/entitlements",
      "/api/v1/autonomy/constitution",
      "/api/v1/autonomy/evaluate",
    ],
    status: "read-only",
  },
  {
    id: "productization",
    label: "Productization",
    summary: "Customer segments, product modules, editions, market rollout and room-plan proposal integration contracts.",
    owns: ["ProductModule", "ProductEdition", "CustomerProfile", "MarketRollout", "RoomPlanProposalAttachment"],
    apiRoutes: ["/api/v1/productization"],
    status: "foundation",
  },
  {
    id: "reliability",
    label: "Reliability",
    summary: "Idempotency, bounded retries, reconciliation, dead letters, replay, kill switches and guarantees.",
    owns: ["RetryDecision", "DeliveryAttempt", "DeadLetter", "ReplayRequest", "KillSwitch", "GuaranteeEvaluation", "RecoveryPlaybook"],
    apiRoutes: ["/api/v1/platform-guarantees"],
    status: "read-only",
  },
  {
    id: "audit",
    label: "Audit",
    summary: "Immutable command, event, actor, approval, correction and access history.",
    owns: ["AuditEvent", "CommandReceipt", "ApprovalDecision", "CorrectionLineage", "AccessEvent"],
    apiRoutes: [],
    status: "planned",
  },
  {
    id: "autonomy",
    label: "Autonomy",
    summary: "Typed effect classes, immutable safety rules, bounded authority, simulations and fail-closed action evaluation.",
    owns: ["AutonomyConstitution", "CapabilityPolicy", "AuthorityGrant", "ActionEvaluation", "SafetySimulation"],
    apiRoutes: ["/api/v1/autonomy/constitution", "/api/v1/autonomy/evaluate"],
    status: "foundation",
  },
  {
    id: "docs",
    label: "Developer",
    summary: "Versioned API contracts, event catalog, webhooks, sandbox and changelog.",
    owns: ["OpenAPI", "EventSchema", "WebhookContract", "CompatibilityPolicy", "Changelog"],
    apiRoutes: ["/api/v1/healthz", "/api/v1/catalog"],
    status: "foundation",
  },
];

export const canonicalObjects = [
  { name: "Account", owner: "Customers", next: "Contact, Opportunity, Commercial Case, Order and Customer Issue relationships" },
  { name: "Contact", owner: "Customers", next: "Account membership and contact roles" },
  { name: "Lead", owner: "Growth/Customers", next: "Deduplicated conversion to Contact, Account and optional Opportunity" },
  { name: "Opportunity", owner: "Customers", next: "Qualified pursuit with Account, Contact Roles and next step" },
  { name: "CommercialCase", owner: "Commercial Cases", next: "Proposal-stage project tied to one Opportunity and Account" },
  { name: "ProposalVersion", owner: "Commercial Cases", next: "Immutable after approval/send; acceptance binds exact version" },
  { name: "Order", owner: "Orders & Delivery", next: "Created from one accepted Proposal Version" },
  { name: "Shipment", owner: "Orders & Delivery", next: "Carrier, stage, ETA, documents, evidence and exceptions" },
  { name: "Campaign", owner: "Growth", next: "Members, provider identity, attribution and measurable outcomes" },
  { name: "CustomerIssue", owner: "Customer Care", next: "Conversation, order/evidence, SLA, resolution and approval" }
];
