export const ORDER_FULFILLMENT_CONTRACT_VERSION = "luzione-order-fulfillment-intent/v0.1";
export const ORDER_OBJECT_OWNER = "LUZIONE_COMMERCE_ORDER";
export const FULFILLMENT_INTENT_OBJECT_OWNER = "LUZIONE_FULFILLMENT_INTENT";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

type Base = { commandId: string; contractVersion: typeof ORDER_FULFILLMENT_CONTRACT_VERSION; expectedObjectVersion: string; idempotencyKey: string };

export type OrderCreateCommand = Base & {
  commandType: "order.create_from_accepted_quote";
  expectedObjectVersion: "ABSENT";
  expectedQuoteEconomicsVersionId: string;
  expectedQuoteVersion: string;
  orderId: string;
  quoteId: string;
};

export type FulfillmentIntentCommand = Base & {
  commandType: "fulfillment.intent.request";
  fulfillmentIntentId: string;
  intent: { lineNumber: number; quantity: number }[];
  orderId: string;
  purpose: string;
};

export class OrderFulfillmentContractError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = "OrderFulfillmentContractError"; }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OrderFulfillmentContractError("INVALID_COMMAND", `${field} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new OrderFulfillmentContractError("INVALID_COMMAND", `${field} must be a non-empty bounded string.`);
  return value.trim();
}
function id(value: unknown, field: string) { const parsed = text(value, field, 200); if (!ID.test(parsed)) throw new OrderFulfillmentContractError("INVALID_COMMAND", `${field} must be a stable canonical identifier.`); return parsed; }
function positiveInteger(value: unknown, field: string) { if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 1_000_000) throw new OrderFulfillmentContractError("INVALID_QUANTITY", `${field} must be a positive safe integer.`); return Number(value); }

function base(input: Record<string, unknown>) {
  if (input.contractVersion !== ORDER_FULFILLMENT_CONTRACT_VERSION) throw new OrderFulfillmentContractError("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${ORDER_FULFILLMENT_CONTRACT_VERSION}.`);
  for (const forged of ["actor", "actorId", "actorType", "tenant", "tenantId", "roles", "capabilities", "authority", "effectClass", "provider", "recipient", "payment", "booking", "dispatchState", "acknowledgement", "sourceConfirmed"]) {
    if (forged in input) throw new OrderFulfillmentContractError("AUTHORITY_FORGED", `${forged} is server-derived or outside this no-effect contract.`);
  }
  return { commandId: id(input.commandId, "commandId"), contractVersion: ORDER_FULFILLMENT_CONTRACT_VERSION, expectedObjectVersion: text(input.expectedObjectVersion, "expectedObjectVersion", 300), idempotencyKey: id(input.idempotencyKey, "idempotencyKey") } as const;
}

export function parseOrderCreateCommand(value: unknown): OrderCreateCommand {
  const input = object(value, "command"); const common = base(input);
  if (input.commandType !== "order.create_from_accepted_quote") throw new OrderFulfillmentContractError("UNSUPPORTED_COMMAND", "commandType must be order.create_from_accepted_quote.");
  if (common.expectedObjectVersion !== "ABSENT") throw new OrderFulfillmentContractError("VERSION_CONFLICT", "Order create requires expectedObjectVersion ABSENT.", 409);
  return { ...common, commandType: "order.create_from_accepted_quote", expectedObjectVersion: "ABSENT", expectedQuoteEconomicsVersionId: id(input.expectedQuoteEconomicsVersionId, "expectedQuoteEconomicsVersionId"), expectedQuoteVersion: text(input.expectedQuoteVersion, "expectedQuoteVersion", 300), orderId: id(input.orderId, "orderId"), quoteId: id(input.quoteId, "quoteId") };
}

export function parseFulfillmentIntentCommand(value: unknown): FulfillmentIntentCommand {
  const input = object(value, "command"); const common = base(input);
  if (input.commandType !== "fulfillment.intent.request") throw new OrderFulfillmentContractError("UNSUPPORTED_COMMAND", "commandType must be fulfillment.intent.request.");
  if (!Array.isArray(input.intent) || input.intent.length < 1 || input.intent.length > 200) throw new OrderFulfillmentContractError("INVALID_COMMAND", "intent must contain between 1 and 200 bounded line requests.");
  const seen = new Set<number>();
  const intent = input.intent.map((raw, index) => {
    const line = object(raw, `intent[${index}]`);
    for (const forbidden of ["provider", "recipient", "supplier", "price", "currency", "payment", "booking", "dispatch", "send"]) if (forbidden in line) throw new OrderFulfillmentContractError("EFFECT_FORGED", `${forbidden} is outside the no-effect Fulfillment Intent contract.`);
    const lineNumber = positiveInteger(line.lineNumber, `intent[${index}].lineNumber`);
    if (seen.has(lineNumber)) throw new OrderFulfillmentContractError("INVALID_COMMAND", "Fulfillment Intent line numbers must be unique.");
    seen.add(lineNumber);
    return { lineNumber, quantity: positiveInteger(line.quantity, `intent[${index}].quantity`) };
  }).sort((a, b) => a.lineNumber - b.lineNumber);
  return { ...common, commandType: "fulfillment.intent.request", fulfillmentIntentId: id(input.fulfillmentIntentId, "fulfillmentIntentId"), intent, orderId: id(input.orderId, "orderId"), purpose: text(input.purpose, "purpose", 500) };
}
