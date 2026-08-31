import { PROVIDER_ADAPTER_CONTRACT_VERSION, type PreparedProviderRequest, type ProviderAdapter, type ProviderMessage } from "@/modules/provider-runtime/contracts";

type Scenario = "ambiguous" | "matched" | "permanent" | "rate_limited" | "source_unavailable" | "version_mismatch";

function scenario(payload: Record<string, unknown>): Scenario {
  const value = payload.scenario ?? "matched";
  if (!["ambiguous", "matched", "permanent", "rate_limited", "source_unavailable", "version_mismatch"].includes(String(value))) throw new Error("Sandbox scenario is unsupported.");
  return value as Scenario;
}

export class SandboxEchoProviderAdapter implements ProviderAdapter {
  readonly destination = "sandbox.echo";
  readonly mode = "SANDBOX" as const;
  readonly provider = "luzione-deterministic-simulator";

  async prepare(message: ProviderMessage): Promise<PreparedProviderRequest> {
    scenario(message.payload);
    return {
      contractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
      destination: this.destination,
      idempotencyKey: message.idempotencyKey,
      objectRef: `${message.objectType}:${message.objectId}`,
      payload: message.payload,
      payloadHash: message.payloadHash,
      providerRequestRef: `sandbox-request:${message.idempotencyKey}`,
      resultingObjectVersion: message.resultingObjectVersion,
    };
  }

  async execute(request: PreparedProviderRequest) {
    const selected = scenario(request.payload);
    if (selected === "ambiguous") return { errorCode: "SANDBOX_TIMEOUT_AFTER_ACCEPT", failureClass: "AMBIGUOUS_AFTER_ACK", safeSummary: "The sandbox accepted the request but withheld the acknowledgement.", state: "FAILED" } as const;
    if (selected === "permanent") return { errorCode: "SANDBOX_REJECTED", failureClass: "PERMANENT", safeSummary: "The sandbox rejected the request permanently.", state: "FAILED" } as const;
    if (selected === "rate_limited") return { errorCode: "SANDBOX_RATE_LIMITED", failureClass: "RATE_LIMITED", retryAfterMs: 2_000, safeSummary: "The sandbox requested a bounded retry delay.", state: "FAILED" } as const;
    return { acknowledgementRef: `sandbox-ack:${request.idempotencyKey}`, state: "ACKNOWLEDGED" } as const;
  }

  async observe(request: PreparedProviderRequest, acknowledgementRef: string) {
    if (!acknowledgementRef.startsWith("sandbox-ack:")) return { result: "AMBIGUOUS" as const, notes: "The acknowledgement reference is not owned by the sandbox adapter." };
    return this.readback(request);
  }

  async reconcile(request: PreparedProviderRequest) {
    return this.readback(request);
  }

  async compensate(request: PreparedProviderRequest) {
    void request;
    return { reason: "The deterministic sandbox does not create a real external effect.", state: "NOT_SUPPORTED" as const };
  }

  private async readback(request: PreparedProviderRequest) {
    const selected = scenario(request.payload);
    if (selected === "source_unavailable") return { result: "SOURCE_UNAVAILABLE" as const, notes: "The sandbox source is temporarily unavailable." };
    if (selected === "version_mismatch") return { observedObjectVersion: `${request.resultingObjectVersion}:different`, result: "VERSION_MISMATCH" as const, sourceReadbackRef: `sandbox-readback:${request.idempotencyKey}:different` };
    return { observedObjectVersion: request.resultingObjectVersion, result: "MATCHED" as const, sourceReadbackRef: `sandbox-readback:${request.idempotencyKey}:${request.payloadHash}` };
  }
}
