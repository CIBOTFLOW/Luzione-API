import "server-only";

import type { Pool, PoolClient } from "pg";
import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { PostgresAtomicCommandStore, type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { createLifecycleCommandRequest, IdempotencyConflictError, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { FULFILLMENT_INTENT_OBJECT_OWNER, ORDER_FULFILLMENT_CONTRACT_VERSION, ORDER_OBJECT_OWNER, type FulfillmentIntentCommand, type OrderCreateCommand } from "@/modules/order-fulfillment/contracts";

const POLICY_VERSION = "2026-08-31.api-pc-010.dark-path.v1";

export class OrderFulfillmentDomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); this.name = "OrderFulfillmentDomainError"; }
}
function iso(value: unknown) { const parsed = Date.parse(String(value)); if (!Number.isFinite(parsed)) throw new Error("Canonical timestamp is invalid."); return new Date(parsed).toISOString(); }
function quoteVersion(row: Record<string, unknown>) { return `quote:${String(row.external_quote_id)}:e${Number(row.economics_version)}:s${String(row.status)}`; }
function orderVersion(row: Record<string, unknown>) { return `order:${String(row.external_order_id)}:v${Number(row.version)}:s${String(row.status)}`; }

async function readTx<T>(pool: Pool, tenantId: string, callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect(); try { await client.query("begin read only"); await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]); const value = await callback(client); await client.query("commit"); return value; } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
}

