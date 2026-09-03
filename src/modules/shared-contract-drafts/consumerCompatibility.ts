import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  A02_COMMAND_CONTRACT_VERSION,
  A02_IDENTITY_TENANT_CONTRACT_VERSION,
  A02_READBACK_CONTRACT_VERSION,
  A02_RECEIPT_CONTRACT_VERSION,
  type A02CommandDraft,
  type A02IdentityTenantDraft,
  type A02ReadbackDraft,
  type A02ReceiptDraft,
} from "./contracts";

export type A02ConsumerCompatibilityErrorCode =
  | "A02_CROSS_TENANT"
  | "A02_EFFECT_AUTHORITY_DENIED"
  | "A02_FIELD_SET_MISMATCH"
  | "A02_IDEMPOTENCY_CONFLICT"
  | "A02_STALE_FINALITY"
  | "A02_VALUE_INVALID"
  | "A02_WRONG_VERSION";

export class A02ConsumerCompatibilityError extends Error {
  readonly code: A02ConsumerCompatibilityErrorCode;

  constructor(code: A02ConsumerCompatibilityErrorCode, message: string) {
    super(message);
    this.name = "A02ConsumerCompatibilityError";
    this.code = code;
  }
}

type JsonObject = Record<string, unknown>;

export function parseA02IdentityTenantConsumerFixture(value: unknown): A02IdentityTenantDraft {
  const envelope = exactObject(value, [
    "authority", "contractVersion", "credentialActor", "logicalActor", "request",
    "serverDerived", "sourceVersionRefs", "tenant",
  ], "identityTenant");
  exactVersion(envelope.contractVersion, A02_IDENTITY_TENANT_CONTRACT_VERSION, "identityTenant");
  if (envelope.serverDerived !== true) invalid("identityTenant.serverDerived must be true.");

  const request = exactObject(envelope.request, [
    "correlationId", "requestId", "requestedAt", "spanId", "traceId",
  ], "identityTenant.request");
  stableId(request.requestId, "identityTenant.request.requestId");
  stableId(request.correlationId, "identityTenant.request.correlationId");
  patterned(request.traceId, /^[a-f0-9]{32}$/, "identityTenant.request.traceId");
  patterned(request.spanId, /^[a-f0-9]{16}$/, "identityTenant.request.spanId");
  timestamp(request.requestedAt, "identityTenant.request.requestedAt");

  const credentialActor = exactObject(envelope.credentialActor, [
    "actorId", "actorType", "credentialSource",
  ], "identityTenant.credentialActor");
  stableId(credentialActor.actorId, "identityTenant.credentialActor.actorId");
  enumeration(credentialActor.actorType, ["agent", "service", "user"], "identityTenant.credentialActor.actorType");
  enumeration(credentialActor.credentialSource, ["service-token", "vercel-oidc"], "identityTenant.credentialActor.credentialSource");

  if (envelope.logicalActor !== null) {
    const logicalActor = exactObject(envelope.logicalActor, [
      "actorId", "actorType", "definitionVersion", "delegationEvidenceRef",
    ], "identityTenant.logicalActor");
    stableId(logicalActor.actorId, "identityTenant.logicalActor.actorId");
    if (logicalActor.actorType !== "agent") invalid("identityTenant.logicalActor.actorType must be agent.");
    stableId(logicalActor.definitionVersion, "identityTenant.logicalActor.definitionVersion");
    stableId(logicalActor.delegationEvidenceRef, "identityTenant.logicalActor.delegationEvidenceRef");
  }

  const tenant = exactObject(envelope.tenant, ["boundary", "source", "tenantId"], "identityTenant.tenant");
  stableId(tenant.tenantId, "identityTenant.tenant.tenantId");
  if (tenant.source !== "VERIFIED_CREDENTIAL" || tenant.boundary !== "EXACT") {
    invalid("identityTenant.tenant must remain an exact verified-credential boundary.");
  }

  const authority = exactObject(envelope.authority, [
    "authorityClass", "capability", "purpose",
  ], "identityTenant.authority");
  stableId(authority.authorityClass, "identityTenant.authority.authorityClass");
  stableId(authority.capability, "identityTenant.authority.capability");
  stableId(authority.purpose, "identityTenant.authority.purpose");
  uniqueStableIds(envelope.sourceVersionRefs, false, "identityTenant.sourceVersionRefs");
  return envelope as A02IdentityTenantDraft;
}

