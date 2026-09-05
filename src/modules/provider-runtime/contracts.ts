import {
  EFFECT_ADMISSION_CONTRACT_VERSION,
  type EffectAdmissionDecision,
  type EffectExecutionEnvelope,
  parseEffectAdmissionDecision,
  parseEffectExecutionEnvelope,
} from "@/modules/effect-admission/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { FailureClass } from "@/modules/platform-guarantees/types";

export const LEGACY_PROVIDER_ADAPTER_CONTRACT_VERSION = "luzione-provider-adapter/v0.2" as const;
export const PROVIDER_ADAPTER_CONTRACT_VERSION = "luzione-provider-adapter/v0.3" as const;
export const PREPARED_PROVIDER_DISPATCH_VERSION = "luzione-prepared-provider-dispatch/v1" as const;
export const PROVIDER_CREDENTIAL_RELEASE_VERSION = "luzione-provider-credential-release/v1" as const;

export type ProviderMode = "LIVE" | "SANDBOX";
export type ProviderEffectClass = "EXTERNAL_EFFECT" | "NO_EFFECT" | "REVERSIBLE_INTERNAL";

export type ProviderMessage = {
  actor: { actorId: string; actorType: "agent" | "service" | "system" | "user" };
  authorizationRef: string | null;
  destination: string;
  /** Historical v0.2 input only. v0.3 durable rows never populate this field. */
  effectAdmissionRef?: string | null;
  effectClass: ProviderEffectClass;
  expectedObjectVersion: string;
  idempotencyKey: string;
  objectId: string;
  objectType: string;
  originatingEnvelopeRef: string;
  outboxMessageId: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  receiptId: string;
  resultingObjectVersion: string;
  tenantId: string;
};

export type PreparedProviderDispatch = {
  adapterContractVersion: typeof PROVIDER_ADAPTER_CONTRACT_VERSION;
  contractVersion: typeof PREPARED_PROVIDER_DISPATCH_VERSION;
  credentialBindingId: string;
  destination: string;
  effectClass: ProviderEffectClass;
  idempotencyKey: string;
  objectRef: string;
  originatingEnvelopeRef: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  provider: string;
  providerRequestRef: string;
  resultingObjectVersion: string;
  sourcePayloadHash: string;
  tenantId: string;
};

/** @deprecated Historical live-adapter v0.2 shape; it cannot satisfy ProviderAdapter v0.3. */
export type PreparedProviderRequest = {
  contractVersion: typeof LEGACY_PROVIDER_ADAPTER_CONTRACT_VERSION;
  credentialBindingId: string;
  destination: string;
  effectAdmissionRef: string;
  idempotencyKey: string;
  objectRef: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  provider: string;
  providerRequestRef: string;
  resultingObjectVersion: string;
  tenantId: string;
};

export type ProviderCredentialRelease = {
  contractVersion: typeof PROVIDER_CREDENTIAL_RELEASE_VERSION;
  credentialBindingId: string;
  effectAdmissionRef: string;
  executionIdentity: string;
  preparedDispatchDigest: string;
  releaseRef: string;
  state: "NO_CREDENTIAL_REQUIRED" | "RELEASED";
};

export type ProviderExecutionContext = {
  executionEnvelope: EffectExecutionEnvelope;
  preparedDispatch: PreparedProviderDispatch;
};

export type ProviderExecutionResult =
  | { acknowledgementRef: string; state: "ACKNOWLEDGED" }
  | { errorCode: string; failureClass: FailureClass; retryAfterMs?: number | null; safeSummary: string; state: "FAILED" };

export type ProviderObservationResult = {
  notes?: string | null;
  observedObjectVersion?: string | null;
  result: "AMBIGUOUS" | "MATCHED" | "NOT_FOUND" | "SOURCE_UNAVAILABLE" | "VERSION_MISMATCH";
  sourceReadbackRef?: string | null;
};

export type ProviderCompensationResult =
  | { acknowledgementRef: string; state: "ACKNOWLEDGED" }
  | { reason: string; state: "NOT_SUPPORTED" };

export type ProviderAdapter = {
  readonly contractVersion: typeof PROVIDER_ADAPTER_CONTRACT_VERSION;
  readonly credentialBindingId: string;
  readonly destination: string;
  readonly effectClass: ProviderEffectClass;
  readonly mode: ProviderMode;
  readonly provider: string;
  compensate(context: ProviderExecutionContext): Promise<ProviderCompensationResult>;
  execute(context: ProviderExecutionContext, release: ProviderCredentialRelease): Promise<ProviderExecutionResult>;
  observe(context: ProviderExecutionContext, acknowledgementRef: string): Promise<ProviderObservationResult>;
  /** Pure canonicalization only. No credential read and no provider contact are permitted. */
  prepare(message: ProviderMessage): Promise<unknown>;
  reconcile(context: ProviderExecutionContext): Promise<ProviderObservationResult>;
  /** Invoked only after the credential-release admission checkpoint succeeds. */
  releaseCredential(prepared: PreparedProviderDispatch, decision: EffectAdmissionDecision): Promise<unknown>;
};

