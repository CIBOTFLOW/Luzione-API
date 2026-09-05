import { providerAdapterEnabled } from "@/lib/api/config";
import {
  buildEffectExecutionEnvelope,
  EffectAdmissionError,
  parseEffectExecutionEnvelope,
  type EffectAdmissionCheckpoint,
  type EffectAdmissionDecision,
  type EffectAdmissionSubject,
} from "@/modules/effect-admission/contracts";
import { DefaultOffEffectAdmissionGate, type EffectAdmissionGate } from "@/modules/effect-admission/gate";
import {
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  ProviderContractError,
  assertAdapterResult,
  assertObservation,
  buildProviderExecutionContext,
  parsePreparedProviderDispatch,
  parseProviderCredentialRelease,
  preparedProviderDispatchDigest,
  providerMessageFromRow,
  type PreparedProviderDispatch,
  type ProviderAdapter,
  type ProviderExecutionContext,
  type ProviderMessage,
  type ProviderMode,
} from "@/modules/provider-runtime/contracts";
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
  readClaimedOutboxForAdmission(input: { outboxMessageId: string; tenantId: string; workerId: string }): Promise<Record<string, unknown>>;
  readClaimedReconciliationForAdmission(input: { reconciliationId: string; tenantId: string; workerId: string }): Promise<Record<string, unknown>>;
  completeClaimedReconciliation(input: {
    notes?: string | null;
    observedObjectVersion?: string | null;
    reconciliationId: string;
    result: "AMBIGUOUS" | "MATCHED" | "NOT_FOUND" | "SOURCE_UNAVAILABLE" | "VERSION_MISMATCH";
    sourceReadbackRef?: string | null;
    tenantId: string;
    workerId: string;
  }): Promise<unknown>;
  recordDispatchStarted(input: {
    adapterContractVersion: string;
    effectExecutionContext: ProviderExecutionContext;
    outboxMessageId: string;
    providerMode: ProviderMode;
    providerRequestRef: string;
    tenantId: string;
    workerId: string;
  }): Promise<unknown>;
  recordOutboxFailure(input: DeliveryFailure): Promise<unknown>;
  recordProviderAcknowledgement(input: { outboxMessageId: string; providerAcknowledgementRef: string; tenantId: string; workerId: string }): Promise<unknown>;
};

type Enablement = (input: { destination: string; mode: ProviderMode; tenantId: string }) => boolean;

function boundedError(error: unknown) {
  if (error instanceof ProviderContractError) return { code: error.code, summary: error.message.slice(0, 1_000) };
  if (error instanceof EffectAdmissionError) return { code: error.code, summary: error.message.slice(0, 1_000) };
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) {
    return { code: error.message, summary: error.message };
  }
  return { code: "PROVIDER_ADAPTER_ERROR", summary: "The provider adapter failed without a safe typed result." };
}

export class ProviderWorkerRuntime {
  constructor(
    private readonly store: ProviderWorkerStore,
    private readonly registry: ProviderAdapterRegistry,
    private readonly enabled: Enablement = providerAdapterEnabled,
    private readonly effectAdmission: EffectAdmissionGate = new DefaultOffEffectAdmissionGate(),
  ) {}

