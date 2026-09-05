import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import { type CommandTransaction } from "@/lib/platform-guarantees/postgresCommandStore";
import { createLifecycleCommandRequest, LifecycleCommandKernel } from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { SUPPLIER_PROFILE_OWNER, SUPPLIER_PROFILE_POLICY_VERSION, SeedSupplierIdentityContractError } from "@/modules/seed-supplier-identity/contracts";
import { accountVersionRef, isCanonicalSupplierIdentityInstant } from "@/modules/seed-supplier-identity/model";
import { SeedSupplierIdentityDomainError, SupplierIdentityAtomicCommandStore } from "@/modules/seed-supplier-identity/store";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { parseTimelineEventV1 } from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import { SEED_PRODUCT_CONTRACT_VERSIONS, type SeedSourceRefV1, type TimelineEventV1 } from "@/modules/luzione-core-contracts/seedProductContracts";
import { parsePortalAccountAccessBindingCommand, parsePortalAccountAccessBindingV1, portalAccountAccessBindingId, portalAccountAccessBindingVersion, type PortalAccountAccessBindingCommand, type PortalAccountAccessBindingV1, type PortalBindingEvidenceRef } from "@/modules/seed-supplier-identity/portalAccessContracts";
export { PORTAL_ACCOUNT_ACCESS_BINDING_VERSION, PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION, parsePortalAccountAccessBindingCommand, parsePortalAccountAccessBindingV1, portalAccountAccessBindingId, portalAccountAccessBindingVersion, requirePortalAccountAccess } from "@/modules/seed-supplier-identity/portalAccessContracts";
export type { PortalAccountAccessBindingCommand, PortalAccountAccessBindingV1 } from "@/modules/seed-supplier-identity/portalAccessContracts";

type Row = Record<string, unknown>;
function json<T>(value: unknown) { return (typeof value === "string" ? JSON.parse(value) : value) as T; }
async function evidence(client: PoolClient, tenantId: string, refs: readonly PortalBindingEvidenceRef[]) { for (const ref of refs) { const result = await client.query("select object_version,status from public.seed_procurement_evidence_artifacts where tenant_id=$1 and artifact_id=$2", [tenantId, ref.objectId]); if (!result.rows[0] || String(result.rows[0].object_version) !== ref.version || String(result.rows[0].status) !== "ACTIVE") throw new SeedSupplierIdentityDomainError("PORTAL_BINDING_EVIDENCE_INVALID", "Portal binding evidence is missing, stale, or inactive.", 409); } }

export class PortalAccountAccessBindingStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;
  constructor(private readonly pool: Pool = databasePool()) { this.kernel = new LifecycleCommandKernel(new SupplierIdentityAtomicCommandStore(pool)); }
  async execute(input: { actor: ApiActor; command: PortalAccountAccessBindingCommand; correlationId: string; human: HumanApprovalSubject; requestedAt: string }) {
    if (!isCanonicalSupplierIdentityInstant(input.requestedAt)) throw new SeedSupplierIdentityDomainError("INVALID_REQUESTED_AT", "Portal binding requestedAt must be a real canonical RFC3339 UTC instant.", 400);
    if (input.actor.actorId !== "service:luzione-supplier-portal" || !input.actor.capabilities.includes("supplier.portal.account_binding.command")) throw new SeedSupplierIdentityDomainError("PORTAL_WORKLOAD_IDENTITY_REQUIRED", "Only the credential-derived Supplier Portal workload may project access binding metadata.", 403);
    const requiredHumanCapability = input.command.commandType === "portal_account_access_binding.record" ? "supplier.portal.account_binding.record" : "supplier.portal.account_binding.revoke";
    if (input.human.tenantId !== input.actor.tenantId || !input.human.capabilities.includes(requiredHumanCapability)) throw new SeedSupplierIdentityDomainError("HUMAN_APPROVAL_REQUIRED", `Portal Account binding change requires a signed same-tenant human with ${requiredHumanCapability}.`, 403);
    const result = await this.kernel.execute(createLifecycleCommandRequest({ actor: { actorId: input.human.actorId, actorType: "user", roles: [] }, causationId: null, commandId: input.command.commandId, commandType: input.command.commandType, correlationId: input.correlationId, expectedObjectVersion: input.command.expectedVersion, idempotencyKey: input.command.idempotencyKey, payload: input.command, policyVersion: SUPPLIER_PROFILE_POLICY_VERSION, requestedAt: input.requestedAt, stepId: null, target: { objectId: input.command.bindingId, objectType: "portal_account_access_binding", objectVersion: input.command.expectedVersion, ownerProject: SUPPLIER_PROFILE_OWNER, sourceRefs: ["portal:organization", "portal:membership", "portal:object-grant", `workload:${input.actor.actorId}`] }, tenantId: input.actor.tenantId, workflowId: null }), async (transaction) => {
      await transaction.client.query("select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2,0))", [input.actor.tenantId, input.command.bindingId]);
      await evidence(transaction.client, input.actor.tenantId, input.command.evidenceRefs);
      const priorResult = await transaction.client.query("select * from public.seed_supplier_portal_account_binding_versions where tenant_id=$1 and binding_id=$2 order by version desc limit 1", [input.actor.tenantId, input.command.bindingId]);
      const prior = priorResult.rows[0] as Row | undefined;
      let accountId: string; let accountVersion: string; let organizationId: string; let versionNumber: number; let status: "ACTIVE" | "REVOKED"; let revocationRef: string | null;
      if (input.command.commandType === "portal_account_access_binding.record") {
        if (prior) throw new SeedSupplierIdentityDomainError("PORTAL_BINDING_EXISTS", "Portal Account binding already exists.", 409);
        if (input.command.bindingId !== portalAccountAccessBindingId(input.actor.tenantId, input.command.organizationId, input.command.accountId)) throw new SeedSupplierIdentityDomainError("PORTAL_BINDING_ID_MISMATCH", "Portal binding stable ID is not canonical.", 409);
        const account = await transaction.client.query("select version from public.accounts where tenant_id=$1 and id::text=$2", [input.actor.tenantId, input.command.accountId]);
        if (!account.rows[0] || accountVersionRef(input.command.accountId, account.rows[0].version) !== input.command.accountVersion) throw new SeedSupplierIdentityDomainError("ACCOUNT_VERSION_CONFLICT", "Portal binding Account is missing or stale.", 409);
        accountId=input.command.accountId; accountVersion=input.command.accountVersion; organizationId=input.command.organizationId; versionNumber=1; status="ACTIVE"; revocationRef=null;
      } else {
        if (!prior || String(prior.object_version) !== input.command.expectedVersion || String(prior.status) !== "ACTIVE") throw new SeedSupplierIdentityDomainError("PORTAL_BINDING_VERSION_CONFLICT", "Portal binding is missing, stale, or already revoked.", 409);
        const priorMembership = json<{ id: string; version: string }>(prior.membership_ref);
        const priorGrant = json<{ id: string; version: string }>(prior.object_grant_ref);
        if (priorMembership.id !== input.command.membershipRef.id || priorGrant.id !== input.command.objectGrantRef.id
          || priorMembership.version === input.command.membershipRef.version || priorGrant.version === input.command.objectGrantRef.version) {
          throw new SeedSupplierIdentityDomainError("PORTAL_BINDING_LINEAGE_CONFLICT", "Portal revocation must preserve membership/grant IDs and advance both exact source versions.", 409);
        }
        const account = await transaction.client.query("select version from public.accounts where tenant_id=$1 and id::text=$2", [input.actor.tenantId, String(prior.account_id)]);
        if (!account.rows[0] || accountVersionRef(String(prior.account_id), account.rows[0].version) !== String(prior.account_version)) throw new SeedSupplierIdentityDomainError("ACCOUNT_VERSION_CONFLICT", "Portal binding Account is missing or stale.", 409);
        accountId=String(prior.account_id); accountVersion=String(prior.account_version); organizationId=String(prior.organization_id); versionNumber=Number(prior.version)+1; status="REVOKED"; revocationRef=input.command.revocationRef;
      }
      const objectVersion=portalAccountAccessBindingVersion(input.command.bindingId,versionNumber);
      await transaction.client.query(`insert into public.seed_supplier_portal_account_binding_versions (tenant_id,binding_id,version,organization_id,account_id,account_version,membership_ref,object_grant_ref,evidence_refs,status,revocation_ref,object_version,expected_object_version,command_payload,command_payload_hash,created_command_id,created_by,created_by_type,human_authentication_ref,workload_actor_id,created_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21)`, [input.actor.tenantId,input.command.bindingId,versionNumber,organizationId,accountId,accountVersion,JSON.stringify(input.command.membershipRef),JSON.stringify(input.command.objectGrantRef),JSON.stringify(input.command.evidenceRefs),status,revocationRef,objectVersion,input.command.expectedVersion,JSON.stringify(input.command),sha256(input.command),input.command.commandId,input.human.actorId,"user",input.human.authenticationRef,input.actor.actorId,input.requestedAt]);
      return { evidenceRefs: [`postgres:public.seed_supplier_portal_account_binding_versions/${input.command.bindingId}@${objectVersion}`, ...input.command.evidenceRefs.map((ref) => `${ref.ownerProject}:${ref.objectType}:${ref.objectId}@${ref.version}`), `human:${input.human.authenticationRef}`, `workload:${input.actor.actorId}`], objectVersion };
    });
    const readback=await this.read(input.actor,input.command.bindingId);
    if (!readback || readback.version!==result.objectVersion || readback.receipt.receiptId!==result.receiptId || readback.receipt.payloadHash!==result.payloadHash) throw new SeedSupplierIdentityDomainError("READBACK_UNCONFIRMED", "Portal Account access binding readback did not match its P110 receipt.", 503);
    const timelineEvent = await this.readTimeline(input.actor, readback);
    return { readback, readbackMatchesReceipt:true, receipt:result, timelineEvent };
  }
  async read(actor: ApiActor, bindingId: string): Promise<PortalAccountAccessBindingV1 | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      await client.query("select set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const result = await client.query(`select b.*,r.receipt_id,r.command_id receipt_command_id,r.command_type receipt_command_type,
        r.idempotency_key receipt_idempotency_key,r.payload_hash receipt_payload_hash,r.expected_object_version receipt_expected_version,
        r.committed_object_version receipt_committed_version,r.actor_id receipt_actor_id,r.actor_type receipt_actor_type,
        r.target_owner_project,r.target_object_type,r.target_object_id,r.policy_version,r.requested_at,r.committed_at,r.state receipt_state,
        a.version current_account_version
        from public.seed_supplier_portal_account_binding_versions b
        join public.p110_command_receipts r on r.tenant_id=b.tenant_id and r.command_id=b.created_command_id
        join public.accounts a on a.tenant_id=b.tenant_id and a.id::text=b.account_id
        where b.tenant_id=$1 and b.binding_id=$2 order by b.version desc limit 1`, [actor.tenantId, bindingId]);
      if (!result.rows[0]) { await client.query("commit"); return null; }
      const row = result.rows[0] as Row;
      const command=parsePortalAccountAccessBindingCommand(json(row.command_payload));
      const expectedCommandType=Number(row.version)===1?"portal_account_access_binding.record":"portal_account_access_binding.revoke";
      const corrupt = accountVersionRef(String(row.account_id), row.current_account_version) !== String(row.account_version)
        || String(row.workload_actor_id)!=="service:luzione-supplier-portal" || String(row.created_by_type)!=="user"
        || String(row.created_command_id)!==String(row.receipt_command_id) || command.commandId!==String(row.created_command_id)
        || command.commandType!==expectedCommandType || String(row.receipt_command_type)!==expectedCommandType
        || command.idempotencyKey!==String(row.receipt_idempotency_key) || command.expectedVersion!==String(row.expected_object_version)
        || String(row.receipt_expected_version)!==String(row.expected_object_version) || String(row.receipt_committed_version)!==String(row.object_version)
        || sha256(command)!==String(row.command_payload_hash) || String(row.command_payload_hash)!==String(row.receipt_payload_hash)
        || String(row.created_by)!==String(row.receipt_actor_id) || String(row.receipt_actor_type)!=="user"
        || String(row.target_owner_project)!==SUPPLIER_PROFILE_OWNER || String(row.target_object_type)!=="portal_account_access_binding" || String(row.target_object_id)!==String(row.binding_id)
        || String(row.policy_version)!==SUPPLIER_PROFILE_POLICY_VERSION || String(row.receipt_state)!=="DOMAIN_COMMITTED"
        || new Date(String(row.requested_at)).toISOString()!==new Date(String(row.created_at)).toISOString() || row.committed_at===null;
      if (corrupt) throw new SeedSupplierIdentityDomainError("PORTAL_BINDING_READBACK_CORRUPT", "Portal binding Account, command, actor, target, payload, version, policy, or receipt is stale/corrupt.", 500);
      const rowMembership=json(row.membership_ref); const rowGrant=json(row.object_grant_ref); const rowEvidence=json(row.evidence_refs);
      if (sha256(command.membershipRef)!==sha256(rowMembership)||sha256(command.objectGrantRef)!==sha256(rowGrant)||sha256(command.evidenceRefs)!==sha256(rowEvidence)
        || (command.commandType==="portal_account_access_binding.record" && (command.accountId!==String(row.account_id)||command.accountVersion!==String(row.account_version)||command.organizationId!==String(row.organization_id)))
        || (command.commandType==="portal_account_access_binding.revoke" && command.revocationRef!==String(row.revocation_ref))) throw new SeedSupplierIdentityDomainError("PORTAL_BINDING_READBACK_CORRUPT","Portal binding stored command fields do not match canonical columns.",500);
      await evidence(client, actor.tenantId, command.evidenceRefs);
      const parsed = parsePortalAccountAccessBindingV1({ accountRef:{accountId:String(row.account_id),accountVersion:String(row.account_version)}, authority:{decision:"REQUIRE_HUMAN",effectClass:"A2",humanActorId:String(row.created_by),humanAuthenticationRef:String(row.human_authentication_ref),workloadActorId:String(row.workload_actor_id)}, bindingId:String(row.binding_id),contractVersion:"PortalOrganizationAccountAccessBinding/v1",createdAt:new Date(String(row.created_at)).toISOString(),evidenceRefs:rowEvidence,membershipRef:rowMembership,objectGrantRef:rowGrant,organizationId:String(row.organization_id),receipt:{committedVersion:String(row.object_version),finality:"DOMAIN_COMMITTED",payloadHash:String(row.receipt_payload_hash),receiptId:String(row.receipt_id)},revocationRef:row.revocation_ref===null?null:String(row.revocation_ref),status:row.status,tenantId:String(row.tenant_id),version:String(row.object_version)});
      await client.query("commit");
      return parsed;
    } catch(error){await client.query("rollback").catch(()=>undefined);throw error;} finally{client.release();}
  }

  private async readTimeline(actor: ApiActor, binding: PortalAccountAccessBindingV1): Promise<TimelineEventV1> {
    const client=await this.pool.connect();
    try {
      await client.query("begin read only"); await client.query("select set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const result=await client.query(`select e.tenant_id event_tenant_id,e.event_id,e.recorded_at,e.occurred_at,e.evidence_refs,
        e.command_id event_command_id,e.subject_owner_project,e.subject_object_type,e.subject_object_id,e.subject_object_version,
        r.receipt_id,r.idempotency_key,r.payload_hash,r.expected_object_version,r.committed_object_version,r.policy_version,
        r.actor_id,r.actor_type,r.correlation_id,r.command_id,r.command_type,r.target_owner_project,r.target_object_type,r.target_object_id,
        r.requested_at,r.committed_at,r.state receipt_state
        from public.p110_event_envelopes e join public.p110_command_receipts r on r.tenant_id=e.tenant_id and r.event_id=e.event_id
        where r.tenant_id=$1 and r.receipt_id=$2 limit 1`,[actor.tenantId,binding.receipt.receiptId]);
      if(!result.rows[0]) throw new SeedSupplierIdentityDomainError("TIMELINE_READBACK_UNCONFIRMED","Portal binding TimelineEvent projection is missing.",503);
      const row=result.rows[0] as Row; const ref:SeedSourceRefV1={objectId:binding.bindingId,objectType:"PORTAL_ACCOUNT_ACCESS_BINDING",ownerProject:SUPPLIER_PROFILE_OWNER,tenantId:binding.tenantId,version:binding.version}; const eventEvidence=json<string[]>(row.evidence_refs);
      if(String(row.event_tenant_id)!==binding.tenantId||String(row.event_command_id)!==String(row.command_id)||String(row.receipt_state)!=="DOMAIN_COMMITTED"||String(row.committed_object_version)!==binding.version||String(row.actor_id)!==binding.authority.humanActorId||String(row.actor_type)!=="user"||String(row.target_owner_project)!==SUPPLIER_PROFILE_OWNER||String(row.target_object_type)!=="portal_account_access_binding"||String(row.target_object_id)!==binding.bindingId||String(row.subject_owner_project)!==SUPPLIER_PROFILE_OWNER||String(row.subject_object_type)!=="portal_account_access_binding"||String(row.subject_object_id)!==binding.bindingId||String(row.subject_object_version)!==binding.version||String(row.policy_version)!==SUPPLIER_PROFILE_POLICY_VERSION||new Date(String(row.requested_at)).toISOString()!==new Date(String(row.occurred_at)).toISOString()||row.committed_at===null||String(row.payload_hash)!==binding.receipt.payloadHash||!eventEvidence.includes(`postgres:public.seed_supplier_portal_account_binding_versions/${binding.bindingId}@${binding.version}`)||!eventEvidence.includes(`human:${binding.authority.humanAuthenticationRef}`)||!eventEvidence.includes(`workload:${binding.authority.workloadActorId}`)) throw new SeedSupplierIdentityDomainError("TIMELINE_READBACK_CORRUPT","Portal binding TimelineEvent causation, human/workload attribution, or receipt is corrupt.",500);
      const parsed=parseTimelineEventV1({authority:{actorId:String(row.actor_id),actorType:"HUMAN",approvalRef:`approval:${sha256({authenticationRef:binding.authority.humanAuthenticationRef,commandId:String(row.command_id)})}`,capability:String(row.command_type),decision:"REQUIRE_HUMAN",effectClass:"A2",policyVersion:String(row.policy_version),serverDerivedIdentityRef:`correlation:${String(row.correlation_id)}`},contractVersion:SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent,createdAt:new Date(String(row.recorded_at)).toISOString(),data:{actorId:String(row.actor_id),aggregateRefs:[ref],eventType:String(row.command_type).toUpperCase().replaceAll(".","_"),evidenceRefs:eventEvidence,occurredAt:new Date(String(row.occurred_at)).toISOString(),recordedAt:new Date(String(row.recorded_at)).toISOString(),summary:`Accepted ${String(row.command_type)} with exact Portal access-binding receipt.`,visibility:"INTERNAL"},mutation:{expectedVersion:String(row.expected_object_version),idempotencyKey:String(row.idempotency_key),payloadHash:String(row.payload_hash)},receipt:{committedVersion:String(row.committed_object_version),finality:"DOMAIN_COMMITTED",observedAt:null,observedVersion:null,providerAcknowledgementRef:null,receiptId:String(row.receipt_id),sourceReadbackRef:null},resource:{archivedAt:null,id:String(row.event_id),status:"ACTIVE",type:"TIMELINE_EVENT",version:String(row.committed_object_version)},sourceRefs:[ref],tenantId:binding.tenantId,updatedAt:new Date(String(row.recorded_at)).toISOString()});
      await client.query("commit"); return parsed;
    } catch(error){await client.query("rollback").catch(()=>undefined);throw error;} finally{client.release();}
  }
}
