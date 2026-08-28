import type { DataClassification, EffectClass } from "@/modules/autonomy/types";

export type TenantCapabilityRule = {
  capability: string;
  decision: "ALLOW" | "APPROVAL" | "BLOCK";
  actorTypes: readonly ("agent" | "service" | "user")[];
  purposes: readonly string[];
  maximumEffectClass: EffectClass;
};

export type TenantPolicySnapshot = {
  checksum: string;
  code: string;
  defaultDecision: "APPROVAL" | "BLOCK";
  maximumDataClassification: DataClassification;
  maximumEffectClass: EffectClass;
  policyDefinitionId: string;
  rules: readonly TenantCapabilityRule[];
  tenantId: string | null;
  version: number;
};

export type TenantPolicyDecision = {
  allowedByPolicy: boolean;
  capabilityDecision: "ALLOW" | "APPROVAL" | "BLOCK";
  policyDefinitionId: string;
  policyVersion: number;
  reasonCodes: readonly string[];
  ruleMatched: boolean;
};
