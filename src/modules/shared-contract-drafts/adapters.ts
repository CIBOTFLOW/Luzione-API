import type { ApiActor } from "@/lib/api/actor";
import type { CausalReadback } from "@/modules/platform-contracts/readbackContract";
import type { RequestIdentityEnvelope } from "@/modules/platform-contracts/requestIdentity";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { LifecycleCommandReceipt, LifecycleCommandRequest } from "@/modules/platform-guarantees/types";
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

const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;

function bounded(value: string, field: string) {
  const normalized = value.trim();
  if (!BOUNDED_ID.test(normalized)) throw new Error(`${field} must be a bounded stable identifier.`);
  return normalized;
}

function exactIso(value: string, field: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}

export function adaptIdentityTenantDraft(input: {
  actor: ApiActor;
  identity: RequestIdentityEnvelope;
  logicalActor?: {
    actorId: string;
    definitionVersion: string;
    delegationEvidenceRef: string;
  } | null;
}): A02IdentityTenantDraft {
  const { actor, identity } = input;
  if (!identity.actorId || !identity.actorType || !identity.tenantId
    || !identity.authorityClass || !identity.capability || !identity.purpose) {
    throw new Error("Authenticated request identity must be fully server-bound before A02 adaptation.");
  }
  if (identity.actorId !== actor.actorId || identity.actorType !== actor.actorType
    || identity.tenantId !== actor.tenantId) {
    throw new Error("Credential actor and request identity do not match.");
  }
  if (!actor.capabilities.includes(identity.capability)) {
    throw new Error("The bound request capability is absent from the verified credential.");
  }
  const logicalActor = input.logicalActor
    ? {
        actorId: bounded(input.logicalActor.actorId, "logicalActor.actorId"),
        actorType: "agent" as const,
        definitionVersion: bounded(input.logicalActor.definitionVersion, "logicalActor.definitionVersion"),
        delegationEvidenceRef: bounded(input.logicalActor.delegationEvidenceRef, "logicalActor.delegationEvidenceRef"),
      }
    : null;
  if (logicalActor && actor.actorType !== "service") {
    throw new Error("Only a verified service workload may carry a delegated logical actor.");
  }
  return {
    authority: {
      authorityClass: bounded(identity.authorityClass, "authority.authorityClass"),
      capability: bounded(identity.capability, "authority.capability"),
      purpose: bounded(identity.purpose, "authority.purpose"),
    },
    contractVersion: A02_IDENTITY_TENANT_CONTRACT_VERSION,
    credentialActor: {
      actorId: bounded(actor.actorId, "credentialActor.actorId"),
      actorType: actor.actorType,
      credentialSource: actor.source,
    },
    logicalActor,
    request: {
      correlationId: bounded(identity.correlationId, "request.correlationId"),
      requestId: bounded(identity.requestId, "request.requestId"),
      requestedAt: exactIso(identity.requestedAt, "request.requestedAt"),
      spanId: bounded(identity.spanId, "request.spanId"),
      traceId: bounded(identity.traceId, "request.traceId"),
    },
    serverDerived: true,
    sourceVersionRefs: [...new Set(identity.sourceVersionRefs.map((value) => bounded(value, "sourceVersionRef")))].sort(),
    tenant: {
      boundary: "EXACT",
      source: "VERIFIED_CREDENTIAL",
      tenantId: bounded(actor.tenantId, "tenant.tenantId"),
    },
  };
}

