import {
  AUTHORITY_CONTRACT_VERSION,
  type AuthenticatedPrincipal,
  type AuthorityClass,
  type EffectAction,
  type EffectEnvelope,
  type Money,
} from "./types";
import { assertOpaqueSecretRef } from "./secretStore";

export class ControlPlaneRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, label: string, maximum = 500) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maximum) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", `${label} must be a non-empty string up to ${maximum} characters.`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maximum = 500) {
  return value === undefined || value === null ? undefined : textValue(value, label, maximum);
}

function stringArray(value: unknown, label: string, maximumItems = 100) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", `${label} must be an array of at most ${maximumItems} strings.`);
  }
  const items = value.map((item) => textValue(item, label));
  if (new Set(items).size !== items.length) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", `${label} must not contain duplicates.`);
  }
  return items;
}

function money(value: unknown, label: string): Money {
  const input = object(value, label);
  const amount = textValue(input.amount, `${label}.amount`, 32);
  const currency = textValue(input.currency, `${label}.currency`, 3);
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", `${label} must use a non-negative decimal amount and ISO currency code.`);
  }
  return { amount, currency };
}

const RAW_SECRET_KEY = /(secret|token|password|credential|api[_-]?key|private[_-]?key)/i;

export function assertNoRawSecrets(value: unknown, path = "configuration"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_SECRET_KEY.test(key)) {
      throw new ControlPlaneRequestError("RAW_SECRET_REJECTED", `Raw credential field ${path}.${key} is prohibited.`);
    }
    assertNoRawSecrets(entry, `${path}.${key}`);
  }
}

export async function readBoundedJson(request: Request, maximumBytes = 64 * 1024) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new ControlPlaneRequestError("REQUEST_TOO_LARGE", "The request body is too large.", 413);
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maximumBytes) {
    throw new ControlPlaneRequestError("REQUEST_TOO_LARGE", "The request body is too large.", 413);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ControlPlaneRequestError("INVALID_JSON", "The request body must be valid JSON.");
  }
}

export type CreateConnectionInput = {
  adapterVersion: string;
  authMethod: "OAUTH2" | "API_KEY" | "BASIC" | "DATABASE" | "NONE" | "LEGACY";
  configuration: Record<string, unknown>;
  displayName: string;
  legacySourceRef?: string;
  provider: string;
  scopes: string[];
  secretRef?: string;
};

export function parseCreateConnection(value: unknown): CreateConnectionInput {
  const input = object(value, "connection");
  if ("tenantId" in input || "tenant_id" in input) {
    throw new ControlPlaneRequestError("TENANT_CONTEXT_FORBIDDEN", "Tenant context is resolved from the authenticated membership, not the request body.");
  }
  const provider = textValue(input.provider, "provider", 100);
  if (!/^[a-z][a-z0-9._-]+$/.test(provider)) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "provider must be a registered lowercase provider code.");
  }
  const authMethod = textValue(input.authMethod, "authMethod", 32);
  if (!["OAUTH2", "API_KEY", "BASIC", "DATABASE", "NONE", "LEGACY"].includes(authMethod)) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "authMethod is not supported.");
  }
  const configuration = object(input.configuration ?? {}, "configuration");
  assertNoRawSecrets(configuration);
  const secretRef = optionalText(input.secretRef, "secretRef", 507);
  if (secretRef) assertOpaqueSecretRef(secretRef);
  const legacySourceRef = optionalText(input.legacySourceRef, "legacySourceRef", 500);
  if (authMethod === "LEGACY" && (!secretRef?.startsWith("legacy:") || !legacySourceRef)) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "LEGACY connections require a legacy: secret reference and source reference.");
  }
  if (authMethod !== "NONE" && !secretRef) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "Authenticated connections require an opaque secretRef.");
  }
  return {
    adapterVersion: textValue(input.adapterVersion, "adapterVersion", 100),
    authMethod: authMethod as CreateConnectionInput["authMethod"],
    configuration,
    displayName: textValue(input.displayName, "displayName", 200),
    legacySourceRef,
    provider,
    scopes: stringArray(input.scopes ?? [], "scopes"),
    secretRef,
  };
}

export function parseConnectionPatch(value: unknown) {
  const input = object(value, "connection patch");
  if ("tenantId" in input || "tenant_id" in input || "secretRef" in input) {
    throw new ControlPlaneRequestError(
      "IMMUTABLE_CONNECTION_FIELD",
      "Tenant and credential references cannot be changed through the connection metadata endpoint.",
    );
  }
  const configuration = input.configuration === undefined
    ? undefined
    : object(input.configuration, "configuration");
  if (configuration) assertNoRawSecrets(configuration);
  if (input.killSwitchActive !== undefined && typeof input.killSwitchActive !== "boolean") {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "killSwitchActive must be a boolean.");
  }
  return {
    configuration,
    displayName: optionalText(input.displayName, "displayName", 200),
    killSwitchActive: input.killSwitchActive as boolean | undefined,
    scopes: input.scopes === undefined ? undefined : stringArray(input.scopes, "scopes"),
  };
}

