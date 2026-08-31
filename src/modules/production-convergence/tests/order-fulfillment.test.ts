import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ORDER_FULFILLMENT_CONTRACT_VERSION, OrderFulfillmentContractError, parseFulfillmentIntentCommand, parseOrderCreateCommand } from "@/modules/order-fulfillment/contracts";

test("Order create binds an absent Order to exact accepted Quote evidence", () => {
  const parsed = parseOrderCreateCommand({ commandId: "command-order-001", commandType: "order.create_from_accepted_quote", contractVersion: ORDER_FULFILLMENT_CONTRACT_VERSION, expectedObjectVersion: "ABSENT", expectedQuoteEconomicsVersionId: "economics-001", expectedQuoteVersion: "quote:quote-001:e1:scustomer_accepted", idempotencyKey: "idempotency-order-001", orderId: "order-001", quoteId: "quote-001" });
  assert.equal(parsed.expectedQuoteVersion, "quote:quote-001:e1:scustomer_accepted");
  assert.throws(() => parseOrderCreateCommand({ ...parsed, expectedObjectVersion: "existing" }), (error: unknown) => error instanceof OrderFulfillmentContractError && error.code === "VERSION_CONFLICT");
  assert.throws(() => parseOrderCreateCommand({ ...parsed, tenantId: "forged" }), (error: unknown) => error instanceof OrderFulfillmentContractError && error.code === "AUTHORITY_FORGED");
});

test("Fulfillment Intent is bounded to exact line quantities and rejects effect fields", () => {
  const parsed = parseFulfillmentIntentCommand({ commandId: "command-intent-001", commandType: "fulfillment.intent.request", contractVersion: ORDER_FULFILLMENT_CONTRACT_VERSION, expectedObjectVersion: "order:order-001:v1:screated", fulfillmentIntentId: "intent-001", idempotencyKey: "idempotency-intent-001", intent: [{ lineNumber: 2, quantity: 1 }, { lineNumber: 1, quantity: 2 }], orderId: "order-001", purpose: "Prepare an internal fulfillment plan" });
  assert.deepEqual(parsed.intent.map((line) => line.lineNumber), [1, 2]);
  assert.throws(() => parseFulfillmentIntentCommand({ ...parsed, intent: [{ lineNumber: 1, quantity: 2, provider: "forged" }] }), (error: unknown) => error instanceof OrderFulfillmentContractError && error.code === "EFFECT_FORGED");
});

test("store requires customer acceptance, exact approval and no-effect intent readback", () => {
  const store = readFileSync("src/modules/order-fulfillment/store.ts", "utf8");
  assert.match(store, /quote\.status !== "customer_accepted"/);
  assert.match(store, /approval_required[\s\S]*approval_decision !== "approved"/);
  assert.match(store, /converted_order_id/);
  assert.match(store, /insert into public\.orders/);
  assert.match(store, /insert into public\.order_lines/);
  assert.match(store, /insert into public\.order_fulfillment_intents/);
  assert.match(store, /LifecycleCommandKernel/);
  const migration = readFileSync("supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql", "utf8");
  assert.match(migration, /state = 'RECORDED_NO_EFFECT'/);
  assert.match(migration, /effect_class = 'NO_EFFECT'/);
  assert.match(migration, /dispatch_authorized = false and provider_acknowledged = false and source_confirmed = false/);
  assert.doesNotMatch(migration, /api_orders|truncate|delete from|drop table/i);
});

test("Order and Fulfillment Intent routes are authenticated and exact-tenant default-off", () => {
  for (const path of ["src/app/api/v1/commands/orders/route.ts", "src/app/api/v1/commands/fulfillment-intents/route.ts"]) {
    const route = readFileSync(path, "utf8"); assert.match(route, /requireServiceActor\(request\.headers/); assert.match(route, /domainCommandsEnabledForTenant\(actor\.tenantId\)/); assert.match(route, /DOMAIN_MUTATIONS_DISABLED/); assert.doesNotMatch(route, /tenantId\s*:\s*(body|command)\./);
  }
});
