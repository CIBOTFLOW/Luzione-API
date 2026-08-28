import { dataClassifications, effectClasses } from "./types";
import type { AutonomyActionPlan, AutonomyControlState } from "./types";

type JsonObject = Record<string, unknown>;

const BODY_KEYS = new Set(["plan"]);
const PLAN_KEYS = new Set([
  "actionId",
  "actionVersion",
  "capability",
  "controls",
  "dataClassification",
  "declaredEffectClass",
  "purpose",
]);
const CONTROL_KEYS = new Set([
  "budgetWithinLimit",
  "dependenciesReady",
  "evidenceComplete",
  "idempotencyKey",
  "killSwitchReady",
  "providerReconciliationPlanned",
  "readbackPlanned",
  "rollbackPlanned",
  "simulationPassed",
]);

export class AutonomyRequestError extends Error {
  readonly code: "CLIENT_AUTHORITY_REJECTED" | "INVALID_REQUEST";

  constructor(code: AutonomyRequestError["code"], message: string) {
    super(message);
    this.name = "AutonomyRequestError";
    this.code = code;
  }
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label} must be an object.`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, allowed: Set<string>, label: string) {
  const forbiddenAuthorityKeys = [
    "actorId",
    "actorType",
    "approved",
    "authority",
    "authorityGrant",
    "permissions",
    "roles",
    "tenantId",
  ];
  const clientAuthorityKey = Object.keys(value).find((key) => forbiddenAuthorityKeys.includes(key));
  if (clientAuthorityKey) {
    throw new AutonomyRequestError(
      "CLIENT_AUTHORITY_REJECTED",
      `${label}.${clientAuthorityKey} cannot be supplied by a client.`,
    );
  }
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label}.${unknown} is not supported.`);
  }
}

function boundedString(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label} must be a non-empty string up to ${maximum} characters.`);
  }
  return value.trim();
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new AutonomyRequestError("INVALID_REQUEST", `${label} must be boolean.`);
  }
  return value;
}

function parseControls(value: unknown): AutonomyControlState {
  const controls = object(value, "plan.controls");
  exactKeys(controls, CONTROL_KEYS, "plan.controls");
  const idempotencyKey = controls.idempotencyKey === null
    ? null
    : boundedString(controls.idempotencyKey, "plan.controls.idempotencyKey", 200);
  return {
    budgetWithinLimit: boolean(controls.budgetWithinLimit, "plan.controls.budgetWithinLimit"),
    dependenciesReady: boolean(controls.dependenciesReady, "plan.controls.dependenciesReady"),
    evidenceComplete: boolean(controls.evidenceComplete, "plan.controls.evidenceComplete"),
    idempotencyKey,
    killSwitchReady: boolean(controls.killSwitchReady, "plan.controls.killSwitchReady"),
    providerReconciliationPlanned: boolean(
      controls.providerReconciliationPlanned,
      "plan.controls.providerReconciliationPlanned",
    ),
    readbackPlanned: boolean(controls.readbackPlanned, "plan.controls.readbackPlanned"),
    rollbackPlanned: boolean(controls.rollbackPlanned, "plan.controls.rollbackPlanned"),
    simulationPassed: boolean(controls.simulationPassed, "plan.controls.simulationPassed"),
  };
}

export function parseAutonomyEvaluationRequest(value: unknown): AutonomyActionPlan {
  const body = object(value, "request");
  exactKeys(body, BODY_KEYS, "request");
  const plan = object(body.plan, "plan");
  exactKeys(plan, PLAN_KEYS, "plan");

  const actionId = boundedString(plan.actionId, "plan.actionId", 160);
  const actionVersion = boundedString(plan.actionVersion, "plan.actionVersion", 100);
  const capability = boundedString(plan.capability, "plan.capability", 160);
  const purpose = boundedString(plan.purpose, "plan.purpose", 240);
  if (!/^[A-Za-z0-9._:-]+$/.test(actionId) || !/^[A-Za-z0-9._:-]+$/.test(actionVersion)) {
    throw new AutonomyRequestError("INVALID_REQUEST", "Action identifiers contain unsupported characters.");
  }
  if (!/^[a-z][a-z0-9._-]+$/.test(capability)) {
    throw new AutonomyRequestError("INVALID_REQUEST", "plan.capability must use a lowercase registered capability name.");
  }
  if (!effectClasses.includes(plan.declaredEffectClass as (typeof effectClasses)[number])) {
    throw new AutonomyRequestError("INVALID_REQUEST", "plan.declaredEffectClass is invalid.");
  }
  if (!dataClassifications.includes(plan.dataClassification as (typeof dataClassifications)[number])) {
    throw new AutonomyRequestError("INVALID_REQUEST", "plan.dataClassification is invalid.");
  }

  return {
    actionId,
    actionVersion,
    capability,
    controls: parseControls(plan.controls),
    dataClassification: plan.dataClassification as AutonomyActionPlan["dataClassification"],
    declaredEffectClass: plan.declaredEffectClass as AutonomyActionPlan["declaredEffectClass"],
    purpose,
  };
}
