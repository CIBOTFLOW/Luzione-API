import type { CanonicalConnectorBindingResolutionV1 } from "./contracts";
import { ConnectorRevocationV2Error, parseCanonicalConnectorBindingResolutionV1 } from "./contracts";

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

export class SyntheticCanonicalConnectorBindingResolver implements CanonicalConnectorBindingResolver {
  constructor(private readonly resolutions: readonly CanonicalConnectorBindingResolutionV1[]) {}

  async resolveCurrent(input: { bindingId: string; tenantId: string }) {
    const matches = this.resolutions
      .map(parseCanonicalConnectorBindingResolutionV1)
      .filter((resolution) => resolution.tenantId === input.tenantId && resolution.binding.bindingId === input.bindingId && resolution.current);
    if (matches.length > 1) {
      throw new ConnectorRevocationV2Error("CANONICAL_BINDING_FORK", "Canonical owner returned more than one current binding resolution.", 503);
    }
    return matches[0] ?? null;
  }
}
