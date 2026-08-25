import crypto from "node:crypto";
import type {
  CanonicalObjectRef,
  ContinuationDescriptor,
  EventActor,
  UniversalEventEnvelope,
} from "./types";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const EVENT_TYPE = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/;
const FLOW_COMMANDS = new Set([
  "ACKNOWLEDGE_PROVIDER", "CANCEL_FUTURE_WORK", "CONFIRM_SOURCE_READBACK", "FAIL_CURRENT_STEP",
  "PAUSE_FOR_FACT", "PAUSE_FOR_HUMAN", "QUARANTINE_FLOW", "RECONCILE_SOURCE", "RESUME_FLOW",
  "RETRY_SAFE_STEP", "START_FLOW", "SUPERSEDE_FLOW",
]);

const forbiddenClientKeys = new Set([
  "actor",
  "actorId",
  "actor_id",
  "authorityClass",
  "externalEffectExecuted",
  "permissions",
  "roles",
  "sourceConfirmed",
  "sourceConfirmedAt",
  "tenant",
  "tenantId",
  "tenant_id",
]);

function normalizeJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item, seen));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if (seen.has(value)) throw new Error("Contract payload must not contain circular references.");
    seen.add(value);
    const result = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeJson((value as Record<string, unknown>)[key], seen);
        return accumulator;
      }, {});
    seen.delete(value);
    return result;
  }
  if (["bigint", "function", "symbol", "undefined"].includes(typeof value)) {
    throw new Error(`Contract payload contains unsupported ${typeof value}.`);
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalizeJson(value));
}

export function sha256(value: unknown) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function assertText(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} is required.`);
}

function assertTimestamp(value: string, field: string) {
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${field} must be an ISO-8601 timestamp with a UTC or numeric offset.`);
  }
}

function collectForbiddenKeys(value: unknown, path = "payload"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => collectForbiddenKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(forbiddenClientKeys.has(key) ? [`${path}.${key}`] : []),
    ...collectForbiddenKeys(child, `${path}.${key}`),
  ]);
}

export function assertClientPayloadCannotGrantAuthority(payload: Record<string, unknown>) {
  const offenders = collectForbiddenKeys(payload);
  if (offenders.length) {
    throw new Error(`Client payload cannot grant actor, tenant, source-confirmation, or external-effect authority: ${offenders.join(", ")}.`);
  }
}

export function assertCanonicalObjectRef(subject: CanonicalObjectRef) {
  assertText(subject.ownerProject, "subject.ownerProject");
  assertText(subject.objectType, "subject.objectType");
  assertText(subject.objectId, "subject.objectId");
  assertText(subject.objectVersion, "subject.objectVersion");
  if (!Array.isArray(subject.sourceRefs)) throw new Error("subject.sourceRefs must be an array.");
}

export function createUniversalEventEnvelope(input: {
  actor: EventActor;
  authorityClass: UniversalEventEnvelope["authorityClass"];
  causationId?: string | null;
  commandId?: string | null;
  correctionOf?: string | null;
  correlationId: string;
  eventId?: string;
  eventType: string;
  eventVersion: number;
  evidenceRefs?: string[];
  idempotencyKey: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  privacyClass?: UniversalEventEnvelope["privacyClass"];
  producerProject: string;
  recordedAt: string;
  retentionClass?: UniversalEventEnvelope["retentionClass"];
  stepId?: string | null;
  subject: CanonicalObjectRef;
  supersedes?: string | null;
  tenantId: string;
  workflowId?: string | null;
}): UniversalEventEnvelope {
  assertText(input.tenantId, "tenantId");
  assertText(input.actor.actorId, "actor.actorId");
  assertText(input.correlationId, "correlationId");
  assertText(input.idempotencyKey, "idempotencyKey");
  assertText(input.producerProject, "producerProject");
  if (!EVENT_TYPE.test(input.eventType)) throw new Error("eventType must use versioned dot notation, for example lifecycle.command.accepted.");
  if (!Number.isInteger(input.eventVersion) || input.eventVersion < 1) throw new Error("eventVersion must be a positive integer.");
  assertTimestamp(input.occurredAt, "occurredAt");
  assertTimestamp(input.recordedAt, "recordedAt");
  assertCanonicalObjectRef(input.subject);
  assertClientPayloadCannotGrantAuthority(input.payload);

  const payload = normalizeJson(input.payload) as Record<string, unknown>;
  return {
    actor: { ...input.actor, roles: [...new Set(input.actor.roles)].sort() },
    authorityClass: input.authorityClass,
    causationId: input.causationId ?? null,
    commandId: input.commandId ?? null,
    contractVersion: "1.0",
    correctionOf: input.correctionOf ?? null,
    correlationId: input.correlationId,
    eventId: input.eventId ?? `evt_${crypto.randomUUID()}`,
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    evidenceRefs: [...new Set(input.evidenceRefs ?? [])].sort(),
    idempotencyKey: input.idempotencyKey,
    occurredAt: new Date(input.occurredAt).toISOString(),
    payload,
    payloadHash: sha256(payload),
    privacyClass: input.privacyClass ?? "INTERNAL",
    producerProject: input.producerProject,
    recordedAt: new Date(input.recordedAt).toISOString(),
    retentionClass: input.retentionClass ?? "OPERATIONAL",
    stepId: input.stepId ?? null,
    subject: { ...input.subject, sourceRefs: [...new Set(input.subject.sourceRefs)].sort() },
    supersedes: input.supersedes ?? null,
    tenantId: input.tenantId,
    workflowId: input.workflowId ?? null,
  };
}

export function signContinuationDescriptor(descriptor: ContinuationDescriptor, secret: string) {
  if (secret.length < 16) throw new Error("Continuation signing secret must contain at least 16 characters.");
  const body = Buffer.from(canonicalJson(descriptor)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyContinuationToken(token: string, secret: string, now: string) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("Continuation token is malformed.");
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new Error("Continuation token signature is invalid.");
  }
  const descriptor = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ContinuationDescriptor;
  if (!descriptor || typeof descriptor !== "object") throw new Error("Continuation descriptor is invalid.");
  assertText(descriptor.tenantId, "continuation.tenantId");
  assertText(descriptor.flowId, "continuation.flowId");
  if (!Number.isInteger(descriptor.workflowVersion) || descriptor.workflowVersion < 1) throw new Error("Continuation workflow version is invalid.");
  if (!Number.isInteger(descriptor.stateVersion) || descriptor.stateVersion < 1) throw new Error("Continuation state version is invalid.");
  if (descriptor.checkpointId !== null && typeof descriptor.checkpointId !== "string") throw new Error("Continuation checkpoint is invalid.");
  if (!Array.isArray(descriptor.allowedCommands) || descriptor.allowedCommands.some((command) => typeof command !== "string")) {
    throw new Error("Continuation allowed commands are invalid.");
  }
  if (descriptor.allowedCommands.some((command) => !FLOW_COMMANDS.has(command))) throw new Error("Continuation contains an unknown command.");
  assertTimestamp(descriptor.expiresAt, "continuation.expiresAt");
  assertTimestamp(now, "now");
  if (new Date(descriptor.expiresAt).getTime() <= new Date(now).getTime()) throw new Error("Continuation token has expired.");
  return descriptor;
}