const DESTINATION = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const DIGEST = /^[a-f0-9]{64}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const PREPARED_KEYS = [
  "adapterContractVersion", "contractVersion", "credentialBindingId", "destination", "effectClass",
  "idempotencyKey", "objectRef", "originatingEnvelopeRef", "payload", "payloadHash", "provider",
  "providerRequestRef", "resultingObjectVersion", "sourcePayloadHash", "tenantId",
] as const;
const RELEASE_KEYS = [
  "contractVersion", "credentialBindingId", "effectAdmissionRef", "executionIdentity",
  "preparedDispatchDigest", "releaseRef", "state",
] as const;

export class ProviderContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProviderContractError";
  }
}

function text(value: unknown, field: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new ProviderContractError("PROVIDER_CONTRACT_INVALID", `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderContractError("PROVIDER_CONTRACT_INVALID", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function providerMessageFromRow(row: Record<string, unknown>): ProviderMessage {
  const payload = record(row.payload, "payload");
  const payloadHash = text(row.payload_hash, "payloadHash", 64);
  if (!DIGEST.test(payloadHash) || sha256(payload) !== payloadHash) {
    throw new ProviderContractError("PROVIDER_PAYLOAD_HASH_MISMATCH", "The durable outbox payload does not match its canonical hash.");
  }
  const destination = text(row.destination, "destination", 190);
  if (!DESTINATION.test(destination)) throw new ProviderContractError("PROVIDER_DESTINATION_INVALID", "The durable destination is invalid.");
  const effectClass = text(row.effect_class, "effectClass", 32);
  if (!(["EXTERNAL_EFFECT", "NO_EFFECT", "REVERSIBLE_INTERNAL"] as string[]).includes(effectClass)) {
    throw new ProviderContractError("PROVIDER_EFFECT_CLASS_INVALID", "The durable effect class is unsupported.");
  }
  const authorizationRef = row.authorization_ref == null ? null : text(row.authorization_ref, "authorizationRef", 500);
  if (effectClass === "EXTERNAL_EFFECT" && !authorizationRef) {
    throw new ProviderContractError("PROVIDER_AUTHORITY_MISSING", "External effects require a durable authorization reference.");
  }
  const message = {
    actor: { actorId: text(row.actor_id, "actorId", 512), actorType: actorType(row.actor_type) },
    authorizationRef,
    destination,
    effectClass: effectClass as ProviderEffectClass,
    expectedObjectVersion: text(row.expected_object_version, "expectedObjectVersion", 300),
    idempotencyKey: text(row.idempotency_key, "idempotencyKey", 500),
    objectId: text(row.target_object_id, "objectId", 500),
    objectType: text(row.target_object_type, "objectType", 200),
    outboxMessageId: text(row.outbox_message_id, "outboxMessageId", 500),
    payload,
    payloadHash,
    receiptId: text(row.receipt_id, "receiptId", 500),
    resultingObjectVersion: text(row.resulting_object_version, "resultingObjectVersion", 300),
    tenantId: text(row.tenant_id, "tenantId", 200),
  };
  return Object.freeze({ ...message, originatingEnvelopeRef: providerOriginatingEnvelopeRef(message) });
}

export function providerOriginatingEnvelopeRef(message: Pick<ProviderMessage,
  "idempotencyKey" | "outboxMessageId" | "payloadHash" | "receiptId" | "resultingObjectVersion" | "tenantId">) {
  return `p110-origin:${sha256({
    idempotencyKey: message.idempotencyKey,
    outboxMessageId: message.outboxMessageId,
    payloadHash: message.payloadHash,
    receiptId: message.receiptId,
    resultingObjectVersion: message.resultingObjectVersion,
    tenantId: message.tenantId,
  })}`;
}

export function parsePreparedProviderDispatch(value: unknown, message: ProviderMessage, adapter: ProviderAdapter): PreparedProviderDispatch {
  const row = exactObject(value, PREPARED_KEYS, "PREPARED_PROVIDER_DISPATCH") as unknown as PreparedProviderDispatch;
  if (adapter.contractVersion !== PROVIDER_ADAPTER_CONTRACT_VERSION
    || row.adapterContractVersion !== PROVIDER_ADAPTER_CONTRACT_VERSION
    || row.contractVersion !== PREPARED_PROVIDER_DISPATCH_VERSION) {
    throw new ProviderContractError("PROVIDER_CONTRACT_VERSION_UNSUPPORTED", "The prepared dispatch contract version is unsupported.");
  }
  if (!DIGEST.test(row.payloadHash) || !DIGEST.test(row.sourcePayloadHash) || sha256(row.payload) !== row.payloadHash) {
    throw new ProviderContractError("PREPARED_PROVIDER_PAYLOAD_HASH_MISMATCH", "The prepared dispatch payload digest is invalid.");
  }
  record(row.payload, "preparedDispatch.payload");
  for (const [field, fieldValue] of Object.entries({
    credentialBindingId: row.credentialBindingId,
    destination: row.destination,
    idempotencyKey: row.idempotencyKey,
    objectRef: row.objectRef,
    originatingEnvelopeRef: row.originatingEnvelopeRef,
    provider: row.provider,
    providerRequestRef: row.providerRequestRef,
    resultingObjectVersion: row.resultingObjectVersion,
    tenantId: row.tenantId,
  })) text(fieldValue, `preparedDispatch.${field}`, 512);
  if (!DESTINATION.test(row.destination)
    || !["EXTERNAL_EFFECT", "NO_EFFECT", "REVERSIBLE_INTERNAL"].includes(row.effectClass)) {
    throw new ProviderContractError("PREPARED_PROVIDER_DISPATCH_INVALID", "The prepared destination or effect class is invalid.");
  }
  if (adapter.credentialBindingId !== row.credentialBindingId
    || adapter.destination !== row.destination
    || adapter.effectClass !== row.effectClass
    || adapter.provider !== row.provider
    || message.destination !== row.destination
    || message.effectClass !== row.effectClass
    || message.idempotencyKey !== row.idempotencyKey
    || `${message.objectType}:${message.objectId}` !== row.objectRef
    || message.originatingEnvelopeRef !== row.originatingEnvelopeRef
    || message.payloadHash !== row.sourcePayloadHash
    || message.resultingObjectVersion !== row.resultingObjectVersion
    || message.tenantId !== row.tenantId) {
    throw new ProviderContractError("PREPARED_PROVIDER_BINDING_MISMATCH", "The prepared dispatch changed its canonical source binding.");
  }
  return Object.freeze(row);
}

export function preparedProviderDispatchDigest(prepared: PreparedProviderDispatch) {
  return sha256(prepared);
}

export function buildProviderCredentialRelease(prepared: PreparedProviderDispatch, decisionValue: unknown, state: ProviderCredentialRelease["state"]): ProviderCredentialRelease {
  const decision = parseEffectAdmissionDecision(decisionValue);
  const digest = preparedProviderDispatchDigest(prepared);
  if (!decision.admitted || !decision.credentialReleaseAuthorized
    || decision.contractVersion !== EFFECT_ADMISSION_CONTRACT_VERSION
    || decision.checkpoint !== "PROVIDER_CREDENTIAL_RELEASE"
    || decision.credentialBindingId !== prepared.credentialBindingId
    || decision.destination !== prepared.destination
    || decision.originatingEnvelopeRef !== prepared.originatingEnvelopeRef
    || decision.preparedDispatchDigest !== digest
    || decision.provider !== prepared.provider
    || decision.sourcePayloadHash !== prepared.sourcePayloadHash
    || decision.tenantId !== prepared.tenantId) {
    throw new ProviderContractError("PROVIDER_CREDENTIAL_RELEASE_NOT_ADMITTED", "Credential release lacks an exact admitted checkpoint.");
  }
  if (state !== "NO_CREDENTIAL_REQUIRED" && state !== "RELEASED") {
    throw new ProviderContractError("PROVIDER_CREDENTIAL_RELEASE_INVALID", "Credential release state is invalid.");
  }
  const unsigned = {
    contractVersion: PROVIDER_CREDENTIAL_RELEASE_VERSION,
    credentialBindingId: prepared.credentialBindingId,
    effectAdmissionRef: decision.decisionRef,
    executionIdentity: decision.executionIdentity,
    preparedDispatchDigest: digest,
    state,
  };
  return Object.freeze({ ...unsigned, releaseRef: `credential-release:${sha256(unsigned)}` });
}

export function parseProviderCredentialRelease(value: unknown, prepared: PreparedProviderDispatch, decision: EffectAdmissionDecision): ProviderCredentialRelease {
  const row = exactObject(value, RELEASE_KEYS, "PROVIDER_CREDENTIAL_RELEASE") as unknown as ProviderCredentialRelease;
  const expected = buildProviderCredentialRelease(prepared, decision, row.state);
  if (JSON.stringify(row) !== JSON.stringify(expected)) {
    throw new ProviderContractError("PROVIDER_CREDENTIAL_RELEASE_INVALID", "Credential release content does not match the admitted checkpoint.");
  }
  return Object.freeze(row);
}

export function buildProviderExecutionContext(envelopeValue: unknown, prepared: PreparedProviderDispatch): ProviderExecutionContext {
  const envelope = parseEffectExecutionEnvelope(envelopeValue);
  if (envelope.admissionCheckpoint !== "PROVIDER_PRE_EXECUTE"
    || envelope.credentialBindingId !== prepared.credentialBindingId
    || envelope.destination !== prepared.destination
    || envelope.originatingEnvelopeRef !== prepared.originatingEnvelopeRef
    || envelope.preparedDispatchDigest !== preparedProviderDispatchDigest(prepared)
    || envelope.provider !== prepared.provider
    || envelope.sourcePayloadHash !== prepared.sourcePayloadHash
    || envelope.tenantId !== prepared.tenantId) {
    throw new ProviderContractError("PROVIDER_EXECUTION_CONTEXT_BINDING_MISMATCH", "Execution context does not bind the prepared dispatch.");
  }
  return Object.freeze({ executionEnvelope: envelope, preparedDispatch: prepared });
}

function actorType(value: unknown): ProviderMessage["actor"]["actorType"] {
  const parsed = text(value, "actorType", 20);
  if (!(["agent", "service", "system", "user"] as string[]).includes(parsed)) {
    throw new ProviderContractError("PROVIDER_ACTOR_INVALID", "The durable receipt actor type is invalid.");
  }
  return parsed as ProviderMessage["actor"]["actorType"];
}

export function assertAdapterResult(result: ProviderExecutionResult) {
  if (result.state === "ACKNOWLEDGED") {
    text(result.acknowledgementRef, "acknowledgementRef", 1_000);
    return result;
  }
  if (!FAILURE_CODE.test(result.errorCode)) throw new ProviderContractError("PROVIDER_FAILURE_INVALID", "Provider errorCode is invalid.");
  text(result.safeSummary, "safeSummary", 1_000);
  if (!(["AMBIGUOUS_AFTER_ACK", "CONTRACT_VIOLATION", "PERMANENT", "POLICY_BLOCKED", "RATE_LIMITED", "TRANSIENT_BEFORE_ACK"] as string[]).includes(result.failureClass)) {
    throw new ProviderContractError("PROVIDER_FAILURE_INVALID", "Provider failureClass is invalid.");
  }
  if (result.retryAfterMs != null && (!Number.isSafeInteger(result.retryAfterMs) || result.retryAfterMs < 0 || result.retryAfterMs > 900_000)) {
    throw new ProviderContractError("PROVIDER_FAILURE_INVALID", "retryAfterMs must be a bounded safe integer.");
  }
  return result;
}

export function assertObservation(result: ProviderObservationResult, expectedVersion: string) {
  if (result.result === "MATCHED") {
    if (!result.sourceReadbackRef?.trim()) throw new ProviderContractError("PROVIDER_READBACK_REF_REQUIRED", "Matched observation requires source readback evidence.");
    if (result.observedObjectVersion !== expectedVersion) throw new ProviderContractError("PROVIDER_VERSION_MISMATCH", "Matched observation must equal the exact expected source version.");
  }
  if (result.sourceReadbackRef && result.sourceReadbackRef.length > 1_000) throw new ProviderContractError("PROVIDER_READBACK_INVALID", "sourceReadbackRef is too long.");
  if (result.observedObjectVersion && result.observedObjectVersion.length > 300) throw new ProviderContractError("PROVIDER_READBACK_INVALID", "observedObjectVersion is too long.");
  if (result.notes && result.notes.length > 1_000) throw new ProviderContractError("PROVIDER_READBACK_INVALID", "notes are too long.");
  return result;
}

function exactObject<const T extends readonly string[]>(value: unknown, keys: T, code: string): Record<T[number], unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderContractError(`${code}_INVALID`, `${code} must be an object.`);
  const row = value as Record<string, unknown>;
  const actual = Object.keys(row).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ProviderContractError(`${code}_FIELDS_INVALID`, `${code} has missing or surplus fields.`);
  }
  return row as Record<T[number], unknown>;
}
