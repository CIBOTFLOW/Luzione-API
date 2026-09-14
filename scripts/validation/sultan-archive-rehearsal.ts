import assert from "node:assert/strict";
import { approvalSignature, SultanAgentGatewayService } from "../../src/modules/sultan-agent-gateway/service";
import { Pool } from "pg";
import { archiveInternalActionTx } from "../../src/modules/sultan-agent-gateway/internalActionArchive";
import { PostgresSultanAgentGatewayStore } from "../../src/modules/sultan-agent-gateway/postgresStore";
import { sha256 } from "../../src/modules/platform-guarantees/eventContract";
async function main() {
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const payload = { title: "Synthetic internal draft" };
const reservation = { case_id: "case-1", case_type: "COMMERCIAL", expected_version: "commercial-case:case-1:v1", preview: { payload: { campaignId: "sultan-campaign-test", targetReceiptId: "receipt-original", targetObjectVersion: "case-original-v1", targetPayloadHash: sha256(payload) } } };
try {
  await client.query(`insert into public.commercial_cases values ('luzione','case-1',1)`);
  await client.query(`insert into public.sultan_agent_command_reservations(tenant_id,reservation_id,operation_id,run_id,tool_call_id,tool_id,tool_version,agent_id,agent_version,case_id,case_type,expected_version,effect_class,approval_mode,arguments_hash,command_hash,state,preview,expires_at,created_at)
    values ('luzione','reservation-1','operation-1','run-1','call-1','luzione.gmail_draft.create','v1','agent-1','v1','case-1','COMMERCIAL','case-original-v1','A1','PER_COMMAND_HUMAN',$1,$1,'EXECUTED','{}',now()+interval '10 minutes',now())`, ['a'.repeat(64)]);
  await client.query(`insert into public.sultan_agent_internal_actions(tenant_id,action_id,receipt_id,reservation_id,operation_id,run_id,tool_call_id,tool_id,case_id,case_type,object_version,campaign_id,payload,state,approval_id,approved_by,approved_at,created_at)
    values ('luzione','action-1','receipt-original','reservation-1','operation-1','run-1','call-1','luzione.gmail_draft.create','case-1','COMMERCIAL','case-original-v1','sultan-campaign-test',$1,'SOURCE_CONFIRMED','approval-1',$2,now(),now())`, [payload,'user_'+ 'a'.repeat(64)]);
  await client.query('begin');
  await assert.rejects(archiveInternalActionTx(client, 'other', reservation, new Date().toISOString()), { code: 'EXACT_OBJECT_VERSION_REQUIRED' });
  await client.query('rollback');
  await client.query('begin');
  await archiveInternalActionTx(client, 'luzione', reservation, new Date().toISOString());
  await client.query('rollback');
  assert.equal((await client.query("select state from public.sultan_agent_internal_actions")).rows[0].state, 'SOURCE_CONFIRMED');
  // Seed an already-admitted reservation to isolate the real signed execute/store path.
  // Stage5 issuance itself is covered by the existing suite, not this fixture.
  await client.query("alter table public.sultan_agent_command_reservations add column admission_receipt_id text");
  await client.query(`insert into public.sultan_agent_command_reservations(tenant_id,reservation_id,admission_receipt_id,operation_id,run_id,tool_call_id,tool_id,tool_version,agent_id,agent_version,case_id,case_type,expected_version,effect_class,approval_mode,arguments_hash,command_hash,state,preview,expires_at,created_at)
    values ('luzione','archive-reservation','fixture-admission','archive-operation','run-1','archive-call','luzione.internal_action.archive','v1','agent-1','v1','case-1','COMMERCIAL','commercial-case:case-1:v1','A1','PER_COMMAND_HUMAN',$1,$1,'PREPARED',$2,now()+interval '10 minutes',now())`, ['b'.repeat(64), { ...reservation.preview, campaignId: 'sultan-campaign-test' }]);
  const actor = { actorId: 'service:sultan-os', actorType: 'service' as const, tenantId: 'luzione', capabilities: ['sultan.command.execute','sultan.effect.read'], source: 'vercel-oidc' as const };
  const secret = 'disposable-test-approval-secret-longer-than-32-bytes';
  const service = new SultanAgentGatewayService(new PostgresSultanAgentGatewayStore(pool), () => new Date(), secret);
  const admission = { contractVersion: 'sultan.human-approval-admission.v1' as const, approvalId: 'archive-approval', operatorId: 'user_'+'b'.repeat(64), reservationId: 'archive-reservation', commandHash: 'b'.repeat(64), decision: 'APPROVE' as const, approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+600000).toISOString() };
  const executionInput = { actor, reservationId: admission.reservationId, commandHash: admission.commandHash, approvalAdmission: { ...admission, signature: approvalSignature(secret, admission) } };
  await assert.rejects(service.execute({ ...executionInput, approvalAdmission: { ...executionInput.approvalAdmission, signature: 'c'.repeat(64) } }), { code: 'APPROVAL_SIGNATURE_INVALID' });
  const executed = await service.execute(executionInput);
  assert.equal(executed.state, 'SOURCE_CONFIRMED');
  assert.notEqual(executed.receipt.receiptId, 'receipt-original');
  const replay = await service.execute(executionInput);
  assert.equal(replay.idempotentReplay, true);
  assert.equal((await client.query("select count(*) from public.sultan_agent_internal_actions")).rows[0].count,'2');
  await client.query('begin');
  await archiveInternalActionTx(client, 'luzione', reservation, new Date().toISOString());
  await client.query('commit');
  const row = (await client.query("select * from public.sultan_agent_internal_actions where receipt_id='receipt-original'")).rows[0];
  const readback = await new PostgresSultanAgentGatewayStore(pool).readEffect({ actorId: 'service:sultan-os', actorType: 'service', tenantId: 'luzione', capabilities: ['sultan.effect.read'], source: 'vercel-oidc' }, 'receipt-original', new Date().toISOString());
  assert.equal(readback!.state, 'ARCHIVED'); assert.equal(readback!.contractVersion, 'luzione-sultan-readback/v2'); assert.equal(readback!.businessFinal, false);
  assert.equal(row.state,'ARCHIVED'); assert.deepEqual(row.payload,payload); assert.ok(row.archived_at);
  await assert.rejects(client.query("update public.sultan_agent_internal_actions set case_id='other'"));
  await assert.rejects(client.query("delete from public.sultan_agent_internal_actions"));
  console.log('PASS: disposable Postgres migration, archive/readback, repeated archive, rollback, tenant isolation, evidence immutability');
} finally { client.release(); await pool.end(); }

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
