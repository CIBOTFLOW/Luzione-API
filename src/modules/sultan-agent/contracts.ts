import type {
  AutonomyControlState,
  AutonomyEvaluation,
  DataClassification,
  EffectClass,
} from "@/modules/autonomy/types";
import type { TenantPolicyDecision } from "@/modules/tenant-policy/types";

export const SULTAN_AGENT_INTENT_CONTRACT_VERSION = "luzione-sultan-agent-intent/v0.1" as const;
export const SULTAN_AGENT_POLICY_CONTRACT_VERSION = "luzione-sultan-agent-policy/v0.1" as const;
export const SULTAN_AGENT_OUTCOME_CONTRACT_VERSION = "luzione-sultan-agent-outcome/v0.1" as const;
export const SULTAN_AGENT_CONTEXT_CONTRACT_VERSION = "luzione-sultan-agent-context/v0.1" as const;

export const sultanAgentRunModes = ["SIMULATION", "SHADOW", "ASSISTED"] as const;
export type SultanAgentRunMode = (typeof sultanAgentRunModes)[number];

export const sultanAgentAuthorityDomains = ["LUZIONE", "FEP", "SULTAN_INTERNAL"] as const;
export type SultanAgentAuthorityDomain = (typeof sultanAgentAuthorityDomains)[number];

export const sultanAgentCaseTypes = [
  "PORTFOLIO",
  "COMMERCIAL",
  "FULFILLMENT",
  "PARTNER_RELATIONSHIP",
  "CATALOG_QUALITY",
  "ACCOUNT_RELATIONSHIP",
  "ECONOMIC_REVIEW",
  "FEP_CASE",
  "CONTROL_REVIEW",
] as const;
export type SultanAgentCaseType = (typeof sultanAgentCaseTypes)[number];

export type SultanAgentDefinitionRef = {
  agentId: string;
  agentVersion: string;
  authorityDomain: SultanAgentAuthorityDomain;
};

export type SultanAgentCaseRef = {
  caseId: string;
  caseType: SultanAgentCaseType;
  expectedVersion: string | null;
};

export type SultanAgentContextRef = {
  contextContractVersion: typeof SULTAN_AGENT_CONTEXT_CONTRACT_VERSION;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  integrityHash: string;
  observedAt: string;
  sourceOwner: "CIBOTFLOW/Luzione-API" | "CIBOTFLOW/FEP-Platform" | "SYNTHETIC_LUZIONE";
  sourceRef: string;
  sourceVersion: string;
};

export type SultanAgentIntent = {
  actionId: string;
  actionVersion: string;
  agent: SultanAgentDefinitionRef;
  capability: string;
  caseRef: SultanAgentCaseRef;
  controls: AutonomyControlState;
  dataClassification: DataClassification;
  declaredEffectClass: EffectClass;
  intentContractVersion: typeof SULTAN_AGENT_INTENT_CONTRACT_VERSION;
  purpose: string;
  runMode: SultanAgentRunMode;
  sourceContext: readonly SultanAgentContextRef[];
  workOrderId: string;
};

export type SultanAgentAdmissionStatus =
  | "ABSTAIN_STALE_CONTEXT"
  | "ADMIT_READ_ONLY"
  | "BLOCKED"
  | "REQUIRE_APPROVAL"
  | "SIMULATE_ONLY";

export type SultanAgentPolicyDecision = {
  actor: {
    actorId: string;
    actorType: "agent" | "service" | "user";
    tenantId: string;
  };
  agent: SultanAgentDefinitionRef & {
    binding: "DIRECT_CREDENTIAL" | "VERCEL_WORKLOAD_DELEGATION" | "UNVERIFIED";
  };
  agentDefinitionVerified: boolean;
  autonomy: AutonomyEvaluation;
  businessStateMutated: false;
  evaluatedOnly: true;
  externalEffectsAuthorized: false;
  nextSafeAction: string;
  policyContractVersion: typeof SULTAN_AGENT_POLICY_CONTRACT_VERSION;
  reasonCodes: readonly string[];
  sourceContext: {
    acceptedCount: number;
    freshness: "FRESH" | "STALE" | "UNKNOWN";
    synthetic: boolean;
    verification: "CANONICAL_READBACK" | "SYNTHETIC_SIMULATION" | "UNVERIFIED";
    verifiedCount: number;
  };
  status: SultanAgentAdmissionStatus;
  tenantPolicy: TenantPolicyDecision;
};

export type SultanAgentOutcomeReceipt = {
  businessCompletionClaimed: false;
  businessStateMutated: false;
  commandReceiptRef: string | null;
  intentRef: string;
  outcomeContractVersion: typeof SULTAN_AGENT_OUTCOME_CONTRACT_VERSION;
  policyDecisionRef: string;
  readbackRef: string | null;
  reconciliationState: "NOT_STARTED";
};
