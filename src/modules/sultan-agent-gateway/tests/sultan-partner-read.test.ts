import assert from "node:assert/strict";
import test from "node:test";

import type { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { LUZIONE_SULTAN_TOOL_CALL_V1, SultanAgentGatewayError, type SultanToolCall } from "@/modules/sultan-agent-gateway/contracts";
import { partnerEvidence, projectPartnerCase } from "@/modules/sultan-agent-gateway/partnerCase";
import { readPartnerCase } from "@/modules/sultan-agent-gateway/partnerCaseStore";
import { deriveSultanLogicalAgent, toolsForAgent } from "@/modules/sultan-agent-gateway/registry";
import { SultanAgentGatewayService, type AuthoritativeCaseSnapshot, type SultanAgentGatewayStore } from "@/modules/sultan-agent-gateway/service";

const ID = "8d3d18be-2c13-4e3b-9802-0a10a2456f09";
const NOW = "2026-10-29T18:01:00.000Z";
const actor = (tenantId = "luzione", capabilities = ["sultan.tool.manifest.read", "sultan.tool.invoke", "sultan.case.read"]): ApiActor => ({
  actorId: "service:sultan-os", actorType: "service", capabilities, source: "vercel-oidc", tenantId,
});
const fixture = (): Parameters<typeof projectPartnerCase>[0] => ({
  account: {
    accountId: ID, accountName: "Synthetic Design Studio", accountType: "design_firm", status: "TARGET",
    partnerIq: 77, partnerIqVersion: "v2", partnerIqConfidence: "HIGH", updatedAt: NOW,
  },
  coverage: {
    professionals: { count: 2, latestUpdatedAt: NOW },
    leads: { count: 1, latestUpdatedAt: NOW },
    opportunities: { count: 0, latestUpdatedAt: null },
  },
  observedAt: NOW,
});

function fakePool(options: { missing?: boolean; failPeople?: boolean } = {}) {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  let released = false;
  const client = {
    async query(sql: string, params: readonly unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes("from public.crm_accounts")) {
        return { rows: options.missing ? [] : [{
          account_id: ID, account_name: "Synthetic Design Studio", account_type: "design_firm",
          status: "TARGET", partner_iq: 77, partner_iq_version: "v2", partner_iq_confidence: "HIGH", updated_at: NOW,
        }] };
      }
      if (sql.includes("from public.crm_people")) {
        if (options.failPeople) throw new Error("synthetic database failure");
        return { rows: [{ total: 2, latest_at: NOW }] };
      }
      if (sql.includes("from public.crm_leads")) return { rows: [{ total: 1, latest_at: NOW }] };
      if (sql.includes("from public.crm_opportunities")) return { rows: [{ total: 0, latest_at: null }] };
      return { rows: [] };
    },
    release() { released = true; },
  };
  return { pool: { connect: async () => client } as unknown as Pool, queries, wasReleased: () => released };
}

test("partner projection is deterministic, version-bound and contains no person-level records", () => {
  const first = projectPartnerCase(fixture(), sha256);
  assert.equal(first.objectVersion, projectPartnerCase(fixture(), sha256).objectVersion);
  assert.equal(first.caseType, "PARTNER_RELATIONSHIP");
  assert.equal(first.sourceRefs.length, 4);
  assert.ok(first.sourceRefs.every((ref) => ref.includes(ID) && ref.includes(first.objectVersion)));
  assert.equal(JSON.stringify(first).includes("personId"), false);
  const modified = fixture();
  modified.coverage.leads.count = 2;
  assert.notEqual(projectPartnerCase(modified, sha256).objectVersion, first.objectVersion);
});

test("partner projection rejects malformed identity, counts and digest", () => {
  const bad = fixture();
  bad.account.accountId = "not-a-uuid";
  assert.throws(() => projectPartnerCase(bad, sha256), /IDENTITY_INVALID/);
  const invalidCount = fixture();
  invalidCount.coverage.professionals.count = -1;
  assert.throws(() => projectPartnerCase(invalidCount, sha256), /COVERAGE_INVALID/);
  assert.throws(() => projectPartnerCase(fixture(), () => "fake"), /DIGEST_INVALID/);
});

test("partner evidence flags missing IQ/lead data and denies unsupported tools", () => {
  const input = fixture();
  input.account.partnerIq = null;
  input.coverage.professionals.count = 0;
  input.coverage.leads.count = 0;
  const observed = projectPartnerCase(input, sha256);
  const result = partnerEvidence(observed, "luzione.partner_relationship.read");
  assert.equal(result.freshness, "FRESH");
  assert.ok(result.missingEvidence.includes("current Partner IQ"));
  assert.ok(result.missingEvidence.includes("linked professional or lead evidence"));
  assert.equal(partnerEvidence(observed, "luzione.note.append").freshness, "UNKNOWN");
});

