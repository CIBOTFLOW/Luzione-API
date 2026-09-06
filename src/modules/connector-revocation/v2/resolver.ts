import type { CanonicalConnectorBindingResolutionV1 } from "./contracts";
import { ConnectorRevocationV2Error } from "./contracts";

export interface CanonicalConnectorBindingResolver {
  resolveCurrent(input: { bindingId: string; tenantId: string }): Promise<CanonicalConnectorBindingResolutionV1 | null>;
}

export class UnavailableCanonicalConnectorBindingResolver implements CanonicalConnectorBindingResolver {
  async resolveCurrent(input: { bindingId: string; tenantId: string }): Promise<null> {
    void input;
    throw new ConnectorRevocationV2Error(
      "CANONICAL_BINDING_SOURCE_UNAVAILABLE",
      "No admitted canonical connector-binding owner adapter is configured; revocation fails closed.",
      503,
    );
  }
}