export class OrderFulfillmentStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;
  constructor(private readonly pool: Pool = databasePool()) { this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool)); }

  async readOrder(actor: ApiActor, orderId: string) {
    const result = await readTx(this.pool, actor.tenantId, (client) => client.query(`select o.*, q.external_quote_id, coalesce((select jsonb_agg(jsonb_build_object('lineNumber',l.line_number,'quoteLineId',l.quote_line_id,'sku',l.sku,'description',l.description,'quantity',l.quantity::int,'unitPriceCents',l.unit_price_cents) order by l.line_number) from public.order_lines l where l.order_id=o.id and l.tenant_id=o.tenant_id),'[]'::jsonb) lines from public.orders o left join public.quotes q on q.id=o.quote_id and q.tenant_id=o.tenant_id where o.tenant_id=$1 and o.external_order_id=$2 limit 1`, [actor.tenantId, orderId]));
    const row = result.rows[0] as Record<string, unknown> | undefined; if (!row) return null;
    return { contractVersion: ORDER_FULFILLMENT_CONTRACT_VERSION, objectVersion: orderVersion(row), order: { createdAt: iso(row.created_at), currency: String(row.currency), customerId: row.customer_id ? String(row.customer_id) : null, customerName: String(row.customer_name), lines: Array.isArray(row.lines) ? row.lines : [], orderId: String(row.external_order_id), quoteId: String(row.external_quote_id), status: String(row.status), subtotalCents: Number(row.subtotal_cents), totalCents: Number(row.total_cents), updatedAt: iso(row.updated_at), version: Number(row.version) }, sourceOfTruth: "orders+order_lines", transferState: "UI_LEGACY_WRITER_API_DARK_PATH" } as const;
  }

  async readFulfillmentIntent(actor: ApiActor, fulfillmentIntentId: string) {
    const result = await readTx(this.pool, actor.tenantId, (client) => client.query(`select * from public.order_fulfillment_intents where tenant_id=$1 and fulfillment_intent_id=$2 limit 1`, [actor.tenantId, fulfillmentIntentId]));
    const row = result.rows[0] as Record<string, unknown> | undefined; if (!row) return null;
    return { contractVersion: ORDER_FULFILLMENT_CONTRACT_VERSION, objectVersion: `fulfillment-intent:${String(row.fulfillment_intent_id)}:v1`, fulfillmentIntent: { createdAt: iso(row.created_at), dispatchAuthorized: false, effectClass: "NO_EFFECT", fulfillmentIntentId: String(row.fulfillment_intent_id), lineIntents: Array.isArray(row.line_intents) ? row.line_intents : [], orderId: String(row.external_order_id), providerAcknowledged: false, purpose: String(row.purpose), sourceConfirmed: false, state: "RECORDED_NO_EFFECT" }, sourceOfTruth: "order_fulfillment_intents" } as const;
  }

  async executeOrderCreate(input: { actor: ApiActor; command: OrderCreateCommand; correlationId: string; requestedAt: string }) {
    const request = createLifecycleCommandRequest({ actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] }, causationId: null, commandId: input.command.commandId, commandType: input.command.commandType, correlationId: input.correlationId, expectedObjectVersion: input.command.expectedObjectVersion, idempotencyKey: input.command.idempotencyKey, payload: input.command, policyVersion: POLICY_VERSION, requestedAt: input.requestedAt, stepId: null, target: { objectId: input.command.orderId, objectType: "order", objectVersion: "ABSENT", ownerProject: ORDER_OBJECT_OWNER, sourceRefs: ["postgres:public.quotes", "postgres:public.orders", "postgres:public.order_lines"] }, tenantId: input.actor.tenantId, workflowId: null });
    const receipt = await this.kernel.execute(request, (transaction) => this.createOrder(transaction, input));
    const readback = await this.readOrder(input.actor, input.command.orderId); if (!readback || (!receipt.idempotentReplay && readback.objectVersion !== receipt.objectVersion)) throw new OrderFulfillmentDomainError("READBACK_UNCONFIRMED", "Order readback was not confirmed; reconcile the receipt before retrying.", 503);
    return { readback, receipt };
  }

  private async createOrder(transaction: CommandTransaction, input: { actor: ApiActor; command: OrderCreateCommand; requestedAt: string }) {
    const result = await transaction.client.query(`select q.*, e.quote_economics_version_id, e.approval_required, a.decision approval_decision from public.quotes q join public.quote_economics_versions e on e.tenant_id=q.tenant_id and e.quote_id=q.id and e.version=q.economics_version left join public.quote_margin_approval_records a on a.tenant_id=q.tenant_id and a.quote_economics_version_id=e.quote_economics_version_id where q.tenant_id=$1 and q.external_quote_id=$2 for update of q`, [input.actor.tenantId, input.command.quoteId]);
    const quote = result.rows[0] as Record<string, unknown> | undefined; if (!quote) throw new OrderFulfillmentDomainError("QUOTE_NOT_FOUND", "Accepted Quote and immutable economics were not found.", 404);
    if (quoteVersion(quote) !== input.command.expectedQuoteVersion || String(quote.quote_economics_version_id) !== input.command.expectedQuoteEconomicsVersionId) throw new OrderFulfillmentDomainError("VERSION_CONFLICT", "Order create requires the exact current Quote and economics versions.", 409);
    if (quote.status !== "customer_accepted") throw new OrderFulfillmentDomainError("QUOTE_NOT_ACCEPTED", "Only a customer_accepted Quote can create an Order.", 409);
    if (quote.converted_order_id) throw new OrderFulfillmentDomainError("QUOTE_ALREADY_CONVERTED", "This Quote already has an Order.", 409);
    if (quote.approval_required && quote.approval_decision !== "approved") throw new OrderFulfillmentDomainError("QUOTE_APPROVAL_REQUIRED", "The accepted Quote's exact economics version lacks verified approval.", 409);
    const orderResult = await transaction.client.query(`insert into public.orders (tenant_id,quote_id,external_order_id,customer_id,customer_name,status,currency,total_cents,subtotal_cents,version,source_system,source_record_id,created_by_type,created_by_id,created_at,updated_at) values ($1,$2,$3,$4,$5,'created',$6,$7,$7,1,'luzione_api',$8,$9,$10,$11,$11) on conflict (external_order_id) do nothing returning *`, [input.actor.tenantId, quote.id, input.command.orderId, quote.customer_id, quote.customer_name, quote.currency, Number(quote.subtotal_cents), input.command.commandId, input.actor.actorType, input.actor.actorId, input.requestedAt]);
    const order = orderResult.rows[0] as Record<string, unknown> | undefined; if (!order) throw new OrderFulfillmentDomainError("ORDER_EXISTS", "Order identity already exists.", 409);
    const copied = await transaction.client.query(`insert into public.order_lines (tenant_id,order_id,quote_line_id,line_number,sku,description,quantity,unit_price_cents,supplier_id,version,created_at,updated_at) select $1,$2,id,line_number,sku,description,quantity,unit_price_cents,supplier_id,1,$3,$3 from public.quote_lines where quote_id=$4 returning id`, [input.actor.tenantId, order.id, input.requestedAt, quote.id]);
    if ((copied.rowCount ?? 0) < 1) throw new OrderFulfillmentDomainError("QUOTE_LINES_MISSING", "The accepted Quote has no canonical lines.", 409);
    await transaction.client.query(`update public.quotes set status='converted_to_order', converted_order_id=$3, updated_at=$4 where tenant_id=$1 and id=$2`, [input.actor.tenantId, quote.id, order.id, input.requestedAt]);
    return { evidenceRefs: [`postgres:public.quotes/${input.command.quoteId}`, `postgres:public.orders/${input.command.orderId}`], objectVersion: orderVersion(order) };
  }

  async executeFulfillmentIntent(input: { actor: ApiActor; command: FulfillmentIntentCommand; correlationId: string; requestedAt: string }) {
    const request = createLifecycleCommandRequest({ actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] }, causationId: null, commandId: input.command.commandId, commandType: input.command.commandType, correlationId: input.correlationId, expectedObjectVersion: input.command.expectedObjectVersion, idempotencyKey: input.command.idempotencyKey, payload: input.command, policyVersion: POLICY_VERSION, requestedAt: input.requestedAt, stepId: null, target: { objectId: input.command.fulfillmentIntentId, objectType: "fulfillment_intent", objectVersion: input.command.expectedObjectVersion, ownerProject: FULFILLMENT_INTENT_OBJECT_OWNER, sourceRefs: ["postgres:public.orders", "postgres:public.order_fulfillment_intents"] }, tenantId: input.actor.tenantId, workflowId: null });
    const receipt = await this.kernel.execute(request, (transaction) => this.createIntent(transaction, input));
    const readback = await this.readFulfillmentIntent(input.actor, input.command.fulfillmentIntentId); if (!readback) throw new OrderFulfillmentDomainError("READBACK_UNCONFIRMED", "Fulfillment Intent readback was not confirmed.", 503);
    return { readback, receipt };
  }

  private async createIntent(transaction: CommandTransaction, input: { actor: ApiActor; command: FulfillmentIntentCommand; requestedAt: string }) {
    const result = await transaction.client.query(`select * from public.orders where tenant_id=$1 and external_order_id=$2 for share`, [input.actor.tenantId, input.command.orderId]); const order = result.rows[0] as Record<string, unknown> | undefined;
    if (!order) throw new OrderFulfillmentDomainError("ORDER_NOT_FOUND", "Order not found.", 404); if (orderVersion(order) !== input.command.expectedObjectVersion) throw new OrderFulfillmentDomainError("VERSION_CONFLICT", "Fulfillment Intent requires the exact current Order version.", 409);
    const lines = await transaction.client.query(`select line_number,quantity::int quantity from public.order_lines where tenant_id=$1 and order_id=$2 order by line_number`, [input.actor.tenantId, order.id]);
    const canonical = new Map(lines.rows.map((line) => [Number(line.line_number), Number(line.quantity)]));
    if (input.command.intent.some((line) => canonical.get(line.lineNumber) !== line.quantity) || input.command.intent.length !== canonical.size) throw new OrderFulfillmentDomainError("INTENT_LINE_CONFLICT", "Fulfillment Intent must match every exact canonical Order line and quantity.", 409);
    await transaction.client.query(`insert into public.order_fulfillment_intents (tenant_id,fulfillment_intent_id,order_id,external_order_id,expected_order_version,resulting_order_version,purpose,line_intents,idempotency_key,payload_hash,requested_by,created_at) values ($1,$2,$3,$4,$5,$5,$6,$7::jsonb,$8,$9,$10,$11)`, [input.actor.tenantId, input.command.fulfillmentIntentId, order.id, input.command.orderId, input.command.expectedObjectVersion, input.command.purpose, JSON.stringify(input.command.intent), input.command.idempotencyKey, sha256(input.command), input.actor.actorId, input.requestedAt]);
    return { evidenceRefs: [`postgres:public.orders/${input.command.orderId}`, `postgres:public.order_fulfillment_intents/${input.command.fulfillmentIntentId}`], objectVersion: `fulfillment-intent:${input.command.fulfillmentIntentId}:v1` };
  }
}

export { IdempotencyConflictError };
