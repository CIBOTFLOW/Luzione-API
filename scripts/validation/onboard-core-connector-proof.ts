import assert from "node:assert/strict";
import { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import {
  CONNECTOR_SYNC_VALIDATION_VERSION, classifyConnectorOutcome, connectorValidationPayloadDigest,
  parseConnectorSyncValidationRequest,
} from "@/modules/onboard-core/connectorContracts";
import { ConnectorSyncValidationService } from "@/modules/onboard-core/connectorService";
import { ONBOARD_CORE_API_VERSION } from "@/modules/onboard-core/contracts";
import { OnboardCoreDomainError } from "@/modules/onboard-core/store";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const tenant = "onboard-connector-proof-a";
const sourceBindingDigest = "9".repeat(64);
const mandateId = "55555555-5555-4555-8555-555555555555";
const mandateVersion = "setup-mandate:proof@v2";
const actor: ApiActor = { actorId: "service:onboard-connector-proof", actorType: "service", capabilities: ["connector.sync_validation.execute"], source: "service-token", tenantId: tenant };

function request(input: { created?: number; operationKey: string; scenario?: "ambiguous" | "matched" | "source_unavailable" | "version_mismatch"; tenantId?: string }) {
  const binding = { bindingId: "77777777-7777-4777-8777-777777777777", consentRef: "consent:connector-proof", contractVersion: "ConnectorBinding/v1" as const, credentialReference: "secret-ref:opaque-connector-binding-proof", cursor: null, provider: "GOOGLE_WORKSPACE" as const, revocation: { revokedAt: null, revocationRef: null }, scopes: ["contacts.readonly"], status: "DRAFT" as const, tenantId: input.tenantId ?? tenant };
  const validation = { changes: { created: input.created ?? 2, duplicates: 1, failed: 0, updated: 3 }, cursorAfter: "sandbox-cursor:proof-after", scenario: input.scenario ?? "matched" };
  const digestInput = { binding, expectedMandateObjectVersion: mandateVersion, mandateId, sourceBindingDigest, validation };
  return parseConnectorSyncValidationRequest({ ...digestInput, contractVersion: ONBOARD_CORE_API_VERSION, operationKey: input.operationKey, payloadDigest: connectorValidationPayloadDigest(digestInput) });
}

async function seedMandate(pool: Pool) {
  const blueprintId = "44444444-4444-4444-8444-444444444444";
  const approvalRef = "approval:connector-proof";
  const blueprint = { approval: { approvedAt: null, approvalRef: null, state: "DRAFT" }, blueprintId, contractVersion: "TenantBlueprint/v1", sections: { aiPolicies: ["ai-policy:no-effects"], approvals: ["approval-policy:human"], connectors: ["connector:google"], fields: ["field:name"], icp: ["icp:proof"], retention: ["retention-policy:proof"], roles: ["role:admin"], stages: ["stage:new"], terminology: { "term:lead": "label:prospect" }, workflows: ["workflow:proof"] }, tenantId: tenant, version: "1.0.0" };
  const approved = { ...blueprint, approval: { approvedAt: new Date().toISOString(), approvalRef, state: "APPROVED" } };
  const mandate = { active: true, allowedActions: ["DRY_RUN_IMPORT", "RECONCILE_IMPORT", "VALIDATE_CONNECTOR_READBACK"], approvalRef, blueprintRef: { blueprintId, version: "1.0.0" }, contractVersion: "SetupMandate/v1", effectCeiling: "NO_EFFECT", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), limits: { maxImportRecords: 100, maxRuntimeMinutes: 5 }, mandateId, prohibitedActions: ["CHANGE_SHARED_CODE_OR_SCHEMA", "COMPLETE_OAUTH", "CREATE_OR_READ_CREDENTIAL", "CROSS_TENANT", "DESTRUCTIVE_DATA_CLEANUP", "EXPAND_AUTHORITY", "SEND_EXTERNAL_COMMUNICATION"], rollbackPlanRef: "rollback:connector-proof", tenantId: tenant };
  await pool.query(`insert into public.onboarding_tenant_blueprint_drafts (tenant_id,blueprint_id,source_pack_id,source_pack_version,source_digest,source_schema_digest,source_binding,source_binding_digest,mapping_version,draft_payload_hash,canonical_blueprint,object_version,created_by,created_by_type,created_at) values ($1,$2::uuid,'pack:connector','1.0.0',$3,'c94dd71d93d72b048ceaa77b1ba08cb84e1f610393f139060f49ead684d28eb4',$4::jsonb,$5,'TenantBlueprintMap/v2',$6,$7::jsonb,'blueprint:draft@proof','service:proposal','service',now())`, [tenant, blueprintId, "1".repeat(64), JSON.stringify({ contractVersion: "TenantPackSourceBinding/v1", sourceSchemaDigest: "c94dd71d93d72b048ceaa77b1ba08cb84e1f610393f139060f49ead684d28eb4" }), sourceBindingDigest, "2".repeat(64), JSON.stringify(blueprint)]);
  await pool.query(`insert into public.onboarding_tenant_blueprint_approvals (tenant_id,approval_event_id,blueprint_id,action,approval_ref,canonical_blueprint,object_version,actor_id,actor_type,proposal_actor_id,human_authentication_ref,approved_at,created_at) values ($1,'66666666-6666-4666-8666-666666666666',$2::uuid,'APPROVED',$3,$4::jsonb,'blueprint:approved@proof','user_human','user','service:proposal','supabase-session:proof',now(),now())`, [tenant, blueprintId, approvalRef, JSON.stringify(approved)]);
  await pool.query(`insert into public.onboarding_setup_mandates (tenant_id,mandate_id,blueprint_id,blueprint_version,approval_ref,source_binding_digest,canonical_mandate,object_version,expires_at,created_by,created_by_type,created_at) values ($1,$2::uuid,$3::uuid,'1.0.0',$4,$5,$6::jsonb,$7,$8,'service:mandate','service',now())`, [tenant, mandateId, blueprintId, approvalRef, sourceBindingDigest, JSON.stringify(mandate), mandateVersion, mandate.expiresAt]);
}

