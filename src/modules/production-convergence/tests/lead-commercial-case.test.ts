import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { domainCommandsEnabledForTenant } from "@/lib/api/config";
import {
  LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
  LeadCommercialCaseContractError,
  parseCommercialCaseCommand,
  parseLeadCommand,
} from "@/modules/lead-commercial-case/contracts";

function leadCommand() {
  return {
    commandId: "command-lead-001",
    commandType: "lead.create",
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    expectedObjectVersion: "ABSENT",
    idempotencyKey: "idempotency-lead-001",
    lead: {
      accountId: null,
      assignedOwnerId: "operator-1",
      contactId: null,
      leadSource: "operator",
      recommendedNextAction: "Qualify",
      stage: "new",
      status: "active",
      vertical: "design",
    },
    leadId: "lead-001",
  };
}

function caseCreate() {
  return {
    caseId: "case-001",
    commandId: "command-case-001",
    commandType: "commercial_case.create",
    commercialCase: {
      accountId: null,
      accountName: "Example account",
      amount: 2500,
      contactName: null,
      primaryContactId: null,
      sourceLeadId: "lead-001",
      sourceLeadVersion: "crm-lead:lead-001@2026-08-31T05:00:00.000Z",
      title: "Example case",
    },
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    expectedObjectVersion: "ABSENT",
    idempotencyKey: "idempotency-case-001",
  };
}

test("lead and commercial-case contracts parse bounded dark-path commands", () => {
  const lead = parseLeadCommand(leadCommand());
  assert.equal(lead.commandType, "lead.create");
  assert.equal(lead.expectedObjectVersion, "ABSENT");

  const create = parseCommercialCaseCommand(caseCreate());
  assert.equal(create.commandType, "commercial_case.create");
  if (create.commandType === "commercial_case.create") {
    assert.equal(create.commercialCase.sourceLeadId, "lead-001");
  }

  const owner = parseCommercialCaseCommand({
    caseId: "case-001",
    commandId: "command-case-owner-001",
    commandType: "commercial_case.update_owner",
    contractVersion: LEAD_COMMERCIAL_CASE_CONTRACT_VERSION,
    expectedObjectVersion: "commercial-case:case-001:v1",
    idempotencyKey: "idempotency-case-owner-001",
    owner: "operator-2",
  });
  assert.equal(owner.commandType, "commercial_case.update_owner");
});

test("contracts reject actor/tenant authority smuggling and unsafe versions", () => {
  assert.throws(
    () => parseLeadCommand({ ...leadCommand(), tenantId: "forged" }),
    (error: unknown) => error instanceof LeadCommercialCaseContractError && error.code === "AUTHORITY_FORGED",
  );
  assert.throws(
    () => parseLeadCommand({ ...leadCommand(), expectedObjectVersion: "crm-lead:existing" }),
    (error: unknown) => error instanceof LeadCommercialCaseContractError && error.code === "VERSION_CONFLICT",
  );
  assert.throws(
    () => parseCommercialCaseCommand({ ...caseCreate(), contractVersion: "future" }),
    (error: unknown) => error instanceof LeadCommercialCaseContractError && error.code === "UNSUPPORTED_CONTRACT_VERSION",
  );
});

test("migration converges observed legacy rows additively without a second truth table", () => {
  const migration = readFileSync(
    "supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql",
    "utf8",
  );
  assert.match(migration, /create table if not exists public\.crm_leads/);
  assert.match(migration, /create table if not exists public\.commercial_case_identities/);
  assert.match(migration, /create table if not exists public\.commercial_cases/);
  assert.match(migration, /add column if not exists source_lead_id/);
  assert.match(migration, /add column if not exists relationship_integrity_state/);
  assert.match(migration, /account_id uuid/);
  assert.match(migration, /opportunity_id uuid/);
  assert.match(migration, /relationship_integrity_state = 'legacy_unverified'/);
  assert.match(migration, /relationship_integrity_state = 'verified'[\s\S]*opportunity_id is not null/);
  assert.doesNotMatch(migration, /'VERIFIED'|'UNVERIFIED'|'RECONCILIATION_REQUIRED'/);
  assert.match(migration, /UI_LEGACY_WRITER|active UI writer retirement|default-off/i);
  assert.doesNotMatch(migration, /drop table|truncate|delete from/);
  assert.doesNotMatch(migration, /api_leads|api_commercial_cases/);
  const proofHarness = readFileSync(
    "scripts/validation/run-api-pc-008-disposable-proof.sh",
    "utf8",
  );
  assert.match(proofHarness, /proof_shape=fresh/);
  assert.match(proofHarness, /proof_shape=observed_ui_legacy/);
  assert.match(proofHarness, /trap cleanup EXIT/);
});

