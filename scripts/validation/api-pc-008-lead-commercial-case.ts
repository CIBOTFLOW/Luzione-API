import assert from "node:assert/strict";
import { Pool } from "pg";

import { GET as getCaseRoute, POST as postCaseRoute } from "@/app/api/v1/commands/commercial-cases/route";
import { GET as getLeadRoute, POST as postLeadRoute } from "@/app/api/v1/commands/leads/route";
import type { ApiActor } from "@/lib/api/actor";
import {
  LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
  parseCommercialCaseCommand,
  parseLeadCommand,
} from "@/modules/lead-commercial-case/contracts";
import {
  IdempotencyConflictError,
  LeadCommercialCaseDomainError,
  LeadCommercialCaseStore,
} from "@/modules/lead-commercial-case/store";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required for the disposable API-PC-008 proof.");

const actor: ApiActor = {
  actorId: "service:api-pc-008-proof",
  actorType: "service",
  capabilities: ["lead.command", "lead.read", "commercial_case.command", "commercial_case.read"],
  source: "service-token",
  tenantId: "api-pc-008-a",
};
const tenantB: ApiActor = { ...actor, tenantId: "api-pc-008-b" };

async function main() {
  const pool = new Pool({ connectionString });
  const store = new LeadCommercialCaseStore(pool);
  try {
  const leadCommand = parseLeadCommand({
    commandId: "command-lead-proof-001",
    commandType: "lead.create",
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    expectedObjectVersion: "ABSENT",
    idempotencyKey: "idempotency-lead-proof-001",
    lead: {
      accountId: null,
      assignedOwnerId: "operator-proof",
      contactId: null,
      leadSource: "api-pc-008-proof",
      recommendedNextAction: "Create Commercial Case",
      stage: "qualified",
      status: "active",
      vertical: "design",
    },
    leadId: "lead-proof-001",
  });
  const lead = await store.executeLeadCreate({
    actor,
    command: leadCommand,
    correlationId: "correlation-lead-proof-001",
    requestedAt: "2026-08-31T05:00:00.000Z",
  });
  assert.equal(lead.receipt.idempotentReplay, false);
  assert.equal(lead.readback.sourceOfTruth, "crm_leads");
  assert.equal(lead.readback.lead.leadId, "lead-proof-001");

  const replay = await store.executeLeadCreate({
    actor,
    command: leadCommand,
    correlationId: "correlation-lead-proof-001-replay",
    requestedAt: "2026-08-31T05:01:00.000Z",
  });
  assert.equal(replay.receipt.idempotentReplay, true);
  assert.equal(replay.receipt.receiptId, lead.receipt.receiptId);

  await assert.rejects(
    () => store.executeLeadCreate({
      actor,
      command: parseLeadCommand({
        ...leadCommand,
        lead: { ...leadCommand.lead, stage: "changed-payload" },
      }),
      correlationId: "correlation-lead-proof-conflict",
      requestedAt: "2026-08-31T05:02:00.000Z",
    }),
    (error: unknown) => error instanceof IdempotencyConflictError,
  );

  const createCase = parseCommercialCaseCommand({
    caseId: "case-proof-001",
    commandId: "command-case-proof-001",
    commandType: "commercial_case.create",
    commercialCase: {
      accountId: null,
      accountName: "Proof account",
      amount: 2500,
      contactName: null,
      primaryContactId: null,
      sourceLeadId: "lead-proof-001",
      sourceLeadVersion: lead.readback.objectVersion,
      title: "Proof Commercial Case",
    },
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    expectedObjectVersion: "ABSENT",
    idempotencyKey: "idempotency-case-proof-001",
  });
  if (createCase.commandType !== "commercial_case.create") {
    throw new Error("The proof fixture must parse as commercial_case.create.");
  }
  const commercialCase = await store.executeCommercialCase({
    actor,
    command: createCase,
    correlationId: "correlation-case-proof-001",
    requestedAt: "2026-08-31T05:03:00.000Z",
  });
  assert.equal(commercialCase.readback.sourceOfTruth, "commercial_cases");
  assert.equal(commercialCase.readback.commercialCase.sourceLeadId, "lead-proof-001");
  assert.equal(commercialCase.readback.commercialCase.relationshipIntegrityState, "legacy_unverified");
  assert.equal(commercialCase.readback.commercialCase.opportunityId, null);

  await assert.rejects(
    () => store.executeCommercialCase({
      actor,
      command: parseCommercialCaseCommand({
        ...createCase,
        caseId: "case-proof-duplicate-origin",
        commandId: "command-case-proof-duplicate-origin",
        idempotencyKey: "idempotency-case-proof-duplicate-origin",
      }),
      correlationId: "correlation-case-proof-duplicate-origin",
      requestedAt: "2026-08-31T05:04:00.000Z",
    }),
    (error: unknown) => error instanceof LeadCommercialCaseDomainError && error.code === "ORIGIN_CONFLICT",
  );

  const rollbackLead = await store.executeLeadCreate({
    actor,
    command: parseLeadCommand({
      ...leadCommand,
      commandId: "command-lead-rollback-proof-001",
      idempotencyKey: "idempotency-lead-rollback-proof-001",
      leadId: "lead-rollback-proof-001",
    }),
    correlationId: "correlation-lead-rollback-proof-001",
    requestedAt: "2026-08-31T05:04:15.000Z",
  });
  await pool.query(
    "alter table public.commercial_cases add constraint api_pc_008_force_rollback check (title <> 'Force rollback')",
  );
  try {
    await assert.rejects(
      () => store.executeCommercialCase({
        actor,
        command: parseCommercialCaseCommand({
          ...createCase,
          caseId: "case-rollback-proof-001",
          commandId: "command-case-rollback-proof-001",
          commercialCase: {
            ...createCase.commercialCase,
            sourceLeadId: "lead-rollback-proof-001",
            sourceLeadVersion: rollbackLead.readback.objectVersion,
            title: "Force rollback",
          },
          idempotencyKey: "idempotency-case-rollback-proof-001",
        }),
        correlationId: "correlation-case-rollback-proof-001",
        requestedAt: "2026-08-31T05:04:30.000Z",
      }),
    );
  } finally {
    await pool.query("alter table public.commercial_cases drop constraint api_pc_008_force_rollback");
  }

  const owner = await store.executeCommercialCase({
    actor,
    command: parseCommercialCaseCommand({
      caseId: "case-proof-001",
      commandId: "command-case-owner-proof-001",
      commandType: "commercial_case.update_owner",
      contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
      expectedObjectVersion: commercialCase.readback.objectVersion,
      idempotencyKey: "idempotency-case-owner-proof-001",
      owner: "owner-proof",
    }),
    correlationId: "correlation-case-owner-proof-001",
    requestedAt: "2026-08-31T05:05:00.000Z",
  });
  assert.equal(owner.readback.commercialCase.owner, "owner-proof");
  assert.equal(owner.readback.commercialCase.version, 2);

  const caseReplayAfterAdvance = await store.executeCommercialCase({
    actor,
    command: createCase,
    correlationId: "correlation-case-proof-replay-after-advance",
    requestedAt: "2026-08-31T05:05:30.000Z",
  });
  assert.equal(caseReplayAfterAdvance.receipt.idempotentReplay, true);
  assert.equal(caseReplayAfterAdvance.receipt.receiptId, commercialCase.receipt.receiptId);
  assert.equal(caseReplayAfterAdvance.readback.commercialCase.version, 2);
  assert.equal(caseReplayAfterAdvance.readbackMatchesReceipt, false);

  await assert.rejects(
    () => store.executeCommercialCase({
      actor,
      command: parseCommercialCaseCommand({
        caseId: "case-proof-001",
        commandId: "command-case-stale-proof-001",
        commandType: "commercial_case.update_next_action",
        contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
        expectedObjectVersion: commercialCase.readback.objectVersion,
        idempotencyKey: "idempotency-case-stale-proof-001",
        nextAction: "This stale write must not commit",
        nextActionDueAt: null,
      }),
      correlationId: "correlation-case-stale-proof-001",
      requestedAt: "2026-08-31T05:06:00.000Z",
    }),
    (error: unknown) => error instanceof LeadCommercialCaseDomainError && error.code === "VERSION_CONFLICT",
  );

  assert.equal(await store.readLead(tenantB, "lead-proof-001"), null);
  assert.equal(await store.readCommercialCase(tenantB, "case-proof-001"), null);

  process.env.LUZIONE_API_SERVICE_TOKEN = "api-pc-008-proof-service-token";
  process.env.LUZIONE_API_SERVICE_ACTOR_ID = actor.actorId;
  process.env.LUZIONE_API_SERVICE_ACTOR_TYPE = actor.actorType;
  process.env.LUZIONE_API_SERVICE_TENANT_ID = actor.tenantId;
  process.env.LUZIONE_API_SERVICE_CAPABILITIES = actor.capabilities.join(",");
  process.env.LUZIONE_API_MUTATIONS_ENABLED = "true";
  const headers = {
    authorization: "Bearer api-pc-008-proof-service-token",
    "content-type": "application/json",
    "x-correlation-id": "correlation-http-proof-0001",
  };
  process.env.LUZIONE_API_DOMAIN_COMMAND_TENANTS = tenantB.tenantId;
  const tenantGateResponse = await postLeadRoute(new Request("http://localhost/api/v1/commands/leads", {
    body: JSON.stringify({
      ...leadCommand,
      commandId: "command-lead-tenant-gate-proof-001",
      idempotencyKey: "idempotency-lead-tenant-gate-proof-001",
      leadId: "lead-tenant-gate-proof-001",
    }),
    headers,
    method: "POST",
  }));
  assert.equal(tenantGateResponse.status, 503);
  process.env.LUZIONE_API_DOMAIN_COMMAND_TENANTS = actor.tenantId;
  const routeLeadCommand = {
    ...leadCommand,
    commandId: "command-lead-http-proof-001",
    idempotencyKey: "idempotency-lead-http-proof-001",
    leadId: "lead-http-proof-001",
  };
  const leadResponse = await postLeadRoute(new Request("http://localhost/api/v1/commands/leads", {
    body: JSON.stringify(routeLeadCommand),
    headers,
    method: "POST",
  }));
  assert.equal(leadResponse.status, 201);
  const leadBody = await leadResponse.json() as {
    ok: boolean;
    result: { readback: { objectVersion: string; sourceOfTruth: string } };
  };
  assert.equal(leadBody.ok, true);
  assert.equal(leadBody.result.readback.sourceOfTruth, "crm_leads");
  assert.equal(leadResponse.headers.get("x-correlation-id"), "correlation-http-proof-0001");

  const caseResponse = await postCaseRoute(new Request("http://localhost/api/v1/commands/commercial-cases", {
    body: JSON.stringify({
      ...createCase,
      caseId: "case-http-proof-001",
      commandId: "command-case-http-proof-001",
      commercialCase: {
        ...createCase.commercialCase,
        sourceLeadId: "lead-http-proof-001",
        sourceLeadVersion: leadBody.result.readback.objectVersion,
        title: "HTTP Proof Commercial Case",
      },
      idempotencyKey: "idempotency-case-http-proof-001",
    }),
    headers,
    method: "POST",
  }));
  assert.equal(caseResponse.status, 201);
  const caseBody = await caseResponse.json() as {
    result: { readback: { commercialCase: { sourceLeadId: string } } };
  };
  assert.equal(caseBody.result.readback.commercialCase.sourceLeadId, "lead-http-proof-001");

  const readResponse = await getLeadRoute(new Request(
    "http://localhost/api/v1/commands/leads?leadId=lead-http-proof-001",
    { headers },
  ));
  assert.equal(readResponse.status, 200);
  const caseReadResponse = await getCaseRoute(new Request(
    "http://localhost/api/v1/commands/commercial-cases?caseId=case-http-proof-001",
    { headers },
  ));
  assert.equal(caseReadResponse.status, 200);

  const crossTenantResponse = await getLeadRoute(new Request(
    "http://localhost/api/v1/commands/leads?leadId=lead-http-proof-001",
    { headers: { ...headers, "x-luzione-tenant": tenantB.tenantId } },
  ));
  assert.equal(crossTenantResponse.status, 401);

  process.env.LUZIONE_API_MUTATIONS_ENABLED = "false";
  const disabledResponse = await postLeadRoute(new Request("http://localhost/api/v1/commands/leads", {
    body: JSON.stringify({
      ...routeLeadCommand,
      commandId: "command-lead-disabled-proof-001",
      idempotencyKey: "idempotency-lead-disabled-proof-001",
      leadId: "lead-disabled-proof-001",
    }),
    headers,
    method: "POST",
  }));
  assert.equal(disabledResponse.status, 503);

  const evidence = await pool.query(
    `select
       (select count(*)::int from public.crm_leads where tenant_id = $1) as leads,
       (select count(*)::int from public.commercial_cases where tenant_id = $1) as cases,
       (select count(*)::int from public.commercial_cases where tenant_id = $1 and case_id = 'case-proof-duplicate-origin') as duplicate_cases,
       (select count(*)::int from public.commercial_case_identities where tenant_id = $1 and case_id = 'case-rollback-proof-001') as rollback_identities,
       (select count(*)::int from public.p110_command_receipts where tenant_id = $1) as receipts,
       (select count(*)::int from public.p110_event_envelopes where tenant_id = $1) as events,
       (select count(*)::int from public.p110_outbox_messages where tenant_id = $1) as outbox,
       (select count(*)::int from public.p110_idempotency_conflicts where tenant_id = $1) as conflicts`,
    [actor.tenantId],
  );
  assert.deepEqual(evidence.rows[0], {
    cases: 2,
    conflicts: 1,
    duplicate_cases: 0,
    events: 6,
    leads: 3,
    outbox: 6,
    receipts: 6,
    rollback_identities: 0,
  });
  const disabled = await pool.query(
    "select count(*)::int as count from public.crm_leads where tenant_id = $1 and id = 'lead-disabled-proof-001'",
    [actor.tenantId],
  );
  assert.equal(disabled.rows[0].count, 0);
  process.stdout.write(`${JSON.stringify({
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    evidence: evidence.rows[0],
    leadReceiptId: lead.receipt.receiptId,
    caseReceiptId: commercialCase.receipt.receiptId,
    ownerReceiptId: owner.receipt.receiptId,
    result: "PASS",
  })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