test("Partner Network manifest contains only three A0 read tools", () => {
  const agent = deriveSultanLogicalAgent("PARTNER_RELATIONSHIP");
  assert.ok(agent);
  const tools = toolsForAgent(agent);
  assert.deepEqual(tools.map((tool) => tool.toolId), [
    "luzione.case_context.read", "luzione.missing_evidence.read", "luzione.partner_relationship.read",
  ]);
  assert.ok(tools.every((tool) => tool.effectClass === "A0" && tool.approvalMode === "BLOCKED"));
});

test("partner store reads one tenant-scoped repeatable-read snapshot without writes", async () => {
  const fake = fakePool();
  const result = await readPartnerCase(fake.pool, actor(), ID, () => new Date(NOW));
  assert.ok(result);
  assert.equal(result.caseType, "PARTNER_RELATIONSHIP");
  assert.equal(result.observedAt, NOW);
  assert.equal(fake.queries[0].sql.toLowerCase(), "begin transaction isolation level repeatable read read only");
  assert.ok(fake.queries.some((q) => q.sql.includes("set_config('app.tenant_id'")));
  const selects = fake.queries.filter((q) => q.sql.includes("from public."));
  assert.equal(selects.length, 4);
  assert.ok(selects.every((q) => q.sql.includes("tenant_id=$1") && q.sql.includes("account_id::text=$2")));
  assert.ok(selects.every((q) => q.params[0] === "luzione" && q.params[1] === ID));
  assert.equal(fake.queries.at(-1)?.sql, "commit");
  assert.ok(fake.wasReleased());
});

test("partner store rejects foreign workload, aliases and missing accounts", async () => {
  const fake = fakePool();
  await assert.rejects(() => readPartnerCase(fake.pool, actor("other"), ID),
    (error: unknown) => error instanceof SultanAgentGatewayError && error.code === "WORKLOAD_IDENTITY_DENIED");
  assert.equal(fake.queries.length, 0);
  assert.equal(await readPartnerCase(fake.pool, actor(), "legacy-account-alias"), null);
  assert.equal(fake.queries.length, 0);
  const absent = fakePool({ missing: true });
  assert.equal(await readPartnerCase(absent.pool, actor(), ID), null);
  assert.ok(absent.wasReleased());
  assert.equal(absent.queries.at(-1)?.sql, "commit");
});

test("partner store rolls back and releases on query failure", async () => {
  const fake = fakePool({ failPeople: true });
  await assert.rejects(() => readPartnerCase(fake.pool, actor(), ID), /synthetic database failure/);
  assert.equal(fake.queries.at(-1)?.sql, "rollback");
  assert.ok(fake.wasReleased());
});

function call(observed: AuthoritativeCaseSnapshot, expectedVersion: string | null = observed.objectVersion): SultanToolCall {
  return {
    contractVersion: LUZIONE_SULTAN_TOOL_CALL_V1,
    admissionReceiptId: "s5admit_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    operationId: "operation.partner.001", runId: "run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", toolCallId: "call_partner_001",
    toolId: "luzione.partner_relationship.read", toolVersion: "v1",
    agent: { agentId: "agent.luzione.partner-network-steward", agentVersion: "v1" },
    caseRef: { caseId: ID, caseType: "PARTNER_RELATIONSHIP", expectedVersion },
    purpose: "partner-relationship-shadow-review", arguments: {}, argumentsHash: sha256({}), contextRefs: [], controlEvidence: null,
  };
}

test("partner gateway requires exact version and Stage 5 before A0 evidence", async () => {
  const observed = projectPartnerCase(fixture(), sha256);
  let admissions = 0;
  const store = {
    async requireStage5Admission() { admissions += 1; return {} as never; },
    async readCase() { return observed; },
    async readEvidence(_actor: ApiActor, _caseRef: unknown, toolId: string, snapshot: AuthoritativeCaseSnapshot) {
      assert.equal(snapshot, observed);
      return partnerEvidence(snapshot, toolId);
    },
  } as unknown as SultanAgentGatewayStore;
  const service = new SultanAgentGatewayService(store, () => new Date(NOW));
  const ready = await service.invoke({ actor: actor(), call: call(observed) });
  assert.equal(ready.status, "READY");
  assert.equal(ready.effectClass, "A0");
  assert.equal(admissions, 1);
  const missingVersion = await service.invoke({ actor: actor(), call: call(observed, null) });
  assert.equal(missingVersion.status, "BLOCKED");
  assert.equal(missingVersion.failureCode, "EXACT_OBJECT_VERSION_REQUIRED");
  const stale = await service.invoke({ actor: actor(), call: call(observed, "partner-account:old") });
  assert.equal(stale.status, "BLOCKED");
  assert.equal(stale.failureCode, "STALE_OBJECT_VERSION");
  await assert.rejects(() => service.invoke({ actor: actor("other"), call: call(observed) }),
    (error: unknown) => error instanceof SultanAgentGatewayError && error.code === "WORKLOAD_IDENTITY_DENIED");
});
