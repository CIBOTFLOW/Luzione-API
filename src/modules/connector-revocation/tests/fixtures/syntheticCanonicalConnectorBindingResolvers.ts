import {
  ConnectorRevocationV2Error,
  parseCanonicalConnectorBindingResolutionV1,
  type CanonicalConnectorBindingResolutionV1,
} from "../../v2/contracts";
import type { CanonicalConnectorBindingResolver } from "../../v2/resolver";
import {
  ConnectorRevocationV3Error,
  parseConnectorBindingReadbackV1,
  type ConnectorBindingReadbackV1,
} from "../../v3/contracts";
import type { ConnectorBindingReadbackResolverV1 } from "../../v3/resolver";

export class SyntheticCanonicalConnectorBindingResolver implements CanonicalConnectorBindingResolver {
  constructor(private readonly resolutions: readonly CanonicalConnectorBindingResolutionV1[]) {}

  async resolveCurrent(input: { bindingId: string; tenantId: string }) {
    const matches = this.resolutions
      .map(parseCanonicalConnectorBindingResolutionV1)
      .filter((resolution) => resolution.tenantId === input.tenantId && resolution.binding.bindingId === input.bindingId && resolution.current);
    if (matches.length > 1) throw new ConnectorRevocationV2Error("CANONICAL_BINDING_FORK", "Canonical owner returned more than one current binding resolution.", 503);
    return matches[0] ?? null;
  }
}

export class SyntheticConnectorBindingReadbackResolverV1 implements ConnectorBindingReadbackResolverV1 {
  constructor(private readonly readbacks: readonly ConnectorBindingReadbackV1[]) {}

  async resolveCurrent(input: { bindingId: string; tenantId: string }) {
    const matches = this.readbacks
      .map(parseConnectorBindingReadbackV1)
      .filter((readback) => readback.tenantId === input.tenantId && readback.bindingId === input.bindingId);
    if (matches.length > 1) throw new ConnectorRevocationV3Error("CANONICAL_BINDING_FORK", "Canonical owner returned more than one current binding readback.", 503);
    return matches[0] ?? null;
  }
}