export function parseA02CommandConsumerFixture(value: unknown): A02CommandDraft {
  const envelope = exactObject(value, [
    "activation", "commandId", "commandType", "context", "contractVersion",
    "expectedObjectVersion", "idempotencyKey", "payload", "payloadHash",
    "policyVersionRefs", "requestedAt", "requestedEffect", "target",
  ], "command");
  exactVersion(envelope.contractVersion, A02_COMMAND_CONTRACT_VERSION, "command");
  if (envelope.activation !== "DRAFT_ONLY") invalid("command.activation must remain DRAFT_ONLY.");
  parseA02IdentityTenantConsumerFixture(envelope.context);
  stableId(envelope.commandId, "command.commandId");
  stableId(envelope.commandType, "command.commandType");
  stableId(envelope.expectedObjectVersion, "command.expectedObjectVersion");
  stableId(envelope.idempotencyKey, "command.idempotencyKey");
  const payload = object(envelope.payload, "command.payload");
  patterned(envelope.payloadHash, /^[a-f0-9]{64}$/, "command.payloadHash");
  if (envelope.payloadHash !== sha256(payload)) {
    compatibilityError("A02_IDEMPOTENCY_CONFLICT", "command.payloadHash does not match the canonical payload.");
  }
  uniqueStableIds(envelope.policyVersionRefs, true, "command.policyVersionRefs");
  timestamp(envelope.requestedAt, "command.requestedAt");

  const requestedEffect = exactObject(envelope.requestedEffect, [
    "authorizationRef", "effectClass",
  ], "command.requestedEffect");
  if (requestedEffect.effectClass !== "NO_EFFECT" || requestedEffect.authorizationRef !== null) {
    compatibilityError("A02_EFFECT_AUTHORITY_DENIED", "command requested effect authority outside NO_EFFECT.");
  }
  const target = exactObject(envelope.target, [
    "objectId", "objectType", "objectVersion", "ownerProject",
  ], "command.target");
  stableId(target.objectId, "command.target.objectId");
  stableId(target.objectType, "command.target.objectType");
  stableId(target.objectVersion, "command.target.objectVersion");
  stableId(target.ownerProject, "command.target.ownerProject");
  return envelope as A02CommandDraft;
}

export function parseA02ReceiptConsumerFixture(
  value: unknown,
  command?: A02CommandDraft,
): A02ReceiptDraft {
  const envelope = exactObject(value, [
    "commandId", "contractVersion", "correlationId", "effectAuthority", "evidence",
    "idempotency", "object", "receiptId", "state", "tenantId",
  ], "receipt");
  exactVersion(envelope.contractVersion, A02_RECEIPT_CONTRACT_VERSION, "receipt");
  stableId(envelope.receiptId, "receipt.receiptId");
  stableId(envelope.commandId, "receipt.commandId");
  stableId(envelope.correlationId, "receipt.correlationId");
  stableId(envelope.tenantId, "receipt.tenantId");
  enumeration(envelope.state, ["DOMAIN_COMMITTED", "DISPATCH_PENDING"], "receipt.state");
  if (envelope.effectAuthority !== "NOT_GRANTED_BY_CONTRACT") {
    compatibilityError("A02_EFFECT_AUTHORITY_DENIED", "receipt must not grant effect authority.");
  }

  const idempotency = exactObject(envelope.idempotency, ["key", "payloadHash", "replay"], "receipt.idempotency");
  stableId(idempotency.key, "receipt.idempotency.key");
  patterned(idempotency.payloadHash, /^[a-f0-9]{64}$/, "receipt.idempotency.payloadHash");
  if (typeof idempotency.replay !== "boolean") invalid("receipt.idempotency.replay must be boolean.");
  const objectRef = exactObject(envelope.object, ["id", "ownerProject", "type", "version"], "receipt.object");
  stableId(objectRef.id, "receipt.object.id");
  stableId(objectRef.ownerProject, "receipt.object.ownerProject");
  stableId(objectRef.type, "receipt.object.type");
  stableId(objectRef.version, "receipt.object.version");
  const evidence = exactObject(envelope.evidence, ["eventId", "outboxMessageId"], "receipt.evidence");
  stableId(evidence.eventId, "receipt.evidence.eventId");
  stableId(evidence.outboxMessageId, "receipt.evidence.outboxMessageId");

  if (command) {
    if (envelope.tenantId !== command.context.tenant.tenantId) {
      compatibilityError("A02_CROSS_TENANT", "receipt tenant does not match the command context.");
    }
    if (envelope.commandId !== command.commandId
      || envelope.correlationId !== command.context.request.correlationId
      || idempotency.key !== command.idempotencyKey
      || idempotency.payloadHash !== command.payloadHash) {
      compatibilityError("A02_IDEMPOTENCY_CONFLICT", "receipt does not close the exact command and payload hash.");
    }
    if (objectRef.id !== command.target.objectId
      || objectRef.type !== command.target.objectType
      || objectRef.ownerProject !== command.target.ownerProject) {
      invalid("receipt object does not match the command target.");
    }
  }
  return envelope as A02ReceiptDraft;
}

