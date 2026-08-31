import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import {
  PostgresAtomicCommandStore,
  type CommandTransaction,
} from "@/lib/platform-guarantees/postgresCommandStore";
import {
  createLifecycleCommandRequest,
  IdempotencyConflictError,
  LifecycleCommandKernel,
} from "@/modules/platform-guarantees/commandKernel";
import type { CanonicalObjectRef } from "@/modules/platform-guarantees/types";
import {
  COMMERCIAL_CASE_OBJECT_OWNER,
  LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
  LEAD_OBJECT_OWNER,
  type CommercialCaseCommand,
  type LeadCreateCommand,
} from "@/modules/lead-commercial-case/contracts";

const POLICY_VERSION = "2026-08-31.api-pc-008.dark-path.v1";

export class LeadCommercialCaseDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly recovery?: {
      committedObjectVersion: string;
      receiptId: string;
      retry: "RECONCILE_FIRST";
    },
  ) {
    super(message);
    this.name = "LeadCommercialCaseDomainError";
  }
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error("Canonical row has an invalid updated_at timestamp.");
  return new Date(parsed).toISOString();
}

function leadObjectVersion(row: Record<string, unknown>) {
  const updatedAtVersion = row.updated_at_version
    ? String(row.updated_at_version)
    : iso(row.updated_at);
  return `crm-lead:${String(row.id)}@${updatedAtVersion}`;
}

function commercialCaseObjectVersion(row: Record<string, unknown>) {
  return `commercial-case:${String(row.case_id)}:v${Number(row.version)}`;
}

function leadReadback(row: Record<string, unknown>) {
  return {
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    lead: {
      accountId: row.account_id ? String(row.account_id) : null,
      assignedOwnerId: row.assigned_owner_id ? String(row.assigned_owner_id) : null,
      contactId: row.contact_id ? String(row.contact_id) : null,
      createdAt: iso(row.created_at),
      leadId: String(row.id),
      leadSource: String(row.lead_source),
      recommendedNextAction: row.recommended_next_action ? String(row.recommended_next_action) : null,
      stage: String(row.stage),
      status: String(row.status),
      updatedAt: iso(row.updated_at),
      vertical: row.vertical ? String(row.vertical) : null,
      version: Number(row.version),
    },
    objectVersion: leadObjectVersion(row),
    sourceOfTruth: "crm_leads",
    transferState: "UI_LEGACY_WRITER_API_DARK_PATH",
  } as const;
}

function commercialCaseReadback(row: Record<string, unknown>) {
  return {
    commercialCase: {
      accountId: row.account_id ? String(row.account_id) : null,
      accountName: row.account_name ? String(row.account_name) : null,
      amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
      caseId: String(row.case_id),
      contactName: row.contact_name ? String(row.contact_name) : null,
      createdAt: iso(row.created_at),
      nextAction: row.next_action ? String(row.next_action) : null,
      nextActionDueAt: row.next_action_due_at ? iso(row.next_action_due_at) : null,
      owner: row.owner ? String(row.owner) : null,
      opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
      primaryContactId: row.primary_contact_id ? String(row.primary_contact_id) : null,
      relationshipIntegrityState: String(row.relationship_integrity_state),
      sourceLeadId: row.source_lead_id ? String(row.source_lead_id) : null,
      stage: String(row.stage),
      status: String(row.status),
      title: String(row.title),
      updatedAt: iso(row.updated_at),
      version: Number(row.version),
    },
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    legacyCompatibility: {
      sourceLabel: "commercial_cases",
      version: String(row.version),
    },
    objectVersion: commercialCaseObjectVersion(row),
    sourceOfTruth: "commercial_cases",
    transferState: "UI_LEGACY_WRITER_API_DARK_PATH",
  } as const;
}

