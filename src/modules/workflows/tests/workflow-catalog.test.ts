import assert from "node:assert/strict";
import test from "node:test";
import { capabilityPolicies } from "@/modules/autonomy/constitution";
import { workflowPacks } from "../catalog";

test("launch catalog exposes at least eight complete workflow packs", () => {
  assert.ok(workflowPacks.length >= 8);
  const registered = new Set(capabilityPolicies.map((policy) => policy.capability));
  for (const pack of workflowPacks) {
    assert.ok(pack.capabilities.length >= 3, pack.code);
    for (const capability of pack.capabilities) assert.ok(registered.has(capability), capability);
  }
});

test("only vertical packs carry luxury-specific behavior", () => {
  const core = workflowPacks.filter((pack) => pack.vertical === "CORE");
  assert.ok(core.length >= 8);
  assert.ok(core.every((pack) => !pack.code.startsWith("luxury.")));
});
