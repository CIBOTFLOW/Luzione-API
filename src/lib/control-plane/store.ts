import "server-only";

import crypto from "node:crypto";
import type { PoolClient } from "pg";

import { databasePool } from "@/lib/db";
import type { CanonicalActor } from "@/lib/control-plane/actor";
import { evaluateAuthorityV2 } from "@/modules/control-plane/authorityV2";
import type { CreateConnectionInput, ParsedCommand } from "@/modules/control-plane/request";
import type { CapabilityContract, ExactApproval, Money } from "@/modules/control-plane/types";

export class ControlPlaneStoreError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

type ConnectionPatch = Partial<Pick<CreateConnectionInput, "configuration" | "displayName" | "scopes">> & {
  killSwitchActive?: boolean;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function mapConnection(row: Record<string, unknown>) {
  return {
    adapterVersion: row.adapter_version,
    authMethod: row.auth_method,
    capabilities: row.capabilities ?? [],
    connectionId: row.connection_id,
    displayName: row.display_name,
    externalAccountId: row.external_account_id,
    killSwitchActive: row.kill_switch_active,
    lastError: row.last_error_summary,
    lastValidatedAt: row.last_validated_at,
    lastValidationStatus: row.last_validation_status,
    legacyManaged: row.state === "LEGACY_MANAGED",
    provider: row.provider,
    scopes: row.scopes,
    secretBackendStatus: typeof row.secret_ref === "string" ? row.secret_ref.split(":", 1)[0].toUpperCase() : "NONE",
    state: row.state,
    syncSummary: row.sync_summary ?? null,
    tokenExpiresAt: row.token_expires_at,
    updatedAt: row.updated_at,
  };
}

const CONNECTION_SELECT = `
  select connection.*,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'capability', enabled_capability.capability,
        'enabled', enabled_capability.enabled,
        'resourceScope', enabled_capability.resource_scope
      ) order by enabled_capability.capability)
      from public.integration_connection_capabilities enabled_capability
      where enabled_capability.tenant_id = connection.tenant_id
        and enabled_capability.connection_id = connection.connection_id
    ), '[]'::jsonb) as capabilities,
    (
      select jsonb_build_object(
        'syncRunId', sync.sync_run_id,
        'state', sync.state,
        'recordsObserved', sync.records_observed,
        'recordsCommitted', sync.records_committed,
        'updatedAt', sync.updated_at
      )
      from public.integration_sync_runs sync
      where sync.tenant_id = connection.tenant_id
        and sync.connection_id = connection.connection_id
      order by sync.created_at desc
      limit 1
    ) as sync_summary
  from public.integration_connections connection`;

export async function listConnections(actor: CanonicalActor, limit = 100) {
  const result = await databasePool().query(
    `${CONNECTION_SELECT}
     where connection.tenant_id = $1
     order by connection.provider, connection.display_name
     limit $2`,
    [actor.tenantId, Math.max(1, Math.min(limit, 250))],
  );
  return result.rows.map(mapConnection);
}

export async function listModelPriceCatalog(
  actor: CanonicalActor,
  input: { effectiveAt: string; provider?: string },
) {
  const result = await databasePool().query(
    `select distinct on (provider, model)
       price_catalog_id, provider, model, currency,
       input_price_per_million::text,
       cached_input_price_per_million::text,
       output_price_per_million::text,
       effective_from, effective_until, source_url, observed_at
     from public.model_price_catalog
     where active
       and effective_from <= $1::timestamptz
       and (effective_until is null or effective_until > $1::timestamptz)
       and ($2::text is null or provider = $2)
     order by provider, model, effective_from desc`,
    [input.effectiveAt, input.provider ?? null],
  );
  const items = result.rows.map((row) => ({
    cachedInputPricePerMillion: row.cached_input_price_per_million,
    currency: row.currency,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    inputPricePerMillion: row.input_price_per_million,
    model: row.model,
    observedAt: row.observed_at,
    outputPricePerMillion: row.output_price_per_million,
    priceCatalogId: row.price_catalog_id,
    provider: row.provider,
    sourceUrl: row.source_url,
  }));
  return {
    catalogVersion: `sha256:${digest(items)}`,
    effectiveAt: input.effectiveAt,
    items,
    tenantId: actor.tenantId,
  };
}

export async function getConnection(actor: CanonicalActor, connectionId: string) {
  const result = await databasePool().query(
    `${CONNECTION_SELECT}
     where connection.tenant_id = $1 and connection.connection_id = $2`,
    [actor.tenantId, connectionId],
  );
  if (result.rows.length !== 1) {
    throw new ControlPlaneStoreError("CONNECTION_NOT_FOUND", "Connection not found for the active tenant.", 404);
  }
  return mapConnection(result.rows[0]);
}

export async function createConnection(actor: CanonicalActor, input: CreateConnectionInput) {
  const connectionId = crypto.randomUUID();
  const state = input.authMethod === "LEGACY" ? "LEGACY_MANAGED" : "DISCONNECTED";
  const result = await databasePool().query(
    `insert into public.integration_connections
       (connection_id, tenant_id, provider, display_name, state, auth_method, secret_ref,
        scopes, configuration, adapter_version, legacy_source_ref, created_by_identity_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)
     returning *`,
    [
      connectionId,
      actor.tenantId,
      input.provider,
      input.displayName,
      state,
      input.authMethod,
      input.secretRef ?? null,
      JSON.stringify(input.scopes),
      JSON.stringify(input.configuration),
      input.adapterVersion,
      input.legacySourceRef ?? null,
      actor.principal.identityId,
    ],
  );
  return mapConnection({ ...result.rows[0], capabilities: [], sync_summary: null });
}

export async function patchConnection(actor: CanonicalActor, connectionId: string, patch: ConnectionPatch) {
  const result = await databasePool().query(
    `update public.integration_connections
     set display_name = coalesce($3, display_name),
         scopes = coalesce($4::jsonb, scopes),
         configuration = coalesce($5::jsonb, configuration),
         kill_switch_active = coalesce($6, kill_switch_active),
         updated_at = now()
     where tenant_id = $1 and connection_id = $2 and state <> 'REVOKED'
     returning *`,
    [
      actor.tenantId,
      connectionId,
      patch.displayName ?? null,
      patch.scopes ? JSON.stringify(patch.scopes) : null,
      patch.configuration ? JSON.stringify(patch.configuration) : null,
      patch.killSwitchActive ?? null,
    ],
  );
  if (result.rows.length !== 1) {
    throw new ControlPlaneStoreError("CONNECTION_NOT_FOUND", "An active connection was not found for the active tenant.", 404);
  }
  return mapConnection({ ...result.rows[0], capabilities: [], sync_summary: null });
}

export async function listConnectionSyncRuns(actor: CanonicalActor, connectionId: string, limit = 50) {
  const result = await databasePool().query(
    `select sync_run_id, capability, state, records_observed, records_committed,
            source_readback_ref, estimated_cost, actual_cost, attempt_count,
            last_error_code, last_error_summary, created_at, updated_at
     from public.integration_sync_runs
     where tenant_id = $1 and connection_id = $2
     order by created_at desc
     limit $3`,
    [actor.tenantId, connectionId, Math.max(1, Math.min(limit, 100))],
  );
  return result.rows.map((row) => ({
    actualCost: row.actual_cost,
    attemptCount: row.attempt_count,
    capability: row.capability,
    createdAt: row.created_at,
    estimatedCost: row.estimated_cost,
    errorCode: row.last_error_code,
    errorSummary: row.last_error_summary,
    recordsCommitted: row.records_committed,
    recordsObserved: row.records_observed,
    sourceReadbackRef: row.source_readback_ref,
    state: row.state,
    syncRunId: row.sync_run_id,
    updatedAt: row.updated_at,
  }));
}

function verifyActorEnvelope(actor: CanonicalActor, command: ParsedCommand) {
  if (command.envelope.tenantId !== actor.tenantId
    || command.envelope.actor.identityId !== actor.principal.identityId
    || command.envelope.actor.principalType !== actor.principal.principalType
    || command.envelope.actor.membershipRole !== actor.principal.membershipRole) {
    throw new ControlPlaneStoreError(
      "ACTOR_CONTEXT_MISMATCH",
      "The effect envelope tenant and actor must exactly match the server-resolved active membership.",
      403,
    );
  }
}

async function loadCapability(client: PoolClient, command: ParsedCommand): Promise<CapabilityContract> {
  const result = await client.query<{
    authority_class: CapabilityContract["authorityClass"];
    capability: string;
    enabled: boolean;
    operation_kind: CapabilityContract["operationKind"];
    provider: string;
    provider_effect: boolean;
  }>(
    `select provider, capability, authority_class, operation_kind, provider_effect, enabled
     from public.integration_capability_registry
     where provider = $1 and capability = $2`,
    [command.action.provider, command.envelope.capability],
  );
  if (result.rows.length !== 1) {
    throw new ControlPlaneStoreError("CAPABILITY_NOT_REGISTERED", "The provider capability is not registered.", 403);
  }
  const row = result.rows[0];
  return {
    authorityClass: row.authority_class,
    capability: row.capability,
    enabled: row.enabled,
    operationKind: row.operation_kind,
    provider: row.provider,
    providerEffect: row.provider_effect,
  };
}

async function requirePolicyDecision(client: PoolClient, actor: CanonicalActor, command: ParsedCommand) {
  const result = await client.query(
    `select evaluation_id, allowed, requires_approval, hard_blocked
     from public.policy_evaluations
     where evaluation_id = $1
       and tenant_id = $2
       and authority_contract_version = 'luzione-authority/v2'
       and authority_class = $3
       and capability = $4
       and correlation_id = $5`,
    [
      command.envelope.policyDecisionId,
      actor.tenantId,
      command.envelope.authorityClass,
      command.envelope.capability,
      command.envelope.correlationId,
    ],
  );
  if (result.rows.length !== 1 || result.rows[0].hard_blocked || !result.rows[0].allowed) {
    throw new ControlPlaneStoreError("POLICY_DECISION_DENIED", "No matching affirmative authority-v2 policy decision exists.", 403);
  }
}

async function assertExecutionGuards(client: PoolClient, actor: CanonicalActor, command: ParsedCommand) {
  if (command.action.connectionId
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.action.connectionId)) {
    throw new ControlPlaneStoreError("CONNECTION_INVALID", "The command connectionId is invalid.", 400);
  }
  const blocked = await client.query<{ scope_ref: string; scope_type: string }>(
    `select scope_type, scope_ref
     from public.p110_kill_switches
     where active
       and (canonical_tenant_id = $1 or (canonical_tenant_id is null and tenant_id = $2))
       and (
         scope_type = 'GLOBAL'
         or (scope_type = 'PROVIDER' and scope_ref = $3)
         or (scope_type = 'CAPABILITY' and scope_ref = $4)
         or (scope_type = 'CONNECTION' and scope_ref = $5)
         or (scope_type = 'MODEL' and scope_ref = $6)
       )
     limit 1`,
    [
      actor.tenantId,
      actor.legacyTenantId,
      command.action.provider,
      command.envelope.capability,
      command.action.connectionId ?? "",
      command.action.model ?? "",
    ],
  );
  if (blocked.rows.length) {
    throw new ControlPlaneStoreError(
      "KILL_SWITCH_ACTIVE",
      `Command admission is blocked by the active ${blocked.rows[0].scope_type.toLowerCase()} kill switch.`,
      423,
    );
  }
  if (command.action.connectionId) {
    const connection = await client.query(
      `select 1
       from public.integration_connections
       where tenant_id = $1 and connection_id = $2 and provider = $3
         and state not in ('REVOKED','DISCONNECTED') and not kill_switch_active`,
      [actor.tenantId, command.action.connectionId, command.action.provider],
    );
    if (connection.rows.length !== 1) {
      throw new ControlPlaneStoreError(
        "CONNECTION_NOT_EXECUTABLE",
        "The tenant connection is missing, disconnected, revoked, provider-mismatched, or kill-switched.",
        423,
      );
    }
  }

  const estimated = command.envelope.estimatedCost;
  if (!estimated) return;
  const budgetViolation = await client.query<{ budget_policy_id: string; hard_limit: string }>(
    `select policy.budget_policy_id::text, policy.hard_limit::text
     from public.tenant_budget_policies policy
     left join lateral (
       select coalesce(sum(
         case
           when coalesce(usage.actual_cost, usage.estimated_cost)->>'amount' ~ '^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$'
           then (coalesce(usage.actual_cost, usage.estimated_cost)->>'amount')::numeric
           else 0
         end
       ), 0) as spent
       from public.platform_usage_events usage
       where usage.tenant_id = policy.tenant_id
         and coalesce(usage.actual_cost, usage.estimated_cost)->>'currency' = policy.currency
         and (
           (policy.period = 'DAY' and usage.observed_at >= date_trunc('day', now()))
           or (policy.period = 'MONTH' and usage.observed_at >= date_trunc('month', now()))
           or (policy.period = 'RUN' and usage.correlation_id = $7)
         )
         and (
           policy.scope_type = 'GLOBAL'
           or (policy.scope_type = 'PROVIDER' and usage.provider = policy.scope_ref)
           or (policy.scope_type = 'MODEL' and usage.model = policy.scope_ref)
           or (policy.scope_type = 'CONNECTION' and usage.connection_id::text = policy.scope_ref)
           or (policy.scope_type = 'CAPABILITY' and exists (
             select 1 from public.p110_command_receipts receipt
             where receipt.canonical_tenant_id = usage.tenant_id
               and receipt.command_id = usage.command_id
               and receipt.capability = policy.scope_ref
           ))
           or (policy.scope_type = 'WORKFLOW' and exists (
             select 1 from public.p110_command_receipts receipt
             where receipt.canonical_tenant_id = usage.tenant_id
               and receipt.command_id = usage.command_id
               and receipt.workflow_id = policy.scope_ref
           ))
         )
     ) total on true
     where policy.tenant_id = $1
       and policy.active
       and policy.currency = $2
       and (
         policy.scope_type = 'GLOBAL'
         or (policy.scope_type = 'PROVIDER' and policy.scope_ref = $3)
         or (policy.scope_type = 'CAPABILITY' and policy.scope_ref = $4)
         or (policy.scope_type = 'CONNECTION' and policy.scope_ref = $5)
         or (policy.scope_type = 'MODEL' and policy.scope_ref = $6)
       )
       and total.spent + $8::numeric > policy.hard_limit
     limit 1`,
    [
      actor.tenantId,
      estimated.currency,
      command.action.provider,
      command.envelope.capability,
      command.action.connectionId ?? "",
      command.action.model ?? "",
      command.envelope.correlationId,
      estimated.amount,
    ],
  );
  if (budgetViolation.rows.length) {
    throw new ControlPlaneStoreError(
      "BUDGET_EXHAUSTED",
      "The estimated effect cost would exceed an active tenant hard limit.",
      402,
    );
  }
}

