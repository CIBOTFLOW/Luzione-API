import type { ConnectorBindingReadbackV1 } from "./contracts";
import { ConnectorRevocationV3Error } from "./contracts";

export interface ConnectorBindingReadbackResolverV1 {
  resolveCurrent(input: { bindingId: string; tenantId: string }): Promise<ConnectorBindingReadbackV1 | null>;
}

export class UnavailableConnectorBindingReadbackResolverV1 implements ConnectorBindingReadbackResolverV1 {
  async resolveCurrent(input: { bindingId: string; tenantId: string }): Promise<null> {
    void input;
    throw new ConnectorRevocationV3Error(
      "CANONICAL_BINDING_SOURCE_UNAVAILABLE",
      "No admitted canonical locator-free connector-binding owner adapter is configured; revocation fails closed.",
      503,
    );
  }
}
