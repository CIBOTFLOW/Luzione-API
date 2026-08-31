import assert from "node:assert/strict";
import { Pool } from "pg";
import type { ApiActor } from "@/lib/api/actor";
import { PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, parseQuoteCreateCommand } from "@/modules/proposal-quote-approval/contracts";
import { ProposalQuoteApprovalStore } from "@/modules/proposal-quote-approval/store";
import { ORDER_FULFILLMENT_CONTRACT_VERSION, parseFulfillmentIntentCommand, parseOrderCreateCommand } from "@/modules/order-fulfillment/contracts";
import { IdempotencyConflictError, OrderFulfillmentDomainError, OrderFulfillmentStore } from "@/modules/order-fulfillment/store";

const connectionString = process.env.DATABASE_URL?.trim(); if (!connectionString) throw new Error("DATABASE_URL is required.");
const actor: ApiActor = { actorId: "service:api-pc-010-proof", actorType: "service", capabilities: ["quote.command","order.command","order.read","fulfillment_intent.command","fulfillment_intent.read"], source: "service-token", tenantId: "api-pc-010-a" };

async function main() {
  const pool = new Pool({ connectionString }); const quotes = new ProposalQuoteApprovalStore(pool); const store = new OrderFulfillmentStore(pool);
  try {
    await pool.query(`insert into public.commercial_case_identities(case_id,tenant_id,origin_type,origin_id,created_by,status) values('case-pc010',$1,'proof','origin-pc010','proof','active')`, [actor.tenantId]);
    await pool.query(`insert into public.commercial_policy_configurations(tenant_id,policy_key,version,status,configuration) values($1,'quote_margin_approval',1,'active','{"automaticApprovalComparison":"strictly_greater_than","automaticApprovalThresholdPercent":33,"requiredApproverRole":"Admin"}')`, [actor.tenantId]);
    const quote = await quotes.executeQuoteCreate({ actor, command: parseQuoteCreateCommand({ commandId:"command-quote-pc010", commandType:"quote.create", contractVersion:PROPOSAL_QUOTE_APPROVAL_CONTRACT_VERSION, expectedObjectVersion:"ABSENT", idempotencyKey:"idempotency-quote-pc010", quoteId:"quote-pc010", quote:{ commercialCaseId:"case-pc010", currency:"USD", customerId:"customer-pc010", customerName:"Proof Customer", lines:[{description:"Proof item",lineNumber:1,quantity:2,sku:"SKU-1",unitCostCents:2000,unitPriceCents:5000}] } }), correlationId:"correlation-quote-pc010", requestedAt:"2026-08-31T07:00:00.000Z" });
    assert.equal(quote.readback.quote.approvalRequired, false);
    await pool.query(`update public.quotes set status='customer_accepted',updated_at='2026-08-31T07:01:00Z' where tenant_id=$1 and external_quote_id='quote-pc010'`, [actor.tenantId]);
    const accepted = await quotes.readQuote(actor,"quote-pc010"); assert.ok(accepted);
    const command = parseOrderCreateCommand({ commandId:"command-order-pc010",commandType:"order.create_from_accepted_quote",contractVersion:ORDER_FULFILLMENT_CONTRACT_VERSION,expectedObjectVersion:"ABSENT",expectedQuoteEconomicsVersionId:accepted.quote.quoteEconomicsVersionId,expectedQuoteVersion:accepted.objectVersion,idempotencyKey:"idempotency-order-pc010",orderId:"order-pc010",quoteId:"quote-pc010" });
    const order = await store.executeOrderCreate({ actor, command, correlationId:"correlation-order-pc010", requestedAt:"2026-08-31T07:02:00.000Z" });
    assert.equal(order.readback.order.status,"created"); assert.equal(order.readback.order.totalCents,10000); assert.equal(order.readback.order.lines.length,1);
    const replay = await store.executeOrderCreate({ actor, command, correlationId:"correlation-order-replay", requestedAt:"2026-08-31T07:03:00.000Z" }); assert.equal(replay.receipt.idempotentReplay,true);
    await assert.rejects(() => store.executeOrderCreate({ actor, command:parseOrderCreateCommand({...command,orderId:"order-changed"}), correlationId:"correlation-conflict", requestedAt:"2026-08-31T07:04:00.000Z" }), (error:unknown)=>error instanceof IdempotencyConflictError);
    const intentCommand = parseFulfillmentIntentCommand({ commandId:"command-intent-pc010",commandType:"fulfillment.intent.request",contractVersion:ORDER_FULFILLMENT_CONTRACT_VERSION,expectedObjectVersion:order.readback.objectVersion,fulfillmentIntentId:"intent-pc010",idempotencyKey:"idempotency-intent-pc010",intent:[{lineNumber:1,quantity:2}],orderId:"order-pc010",purpose:"Prepare internal fulfillment planning" });
    const intent = await store.executeFulfillmentIntent({ actor, command:intentCommand, correlationId:"correlation-intent", requestedAt:"2026-08-31T07:05:00.000Z" }); assert.equal(intent.readback.fulfillmentIntent.effectClass,"NO_EFFECT"); assert.equal(intent.readback.fulfillmentIntent.dispatchAuthorized,false);
    await assert.rejects(() => store.executeFulfillmentIntent({ actor, command:parseFulfillmentIntentCommand({...intentCommand,commandId:"command-intent-bad",idempotencyKey:"idempotency-intent-bad",fulfillmentIntentId:"intent-bad",intent:[{lineNumber:1,quantity:1}]}), correlationId:"correlation-bad", requestedAt:"2026-08-31T07:06:00.000Z" }), (error:unknown)=>error instanceof OrderFulfillmentDomainError && error.code==="INTENT_LINE_CONFLICT");
    assert.equal(await store.readOrder({...actor,tenantId:"api-pc-010-b"},"order-pc010"),null);
    const evidence=(await pool.query(`select (select count(*)::int from public.orders where tenant_id=$1) orders,(select count(*)::int from public.order_lines where tenant_id=$1) lines,(select count(*)::int from public.order_fulfillment_intents where tenant_id=$1) intents,(select count(*)::int from public.p110_command_receipts where tenant_id=$1) receipts,(select count(*)::int from public.p110_idempotency_conflicts where tenant_id=$1) conflicts`,[actor.tenantId])).rows[0]; assert.deepEqual(evidence,{orders:1,lines:1,intents:1,receipts:3,conflicts:1});
    process.stdout.write(`${JSON.stringify({contractVersion:ORDER_FULFILLMENT_CONTRACT_VERSION,evidence,result:"PASS"})}\n`);
  } finally { await pool.end(); }
}
main().catch((error)=>{process.stderr.write(`${error instanceof Error?error.stack??error.message:String(error)}\n`);process.exitCode=1;});
