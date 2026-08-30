import type { EffectEnvelope, Money, ProviderOutcome } from "./types";

export type ProviderContext = {
  connectionId: string;
  correlationId: string;
  secretRef: string | null;
  tenantId: string;
};

export type ProviderCapabilityDescription = {
  adapterVersion: string;
  capabilities: ReadonlyArray<{
    capability: string;
    providerEffect: boolean;
  }>;
  provider: string;
};

export type ProviderWebhookInput = {
  body: Uint8Array;
  headers: Readonly<Record<string, string>>;
  receivedAt: string;
};

export interface ProviderAdapter<Command = Record<string, unknown>, Event = Record<string, unknown>> {
  connect(context: ProviderContext, input: Record<string, unknown>): Promise<ProviderOutcome>;
  disconnect(context: ProviderContext): Promise<ProviderOutcome>;
  validateConnection(context: ProviderContext): Promise<ProviderOutcome>;
  refreshAuthorization(context: ProviderContext): Promise<ProviderOutcome>;
  getHealth(context: ProviderContext): Promise<ProviderOutcome>;
  execute(context: ProviderContext, envelope: EffectEnvelope, command: Command): Promise<ProviderOutcome>;
  handleWebhook(context: ProviderContext, input: ProviderWebhookInput): Promise<ProviderOutcome>;
  normalizeEvent(input: Event): Record<string, unknown>;
  estimateCost(command: Command): Promise<Money | undefined>;
  describeCapabilities(): ProviderCapabilityDescription;
}

export class ProviderAdapterRegistry {
  readonly #adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter) {
    const description = adapter.describeCapabilities();
    if (this.#adapters.has(description.provider)) {
      throw new Error(`Provider adapter already registered: ${description.provider}`);
    }
    this.#adapters.set(description.provider, adapter);
  }

  require(provider: string) {
    const adapter = this.#adapters.get(provider);
    if (!adapter) throw new Error(`Provider adapter is not implemented: ${provider}`);
    return adapter;
  }

  providers() {
    return [...this.#adapters.keys()].sort();
  }
}