async function loadApproval(client: PoolClient, actor: CanonicalActor, command: ParsedCommand) {
  if (!command.envelope.approvalId) return undefined;
  const result = await client.query<{
    action_id: string;
    action_version: string;
    approval_id: string;
    authority_class: "A3";
    capability: string;
    content_digest: string;
    estimated_cost: Money;
    expires_at: Date | string;
    provider: string;
    requested_by_identity_id: string;
    resource_scope: string[];
    status: ExactApproval["status"];
    tenant_id: string;
  }>(
    `select approval_id, tenant_id::text, authority_class, capability, action_id,
            action_version, content_digest, provider, resource_scope, estimated_cost,
            requested_by_identity_id, status, expires_at
     from public.platform_effect_approvals
     where tenant_id = $1 and approval_id = $2
     for update`,
    [actor.tenantId, command.envelope.approvalId],
  );
  if (result.rows.length !== 1) return undefined;
  const row = result.rows[0];
  return {
    actionId: row.action_id,
    actionVersion: row.action_version,
    actorIdentityId: row.requested_by_identity_id,
    approvalId: row.approval_id,
    authorityClass: row.authority_class,
    capability: row.capability,
    contentDigest: row.content_digest,
    estimatedCost: row.estimated_cost,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    provider: row.provider,
    resourceScope: row.resource_scope,
    status: row.status,
    tenantId: row.tenant_id,
  } satisfies ExactApproval;
}