async function main() {
  const pool = new Pool({ connectionString });
  const service = new ConnectorSyncValidationService(pool);
  try {
    await seedMandate(pool);
    const matchedRequest = request({ operationKey: "connector-validation-matched" });
    const matched = await service.execute({ actor, correlationId: "correlation-connector-matched", request: matchedRequest, requestedAt: new Date().toISOString() });
    assert.equal(matched.validationOutcome.success, true);
    assert.equal(matched.validationOutcome.syncReceipt?.finality, "SOURCE_CONFIRMED");
    const replay = await service.execute({ actor, correlationId: "correlation-connector-replay", request: matchedRequest, requestedAt: new Date().toISOString() });
    assert.equal(replay.commandReceipt.idempotentReplay, true);
    await assert.rejects(() => service.execute({ actor, correlationId: "correlation-changed", request: request({ created: 9, operationKey: "connector-validation-matched" }), requestedAt: new Date().toISOString() }), (error: unknown) => error instanceof IdempotencyConflictError);
    await assert.rejects(() => service.execute({ actor, correlationId: "correlation-cross", request: request({ operationKey: "cross", tenantId: "other-tenant" }), requestedAt: new Date().toISOString() }), (error: unknown) => error instanceof OnboardCoreDomainError && error.code === "TENANT_MISMATCH");
    const mismatch = await service.execute({ actor, correlationId: "correlation-version", request: request({ operationKey: "version", scenario: "version_mismatch" }), requestedAt: new Date().toISOString() });
    assert.deepEqual([mismatch.validationOutcome.state, mismatch.validationOutcome.success], ["VERSION_MISMATCH", false]);
    const blocked = await service.execute({ actor: { ...actor, actorId: "service:blocked-proof" }, correlationId: "correlation-blocked", request: request({ operationKey: "blocked" }), requestedAt: new Date().toISOString() });
    assert.deepEqual([blocked.validationOutcome.state, blocked.validationOutcome.success], ["BLOCKED", false]);
    const ack = classifyConnectorOutcome({ binding: matchedRequest.binding, changes: matchedRequest.validation.changes, cursorAfter: matchedRequest.validation.cursorAfter, lastErrorCode: null, providerAcknowledgementRef: "sandbox-ack:proof", reconciliationRef: null, reconciliationResult: null, sourceReadbackRef: null, state: "PROVIDER_ACKNOWLEDGED" });
    assert.deepEqual([ack.state, ack.evidenceCode, ack.success], ["ACKNOWLEDGED", "ACK_WITHOUT_READBACK", false]);
    const evidence = (await pool.query(`select (select count(*)::int from public.p110_outbox_messages where tenant_id=$1 and effect_class='NO_EFFECT') no_effect,(select count(*)::int from public.p110_outbox_messages where tenant_id=$1 and state='SOURCE_CONFIRMED') source_confirmed,(select count(*)::int from public.p110_outbox_messages where tenant_id=$1 and state='BLOCKED') blocked`, [tenant])).rows[0];
    assert.deepEqual(evidence, { blocked: 1, no_effect: 3, source_confirmed: 1 });
    process.stdout.write(`${JSON.stringify({ contractVersions: ["ConnectorBinding/v1", "SyncReceipt/v1", CONNECTOR_SYNC_VALIDATION_VERSION, "ConnectorValidationOutcome/v1"], evidence, result: "PASS" })}\n`);
  } finally { await pool.end(); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
