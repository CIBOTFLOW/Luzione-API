import { providerAdapterEnabled } from "@/lib/api/config";
import { PROVIDER_ADAPTER_CONTRACT_VERSION, ProviderContractError, assertAdapterResult, assertObservation, providerMessageFromRow, type ProviderMode } from "@/modules/provider-runtime/contracts";
import { ProviderAdapterRegistry } from "@/modules/provider-runtime/registry";

type DeliveryFailure = {
  errorCode: string;
  errorSummary: string;
  failureClass: "AMBIGUOUS_AFTER_ACK" | "CONTRACT_VIOLATION" | "PERMANENT" | "POLICY_BLOCKED" | "RATE_LIMITED" | "TRANSIENT_BEFORE_ACK";
  outboxMessageId: string;
  retryAfterMs?: number | null;
  tenantId: string;
  workerId: string;
};

export type ProviderWorkerStore = {
  claimDueOutbox(input: { limit?: number; outboxMessageId?: string; tenantId: string; workerId: string }): Promise<Record<string, unknown>[]>;
  claimDueReconciliations(input: { limit?: number; outboxMessageId?: string; tenantId: string; workerId: string }): Promise<Record<string, unknown>[]>;
  completeClaimedReconciliation(input: {
    notes?: string | null;
    observedObjectVersion?: string | null;
    reconciliationId: string;
    result: "AMBIGUOUS" | "MATCHED" | "NOT_FOUND" | "SOURCE_UNAVAILABLE" | "VERSION_MISMATCH";
    sourceReadbackRef?: string | null;
    tenantId: string;
    workerId: string;
  }): Promise<unknown>;
  recordDispatchStarted(input: { adapterContractVersion: string; outboxMessageId: string; providerMode: ProviderMode; providerRequestRef: string; tenantId: string; workerId: string }): Promise<unknown>;
  recordOutboxFailure(input: DeliveryFailure): Promise<unknown>;
  recordProviderAcknowledgement(input: { outboxMessageId: string; providerAcknowledgementRef: string; tenantId: string; workerId: string }): Promise<unknown>;
};

type Enablement = (input: { destination: string; mode: ProviderMode; tenantId: string }) => boolean;

function boundedError(error: unknown) {
  if (error instanceof ProviderContractError) return { code: error.code, summary: error.message.slice(0, 1_000) };
  return { code: "PROVIDER_ADAPTER_ERROR", summary: "The provider adapter failed without a safe typed result." };
}

export class ProviderWorkerRuntime {
  constructor(
    private readonly store: ProviderWorkerStore,
    private readonly registry: ProviderAdapterRegistry,
    private readonly enabled: Enablement = providerAdapterEnabled,
  ) {}