export function parseA02ReadbackConsumerFixture(
  value: unknown,
  receipt?: A02ReceiptDraft,
): A02ReadbackDraft {
  const envelope = exactObject(value, [
    "businessFinal", "contractVersion", "evidence", "finality", "freshness",
    "object", "reason", "tenantId",
  ], "readback");
  exactVersion(envelope.contractVersion, A02_READBACK_CONTRACT_VERSION, "readback");
  stableId(envelope.tenantId, "readback.tenantId");
  enumeration(envelope.finality, [
    "DOMAIN_COMMITTED", "MISSING", "PROVIDER_ACKNOWLEDGED", "RECONCILING", "SOURCE_CONFIRMED",
  ], "readback.finality");
  if (typeof envelope.businessFinal !== "boolean") invalid("readback.businessFinal must be boolean.");

  const freshness = exactObject(envelope.freshness, ["freshUntil", "observedAt", "state"], "readback.freshness");
  enumeration(freshness.state, ["FRESH", "NOT_APPLICABLE", "STALE", "UNKNOWN"], "readback.freshness.state");
  timestampOrNull(freshness.observedAt, "readback.freshness.observedAt");
  timestampOrNull(freshness.freshUntil, "readback.freshness.freshUntil");
  const objectRef = exactObject(envelope.object, ["id", "ownerProject", "type", "version"], "readback.object");
  for (const key of ["id", "ownerProject", "type", "version"] as const) {
    boundedStringOrNull(objectRef[key], `readback.object.${key}`);
  }
  const evidence = exactObject(envelope.evidence, [
    "commandId", "eventId", "providerAcknowledgementRef", "receiptId", "reconciliationId", "sourceReadbackRef",
  ], "readback.evidence");
  stableId(evidence.receiptId, "readback.evidence.receiptId");
  for (const key of ["commandId", "eventId", "providerAcknowledgementRef", "reconciliationId", "sourceReadbackRef"] as const) {
    boundedStringOrNull(evidence[key], `readback.evidence.${key}`);
  }
  boundedString(envelope.reason, 1, 2000, "readback.reason");

  const sourceFinal = envelope.finality === "SOURCE_CONFIRMED"
    && freshness.state === "FRESH"
    && evidence.sourceReadbackRef !== null;
  if (envelope.businessFinal !== sourceFinal) {
    compatibilityError("A02_STALE_FINALITY", "only fresh authoritative source readback may be business-final.");
  }
  if (receipt) {
    if (envelope.tenantId !== receipt.tenantId) {
      compatibilityError("A02_CROSS_TENANT", "readback tenant does not match the receipt.");
    }
    if (evidence.receiptId !== receipt.receiptId
      || (evidence.commandId !== null && evidence.commandId !== receipt.commandId)
      || (evidence.eventId !== null && evidence.eventId !== receipt.evidence.eventId)) {
      invalid("readback evidence does not match the exact receipt.");
    }
    if (objectRef.id !== null && objectRef.id !== receipt.object.id) invalid("readback object id does not match the receipt.");
    if (objectRef.type !== null && objectRef.type !== receipt.object.type) invalid("readback object type does not match the receipt.");
    if (objectRef.ownerProject !== null && objectRef.ownerProject !== receipt.object.ownerProject) {
      invalid("readback object owner does not match the receipt.");
    }
  }
  return envelope as A02ReadbackDraft;
}

function exactObject(value: unknown, keys: readonly string[], path: string): JsonObject {
  const result = object(value, path);
  const expected = [...keys].sort();
  const actual = Object.keys(result).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    compatibilityError(
      "A02_FIELD_SET_MISMATCH",
      `${path} fields must be exactly ${expected.join(", ")}; received ${actual.join(", ")}.`,
    );
  }
  return result;
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} must be an object.`);
  return value as JsonObject;
}

function exactVersion(value: unknown, expected: string, path: string) {
  if (value !== expected) compatibilityError("A02_WRONG_VERSION", `${path}.contractVersion must be ${expected}.`);
}

function stableId(value: unknown, path: string) {
  boundedString(value, 2, 512, path);
}

function boundedString(value: unknown, minimum: number, maximum: number, path: string) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    invalid(`${path} must be a string between ${minimum} and ${maximum} characters.`);
  }
}

function boundedStringOrNull(value: unknown, path: string) {
  if (value !== null) boundedString(value, 0, 512, path);
}

function patterned(value: unknown, pattern: RegExp, path: string) {
  if (typeof value !== "string" || !pattern.test(value)) invalid(`${path} has an invalid format.`);
}

function timestamp(value: unknown, path: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(`${path} must be an ISO timestamp.`);
}

function timestampOrNull(value: unknown, path: string) {
  if (value !== null) timestamp(value, path);
}

function enumeration(value: unknown, allowed: readonly string[], path: string) {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(`${path} is not an allowed value.`);
}

function uniqueStableIds(value: unknown, requireOne: boolean, path: string) {
  if (!Array.isArray(value) || (requireOne && value.length === 0)) invalid(`${path} must be a non-empty array when required.`);
  value.forEach((item, index) => stableId(item, `${path}[${index}]`));
  if (new Set(value).size !== value.length) invalid(`${path} values must be unique.`);
}

function invalid(message: string): never {
  return compatibilityError("A02_VALUE_INVALID", message);
}

function compatibilityError(code: A02ConsumerCompatibilityErrorCode, message: string): never {
  throw new A02ConsumerCompatibilityError(code, message);
}
