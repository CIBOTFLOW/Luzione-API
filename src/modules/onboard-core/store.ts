import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import {
  PostgresAtomicCommandStore,
  type CommandTransaction,
} from "@/lib/platform-guarantees/postgresCommandStore";
import type { SetupMandateV1, TenantBlueprintV1 } from "@/modules/luzione-core-contracts/contracts";
import {
  createLifecycleCommandRequest,
  LifecycleCommandKernel,
} from "@/modules/platform-guarantees/commandKernel";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  ONBOARD_CORE_POLICY_VERSION,
  SETUP_MANDATE_REVOCATION_VERSION,
  admitProposalSourceBinding,
  blueprintApprovalObjectVersion,
  blueprintDraftObjectVersion,
  blueprintIdempotencyKey,
  blueprintTuple,
  deterministicUuid,
  issueApprovedBlueprint,
  issueDraftBlueprint,
  issueSetupMandate,
  setupMandateObjectVersion,
  type SetupMandateRequest,
  type SetupMandateRevocationRequest,
  type TenantBlueprintApprovalRequest,
  type TenantBlueprintProposal,
} from "./contracts";
import type { HumanApprovalSubject } from "./humanApproval";

export class OnboardCoreDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OnboardCoreDomainError";
  }
}

function jsonObject(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} is not a canonical object.`);
  }
  return value as Record<string, unknown>;
}

async function readOne(pool: Pool, tenantId: string, query: string, values: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query(query, values);
    await client.query("commit");
    return result.rows[0] as Record<string, unknown> | undefined;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function blueprintReadback(row: Record<string, unknown>) {
  return {
    blueprint: jsonObject(row.canonical_blueprint, "canonical_blueprint") as TenantBlueprintV1,
    mappingVersion: String(row.mapping_version),
    objectVersion: String(row.object_version),
    sourceBinding: jsonObject(row.source_binding, "source_binding"),
    sourceBindingDigest: String(row.source_binding_digest),
    sourceDigest: String(row.source_digest),
    sourcePackId: String(row.source_pack_id),
    sourcePackVersion: String(row.source_pack_version),
    sourceSchemaDigest: String(row.source_schema_digest),
  };
}

function mandateReadback(row: Record<string, unknown>, now = new Date()) {
  const mandate = jsonObject(row.canonical_mandate, "canonical_mandate") as SetupMandateV1;
  const active = row.revoked_at === null && Date.parse(String(row.expires_at)) > now.getTime();
  return {
    mandate: { ...mandate, active },
    sourceBindingDigest: String(row.source_binding_digest),
    objectVersion: String(row.object_version),
    revocation: row.revoked_at === null
      ? null
      : { revokedAt: new Date(String(row.revoked_at)).toISOString(), revocationRef: String(row.revocation_ref) },
  };
}

export class OnboardCoreStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(private readonly pool: Pool = databasePool()) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
  }

  async readBlueprint(actor: ApiActor, blueprintId: string) {
    const row = await readOne(
      this.pool,
      actor.tenantId,
      `select draft.source_pack_id, draft.source_pack_version, draft.source_digest,
              draft.source_schema_digest, draft.source_binding, draft.source_binding_digest, draft.mapping_version,
              coalesce(event.canonical_blueprint, draft.canonical_blueprint) canonical_blueprint,
              coalesce(event.object_version, draft.object_version) object_version
         from public.onboarding_tenant_blueprint_drafts draft
         left join lateral (
           select approval.canonical_blueprint, approval.object_version
             from public.onboarding_tenant_blueprint_approvals approval
            where approval.tenant_id = draft.tenant_id
              and approval.blueprint_id = draft.blueprint_id
            order by approval.created_at desc, approval.approval_event_id desc
            limit 1
         ) event on true
        where draft.tenant_id = $1 and draft.blueprint_id = $2::uuid
        limit 1`,
      [actor.tenantId, blueprintId],
    );
    return row ? blueprintReadback(row) : null;
  }

  async readMandate(actor: ApiActor, mandateId: string, now = new Date()) {
    const row = await readOne(
      this.pool,
      actor.tenantId,
      `select mandate.canonical_mandate, mandate.object_version, mandate.expires_at,
              mandate.source_binding_digest, revocation.revoked_at, revocation.revocation_ref
         from public.onboarding_setup_mandates mandate
         left join lateral (
           select event.revoked_at, event.revocation_ref
             from public.onboarding_setup_mandate_revocations event
            where event.tenant_id = mandate.tenant_id and event.mandate_id = mandate.mandate_id
            order by event.revoked_at desc, event.revocation_event_id desc limit 1
         ) revocation on true
        where mandate.tenant_id = $1 and mandate.mandate_id = $2::uuid
        limit 1`,
      [actor.tenantId, mandateId],
    );
    return row ? mandateReadback(row, now) : null;
  }

  async proposeBlueprint(input: {
    actor: ApiActor;
    correlationId: string;
    proposal: TenantBlueprintProposal;
    requestedAt: string;
  }) {
    const admittedSource = admitProposalSourceBinding(input.actor.tenantId, input.proposal);
    const tuple = blueprintTuple(input.actor.tenantId, input.proposal);
    const blueprint = issueDraftBlueprint(input.actor.tenantId, input.proposal);
    const objectVersion = blueprintDraftObjectVersion(blueprint, input.proposal.sourceDigest);
    const idempotencyKey = blueprintIdempotencyKey(input.actor.tenantId, input.proposal);
    const commandId = deterministicUuid("onboard-blueprint-command", tuple);
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId,
      commandType: "onboarding.tenant_blueprint.propose",
      correlationId: input.correlationId,
      expectedObjectVersion: "ABSENT",
      idempotencyKey,
      payload: {
        blueprint,
        mappingVersion: input.proposal.mappingVersion,
        sourceDigest: input.proposal.sourceDigest,
        sourceSchemaDigest: input.proposal.sourceSchemaDigest,
        sourceBinding: admittedSource.binding,
        sourceBindingDigest: admittedSource.digest,
        sourceTuple: tuple,
      },
      policyVersion: ONBOARD_CORE_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: blueprint.blueprintId,
        objectType: "tenant_blueprint",
        objectVersion: "ABSENT",
        ownerProject: "LUZIONE_API",
        sourceRefs: [
          `tenant-pack:${input.proposal.draft.sourcePackId}@${input.proposal.draft.sourcePackVersion}`,
          `sha256:${input.proposal.sourceDigest}`,
          `l2-binding:${admittedSource.digest}`,
          input.proposal.mappingVersion,
        ],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction) => {
      const existing = await transaction.client.query(
        `select source_digest, mapping_version, object_version
           from public.onboarding_tenant_blueprint_drafts
          where tenant_id = $1 and source_pack_id = $2 and source_pack_version = $3
          for update`,
        [input.actor.tenantId, input.proposal.draft.sourcePackId, input.proposal.draft.sourcePackVersion],
      );
      if (existing.rows.length) {
        throw new OnboardCoreDomainError(
          "BLUEPRINT_VERSION_CONFLICT",
          "The source pack version already exists; changed content or mapping must use a new source pack version.",
          409,
        );
      }
      await transaction.client.query(
        `insert into public.onboarding_tenant_blueprint_drafts
          (tenant_id, blueprint_id, source_pack_id, source_pack_version, source_digest,
           source_schema_digest, source_binding, source_binding_digest, mapping_version, draft_payload_hash, canonical_blueprint,
           object_version, created_by, created_by_type, created_at)
         values ($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)`,
        [
          input.actor.tenantId,
          blueprint.blueprintId,
          input.proposal.draft.sourcePackId,
          input.proposal.draft.sourcePackVersion,
          input.proposal.sourceDigest,
          input.proposal.sourceSchemaDigest,
          JSON.stringify(admittedSource.binding),
          admittedSource.digest,
          input.proposal.mappingVersion,
          sha256(input.proposal.draft),
          JSON.stringify(blueprint),
          objectVersion,
          input.actor.actorId,
          input.actor.actorType,
          input.requestedAt,
        ],
      );
      return {
        evidenceRefs: [`postgres:public.onboarding_tenant_blueprint_drafts/${blueprint.blueprintId}`],
        objectVersion,
      };
    });
    const readback = await this.readBlueprint(input.actor, blueprint.blueprintId);
    if (!readback || (!receipt.idempotentReplay && readback.objectVersion !== receipt.objectVersion)) {
      throw new OnboardCoreDomainError("READBACK_UNCONFIRMED", "Tenant Blueprint persistence could not be confirmed.", 503);
    }
    return { readback, receipt };
  }

  async approveBlueprint(input: {
    actor: ApiActor;
    approval: TenantBlueprintApprovalRequest;
    correlationId: string;
    human: HumanApprovalSubject;
    requestedAt: string;
  }) {
    if (input.human.tenantId !== input.actor.tenantId || !input.human.capabilities.includes("onboarding.blueprint.approve")) {
      throw new OnboardCoreDomainError("HUMAN_APPROVAL_REQUIRED", "Blueprint approval requires a separately authenticated same-tenant human subject.", 403);
    }
    const commandTuple = {
      humanActorId: input.human.actorId,
      proposalActorId: input.actor.actorId,
      blueprintId: input.approval.blueprintId,
      decision: input.approval.decision,
      expectedObjectVersion: input.approval.expectedObjectVersion,
      supersedesApprovalRef: input.approval.supersedesApprovalRef,
      tenantId: input.actor.tenantId,
    };
    const idempotencyKey = `onboard-blueprint-approval:${sha256(commandTuple)}`;
    const approvalRef = `approval:${deterministicUuid("tenant-blueprint-approval", commandTuple)}`;
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.human.actorId, actorType: "user", roles: [] },
      causationId: null,
      commandId: deterministicUuid("tenant-blueprint-approval-command", commandTuple),
      commandType: "onboarding.tenant_blueprint.approve",
      correlationId: input.correlationId,
      expectedObjectVersion: input.approval.expectedObjectVersion,
      idempotencyKey,
      payload: input.approval,
      policyVersion: ONBOARD_CORE_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: input.approval.blueprintId,
        objectType: "tenant_blueprint_approval",
        objectVersion: input.approval.expectedObjectVersion,
        ownerProject: "LUZIONE_API",
        sourceRefs: ["postgres:public.onboarding_tenant_blueprint_approvals"],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction) => this.insertApproval(
      transaction,
      input,
      approvalRef,
    ));
    const readback = await this.readBlueprint(input.actor, input.approval.blueprintId);
    if (!readback || (!receipt.idempotentReplay && readback.objectVersion !== receipt.objectVersion)) {
      throw new OnboardCoreDomainError("READBACK_UNCONFIRMED", "Blueprint approval readback could not be confirmed.", 503);
    }
    return { readback, receipt };
  }

  private async insertApproval(
    transaction: CommandTransaction,
    input: {
      actor: ApiActor;
      approval: TenantBlueprintApprovalRequest;
      human: HumanApprovalSubject;
      requestedAt: string;
    },
    approvalRef: string,
  ) {
    const draftResult = await transaction.client.query(
      `select canonical_blueprint, object_version, source_pack_id, created_by
         from public.onboarding_tenant_blueprint_drafts
        where tenant_id = $1 and blueprint_id = $2::uuid
        for update`,
      [input.actor.tenantId, input.approval.blueprintId],
    );
    const draftRow = draftResult.rows[0] as Record<string, unknown> | undefined;
    if (!draftRow) throw new OnboardCoreDomainError("BLUEPRINT_NOT_FOUND", "Tenant Blueprint not found.", 404);
    if (String(draftRow.created_by) === input.human.actorId) {
      throw new OnboardCoreDomainError("DISTINCT_HUMAN_APPROVER_REQUIRED", "The human approver must be distinct from the proposal subject.", 403);
    }
    if (String(draftRow.object_version) !== input.approval.expectedObjectVersion) {
      throw new OnboardCoreDomainError("STALE_BLUEPRINT", "Blueprint expectedObjectVersion is stale.", 409);
    }
    const currentOwn = await transaction.client.query(
      `select action from public.onboarding_tenant_blueprint_approvals
        where tenant_id = $1 and blueprint_id = $2::uuid
        order by created_at desc, approval_event_id desc limit 1`,
      [input.actor.tenantId, input.approval.blueprintId],
    );
    if (currentOwn.rows.length) {
      throw new OnboardCoreDomainError("APPROVED_RECORD_IMMUTABLE", "An approved Blueprint is append-only and cannot be approved again.", 409);
    }
    const activeResult = await transaction.client.query(
      `select approval.approval_ref, approval.blueprint_id, approval.canonical_blueprint,
              approval.approved_at
         from public.onboarding_tenant_blueprint_approvals approval
         join public.onboarding_tenant_blueprint_drafts draft
           on draft.tenant_id = approval.tenant_id and draft.blueprint_id = approval.blueprint_id
        where approval.tenant_id = $1 and draft.source_pack_id = $2 and approval.action = 'APPROVED'
          and not exists (
            select 1 from public.onboarding_tenant_blueprint_approvals superseded
             where superseded.tenant_id = approval.tenant_id
               and superseded.blueprint_id = approval.blueprint_id
               and superseded.action = 'SUPERSEDED'
               and superseded.approval_ref = approval.approval_ref
          )
        order by approval.created_at desc, approval.approval_event_id desc
        limit 1 for update of approval`,
      [input.actor.tenantId, draftRow.source_pack_id],
    );
    const active = activeResult.rows[0] as Record<string, unknown> | undefined;
    if (!active && input.approval.decision !== "APPROVE") {
      throw new OnboardCoreDomainError("SUPERSESSION_TARGET_MISSING", "No active approval exists to supersede.", 409);
    }
    if (active && input.approval.decision !== "SUPERSEDE_AND_APPROVE") {
      throw new OnboardCoreDomainError("SUPERSESSION_REQUIRED", "A new version must explicitly supersede the current approved Blueprint.", 409);
    }
    if (active && String(active.approval_ref) !== input.approval.supersedesApprovalRef) {
      throw new OnboardCoreDomainError("SUPERSESSION_TARGET_STALE", "supersedesApprovalRef is not the current approval.", 409);
    }
    if (active && String(active.blueprint_id) === input.approval.blueprintId) {
      throw new OnboardCoreDomainError("APPROVED_RECORD_IMMUTABLE", "An approved Blueprint cannot supersede itself.", 409);
    }
    if (active) {
      const priorBlueprint = jsonObject(active.canonical_blueprint, "prior canonical_blueprint") as TenantBlueprintV1;
      const supersededBlueprint = issueApprovedBlueprint(priorBlueprint, {
        approvalRef: String(active.approval_ref),
        approvedAt: new Date(String(active.approved_at)).toISOString(),
        state: "SUPERSEDED",
      });
      await transaction.client.query(
        `insert into public.onboarding_tenant_blueprint_approvals
          (tenant_id, approval_event_id, blueprint_id, action, approval_ref,
           supersedes_approval_ref, canonical_blueprint, object_version, actor_id,
           actor_type, proposal_actor_id, human_authentication_ref, approved_at, created_at)
         values ($1,$2::uuid,$3::uuid,'SUPERSEDED',$4,$4,$5::jsonb,$6,$7,'user',$8,$9,$10,$10)`,
        [
          input.actor.tenantId,
          deterministicUuid("tenant-blueprint-supersession-event", { approvalRef: active.approval_ref, replacement: approvalRef }),
          active.blueprint_id,
          active.approval_ref,
          JSON.stringify(supersededBlueprint),
          blueprintApprovalObjectVersion(supersededBlueprint, String(active.approval_ref)),
          input.human.actorId,
          input.actor.actorId,
          input.human.authenticationRef,
          input.requestedAt,
        ],
      );
    }
    const draft = jsonObject(draftRow.canonical_blueprint, "canonical_blueprint") as TenantBlueprintV1;
    const approvedBlueprint = issueApprovedBlueprint(draft, { approvalRef, approvedAt: input.requestedAt });
    const objectVersion = blueprintApprovalObjectVersion(approvedBlueprint, approvalRef);
    await transaction.client.query(
      `insert into public.onboarding_tenant_blueprint_approvals
        (tenant_id, approval_event_id, blueprint_id, action, approval_ref,
         supersedes_approval_ref, canonical_blueprint, object_version, actor_id,
         actor_type, proposal_actor_id, human_authentication_ref, approved_at, created_at)
       values ($1,$2::uuid,$3::uuid,'APPROVED',$4,$5,$6::jsonb,$7,$8,'user',$9,$10,$11,$11)`,
      [
        input.actor.tenantId,
        deterministicUuid("tenant-blueprint-approval-event", { approvalRef }),
        input.approval.blueprintId,
        approvalRef,
        input.approval.supersedesApprovalRef,
        JSON.stringify(approvedBlueprint),
        objectVersion,
        input.human.actorId,
        input.actor.actorId,
        input.human.authenticationRef,
        input.requestedAt,
      ],
    );
    return {
      evidenceRefs: [
        `postgres:public.onboarding_tenant_blueprint_approvals/${approvalRef}`,
        ...(active ? [`supersedes:${String(active.approval_ref)}`] : []),
      ],
      objectVersion,
    };
  }

  async issueMandate(input: {
    actor: ApiActor;
    correlationId: string;
    mandateRequest: SetupMandateRequest;
    requestedAt: string;
  }) {
    const commandTuple = {
      blueprintId: input.mandateRequest.blueprintId,
      blueprintVersion: input.mandateRequest.blueprintVersion,
      expectedBlueprintObjectVersion: input.mandateRequest.expectedBlueprintObjectVersion,
      profile: input.mandateRequest.profile,
      tenantId: input.actor.tenantId,
    };
    const idempotencyKey = `onboard-setup-mandate:${sha256(commandTuple)}`;
    const mandateId = deterministicUuid("setup-mandate-request", commandTuple);
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId: deterministicUuid("setup-mandate-command", commandTuple),
      commandType: "onboarding.setup_mandate.issue",
      correlationId: input.correlationId,
      expectedObjectVersion: input.mandateRequest.expectedBlueprintObjectVersion,
      idempotencyKey,
      payload: input.mandateRequest,
      policyVersion: ONBOARD_CORE_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: mandateId,
        objectType: "setup_mandate",
        objectVersion: "ABSENT",
        ownerProject: "LUZIONE_API",
        sourceRefs: [
          `tenant-blueprint:${input.mandateRequest.blueprintId}@${input.mandateRequest.blueprintVersion}`,
        ],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction) => {
      const approved = await this.readActiveApprovalForUpdate(
        transaction.client,
        input.actor.tenantId,
        input.mandateRequest.blueprintId,
      );
      if (!approved) throw new OnboardCoreDomainError("APPROVED_BLUEPRINT_REQUIRED", "Setup Mandate requires an approved unsuperseded same-tenant Blueprint.", 403);
      const approvedBlueprint = jsonObject(approved.canonical_blueprint, "canonical_blueprint") as TenantBlueprintV1;
      if (approvedBlueprint.version !== input.mandateRequest.blueprintVersion) {
        throw new OnboardCoreDomainError("BLUEPRINT_VERSION_CONFLICT", "Setup Mandate must pin the exact approved Blueprint version.", 409);
      }
      if (String(approved.object_version) !== input.mandateRequest.expectedBlueprintObjectVersion) {
        throw new OnboardCoreDomainError("STALE_BLUEPRINT", "Setup Mandate expected Blueprint version is stale.", 409);
      }
      const mandate = issueSetupMandate({
        approvalRef: String(approved.approval_ref),
        approvedBlueprint,
        mandateId,
        requestedAt: input.requestedAt,
      });
      if (mandate.mandateId !== mandateId) {
        throw new Error("Server-issued Setup Mandate identity diverged from its reservation target.");
      }
      const objectVersion = setupMandateObjectVersion(mandate);
      const inserted = await transaction.client.query(
        `insert into public.onboarding_setup_mandates
          (tenant_id, mandate_id, blueprint_id, blueprint_version, approval_ref, source_binding_digest,
           canonical_mandate, object_version, expires_at, created_by, created_by_type, created_at)
         values ($1,$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)
         on conflict (tenant_id, mandate_id) do nothing
         returning mandate_id`,
        [
          input.actor.tenantId,
          mandate.mandateId,
          approvedBlueprint.blueprintId,
          approvedBlueprint.version,
          approved.approval_ref,
          approved.source_binding_digest,
          JSON.stringify(mandate),
          objectVersion,
          mandate.expiresAt,
          input.actor.actorId,
          input.actor.actorType,
          input.requestedAt,
        ],
      );
      if (!inserted.rows.length) throw new OnboardCoreDomainError("MANDATE_EXISTS", "Setup Mandate is immutable and already exists.", 409);
      return {
        evidenceRefs: [`postgres:public.onboarding_setup_mandates/${mandate.mandateId}`],
        objectVersion,
      };
    });
    const readback = await this.readMandate(input.actor, mandateId);
    if (!readback || (!receipt.idempotentReplay && readback.objectVersion !== receipt.objectVersion)) {
      throw new OnboardCoreDomainError("READBACK_UNCONFIRMED", "Setup Mandate readback could not be confirmed.", 503);
    }
    return { readback, receipt };
  }

  async revokeMandate(input: {
    actor: ApiActor;
    correlationId: string;
    human: HumanApprovalSubject;
    requestedAt: string;
    revocation: SetupMandateRevocationRequest;
  }) {
    if (input.human.tenantId !== input.actor.tenantId || !input.human.capabilities.includes("onboarding.mandate.revoke")) {
      throw new OnboardCoreDomainError("HUMAN_REVOCATION_REQUIRED", "Mandate revocation requires a separately authenticated same-tenant human subject.", 403);
    }
    const tuple = { humanActorId: input.human.actorId, ...input.revocation, tenantId: input.actor.tenantId };
    const revocationRef = `mandate-revocation:${deterministicUuid("setup-mandate-revocation", tuple)}`;
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.human.actorId, actorType: "user", roles: [] },
      causationId: null,
      commandId: deterministicUuid("setup-mandate-revocation-command", tuple),
      commandType: "onboarding.setup_mandate.revoke",
      correlationId: input.correlationId,
      expectedObjectVersion: input.revocation.expectedMandateObjectVersion,
      idempotencyKey: `onboard-mandate-revocation:${sha256(tuple)}`,
      payload: input.revocation,
      policyVersion: ONBOARD_CORE_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: { objectId: input.revocation.mandateId, objectType: "setup_mandate_revocation", objectVersion: input.revocation.expectedMandateObjectVersion, ownerProject: "LUZIONE_API", sourceRefs: [SETUP_MANDATE_REVOCATION_VERSION] },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction) => {
      const mandate = await transaction.client.query(
        `select object_version from public.onboarding_setup_mandates where tenant_id=$1 and mandate_id=$2::uuid for update`,
        [input.actor.tenantId, input.revocation.mandateId],
      );
      if (!mandate.rows.length) throw new OnboardCoreDomainError("MANDATE_NOT_FOUND", "Same-tenant Setup Mandate not found.", 404);
      if (String(mandate.rows[0].object_version) !== input.revocation.expectedMandateObjectVersion) throw new OnboardCoreDomainError("STALE_MANDATE", "Mandate object version is stale.", 409);
      const prior = await transaction.client.query(
        `select revocation_ref from public.onboarding_setup_mandate_revocations where tenant_id=$1 and mandate_id=$2::uuid limit 1`,
        [input.actor.tenantId, input.revocation.mandateId],
      );
      if (prior.rows.length) throw new OnboardCoreDomainError("MANDATE_ALREADY_REVOKED", "Mandate revocation is append-only and already exists.", 409);
      await transaction.client.query(
        `insert into public.onboarding_setup_mandate_revocations
          (tenant_id,revocation_event_id,mandate_id,revocation_ref,reason_code,actor_id,human_authentication_ref,revoked_at)
         values ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)`,
        [input.actor.tenantId, deterministicUuid("setup-mandate-revocation-event", tuple), input.revocation.mandateId, revocationRef, input.revocation.reasonCode, input.human.actorId, input.human.authenticationRef, input.requestedAt],
      );
      return { evidenceRefs: [`postgres:public.onboarding_setup_mandate_revocations/${revocationRef}`], objectVersion: input.revocation.expectedMandateObjectVersion };
    });
    const readback = await this.readMandate(input.actor, input.revocation.mandateId);
    if (!readback || readback.mandate.active || !readback.revocation) throw new OnboardCoreDomainError("READBACK_UNCONFIRMED", "Mandate revocation readback could not be confirmed.", 503);
    return { readback, receipt };
  }

  private async readActiveApprovalForUpdate(client: PoolClient, tenantId: string, blueprintId: string) {
    const result = await client.query(
      `select approved.approval_ref, approved.canonical_blueprint, approved.object_version,
              draft.source_binding_digest
         from public.onboarding_tenant_blueprint_approvals approved
         join public.onboarding_tenant_blueprint_drafts draft
           on draft.tenant_id=approved.tenant_id and draft.blueprint_id=approved.blueprint_id
        where approved.tenant_id = $1 and approved.blueprint_id = $2::uuid
          and approved.action = 'APPROVED'
          and not exists (
            select 1 from public.onboarding_tenant_blueprint_approvals superseded
             where superseded.tenant_id = approved.tenant_id
               and superseded.blueprint_id = approved.blueprint_id
               and superseded.action = 'SUPERSEDED'
               and superseded.approval_ref = approved.approval_ref
          )
        order by approved.created_at desc, approved.approval_event_id desc
        limit 1 for update of approved`,
      [tenantId, blueprintId],
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  }
}
