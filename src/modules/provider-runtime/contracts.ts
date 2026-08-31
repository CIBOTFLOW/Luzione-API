import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { FailureClass } from "@/modules/platform-guarantees/types";

export const PROVIDER_ADAPTER_CONTRACT_VERSION = "luzione-provider-adapter/v0.1";

export type ProviderMode = "LIVE" | "SANDBOX";
export type ProviderEffectClass = "EXTERNAL_EFFECT" | "NO_EFFECT" | "REVERSIBLE_INTERNAL";

export type ProviderMessage = {
  authorizationRef: string | null;
  destination: string;
  effectClass: ProviderEffectClass;
  expectedObjectVersion: string;
  idempotencyKey: string;
  objectId: string;
  objectType: string;
  outboxMessageId: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  receiptId: string;
  resultingObjectVersion: string;
  tenantId: string;
};

export type PreparedProviderRequest = {
  contractVersion: typeof PROVIDER_ADAPTER_CONTRACT_VERSION;
  destination: string;
  idempotencyKey: string;
  objectRef: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  providerRequestRef: string;
  resultingObjectVersion: string;
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
  readonly destination: string;
  readonly mode: ProviderMode;
  readonly provider: string;
  compensate(request: PreparedProviderRequest): Promise<ProviderCompensationResult>;
  execute(request: PreparedProviderRequest): Promise<ProviderExecutionResult>;
  observe(request: PreparedProviderRequest, acknowledgementRef: string): Promise<ProviderObservationResult>;
  prepare(message: ProviderMessage): Promise<PreparedProviderRequest>;
  reconcile(request: PreparedProviderRequest): Promise<ProviderObservationResult>;
};

const DESTINATION = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

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
  if (!/^[a-f0-9]{64}$/.test(payloadHash) || sha256(payload) !== payloadHash) {
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
  return {
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
