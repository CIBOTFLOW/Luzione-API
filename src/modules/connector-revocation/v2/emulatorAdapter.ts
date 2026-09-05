import type { EffectAdmissionDecision } from "@/modules/effect-admission/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  PREPARED_PROVIDER_DISPATCH_VERSION,
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  ProviderContractError,
  buildProviderCredentialRelease,
  type PreparedProviderDispatch,
  type ProviderAdapter,
  type ProviderExecutionContext,
  type ProviderMessage,
} from "@/modules/provider-runtime/contracts";
import {
  CONNECTOR_REVOCATION_V2_DESTINATION,
  CONNECTOR_REVOCATION_V2_EMULATOR_BINDING,
  CONNECTOR_REVOCATION_V2_EMULATOR_PROVIDER,
  type ConnectorRevocationScenarioV2,
  ConnectorRevocationV2Error,
} from "./contracts";
import type { RevocationPhaseKillGuardV2 } from "./killGuard";

function scenario(payload: Record<string, unknown>): ConnectorRevocationScenarioV2 {
  const value = payload.scenario;
  if (!["ack_only", "ambiguous", "failed", "matched", "source_unavailable", "version_mismatch"].includes(String(value))) throw new Error("CONNECTOR_REVOCATION_SCENARIO_INVALID");
  return value as ConnectorRevocationScenarioV2;
}

export class ConnectorRevocationV2EmulatorAdapter implements ProviderAdapter {
  readonly contractVersion = PROVIDER_ADAPTER_CONTRACT_VERSION;
  readonly credentialBindingId = CONNECTOR_REVOCATION_V2_EMULATOR_BINDING;
  readonly destination = CONNECTOR_REVOCATION_V2_DESTINATION;
  readonly effectClass = "NO_EFFECT" as const;
  readonly mode = "SANDBOX" as const;
  readonly provider = CONNECTOR_REVOCATION_V2_EMULATOR_PROVIDER;

  constructor(private readonly killGuard: RevocationPhaseKillGuardV2) {}

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
      providerRequestRef: `connector-revocation-v2-emulator:${message.idempotencyKey}`,
      resultingObjectVersion: message.resultingObjectVersion,
      sourcePayloadHash: message.payloadHash,
      tenantId: message.tenantId,
    };
  }

  async releaseCredential(prepared: PreparedProviderDispatch, decision: EffectAdmissionDecision) {
    await this.killRecheck(() => this.killGuard.recheckBeforeCredentialHold());
    return buildProviderCredentialRelease(prepared, decision, "NO_CREDENTIAL_REQUIRED");
  }

  async execute(context: ProviderExecutionContext) {
    await this.killRecheck(() => this.killGuard.recheckBeforeExecuteOrDisposition());
    const selected = scenario(context.preparedDispatch.payload);
    if (selected === "ambiguous") return { errorCode: "CONNECTOR_REVOCATION_TIMEOUT_AFTER_ACK", failureClass: "AMBIGUOUS_AFTER_ACK", safeSummary: "The emulator withheld acknowledgement after a synthetic acceptance boundary.", state: "FAILED" } as const;
    if (selected === "failed") return { errorCode: "CONNECTOR_REMOTE_REVOKE_FAILED", failureClass: "PERMANENT", safeSummary: "The emulator deterministically rejected remote revocation.", state: "FAILED" } as const;
    return { acknowledgementRef: `connector-revocation-v2-emulator-ack:${context.preparedDispatch.idempotencyKey}`, state: "ACKNOWLEDGED" } as const;
  }

  async observe(context: ProviderExecutionContext, acknowledgementRef: string) {
    if (!acknowledgementRef.startsWith("connector-revocation-v2-emulator-ack:")) return { notes: "The acknowledgement is not owned by this emulator.", result: "AMBIGUOUS" as const };
    return this.readback(context);
  }

  async reconcile(context: ProviderExecutionContext) {
    return this.readback(context);
  }

  async compensate() {
    return { reason: "The connector revocation emulator produces no provider or credential effect.", state: "NOT_SUPPORTED" as const };
  }

  private async readback(context: ProviderExecutionContext) {
    const selected = scenario(context.preparedDispatch.payload);
    if (selected === "ack_only" || selected === "source_unavailable") return { notes: "The emulator source readback is unavailable.", result: "SOURCE_UNAVAILABLE" as const };
    if (selected === "ambiguous") return { notes: "The emulator remains ambiguous.", result: "AMBIGUOUS" as const };
    if (selected === "failed") return { notes: "The emulator reports no remote revocation.", result: "NOT_FOUND" as const };
    const sourceReadbackRef = `connector-revocation-v2-emulator-readback:${sha256({
      idempotencyKey: context.preparedDispatch.idempotencyKey,
      payloadHash: context.preparedDispatch.payloadHash,
    })}`;
    if (selected === "version_mismatch") return { observedObjectVersion: `${context.preparedDispatch.resultingObjectVersion}:mismatch`, result: "VERSION_MISMATCH" as const, sourceReadbackRef };
    return { observedObjectVersion: context.preparedDispatch.resultingObjectVersion, result: "MATCHED" as const, sourceReadbackRef };
  }

  private async killRecheck(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      if (error instanceof ConnectorRevocationV2Error) {
        throw new ProviderContractError(error.code, error.message);
      }
      throw error;
    }
  }
}
