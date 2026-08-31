import type { ProviderAdapter } from "@/modules/provider-runtime/contracts";

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(adapters: readonly ProviderAdapter[]) {
    for (const adapter of adapters) {
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