export function adaptLifecycleCommandDraft(input: {
  command: LifecycleCommandRequest;
  context: A02IdentityTenantDraft;
}): A02CommandDraft {
  const { command, context } = input;
  if (command.tenantId !== context.tenant.tenantId
    || command.actor.actorId !== (context.logicalActor?.actorId ?? context.credentialActor.actorId)
    || command.actor.actorType !== (context.logicalActor?.actorType ?? context.credentialActor.actorType)) {
    throw new Error("Command actor or tenant does not match the authenticated A02 context.");
  }
  if (command.correlationId !== context.request.correlationId) {
    throw new Error("Command correlation does not match the authenticated A02 context.");
  }
  const payloadHash = sha256(command.payload);
  if (payloadHash !== command.payloadHash) throw new Error("Command payload hash does not match its canonical payload.");
  return {
    activation: "DRAFT_ONLY",
    commandId: bounded(command.commandId, "commandId"),
    commandType: bounded(command.commandType, "commandType"),
    context,
    contractVersion: A02_COMMAND_CONTRACT_VERSION,
    expectedObjectVersion: bounded(command.expectedObjectVersion, "expectedObjectVersion"),
    idempotencyKey: bounded(command.idempotencyKey, "idempotencyKey"),
    payload: command.payload,
    payloadHash,
    policyVersionRefs: [bounded(command.policyVersion, "policyVersion")],
    requestedAt: exactIso(command.requestedAt, "requestedAt"),
    requestedEffect: { authorizationRef: null, effectClass: "NO_EFFECT" },
    target: {
      objectId: bounded(command.target.objectId, "target.objectId"),
      objectType: bounded(command.target.objectType, "target.objectType"),
      objectVersion: bounded(command.target.objectVersion, "target.objectVersion"),
      ownerProject: bounded(command.target.ownerProject, "target.ownerProject"),
    },
  };
}

export function adaptLifecycleReceiptDraft(input: {
  command: A02CommandDraft;
  receipt: LifecycleCommandReceipt;
}): A02ReceiptDraft {
  const { command, receipt } = input;
  if (receipt.commandId !== command.commandId || receipt.tenantId !== command.context.tenant.tenantId
    || receipt.correlationId !== command.context.request.correlationId
    || receipt.idempotencyKey !== command.idempotencyKey || receipt.payloadHash !== command.payloadHash) {
    throw new Error("Lifecycle receipt does not close the exact A02 command.");
  }
  return {
    commandId: receipt.commandId,
    contractVersion: A02_RECEIPT_CONTRACT_VERSION,
    correlationId: receipt.correlationId,
    effectAuthority: "NOT_GRANTED_BY_CONTRACT",
    evidence: { eventId: receipt.eventId, outboxMessageId: receipt.outboxMessageId },
    idempotency: {
      key: receipt.idempotencyKey,
      payloadHash: receipt.payloadHash,
      replay: receipt.idempotentReplay,
    },
    object: {
      id: command.target.objectId,
      type: command.target.objectType,
      version: receipt.objectVersion,
      ownerProject: command.target.ownerProject,
    },
    receiptId: bounded(receipt.receiptId, "receiptId"),
    state: receipt.state,
    tenantId: receipt.tenantId,
  };
}

export function adaptCausalReadbackDraft(input: {
  readback: CausalReadback;
  receipt?: A02ReceiptDraft;
}): A02ReadbackDraft {
  const { readback, receipt } = input;
  if (receipt && (readback.tenantId !== receipt.tenantId
    || readback.evidence.receiptId !== receipt.receiptId
    || (readback.evidence.commandId !== null && readback.evidence.commandId !== receipt.commandId))) {
    throw new Error("Causal readback does not match the exact A02 receipt.");
  }
  if (readback.businessFinal !== (readback.finality === "SOURCE_CONFIRMED")) {
    throw new Error("Only authoritative SOURCE_CONFIRMED readback may be business-final.");
  }
  return {
    businessFinal: readback.businessFinal,
    contractVersion: A02_READBACK_CONTRACT_VERSION,
    evidence: {
      commandId: readback.evidence.commandId,
      eventId: readback.evidence.eventId,
      providerAcknowledgementRef: readback.evidence.providerAcknowledgementRef,
      receiptId: readback.evidence.receiptId,
      reconciliationId: readback.evidence.reconciliationId,
      sourceReadbackRef: readback.evidence.sourceReadbackRef,
    },
    finality: readback.finality,
    freshness: {
      freshUntil: readback.freshness.freshUntil,
      observedAt: readback.freshness.observedAt,
      state: readback.freshness.state,
    },
    object: readback.object,
    reason: readback.reason,
    tenantId: readback.tenantId,
  };
}
