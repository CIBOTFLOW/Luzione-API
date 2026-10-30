// Only invoked by the server-only PostgresSultanAgentGatewayStore.
// Keep this dependency-injected module importable by offline regression tests.

import type { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { SultanAgentGatewayError } from "@/modules/sultan-agent-gateway/contracts";
import { projectPartnerCase, type PartnerRelationshipCoverage } from "@/modules/sultan-agent-gateway/partnerCase";
import type { AuthoritativeCaseSnapshot } from "@/modules/sultan-agent-gateway/service";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type CountRow = { total: number | string; latest_at: Date | string | null };
type AccountRow = {
  account_id: string;
  id: string;
  account_name: string;
  account_type: string;
  status: string | null;
  partner_iq: number | string | null;
  partner_iq_version: string | null;
  partner_iq_confidence: string | null;
  updated_at: Date | string;
};

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("PARTNER_SOURCE_TIMESTAMP_INVALID");
  return date.toISOString();
}

function count(row: CountRow | undefined): PartnerRelationshipCoverage["leads"] {
  if (!row) throw new Error("PARTNER_RELATIONSHIP_COUNT_MISSING");
  const total = Number(row.total);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("PARTNER_RELATIONSHIP_COUNT_INVALID");
  return { count: total, latestUpdatedAt: iso(row.latest_at) };
}

// Canonical UUID-only case IDs avoid ambiguous legacy crm_accounts.id aliases.
// All four projections are read in one tenant-bound REPEATABLE READ READ ONLY transaction.
export async function readPartnerCase(
  pool: Pool,
  actor: ApiActor,
  caseId: string,
  now: () => Date = () => new Date(),
): Promise<AuthoritativeCaseSnapshot | null> {
  if (actor.tenantId !== "luzione" || actor.actorId !== "service:sultan-os" || actor.actorType !== "service") {
    throw new SultanAgentGatewayError("WORKLOAD_IDENTITY_DENIED", "Partner case reads require the exact Sultan workload.", 403);
  }
  if (!CANONICAL_UUID.test(caseId)) return null;
  const client = await pool.connect();
  try {
    await client.query("begin transaction isolation level repeatable read read only");
    await client.query("select set_config('app.tenant_id',$1,true)", [actor.tenantId]);
    const account = await client.query<AccountRow>(
      `select account_id::text as account_id,id,account_name,account_type,status,
              partner_iq,partner_iq_version,partner_iq_confidence,updated_at
         from public.crm_accounts
        where tenant_id=$1 and account_id=$2::uuid
        limit 1`,
      [actor.tenantId, caseId],
    );
    const row = account.rows[0];
    if (!row || row.account_id !== caseId) {
      await client.query("commit");
      return null;
    }
    // CRM legacy writers may link people/leads to crm_accounts.id instead of account_id.
    // Resolve that alias only after the canonical account is tenant-verified.
    const params = [actor.tenantId, caseId, row.id];
    const professionals = await client.query<CountRow>(
      `select count(*)::int as total,max(updated_at) as latest_at
         from public.crm_people where tenant_id=$1 and account_id::text in ($2,$3)`, params,
    );
    const leads = await client.query<CountRow>(
      `select count(*)::int as total,max(updated_at) as latest_at
         from public.crm_leads where tenant_id=$1 and account_id::text in ($2,$3)`, params,
    );
    const opportunities = await client.query<CountRow>(
      `select count(*)::int as total,max(updated_at) as latest_at
         from public.crm_opportunities where tenant_id=$1 and account_id::text in ($2,$3)`, params,
    );
    const result = projectPartnerCase({
      account: {
        accountId: row.account_id,
        accountName: row.account_name,
        accountType: row.account_type,
        status: row.status,
        partnerIq: row.partner_iq === null ? null : Number(row.partner_iq),
        partnerIqVersion: row.partner_iq_version,
        partnerIqConfidence: row.partner_iq_confidence,
        updatedAt: iso(row.updated_at) ?? "",
      },
      coverage: {
        professionals: count(professionals.rows[0]),
        leads: count(leads.rows[0]),
        opportunities: count(opportunities.rows[0]),
      },
      observedAt: now().toISOString(),
    }, sha256);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
