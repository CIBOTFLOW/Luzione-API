import { dataClassifications, effectClasses } from "@/modules/autonomy/types";
import type { DataClassification, EffectClass } from "@/modules/autonomy/types";
import type { TenantCapabilityRule, TenantPolicySnapshot } from "./types";

type JsonObject = Record<string, unknown>;
const actorTypes = ["agent", "service", "user"] as const;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value as JsonObject;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${label} is invalid.`);
  return value as T;
}

function stringArray(value: unknown, label: string, maximum = 50) {
  if (!Array.isArray(value) || value.length > maximum || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} is invalid.`);
  }
  return Object.freeze(value.map((entry) => entry.trim()).filter(Boolean));
}

function parseRule(value: unknown, index: number): TenantCapabilityRule {
  const rule = object(value, `rules[${index}]`);
  if (typeof rule.capability !== "string" || !/^[a-z][a-z0-9._-]+$/.test(rule.capability)) {
    throw new Error(`rules[${index}].capability is invalid.`);
  }
  return Object.freeze({
    capability: rule.capability,
    decision: enumValue(rule.decision, ["ALLOW", "APPROVAL", "BLOCK"] as const, `rules[${index}].decision`),
    actorTypes: stringArray(rule.actorTypes, `rules[${index}].actorTypes`, 3)
      .map((entry) => enumValue(entry, actorTypes, `rules[${index}].actorTypes`)),
    purposes: stringArray(rule.purposes ?? [], `rules[${index}].purposes`, 20),
    maximumEffectClass: enumValue(rule.maximumEffectClass, effectClasses, `rules[${index}].maximumEffectClass`),
  });
}

export function parseTenantPolicySnapshot(row: {
  checksum: string | null;
  code: string;
  compiled_json: unknown;
  policy_definition_id: string;
  tenant_id: string | null;
  version: number;
}): TenantPolicySnapshot {
  const policy = object(row.compiled_json, "compiled policy");
  if (!Array.isArray(policy.rules) || policy.rules.length > 500) throw new Error("compiled policy rules are invalid.");
  const rules = policy.rules.map(parseRule);
  if (new Set(rules.map((rule) => rule.capability)).size !== rules.length) {
    throw new Error("compiled policy contains duplicate capability rules.");
  }
  return Object.freeze({
    checksum: row.checksum ?? "unverified",
    code: row.code,
    defaultDecision: enumValue(policy.defaultDecision, ["APPROVAL", "BLOCK"] as const, "defaultDecision"),
    maximumDataClassification: enumValue(
      policy.maximumDataClassification,
      dataClassifications,
      "maximumDataClassification",
    ) as DataClassification,
    maximumEffectClass: enumValue(policy.maximumEffectClass, effectClasses, "maximumEffectClass") as EffectClass,
    policyDefinitionId: row.policy_definition_id,
    rules: Object.freeze(rules),
    tenantId: row.tenant_id,
    version: row.version,
  });
}