export function parseApprovalDecision(value: unknown) {
  const input = object(value, "approval decision");
  if (input.decision !== "APPROVE" && input.decision !== "DENY") {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "decision must be APPROVE or DENY.");
  }
  return {
    decision: input.decision as "APPROVE" | "DENY",
    rationale: textValue(input.rationale, "rationale", 2_000),
  };
}

export function parseLearningGuardianDecision(value: unknown) {
  const input = object(value, "learning guardian decision");
  const allowedKeys = new Set(["decision", "rationale"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new ControlPlaneRequestError(
      "GUARDIAN_SCOPE_FORBIDDEN",
      "A guardian may submit only a decision and rationale; all learning scope is resolved from the canonical command.",
    );
  }
  if (input.decision !== "APPROVE" && input.decision !== "DENY") {
    throw new ControlPlaneRequestError(
      "INVALID_REQUEST",
      "decision must be APPROVE or DENY.",
    );
  }
  return {
    decision: input.decision as "APPROVE" | "DENY",
    rationale: textValue(input.rationale, "rationale", 2_000),
  };
}

function principal(value: unknown): AuthenticatedPrincipal {
  const input = object(value, "actor");
  const principalType = textValue(input.principalType, "actor.principalType", 16);
  if (!["USER", "SERVICE", "AGENT"].includes(principalType)) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "actor.principalType is invalid.");
  }
  return {
    identityId: textValue(input.identityId, "actor.identityId", 200),
    membershipRole: textValue(input.membershipRole, "actor.membershipRole", 64),
    principalType: principalType as AuthenticatedPrincipal["principalType"],
  };
}

export type ParsedCommand = {
  action: EffectAction;
  commandType: string;
  envelope: EffectEnvelope;
  payload: Record<string, unknown>;
  target: {
    objectId: string;
    objectType: string;
    objectVersion: string;
    ownerProject: string;
  };
};

export function parseCommand(value: unknown): ParsedCommand {
  const input = object(value, "command");
  const envelopeInput = object(input.envelope, "envelope");
  const actionInput = object(input.action, "action");
  const targetInput = object(input.target, "target");
  const authorityClass = textValue(envelopeInput.authorityClass, "envelope.authorityClass", 2);
  if (!["A0", "A1", "A2", "A3", "A4"].includes(authorityClass)) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "envelope.authorityClass is invalid.");
  }
  const estimatedCost = envelopeInput.estimatedCost === undefined
    ? undefined
    : money(envelopeInput.estimatedCost, "envelope.estimatedCost");
  const payload = object(input.payload ?? {}, "payload");
  assertNoRawSecrets(payload, "payload");
  const contentDigest = textValue(actionInput.contentDigest, "action.contentDigest", 64);
  if (!/^[a-f0-9]{64}$/.test(contentDigest)) {
    throw new ControlPlaneRequestError("INVALID_REQUEST", "action.contentDigest must be a lowercase SHA-256 digest.");
  }
  return {
    action: {
      actionId: textValue(actionInput.actionId, "action.actionId", 200),
      actionVersion: textValue(actionInput.actionVersion, "action.actionVersion", 100),
      connectionId: optionalText(actionInput.connectionId, "action.connectionId", 64),
      compensationPlanRef: optionalText(actionInput.compensationPlanRef, "action.compensationPlanRef", 500),
      contentDigest,
      model: optionalText(actionInput.model, "action.model", 200),
      provider: textValue(actionInput.provider, "action.provider", 100),
      readbackPlanned: actionInput.readbackPlanned === true,
      safeReconciliationPlanned: actionInput.safeReconciliationPlanned === true,
    },
    commandType: textValue(input.commandType, "commandType", 200),
    envelope: {
      actor: principal(envelopeInput.actor),
      approvalId: optionalText(envelopeInput.approvalId, "envelope.approvalId", 200),
      authorityClass: authorityClass as AuthorityClass,
      capability: textValue(envelopeInput.capability, "envelope.capability", 200),
      contractVersion: textValue(envelopeInput.contractVersion, "envelope.contractVersion", 64) as typeof AUTHORITY_CONTRACT_VERSION,
      correlationId: textValue(envelopeInput.correlationId, "envelope.correlationId", 200),
      estimatedCost,
      idempotencyKey: textValue(envelopeInput.idempotencyKey, "envelope.idempotencyKey", 200),
      policyDecisionId: textValue(envelopeInput.policyDecisionId, "envelope.policyDecisionId", 200),
      resourceScope: stringArray(envelopeInput.resourceScope, "envelope.resourceScope"),
      tenantId: textValue(envelopeInput.tenantId, "envelope.tenantId", 64),
    },
    payload,
    target: {
      objectId: textValue(targetInput.objectId, "target.objectId", 500),
      objectType: textValue(targetInput.objectType, "target.objectType", 200),
      objectVersion: textValue(targetInput.objectVersion, "target.objectVersion", 200),
      ownerProject: textValue(targetInput.ownerProject, "target.ownerProject", 200),
    },
  };
}
