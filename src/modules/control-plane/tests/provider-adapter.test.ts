import assert from "node:assert/strict";
import test from "node:test";

import { ProviderAdapterRegistry, type ProviderAdapter } from "../providerAdapter";

function adapter(provider: string): ProviderAdapter {
  const outcome = async () => ({ adapterVersion: "v1", auditReference: "audit:1", normalizedOutcome: {}, providerReadback: {} });
  return {
    connect: outcome,
    describeCapabilities: () => ({ adapterVersion: "v1", capabilities: [], provider }),
    disconnect: outcome,
    estimateCost: async () => undefined,
    execute: outcome,
    getHealth: outcome,
    handleWebhook: outcome,
    normalizeEvent: () => ({}),
    refreshAuthorization: outcome,
    validateConnection: outcome,
  };
}

test("provider registry fails closed for missing and duplicate adapters", () => {
  const registry = new ProviderAdapterRegistry();
  assert.throws(() => registry.require("gmail"), /not implemented/);
  registry.register(adapter("gmail"));
  assert.equal(registry.require("gmail").describeCapabilities().provider, "gmail");
  assert.throws(() => registry.register(adapter("gmail")), /already registered/);
});