  async runDeliveryBatch(input: { limit?: number; outboxMessageId?: string; tenantId: string; workerId: string }) {
    const claimed = await this.store.claimDueOutbox(input);
    const outcomes: Array<{ destination: string | null; outboxMessageId: string; state: string }> = [];
    for (const row of claimed) {
      const outboxMessageId = String(row.outbox_message_id);
      let message;
      try {
        message = providerMessageFromRow(row);
      } catch (error) {
        const bounded = boundedError(error);
        await this.store.recordOutboxFailure({ errorCode: bounded.code, errorSummary: bounded.summary, failureClass: "CONTRACT_VIOLATION", outboxMessageId, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ destination: typeof row.destination === "string" ? row.destination : null, outboxMessageId, state: "DEAD_LETTERED" });
        continue;
      }
      const adapter = this.registry.get(message.destination);
      if (!adapter) {
        await this.store.recordOutboxFailure({ errorCode: "PROVIDER_ADAPTER_UNREGISTERED", errorSummary: "No exact provider adapter is registered for the durable destination.", failureClass: "PERMANENT", outboxMessageId, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ destination: message.destination, outboxMessageId, state: "DEAD_LETTERED" });
        continue;
      }
      if (!this.enabled({ destination: adapter.destination, mode: adapter.mode, tenantId: input.tenantId })) {
        await this.store.recordOutboxFailure({ errorCode: "PROVIDER_EFFECT_DISABLED", errorSummary: "The provider adapter is not enabled for this exact mode, tenant and destination.", failureClass: "POLICY_BLOCKED", outboxMessageId, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ destination: message.destination, outboxMessageId, state: "DEAD_LETTERED" });
        continue;
      }
      let prepared;
      try {
        prepared = await adapter.prepare(message);
      } catch (error) {
        const bounded = boundedError(error);
        await this.store.recordOutboxFailure({ errorCode: bounded.code, errorSummary: bounded.summary, failureClass: "CONTRACT_VIOLATION", outboxMessageId, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ destination: message.destination, outboxMessageId, state: "DEAD_LETTERED" });
        continue;
      }
      await this.store.recordDispatchStarted({ adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION, outboxMessageId, providerMode: adapter.mode, providerRequestRef: prepared.providerRequestRef, tenantId: input.tenantId, workerId: input.workerId });
      let execution;
      try {
        execution = assertAdapterResult(await adapter.execute(prepared));
      } catch (error) {
        const bounded = boundedError(error);
        await this.store.recordOutboxFailure({ errorCode: bounded.code, errorSummary: bounded.summary, failureClass: "AMBIGUOUS_AFTER_ACK", outboxMessageId, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ destination: message.destination, outboxMessageId, state: "RECONCILIATION_REQUIRED" });
        continue;
      }
      if (execution.state === "ACKNOWLEDGED") {
        await this.store.recordProviderAcknowledgement({ outboxMessageId, providerAcknowledgementRef: execution.acknowledgementRef, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ destination: message.destination, outboxMessageId, state: "PROVIDER_ACKNOWLEDGED" });
      } else {
        const recorded = await this.store.recordOutboxFailure({ errorCode: execution.errorCode, errorSummary: execution.safeSummary, failureClass: execution.failureClass, outboxMessageId, retryAfterMs: execution.retryAfterMs, tenantId: input.tenantId, workerId: input.workerId }) as { state?: string };
        outcomes.push({ destination: message.destination, outboxMessageId, state: recorded.state ?? "FAILED" });
      }
    }
    return { claimed: claimed.length, outcomes };
  }

  async runReconciliationBatch(input: { limit?: number; outboxMessageId?: string; tenantId: string; workerId: string }) {
    const claimed = await this.store.claimDueReconciliations(input);
    const outcomes: Array<{ reconciliationId: string; result: string }> = [];
    for (const row of claimed) {
      const reconciliationId = String(row.reconciliation_id);
      let message;
      try {
        message = providerMessageFromRow(row);
      } catch (error) {
        const bounded = boundedError(error);
        await this.store.completeClaimedReconciliation({ notes: bounded.summary, reconciliationId, result: "VERSION_MISMATCH", tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ reconciliationId, result: "VERSION_MISMATCH" });
        continue;
      }
      const adapter = this.registry.get(message.destination);
      if (!adapter || !this.enabled({ destination: message.destination, mode: adapter.mode, tenantId: input.tenantId })) {
        await this.store.completeClaimedReconciliation({ notes: "The exact provider adapter is unavailable or disabled; no retry is authorized.", reconciliationId, result: "SOURCE_UNAVAILABLE", tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ reconciliationId, result: "SOURCE_UNAVAILABLE" });
        continue;
      }
      try {
        const prepared = await adapter.prepare(message);
        const observation = assertObservation(await adapter.reconcile(prepared), message.resultingObjectVersion);
        await this.store.completeClaimedReconciliation({ notes: observation.notes, observedObjectVersion: observation.observedObjectVersion, reconciliationId, result: observation.result, sourceReadbackRef: observation.sourceReadbackRef, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ reconciliationId, result: observation.result });
      } catch (error) {
        const bounded = boundedError(error);
        const result = error instanceof ProviderContractError && error.code === "PROVIDER_VERSION_MISMATCH" ? "VERSION_MISMATCH" : "SOURCE_UNAVAILABLE";
        await this.store.completeClaimedReconciliation({ notes: bounded.summary, reconciliationId, result, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ reconciliationId, result });
      }
    }
    return { claimed: claimed.length, outcomes };
  }
}