  async runDeliveryBatch(input: { limit?: number; outboxMessageId?: string; tenantId: string; workerId: string }) {
    const claimed = await this.store.claimDueOutbox(input);
    const outcomes: Array<{ destination: string | null; outboxMessageId: string; state: string }> = [];
    for (const row of claimed) {
      const outboxMessageId = String(row.outbox_message_id);
      let message: ProviderMessage;
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
      if (adapter.mode !== "SANDBOX" || adapter.contractVersion !== PROVIDER_ADAPTER_CONTRACT_VERSION) {
        await this.store.recordOutboxFailure({ errorCode: "PROVIDER_EFFECT_MODE_UNSUPPORTED", errorSummary: "This bounded worker accepts only the exact sandbox adapter contract.", failureClass: "POLICY_BLOCKED", outboxMessageId, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ destination: message.destination, outboxMessageId, state: "DEAD_LETTERED" });
        continue;
      }
      if (!this.enabled({ destination: adapter.destination, mode: adapter.mode, tenantId: input.tenantId })) {
        await this.store.recordOutboxFailure({ errorCode: "PROVIDER_EFFECT_DISABLED", errorSummary: "The provider adapter is not enabled for this exact mode, tenant and destination.", failureClass: "POLICY_BLOCKED", outboxMessageId, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ destination: message.destination, outboxMessageId, state: "DEAD_LETTERED" });
        continue;
      }
      try {
        const claim = await this.admitDelivery({ adapter, checkpoint: "PROVIDER_CLAIM", input, outboxMessageId, prior: null });
        const credential = await this.admitDelivery({ adapter, checkpoint: "PROVIDER_CREDENTIAL_RELEASE", input, outboxMessageId, prior: claim.decision });
        const released = parseProviderCredentialRelease(
          await adapter.releaseCredential(credential.prepared, credential.decision),
          credential.prepared,
          credential.decision,
        );
        const final = await this.admitDelivery({ adapter, checkpoint: "PROVIDER_PRE_EXECUTE", input, outboxMessageId, prior: credential.decision });
        if (released.executionIdentity !== final.decision.executionIdentity
          || released.preparedDispatchDigest !== preparedProviderDispatchDigest(final.prepared)) {
          throw new ProviderContractError("PROVIDER_EXECUTION_IDENTITY_CHANGED", "Execution identity changed after credential release.");
        }
        const envelope = buildEffectExecutionEnvelope(final.subject, final.decision);
        const context = buildProviderExecutionContext(envelope, final.prepared);
        await this.store.recordDispatchStarted({
          adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
          effectExecutionContext: context,
          outboxMessageId,
          providerMode: adapter.mode,
          providerRequestRef: final.prepared.providerRequestRef,
          tenantId: input.tenantId,
          workerId: input.workerId,
        });
        const execution = assertAdapterResult(await adapter.execute(context, released));
        if (execution.state === "ACKNOWLEDGED") {
          await this.store.recordProviderAcknowledgement({ outboxMessageId, providerAcknowledgementRef: execution.acknowledgementRef, tenantId: input.tenantId, workerId: input.workerId });
          outcomes.push({ destination: message.destination, outboxMessageId, state: "PROVIDER_ACKNOWLEDGED" });
        } else {
          const recorded = await this.store.recordOutboxFailure({ errorCode: execution.errorCode, errorSummary: execution.safeSummary, failureClass: execution.failureClass, outboxMessageId, retryAfterMs: execution.retryAfterMs, tenantId: input.tenantId, workerId: input.workerId }) as { state?: string };
          outcomes.push({ destination: message.destination, outboxMessageId, state: recorded.state ?? "FAILED" });
        }
      } catch (error) {
        const bounded = boundedError(error);
        const failureClass = bounded.code === "PROVIDER_ADAPTER_ERROR" ? "AMBIGUOUS_AFTER_ACK" : bounded.code.includes("ADMISSION") || bounded.code.includes("KILL") || bounded.code.includes("IDENTITY") || bounded.code.includes("MODE") ? "POLICY_BLOCKED" : "CONTRACT_VIOLATION";
        const recorded = await this.store.recordOutboxFailure({ errorCode: bounded.code, errorSummary: bounded.summary, failureClass, outboxMessageId, tenantId: input.tenantId, workerId: input.workerId }) as { state?: string };
        outcomes.push({ destination: message.destination, outboxMessageId, state: recorded.state ?? (failureClass === "AMBIGUOUS_AFTER_ACK" ? "RECONCILIATION_REQUIRED" : "DEAD_LETTERED") });
      }
    }
    return { claimed: claimed.length, outcomes };
  }

