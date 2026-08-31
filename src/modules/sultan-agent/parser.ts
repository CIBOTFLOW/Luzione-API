import { dataClassifications, effectClasses } from "@/modules/autonomy/types";
import {
  SULTAN_AGENT_CONTEXT_CONTRACT_VERSION,
  SULTAN_AGENT_INTENT_CONTRACT_VERSION,
  sultanAgentAuthorityDomains,
  sultanAgentCaseTypes,
  sultanAgentRunModes,
  type SultanAgentContextRef,
  type SultanAgentIntent,
} from "./contracts";

type JsonObject = Record<string, unknown>;

export class SultanAgentIntentError extends Error {
  constructor(readonly code: "CLIENT_AUTHORITY_REJECTED" | "INVALID_AGENT_INTENT", message: string) {
    super(message);
  }
}

const forbiddenAuthorityKeys = new Set([
  "actor",
  "actorId",
  "actorType",
  "approval",
  "authority",
  "authorityGrant",
  "capabilities",
  "grant",
  "roles",
  "tenantId",
  "verifiedDeployment",
]);

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SultanAgentIntentError("INVALID_AGENT_INTENT", `${label} is invalid.`);
  }
  return value as JsonObject;
}

function boundedString(value: unknown, label: string, pattern: RegExp, maximum = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || !pattern.test(value)) {
    throw new SultanAgentIntentError("INVALID_AGENT_INTENT", `${label} is invalid.`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new SultanAgentIntentError("INVALID_AGENT_INTENT", `${label} is invalid.`);
  }
  return value as T;
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new SultanAgentIntentError("INVALID_AGENT_INTENT", `${label} is invalid.`);
  return value;
}

function rejectAuthorityClaims(value: JsonObject) {
  const rejected = Object.keys(value).find((key) => forbiddenAuthorityKeys.has(key));
  if (rejected) {
    throw new SultanAgentIntentError(
      "CLIENT_AUTHORITY_REJECTED",
      `${rejected} must be derived from the authenticated server-side authority boundary.`,
    );
  }
}

function contextRef(value: unknown, index: number): SultanAgentContextRef {
  const context = object(value, `sourceContext[${index}]`);
  const observedAt = boundedString(context.observedAt, `sourceContext[${index}].observedAt`, /^\d{4}-\d{2}-\d{2}T/);
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new SultanAgentIntentError("INVALID_AGENT_INTENT", `sourceContext[${index}].observedAt is invalid.`);
  }
  return Object.freeze({
    contextContractVersion: enumValue(
      context.contextContractVersion,
      [SULTAN_AGENT_CONTEXT_CONTRACT_VERSION] as const,
      `sourceContext[${index}].contextContractVersion`,
    ),
    freshness: enumValue(context.freshness, ["FRESH", "STALE", "UNKNOWN"] as const, `sourceContext[${index}].freshness`),
    integrityHash: boundedString(context.integrityHash, `sourceContext[${index}].integrityHash`, /^[0-9a-f]{64}$/),
    observedAt,
    sourceOwner: enumValue(
      context.sourceOwner,
      ["CIBOTFLOW/Luzione-API", "CIBOTFLOW/FEP-Platform", "SYNTHETIC_LUZIONE"] as const,
      `sourceContext[${index}].sourceOwner`,
    ),
    sourceRef: boundedString(context.sourceRef, `sourceContext[${index}].sourceRef`, /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/, 512),
    sourceVersion: boundedString(context.sourceVersion, `sourceContext[${index}].sourceVersion`, /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
  });
}

export function parseSultanAgentIntent(value: unknown): SultanAgentIntent {
  const root = object(value, "request");
  rejectAuthorityClaims(root);
  const intent = object(root.intent, "intent");
  rejectAuthorityClaims(intent);
  const agent = object(intent.agent, "intent.agent");
  const caseRef = object(intent.caseRef, "intent.caseRef");
  const controls = object(intent.controls, "intent.controls");
  if (!Array.isArray(intent.sourceContext) || intent.sourceContext.length === 0 || intent.sourceContext.length > 64) {
    throw new SultanAgentIntentError("INVALID_AGENT_INTENT", "intent.sourceContext is invalid.");
  }

  return Object.freeze({
    actionId: boundedString(intent.actionId, "intent.actionId", /^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    actionVersion: boundedString(intent.actionVersion, "intent.actionVersion", /^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    agent: Object.freeze({
      agentId: boundedString(agent.agentId, "intent.agent.agentId", /^agent\.[a-z0-9.-]+$/),
      agentVersion: boundedString(agent.agentVersion, "intent.agent.agentVersion", /^v[1-9][0-9]*$/),
      authorityDomain: enumValue(agent.authorityDomain, sultanAgentAuthorityDomains, "intent.agent.authorityDomain"),
    }),
    capability: boundedString(intent.capability, "intent.capability", /^[a-z][a-z0-9._-]+$/),
    caseRef: Object.freeze({
      caseId: boundedString(caseRef.caseId, "intent.caseRef.caseId", /^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
      caseType: enumValue(caseRef.caseType, sultanAgentCaseTypes, "intent.caseRef.caseType"),
      expectedVersion: caseRef.expectedVersion === null
        ? null
        : boundedString(caseRef.expectedVersion, "intent.caseRef.expectedVersion", /^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    }),
    controls: Object.freeze({
      budgetWithinLimit: booleanValue(controls.budgetWithinLimit, "intent.controls.budgetWithinLimit"),
      dependenciesReady: booleanValue(controls.dependenciesReady, "intent.controls.dependenciesReady"),
      evidenceComplete: booleanValue(controls.evidenceComplete, "intent.controls.evidenceComplete"),
      idempotencyKey: controls.idempotencyKey === null
        ? null
        : boundedString(controls.idempotencyKey, "intent.controls.idempotencyKey", /^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
      killSwitchReady: booleanValue(controls.killSwitchReady, "intent.controls.killSwitchReady"),
      providerReconciliationPlanned: booleanValue(
        controls.providerReconciliationPlanned,
        "intent.controls.providerReconciliationPlanned",
      ),
      readbackPlanned: booleanValue(controls.readbackPlanned, "intent.controls.readbackPlanned"),
      rollbackPlanned: booleanValue(controls.rollbackPlanned, "intent.controls.rollbackPlanned"),
      simulationPassed: booleanValue(controls.simulationPassed, "intent.controls.simulationPassed"),
    }),
    dataClassification: enumValue(intent.dataClassification, dataClassifications, "intent.dataClassification"),
    declaredEffectClass: enumValue(intent.declaredEffectClass, effectClasses, "intent.declaredEffectClass"),
    intentContractVersion: enumValue(
      intent.intentContractVersion,
      [SULTAN_AGENT_INTENT_CONTRACT_VERSION] as const,
      "intent.intentContractVersion",
    ),
    purpose: boundedString(intent.purpose, "intent.purpose", /^[a-z][a-z0-9._-]+$/),
    runMode: enumValue(intent.runMode, sultanAgentRunModes, "intent.runMode"),
    sourceContext: Object.freeze(intent.sourceContext.map(contextRef)),
    workOrderId: boundedString(intent.workOrderId, "intent.workOrderId", /^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  });
}
