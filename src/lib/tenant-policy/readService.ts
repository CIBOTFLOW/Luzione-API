import "server-only";

import { databasePool } from "@/lib/db";
import { parseTenantPolicySnapshot } from "@/modules/tenant-policy/parser";

export async function readActiveTenantPolicy(tenantCode: string) {
  const canonicalTenantCode = process.env.LUZIONE_CANONICAL_TENANT_CODE?.trim()
    || (tenantCode === "luzione" ? "LUZIONE_INTERNAL" : tenantCode);
  const result = await databasePool().query({
    name: "active-tenant-autonomy-policy-v1",
    text: `
      select pd.policy_definition_id, pd.tenant_id, pd.code, pd.version,
             pd.compiled_json, pd.checksum
      from public.policy_definitions pd
      left join public.tenant_accounts ta on ta.tenant_id = pd.tenant_id
      where pd.code = 'sultan.autonomy'
        and pd.status::text = 'ACTIVE'
        and (ta.code = $1 or pd.tenant_id is null)
      order by (pd.tenant_id is not null) desc, pd.version desc
      limit 1
    `,
    values: [canonicalTenantCode],
  });
  const row = result.rows[0];
  if (!row) throw new Error("No active tenant autonomy policy is configured.");
  return parseTenantPolicySnapshot(row);
}
