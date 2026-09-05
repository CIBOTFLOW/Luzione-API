import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { EffectAdmissionDecision } from "@/modules/effect-admission/contracts";
import {
  PREPARED_PROVIDER_DISPATCH_VERSION,
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  buildProviderCredentialRelease,
  type PreparedProviderDispatch,
  type ProviderAdapter,
  type ProviderExecutionContext,
  type ProviderMessage,
} from "@/modules/provider-runtime/contracts";

type Scenario = "ambiguous" | "matched" | "permanent" | "rate_limited" | "source_unavailable" | "version_mismatch";

function scenario(payload: Record<string, unknown>): Scenario {
  const value = payload.scenario ?? "matched";
  if (!["ambiguous", "matched", "permanent", "rate_limited", "source_unavailable", "version_mismatch"].includes(String(value))) throw new Error("Sandbox scenario is unsupported.");
  return value as Scenario;
}

export class SandboxEchoProviderAdapter implements ProviderAdapter {
  readonly contractVersion = PROVIDER_ADAPTER_CONTRACT_VERSION;
  readonly credentialBindingId = "credential-binding:none:sandbox-echo/v1";
  readonly destination = "sandbox.echo";
  readonly effectClass = "NO_EFFECT" as const;
  readonly mode = "SANDBOX" as const;
  readonly provider = "luzione-deterministic-simulator";

  async prepare(message: ProviderMessage): Promise<PreparedProviderDispatch> {
    scenario(message.payload);
    const payload = { ...message.payload };
    return {
      adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
      contractVersion: PREPARED_PROVIDER_DISPATCH_VERSION,
      credentialBindingId: this.credentialBindingId,
      destination: this.destination,
      effectClass: this.effectClass,
      idempotencyKey: message.idempotencyKey,
      objectRef: `${message.objectType}:${message.objectId}`,
      originatingEnvelopeRef: message.originatingEnvelopeRef,
      payload,
      payloadHash: sha256(payload),
      provider: this.provider,
      providerRequestRef: `sandbox-request:${message.idempotencyKey}`,
      resultingObjectVersion: message.resultingObjectVersion,
      sourcePayloadHash: message.payloadHash,
      tenantId: message.tenantId,
    };
  }

  async releaseCredential(prepared: PreparedProviderDispatch, decision: EffectAdmissionDecision) {
    return buildProviderCredentialRelease(prepared, decision, "NO_CREDENTIAL_REQUIRED");
  }

  async execute(context: ProviderExecutionContext) {
    const request = context.preparedDispatch;
    const selected = scenario(request.payload);
    if (selected === "ambiguous") return { errorCode: "SANDBOX_TIMEOUT_AFTER_ACCEPT", failureClass: "AMBIGUOUS_AFTER_ACK", safeSummary: "The sandbox accepted the request but withheld the acknowledgement.", state: "FAILED" } as const;
    if (selected === "permanent") return { errorCode: "SANDBOX_REJECTED", failureClass: "PERMANENT", safeSummary: "The sandbox rejected the request permanently.", state: "FAILED" } as const;
    if (selected === "rate_limited") return { errorCode: "SANDBOX_RATE_LIMITED", failureClass: "RATE_LIMITED", retryAfterMs: 2_000, safeSummary: "The sandbox requested a bounded retry delay.", state: "FAILED" } as const;
    return { acknowledgementRef: `sandbox-ack:${request.idempotencyKey}`, state: "ACKNOWLEDGED" } as const;
  }

  async observe(context: ProviderExecutionContext, acknowledgementRef: string) {
    if (!acknowledgementRef.startsWith("sandbox-ack:")) return { result: "AMBIGUOUS" as const, notes: "The acknowledgement reference is not owned by the sandbox adapter." };
    return this.readback(context);
  }

  async reconcile(context: ProviderExecutionContext) {
    return this.readback(context);
  }

  async compensate(context: ProviderExecutionContext) {
    void context;
    return { reason: "The deterministic sandbox does not create a real external effect.", state: "NOT_SUPPORTED" as const };
  }

  private async readback(context: ProviderExecutionContext) {
    const request = context.preparedDispatch;
    const selected = scenario(request.payload);
    if (selected === "source_unavailable") return { result: "SOURCE_UNAVAILABLE" as const, notes: "The sandbox source is temporarily unavailable." };
    if (selected === "version_mismatch") return { observedObjectVersion: `${request.resultingObjectVersion}:different`, result: "VERSION_MISMATCH" as const, sourceReadbackRef: `sandbox-readback:${request.idempotencyKey}:different` };
    return { observedObjectVersion: request.resultingObjectVersion, result: "MATCHED" as const, sourceReadbackRef: `sandbox-readback:${request.idempotencyKey}:${request.payloadHash}` };
  }
}