async function bindRead(client: PoolClient, tenantId: string) {
  await client.query("begin read only");
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function readOne(
  pool: Pool,
  tenantId: string,
  query: string,
  id: string,
) {
  const client = await pool.connect();
  try {
    await bindRead(client, tenantId);
    const result = await client.query(query, [tenantId, id]);
    await client.query("commit");
    return result.rows[0] as Record<string, unknown> | undefined;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class LeadCommercialCaseStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(private readonly pool: Pool = databasePool()) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
  }

  async readLead(actor: ApiActor, leadId: string) {
    const row = await readOne(
      this.pool,
      actor.tenantId,
      `select id, tenant_id, account_id, contact_id, lead_source, vertical, stage,
              recommended_next_action, assigned_owner_id, status, version,
              created_at, updated_at,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at_version
         from public.crm_leads
        where tenant_id = $1 and id = $2
        limit 1`,
      leadId,
    );
    return row ? leadReadback(row) : null;
  }

  async readCommercialCase(actor: ApiActor, caseId: string) {
    const row = await readOne(
      this.pool,
      actor.tenantId,
      `select tenant_id, case_id, title, stage, owner, next_action,
              next_action_due_at, account_name, contact_name, amount, status,
              version, account_id, primary_contact_id, opportunity_id, source_lead_id,
              relationship_integrity_state, created_at, updated_at
         from public.commercial_cases
        where tenant_id = $1 and case_id = $2
        limit 1`,
      caseId,
    );
    return row ? commercialCaseReadback(row) : null;
  }

  async executeLeadCreate(input: {
    actor: ApiActor;
    command: LeadCreateCommand;
    correlationId: string;
    requestedAt: string;
  }) {
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId: input.command.commandId,
      commandType: input.command.commandType,
      correlationId: input.correlationId,
      expectedObjectVersion: input.command.expectedObjectVersion,
      idempotencyKey: input.command.idempotencyKey,
      payload: { lead: input.command.lead, leadId: input.command.leadId },
      policyVersion: POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: input.command.leadId,
        objectType: "lead",
        objectVersion: input.command.expectedObjectVersion,
        ownerProject: LEAD_OBJECT_OWNER,
        sourceRefs: ["postgres:public.crm_leads"],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction) => {
      const result = await transaction.client.query(
        `insert into public.crm_leads (
           id, tenant_id, account_id, contact_id, lead_source, vertical, stage,
           recommended_next_action, assigned_owner_id, status, version,
           created_by, updated_by, source_metadata, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$11,$12::jsonb,$13,$13)
         on conflict (id) do nothing
         returning *,
           to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at_version`,
        [
          input.command.leadId,
          input.actor.tenantId,
          input.command.lead.accountId,
          input.command.lead.contactId,
          input.command.lead.leadSource,
          input.command.lead.vertical,
          input.command.lead.stage,
          input.command.lead.recommendedNextAction,
          input.command.lead.assignedOwnerId,
          input.command.lead.status,
          input.actor.actorId,
          JSON.stringify({ contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION, writer: "luzione-api-dark-path" }),
          input.requestedAt,
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        throw new LeadCommercialCaseDomainError("OBJECT_EXISTS", "Lead identity already exists.", 409);
      }
      return {
        evidenceRefs: [`postgres:public.crm_leads/${input.command.leadId}`],
        objectVersion: leadObjectVersion(row),
      };
    });
    const readback = await this.readLead(input.actor, input.command.leadId);
    const readbackMatchesReceipt = readback?.objectVersion === receipt.objectVersion;
    if (!readback || (!receipt.idempotentReplay && !readbackMatchesReceipt)) {
      throw new LeadCommercialCaseDomainError(
        "READBACK_UNCONFIRMED",
        "Lead commit readback could not be confirmed; reconcile the durable receipt before retrying.",
        503,
        {
          committedObjectVersion: receipt.objectVersion,
          receiptId: receipt.receiptId,
          retry: "RECONCILE_FIRST",
        },
      );
    }
    return { readback, readbackMatchesReceipt, receipt };
  }

  async executeCommercialCase(input: {
    actor: ApiActor;
    command: CommercialCaseCommand;
    correlationId: string;
    requestedAt: string;
  }) {
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId: input.command.commandId,
      commandType: input.command.commandType,
      correlationId: input.correlationId,
      expectedObjectVersion: input.command.expectedObjectVersion,
      idempotencyKey: input.command.idempotencyKey,
      payload: input.command,
      policyVersion: POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: input.command.caseId,
        objectType: "commercial_case",
        objectVersion: input.command.expectedObjectVersion,
        ownerProject: COMMERCIAL_CASE_OBJECT_OWNER,
        sourceRefs: ["postgres:public.commercial_cases"],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction, target) =>
      this.mutateCommercialCase(transaction, target, input));
    const readback = await this.readCommercialCase(input.actor, input.command.caseId);
    const readbackMatchesReceipt = readback?.objectVersion === receipt.objectVersion;
    if (!readback || (!receipt.idempotentReplay && !readbackMatchesReceipt)) {
      throw new LeadCommercialCaseDomainError(
        "READBACK_UNCONFIRMED",
        "Commercial Case commit readback could not be confirmed; reconcile the durable receipt before retrying.",
        503,
        {
          committedObjectVersion: receipt.objectVersion,
          receiptId: receipt.receiptId,
          retry: "RECONCILE_FIRST",
        },
      );
    }
    return { readback, readbackMatchesReceipt, receipt };
  }

  private async mutateCommercialCase(
    transaction: CommandTransaction,
    _target: CanonicalObjectRef,
    input: {
      actor: ApiActor;
      command: CommercialCaseCommand;
      requestedAt: string;
    },
  ) {
    if (input.command.commandType === "commercial_case.create") {
      return this.createCommercialCase(transaction, {
        actor: input.actor,
        command: input.command,
        requestedAt: input.requestedAt,
      });
    }
    const current = await transaction.client.query(
      `select * from public.commercial_cases
        where tenant_id = $1 and case_id = $2
        for update`,
      [input.actor.tenantId, input.command.caseId],
    );
    const row = current.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new LeadCommercialCaseDomainError("CASE_NOT_FOUND", "Commercial Case not found.", 404);
    if (commercialCaseObjectVersion(row) !== input.command.expectedObjectVersion) {
      throw new LeadCommercialCaseDomainError("VERSION_CONFLICT", "Commercial Case version conflict.", 409);
    }
    const result = input.command.commandType === "commercial_case.update_owner"
      ? await transaction.client.query(
        `update public.commercial_cases
            set owner = $3, version = version + 1, updated_by = $4, updated_at = $5
          where tenant_id = $1 and case_id = $2
          returning *`,
        [input.actor.tenantId, input.command.caseId, input.command.owner, input.actor.actorId, input.requestedAt],
      )
      : await transaction.client.query(
        `update public.commercial_cases
            set next_action = $3, next_action_due_at = $4, version = version + 1,
                updated_by = $5, updated_at = $6
          where tenant_id = $1 and case_id = $2
          returning *`,
        [
          input.actor.tenantId,
          input.command.caseId,
          input.command.nextAction,
          input.command.nextActionDueAt,
          input.actor.actorId,
          input.requestedAt,
        ],
      );
    const updated = result.rows[0] as Record<string, unknown>;
    return {
      evidenceRefs: [`postgres:public.commercial_cases/${input.command.caseId}`],
      objectVersion: commercialCaseObjectVersion(updated),
    };
  }

  private async createCommercialCase(
    transaction: CommandTransaction,
    input: {
      actor: ApiActor;
      command: Extract<CommercialCaseCommand, { commandType: "commercial_case.create" }>;
      requestedAt: string;
    },
  ) {
    const lead = await transaction.client.query(
      `select *,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at_version
         from public.crm_leads
        where tenant_id = $1 and id = $2
        for share`,
      [input.actor.tenantId, input.command.commercialCase.sourceLeadId],
    );
    const leadRow = lead.rows[0] as Record<string, unknown> | undefined;
    if (!leadRow) throw new LeadCommercialCaseDomainError("LEAD_NOT_FOUND", "Source Lead not found.", 404);
    if (leadObjectVersion(leadRow) !== input.command.commercialCase.sourceLeadVersion) {
      throw new LeadCommercialCaseDomainError("VERSION_CONFLICT", "Source Lead version conflict.", 409);
    }
    const identity = await transaction.client.query(
      `insert into public.commercial_case_identities (
         case_id, tenant_id, origin_type, origin_id, created_by, status
       ) values ($1,$2,'lead',$3,$4,'active')
       on conflict do nothing
       returning case_id`,
      [input.command.caseId, input.actor.tenantId, input.command.commercialCase.sourceLeadId, input.actor.actorId],
    );
    if ((identity.rowCount ?? 0) !== 1) {
      const existing = await transaction.client.query(
        `select case_id from public.commercial_case_identities
          where tenant_id = $1 and origin_type = 'lead' and origin_id = $2
          limit 1`,
        [input.actor.tenantId, input.command.commercialCase.sourceLeadId],
      );
      throw new LeadCommercialCaseDomainError(
        "ORIGIN_CONFLICT",
        existing.rows[0]
          ? "Source Lead already belongs to another Commercial Case."
          : "Commercial Case identity already exists.",
        409,
      );
    }
    const result = await transaction.client.query(
      `insert into public.commercial_cases (
         tenant_id, case_id, title, stage, account_name, contact_name, amount,
         status, created_by, updated_by, version, source_metadata, account_id,
         primary_contact_id, source_lead_id, relationship_integrity_state,
         created_at, updated_at
       ) values ($1,$2,$3,'intake',$4,$5,$6,'active',$7,$7,1,$8::jsonb,$9,$10,$11,'legacy_unverified',$12,$12)
       returning *`,
      [
        input.actor.tenantId,
        input.command.caseId,
        input.command.commercialCase.title,
        input.command.commercialCase.accountName,
        input.command.commercialCase.contactName,
        input.command.commercialCase.amount,
        input.actor.actorId,
        JSON.stringify({
          contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
          sourceLeadVersion: input.command.commercialCase.sourceLeadVersion,
          writer: "luzione-api-dark-path",
        }),
        input.command.commercialCase.accountId,
        input.command.commercialCase.primaryContactId,
        input.command.commercialCase.sourceLeadId,
        input.requestedAt,
      ],
    );
    const row = result.rows[0] as Record<string, unknown>;
    return {
      evidenceRefs: [
        `postgres:public.crm_leads/${input.command.commercialCase.sourceLeadId}`,
        `postgres:public.commercial_cases/${input.command.caseId}`,
      ],
      objectVersion: commercialCaseObjectVersion(row),
    };
  }
}

export { IdempotencyConflictError };