test("store uses P110 atomic evidence and same-row tenant/version readback", () => {
  const store = readFileSync("src/modules/lead-commercial-case/store.ts", "utf8");
  assert.match(store, /LifecycleCommandKernel/);
  assert.match(store, /PostgresAtomicCommandStore/);
  assert.match(store, /insert into public\.crm_leads/);
  assert.match(store, /insert into public\.commercial_case_identities/);
  assert.match(store, /insert into public\.commercial_cases/);
  assert.match(store, /where tenant_id = \$1 and id = \$2/);
  assert.match(store, /where tenant_id = \$1 and case_id = \$2/);
  assert.match(store, /for update/i);
  assert.match(store, /sourceLeadVersion/);
  assert.match(store, /to_char\(updated_at at time zone 'UTC'/);
  assert.match(store, /READBACK_UNCONFIRMED[\s\S]*receiptId: receipt\.receiptId[\s\S]*retry: "RECONCILE_FIRST"/);
  assert.doesNotMatch(store, /insert into public\.commercial_case_(create|command)_receipts/);
});

test("HTTP entrypoints are authenticated, capability-bound and default-off", () => {
  const leads = readFileSync("src/app/api/v1/commands/leads/route.ts", "utf8");
  const cases = readFileSync("src/app/api/v1/commands/commercial-cases/route.ts", "utf8");
  for (const route of [leads, cases]) {
    assert.match(route, /createRequestIdentity\(request\.headers\)/);
    assert.match(route, /requireServiceActor\(request\.headers/);
    assert.match(route, /if \(!domainCommandsEnabledForTenant\(actor\.tenantId\)\)/);
    assert.match(route, /DOMAIN_MUTATIONS_DISABLED/);
    assert.doesNotMatch(route, /tenantId\s*:\s*(body|command)\./);
    assert.doesNotMatch(route, /actorId\s*:\s*(body|command)\./);
  }
  assert.match(leads, /"lead\.command"/);
  assert.match(cases, /"commercial_case\.command"/);
});

test("domain command activation requires the global switch and an exact tenant allowlist match", () => {
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    enabled: process.env.LUZIONE_API_MUTATIONS_ENABLED,
    serviceToken: process.env.LUZIONE_API_SERVICE_TOKEN,
    tenants: process.env.LUZIONE_API_DOMAIN_COMMAND_TENANTS,
  };
  try {
    process.env.DATABASE_URL = "postgres://configured.invalid/luzione";
    process.env.LUZIONE_API_SERVICE_TOKEN = "configured-for-test";
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "true";
    process.env.LUZIONE_API_DOMAIN_COMMAND_TENANTS = "tenant-a, tenant-b";
    assert.equal(domainCommandsEnabledForTenant("tenant-a"), true);
    assert.equal(domainCommandsEnabledForTenant("tenant-b"), true);
    assert.equal(domainCommandsEnabledForTenant("tenant"), false);
    assert.equal(domainCommandsEnabledForTenant("tenant-c"), false);
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "false";
    assert.equal(domainCommandsEnabledForTenant("tenant-a"), false);
  } finally {
    for (const [key, value] of Object.entries({
      DATABASE_URL: previous.databaseUrl,
      LUZIONE_API_DOMAIN_COMMAND_TENANTS: previous.tenants,
      LUZIONE_API_MUTATIONS_ENABLED: previous.enabled,
      LUZIONE_API_SERVICE_TOKEN: previous.serviceToken,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