export async function admitCommand(actor: CanonicalActor, command: ParsedCommand) {
  verifyActorEnvelope(actor, command);
  const client = await databasePool().connect();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))",
      [actor.tenantId, command.envelope.idempotencyKey],
    );
    const payloadHash = digest(command);
    const replay = await client.query(
      `select receipt_id, command_id, payload_hash, state, authority_class, capability,
              policy_decision_id, approval_id, correlation_id, requested_at
       from public.p110_command_receipts
       where tenant_id = $1 and idempotency_key = $2
       for update`,
      [actor.legacyTenantId, command.envelope.idempotencyKey],
    );
    if (replay.rows.length === 1) {
      if (replay.rows[0].payload_hash !== payloadHash) {
        throw new ControlPlaneStoreError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different command.", 409);
      }
      await client.query("commit");
      return { ...replay.rows[0], replayed: true, externalEffectDispatched: false };
    }

    await requirePolicyDecision(client, actor, command);
    await assertExecutionGuards(client, actor, command);
    const capability = await loadCapability(client, command);
    const approval = await loadApproval(client, actor, command);
    const authority = evaluateAuthorityV2({
      action: command.action,
      approval,
      capability,
      envelope: command.envelope,
      now: new Date().toISOString(),
      selectedModel: command.action.model,
    });
    const commandId = `cmd:${crypto.randomUUID()}`;
    const receiptId = `receipt:${crypto.randomUUID()}`;
    const auditEventId = crypto.randomUUID();
    const executionStepId = authority.allowed ? crypto.randomUUID() : null;
    const state = authority.allowed ? "VALIDATED" : "BLOCKED";
    await client.query(
      `insert into public.p110_command_receipts
        (tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
         correlation_id, target_owner_project, target_object_type, target_object_id,
         expected_object_version, policy_version, actor_id, actor_type, actor_roles,
         state, requested_at, metadata, canonical_tenant_id, authority_contract_version,
         authority_class, capability, policy_decision_id, approval_id, resource_scope,
         estimated_cost, compensation_plan_ref)
       values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'luzione-authority/v2',$12,$13,$14::jsonb,
         $15,now(),$16::jsonb,$17,'luzione-authority/v2',$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24)`,
      [
        actor.legacyTenantId,
        receiptId,
        commandId,
        command.commandType,
        command.envelope.idempotencyKey,
        payloadHash,
        command.envelope.correlationId,
        command.target.ownerProject,
        command.target.objectType,
        command.target.objectId,
        command.target.objectVersion,
        actor.principal.identityId,
        actor.principal.principalType.toLowerCase(),
        JSON.stringify([actor.principal.membershipRole]),
        state,
        JSON.stringify({ action: command.action, authorityDecision: authority, payload: command.payload }),
        actor.tenantId,
        command.envelope.authorityClass,
        command.envelope.capability,
        command.envelope.policyDecisionId,
        command.envelope.approvalId ?? null,
        JSON.stringify(command.envelope.resourceScope),
        command.envelope.estimatedCost ? JSON.stringify(command.envelope.estimatedCost) : null,
        command.action.compensationPlanRef ?? null,
      ],
    );
    if (executionStepId) {
      await client.query(
        `insert into public.platform_execution_steps
          (execution_step_id, tenant_id, legacy_tenant_id, command_id, receipt_id,
           connection_id, provider, capability, step_kind, step_sequence, state,
           idempotency_key, input_digest)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'PROVIDER_REQUEST',0,'PENDING',$9,$10)`,
        [
          executionStepId,
          actor.tenantId,
          actor.legacyTenantId,
          commandId,
          receiptId,
          command.action.connectionId ?? null,
          command.action.provider,
          command.envelope.capability,
          `${command.envelope.idempotencyKey}:provider-request`,
          payloadHash,
        ],
      );
    }
    await client.query(
      `insert into public.platform_audit_events
        (audit_event_id, tenant_id, identity_id, event_type, command_id,
         execution_step_id, correlation_id, payload_digest, evidence)
       values ($1,$2,$3,'command.admitted',$4,$5,$6,$7,$8::jsonb)`,
      [
        auditEventId,
        actor.tenantId,
        actor.principal.identityId,
        commandId,
        executionStepId,
        command.envelope.correlationId,
        payloadHash,
        JSON.stringify({
          authorityClass: command.envelope.authorityClass,
          authorityCode: authority.code,
          capability: command.envelope.capability,
          provider: command.action.provider,
          state,
        }),
      ],
    );
    if (authority.allowed && command.envelope.authorityClass === "A3" && command.envelope.approvalId) {
      const consumed = await client.query(
        `update public.platform_effect_approvals
         set status = 'CONSUMED', consumed_at = now(), consumed_by_command_id = $3, updated_at = now()
         where tenant_id = $1 and approval_id = $2 and status = 'APPROVED'`,
        [actor.tenantId, command.envelope.approvalId, commandId],
      );
      if (consumed.rowCount !== 1) {
        throw new ControlPlaneStoreError("APPROVAL_CONSUMPTION_CONFLICT", "The exact approval could not be consumed atomically.", 409);
      }
    }
    await client.query("commit");
    return {
      approvalId: command.envelope.approvalId ?? null,
      authorityClass: command.envelope.authorityClass,
      authorityDecision: authority,
      auditReference: `audit:${auditEventId}`,
      capability: command.envelope.capability,
      commandId,
      correlationId: command.envelope.correlationId,
      executionStepId,
      externalEffectDispatched: false,
      receiptId,
      replayed: false,
      state,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCommand(actor: CanonicalActor, commandId: string) {
  const result = await databasePool().query(
    `select receipt_id, command_id, command_type, idempotency_key, correlation_id,
            state, requested_at, committed_at, source_confirmed_at, source_readback_ref,
            last_error_code, last_error_summary, authority_contract_version,
            authority_class, capability, policy_decision_id, approval_id, resource_scope,
            estimated_cost, actual_cost
     from public.p110_command_receipts
     where canonical_tenant_id = $1 and command_id = $2`,
    [actor.tenantId, commandId],
  );
  if (result.rows.length !== 1) {
    throw new ControlPlaneStoreError("COMMAND_NOT_FOUND", "Command not found for the active tenant.", 404);
  }
  return result.rows[0];
}

export async function decideApproval(
  actor: CanonicalActor,
  approvalId: string,
  input: { decision: "APPROVE" | "DENY"; rationale: string },
) {
  if (actor.principal.principalType !== "USER") {
    throw new ControlPlaneStoreError("HUMAN_APPROVER_REQUIRED", "Only an active human membership may decide an A3 approval.", 403);
  }
  const result = await databasePool().query(
    `update public.platform_effect_approvals
     set status = case when $3 = 'APPROVE' then 'APPROVED' else 'DENIED' end,
         approved_by_identity_id = case when $3 = 'APPROVE' then $4 else null end,
         approved_at = case when $3 = 'APPROVE' then now() else null end,
         decision_rationale = $5,
         updated_at = now()
     where tenant_id = $1 and approval_id = $2 and status = 'REQUESTED' and expires_at > now()
     returning approval_id, status, expires_at, approved_at, approved_by_identity_id`,
    [actor.tenantId, approvalId, input.decision, actor.principal.identityId, input.rationale],
  );
  if (result.rows.length !== 1) {
    throw new ControlPlaneStoreError("APPROVAL_NOT_DECIDABLE", "The approval is missing, expired, or already decided.", 409);
  }
  return result.rows[0];
}
