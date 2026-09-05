import {
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  ProviderContractError,
  type ProviderAdapter,
} from "@/modules/provider-runtime/contracts";

const DESTINATION = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(adapters: readonly ProviderAdapter[]) {
    for (const adapter of adapters) {
      if (adapter.contractVersion !== PROVIDER_ADAPTER_CONTRACT_VERSION) {
        throw new ProviderContractError("PROVIDER_ADAPTER_VERSION_UNSUPPORTED", "Only the exact v0.3 provider adapter contract may be registered.");
      }
      if (adapter.mode !== "SANDBOX") {
        throw new ProviderContractError("PROVIDER_ADAPTER_MODE_UNSUPPORTED", "Only SANDBOX provider adapters may be registered.");
      }
      if (adapter.destination.length > 190 || !DESTINATION.test(adapter.destination)
        || !TOKEN.test(adapter.provider) || !TOKEN.test(adapter.credentialBindingId)) {
        throw new ProviderContractError("PROVIDER_ADAPTER_DESCRIPTOR_INVALID", "Provider adapter registration fields are invalid.");
      }
      if (this.adapters.has(adapter.destination)) throw new Error(`Provider destination ${adapter.destination} is registered more than once.`);
      this.adapters.set(adapter.destination, adapter);
    }
  }

  get(destination: string) {
    return this.adapters.get(destination) ?? null;
  }

  descriptors() {
    return [...this.adapters.values()].map((adapter) => ({ destination: adapter.destination, mode: adapter.mode, provider: adapter.provider }));
  }
}