  async runReconciliationBatch(input: { limit?: number; outboxMessageId?: string; tenantId: string; workerId: string }) {
    const claimed = await this.store.claimDueReconciliations(input);
    const outcomes: Array<{ reconciliationId: string; result: string }> = [];
    for (const claimedRow of claimed) {
      const reconciliationId = String(claimedRow.reconciliation_id);
      try {
        const row = await this.store.readClaimedReconciliationForAdmission({ reconciliationId, tenantId: input.tenantId, workerId: input.workerId });
        const message = providerMessageFromRow(row);
        const adapter = this.registry.get(message.destination);
        if (!adapter || adapter.mode !== "SANDBOX" || adapter.contractVersion !== PROVIDER_ADAPTER_CONTRACT_VERSION
          || !this.enabled({ destination: message.destination, mode: adapter.mode, tenantId: input.tenantId })) {
          throw new ProviderContractError("PROVIDER_ADAPTER_UNAVAILABLE", "The exact sandbox adapter is unavailable or disabled.");
        }
        const prepared = parsePreparedProviderDispatch(await adapter.prepare(message), message, adapter);
        const envelope = parseEffectExecutionEnvelope(parseOriginatingEnvelope(row.effect_execution_envelope));
        const context = buildProviderExecutionContext(envelope, prepared);
        if (String(row.effect_execution_envelope_ref) !== envelope.executionEnvelopeRef
          || String(row.effect_execution_identity) !== envelope.executionIdentity
          || String(row.originating_envelope_ref) !== message.originatingEnvelopeRef
          || String(row.prepared_dispatch_digest) !== preparedProviderDispatchDigest(prepared)) {
          throw new ProviderContractError("ORIGINATING_EXECUTION_ENVELOPE_MISMATCH", "Reconciliation does not match the originating STARTED envelope.");
        }
        const decision = await this.effectAdmission.decide(subjectFor(message, adapter, prepared, "PROVIDER_RECONCILE"), null);
        if (!decision.admitted || decision.executionIdentity !== envelope.executionIdentity) {
          throw new ProviderContractError("EFFECT_RECONCILIATION_NOT_ADMITTED", "The originating execution identity is not admitted for read-only reconciliation.");
        }
        const observation = assertObservation(await adapter.reconcile(context), message.resultingObjectVersion);
        await this.store.completeClaimedReconciliation({ notes: observation.notes, observedObjectVersion: observation.observedObjectVersion, reconciliationId, result: observation.result, sourceReadbackRef: observation.sourceReadbackRef, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ reconciliationId, result: observation.result });
      } catch (error) {
        const bounded = boundedError(error);
        const result = (error instanceof ProviderContractError || error instanceof EffectAdmissionError)
          && (error.code.includes("VERSION") || error.code.includes("ENVELOPE") || error.code.includes("IDENTITY"))
          ? "VERSION_MISMATCH"
          : "SOURCE_UNAVAILABLE";
        await this.store.completeClaimedReconciliation({ notes: bounded.summary, reconciliationId, result, tenantId: input.tenantId, workerId: input.workerId });
        outcomes.push({ reconciliationId, result });
      }
    }
    return { claimed: claimed.length, outcomes };
  }

  private async admitDelivery(input: {
    adapter: ProviderAdapter;
    checkpoint: Extract<EffectAdmissionCheckpoint, "PROVIDER_CLAIM" | "PROVIDER_CREDENTIAL_RELEASE" | "PROVIDER_PRE_EXECUTE">;
    input: { tenantId: string; workerId: string };
    outboxMessageId: string;
    prior: EffectAdmissionDecision | null;
  }) {
    const row = await this.store.readClaimedOutboxForAdmission({ outboxMessageId: input.outboxMessageId, tenantId: input.input.tenantId, workerId: input.input.workerId });
    const message = providerMessageFromRow(row);
    if (message.destination !== input.adapter.destination || message.effectClass !== input.adapter.effectClass) {
      throw new ProviderContractError("EFFECT_DESTINATION_CHANGED", "The durable destination or effect class changed after adapter selection.");
    }
    const prepared = parsePreparedProviderDispatch(await input.adapter.prepare(message), message, input.adapter);
    const subject = subjectFor(message, input.adapter, prepared, input.checkpoint);
    const decision = await this.effectAdmission.decide(subject, input.prior);
    if (!decision.admitted) throw new ProviderContractError(`EFFECT_${decision.denialCode}`, "The exact effect admission decision denied this checkpoint.");
    if (input.checkpoint === "PROVIDER_CREDENTIAL_RELEASE" && !decision.credentialReleaseAuthorized) {
      throw new ProviderContractError("EFFECT_CREDENTIAL_RELEASE_NOT_AUTHORIZED", "Credential release was not authorized.");
    }
    if (input.checkpoint === "PROVIDER_PRE_EXECUTE" && !decision.executeAuthorized) {
      throw new ProviderContractError("EFFECT_EXECUTE_NOT_AUTHORIZED", "Execution was not authorized.");
    }
    return { decision, message, prepared, subject };
  }
}

function subjectFor(
  message: ProviderMessage,
  adapter: ProviderAdapter,
  prepared: PreparedProviderDispatch,
  checkpoint: EffectAdmissionCheckpoint,
): EffectAdmissionSubject {
  return {
    actor: message.actor,
    authorityRef: message.authorizationRef ?? "authority:none:no-effect",
    checkpoint,
    credentialBindingId: adapter.credentialBindingId,
    destination: adapter.destination,
    effectClass: message.effectClass,
    operationKey: message.idempotencyKey,
    originatingEnvelopeRef: message.originatingEnvelopeRef,
    preparedDispatchDigest: preparedProviderDispatchDigest(prepared),
    provider: adapter.provider,
    sourcePayloadHash: message.payloadHash,
    tenantId: message.tenantId,
  };
}

function parseOriginatingEnvelope(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new ProviderContractError("ORIGINATING_EXECUTION_ENVELOPE_INVALID", "The originating execution envelope is not valid JSON.");
    }
  }
  return value;
}
