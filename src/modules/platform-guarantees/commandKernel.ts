import crypto from "node:crypto";
import { createUniversalEventEnvelope, sha256 } from "./eventContract";
import type {
  CanonicalObjectRef,
  IdempotencyConflict,
  LifecycleCommandReceipt,
  LifecycleCommandRequest,
  UniversalEventEnvelope,
} from "./types";

export type AcceptedCommandWrite = {
  event: UniversalEventEnvelope;
  objectVersion: string;
  outboxMessageId: string;
  receipt: LifecycleCommandReceipt;
};

export interface AtomicCommandStore<Transaction> {
  findReceipt(
    transaction: Transaction,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<LifecycleCommandReceipt | null>;
  insertAccepted(transaction: Transaction, write: AcceptedCommandWrite, request: LifecycleCommandRequest): Promise<void>;
  recordConflict(conflict: IdempotencyConflict): Promise<void>;
  withTransaction<Result>(callback: (transaction: Transaction) => Promise<Result>): Promise<Result>;
}

export class IdempotencyConflictError extends Error {
  readonly conflict: IdempotencyConflict;

  constructor(conflict: IdempotencyConflict) {
    super(`Idempotency key ${conflict.idempotencyKey} was already used with a different payload.`);
    this.name = "IdempotencyConflictError";
    this.conflict = conflict;
  }
}

export function createLifecycleCommandRequest(input: Omit<LifecycleCommandRequest, "contractVersion" | "payloadHash">) {
  if (!input.commandId.trim()) throw new Error("commandId is required.");
  if (!input.idempotencyKey.trim()) throw new Error("idempotencyKey is required.");
  if (!input.correlationId.trim()) throw new Error("correlationId is required.");
  if (!input.expectedObjectVersion.trim()) throw new Error("expectedObjectVersion is required.");
  if (!input.policyVersion.trim()) throw new Error("policyVersion is required.");
  return {
    ...input,
    contractVersion: "1.0" as const,
    payloadHash: sha256(input.payload),
  };
}

export class LifecycleCommandKernel<Transaction> {
  constructor(private readonly store: AtomicCommandStore<Transaction>) {}

  async execute(
    request: LifecycleCommandRequest,
    mutateOwner: (
      transaction: Transaction,
      target: CanonicalObjectRef,
    ) => Promise<{ evidenceRefs?: string[]; objectVersion: string }>,
  ) {
    try {
      return await this.store.withTransaction(async (transaction) => {
        const existing = await this.store.findReceipt(
          transaction,
          request.tenantId,
          request.idempotencyKey,
        );
        if (existing) {
          if (existing.payloadHash !== request.payloadHash) {
            throw new IdempotencyConflictError({
              commandId: request.commandId,
              conflictId: `conflict_${crypto.randomUUID()}`,
              existingPayloadHash: existing.payloadHash,
              idempotencyKey: request.idempotencyKey,
              receivedPayloadHash: request.payloadHash,
              tenantId: request.tenantId,
            });
          }
          return { ...existing, idempotentReplay: true };
        }

        const ownerResult = await mutateOwner(transaction, request.target);
        if (!ownerResult.objectVersion.trim()) {
          throw new Error(
            "Owner mutation must return the durable object version read back inside the transaction.",
          );
        }
        const event = createUniversalEventEnvelope({
          actor: request.actor,
          authorityClass: "COMMAND_EVIDENCE",
          causationId: request.causationId,
          commandId: request.commandId,
          correlationId: request.correlationId,
          eventType: "lifecycle.command.accepted",
          eventVersion: 1,
          evidenceRefs: ownerResult.evidenceRefs ?? [],
          idempotencyKey: request.idempotencyKey,
          occurredAt: request.requestedAt,
          payload: {
            commandType: request.commandType,
            expectedObjectVersion: request.expectedObjectVersion,
            objectVersion: ownerResult.objectVersion,
            payloadHash: request.payloadHash,
            policyVersion: request.policyVersion,
          },
          producerProject: "LUZIONE_P110",
          recordedAt: request.requestedAt,
          stepId: request.stepId,
          subject: { ...request.target, objectVersion: ownerResult.objectVersion },
          tenantId: request.tenantId,
          workflowId: request.workflowId,
        });
        const receipt: LifecycleCommandReceipt = {
          commandId: request.commandId,
          correlationId: request.correlationId,
          eventId: event.eventId,
          idempotentReplay: false,
          idempotencyKey: request.idempotencyKey,
          objectVersion: ownerResult.objectVersion,
          outboxMessageId: `outbox_${crypto.randomUUID()}`,
          payloadHash: request.payloadHash,
          receiptId: `receipt_${crypto.randomUUID()}`,
          state: "DISPATCH_PENDING",
          tenantId: request.tenantId,
        };
        await this.store.insertAccepted(
          transaction,
          {
            event,
            objectVersion: ownerResult.objectVersion,
            outboxMessageId: receipt.outboxMessageId,
            receipt,
          },
          request,
        );
        return receipt;
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        await this.store.recordConflict(error.conflict);
      }
      throw error;
    }
  }
}
