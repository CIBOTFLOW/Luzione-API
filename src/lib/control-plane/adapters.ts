import "server-only";

import { ProviderAdapterRegistry } from "@/modules/control-plane/providerAdapter";

export const providerAdapters = new ProviderAdapterRegistry();
