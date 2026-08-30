import crypto from "node:crypto";
import type { PlatformFailure } from "./failureContract";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type {
  EventActor,
  LifecycleCommandReceipt,
  LifecycleCommandRequest,
} from "@/modules/platform-guarantees/types";

export const PLATFORM_RECEIPT_CONTRACT_VERSION = "luzione-platform-receipt/v1";

export const platformReceiptTypes = [
  "decision", "action_intent", "execution", "readback", "recovery", "release",
] as const;
export type PlatformReceiptType = (typeof platformReceiptTypes)[number];

export type PlatformReceipt = {
  acknowledgementRef: string | null;
  actualEffect: { effectClass: string; summary: string } | null;
  actor: EventActor;
  authority: string;
  capability: string;
  contractVersion: typeof PLATFORM_RECEIPT_CONTRACT_VERSION;
  correlationId: string;
  cost: { amount: number; currency: string } | null;
  createdAt: string;
  failure: PlatformFailure | null;
  idempotencyKey: string;
  inputVersionRefs: readonly string[];
  latencyMs: number | null;
  modelRef: string | null;
  observedAt: string | null;
  outcome: "ACCEPTED" | "BLOCKED" | "CONFIRMED" | "FAILED" | "INDETERMINATE" | "SUCCEEDED";
  policyVersionRefs: readonly string[];
  predecessorReceiptIds: readonly string[];
  providerRef: string | null;
  purpose: string;
  receiptId: string;
  receiptType: PlatformReceiptType;
  releaseSha: string;
  requestId: string;
  requestedEffect: { effectClass: string; summary: string };
  sourceReadbackRef: string | null;
  tenantId: string;
  toolRef: string | null;
  traceId: string;
};

function text(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_000) throw new Error(`${field} is required and bounded.`);
  return normalized;
}

function iso(value: string | null, field: string) {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}

export function createPlatformReceipt(
  input: Omit<PlatformReceipt, "contractVersion" | "receiptId"> & { receiptId?: string },
): PlatformReceipt {
  const receiptType = input.receiptType;
  if (!platformReceiptTypes.includes(receiptType)) throw new Error("Unknown receiptType.");
  if (!input.inputVersionRefs.length) throw new Error("At least one inputVersionRef is required.");
  if (!input.policyVersionRefs.length) throw new Error("At least one policyVersionRef is required.");
  if (input.latencyMs !== null && (!Number.isFinite(input.latencyMs) || input.latencyMs < 0)) {
    throw new Error("latencyMs must be null or non-negative.");
  }
  if (input.cost && (!Number.isFinite(input.cost.amount) || input.cost.amount < 0)) {
    throw new Error("cost.amount must be non-negative.");
  }
  if ((receiptType === "decision" || receiptType === "action_intent") && input.actualEffect) {
    throw new Error(`${receiptType} cannot claim an actual effect.`);
  }
  if ((receiptType === "decision" || receiptType === "action_intent")
    && (input.acknowledgementRef || input.sourceReadbackRef || input.observedAt)) {
    throw new Error(`${receiptType} cannot claim acknowledgement or readback evidence.`);
  }
  if (receiptType === "execution" && input.sourceReadbackRef) {
    throw new Error("execution acknowledgement cannot masquerade as source readback.");
  }
  if (receiptType === "readback" && (!input.sourceReadbackRef || !input.observedAt || !input.actualEffect)) {
    throw new Error("readback requires observedAt, actualEffect and sourceReadbackRef.");
  }
  if (input.modelRef && input.inputVersionRefs.includes(input.modelRef)) {
    throw new Error("A model reference is metadata, not an authoritative input version.");
  }
  return {
    ...input,
    actor: { ...input.actor, roles: [...new Set(input.actor.roles)].sort() },
    authority: text(input.authority, "authority"),
    capability: text(input.capability, "capability"),
    contractVersion: PLATFORM_RECEIPT_CONTRACT_VERSION,
    correlationId: text(input.correlationId, "correlationId"),
    createdAt: iso(input.createdAt, "createdAt") as string,
    idempotencyKey: text(input.idempotencyKey, "idempotencyKey"),
    inputVersionRefs: [...new Set(input.inputVersionRefs)].sort(),
    observedAt: iso(input.observedAt, "observedAt"),
    policyVersionRefs: [...new Set(input.policyVersionRefs)].sort(),
    predecessorReceiptIds: [...new Set(input.predecessorReceiptIds)].sort(),
    purpose: text(input.purpose, "purpose"),
    receiptId: input.receiptId ?? `receipt_${crypto.randomUUID()}`,
    releaseSha: text(input.releaseSha, "releaseSha"),
    requestId: text(input.requestId, "requestId"),
    tenantId: text(input.tenantId, "tenantId"),
    traceId: text(input.traceId, "traceId"),
  };
}

export function createLifecycleCommandExecutionReceipt(input: {
  authority: string;
  capability: string;
  command: LifecycleCommandRequest;
  lifecycleReceipt: LifecycleCommandReceipt;
  purpose: string;
  releaseSha: string;
  requestId: string;
  traceId: string;
}) {
  return createPlatformReceipt({
    acknowledgementRef: `event:${input.lifecycleReceipt.eventId}`,
    actualEffect: {
      effectClass: "INTERNAL_DOMAIN_MUTATION",
      summary: `Canonical owner committed object version ${input.lifecycleReceipt.objectVersion}; outbox dispatch remains pending.`,
    },
    actor: input.command.actor,
    authority: input.authority,
    capability: input.capability,
    correlationId: input.command.correlationId,
    cost: null,
    createdAt: input.command.requestedAt,
    failure: null,
    idempotencyKey: input.command.idempotencyKey,
    inputVersionRefs: [input.command.expectedObjectVersion, `payload:${input.command.payloadHash}`],
    latencyMs: null,
    modelRef: null,
    observedAt: null,
    outcome: "ACCEPTED",
    policyVersionRefs: [input.command.policyVersion],
    predecessorReceiptIds: [],
    providerRef: null,
    purpose: input.purpose,
    receiptId: input.lifecycleReceipt.receiptId,
    receiptType: "execution",
    releaseSha: input.releaseSha,
    requestId: input.requestId,
    requestedEffect: { effectClass: "INTERNAL_DOMAIN_MUTATION", summary: input.command.commandType },
    sourceReadbackRef: null,
    tenantId: input.command.tenantId,
    toolRef: null,
    traceId: input.traceId,
  });
}

export function receiptContentHash(receipt: PlatformReceipt) {
  return sha256(Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "receiptId"),
  ));
}
