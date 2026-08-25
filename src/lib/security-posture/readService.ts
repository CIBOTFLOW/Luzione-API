import "server-only";

import { databasePool } from "@/lib/db";
import {
  ACTIVE_DENIAL_PROBES,
  SENSITIVE_SERVER_ONLY_TABLES,
  evaluateRlsPosture,
  probeDeniedRead,
  type RlsPostureRow,
  type RlsProbeResult,
} from "@/modules/security-posture/rlsPosture";

export async function readRlsReadiness(options: { activeProbes?: boolean } = {}) {
  const client = await databasePool().connect();
  try {
    const tableResult = await client.query<RlsPostureRow>(
      `select c.relname as table_name,
              c.relrowsecurity as rls_enabled,
              has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_access,
              has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as authenticated_access,
              has_table_privilege('service_role', c.oid, 'SELECT') as service_role_select,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policy_count
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and c.relname = any($1::text[])
        order by c.relname`,
      [SENSITIVE_SERVER_ONLY_TABLES],
    );
    const defaultResult = await client.query<{ client_default_privileges: boolean }>(
      `select exists (
         select 1
           from pg_default_acl d
           join pg_namespace n on n.oid = d.defaclnamespace
           cross join lateral aclexplode(d.defaclacl) privilege
          where d.defaclrole = 'postgres'::regrole
            and n.nspname = 'public'
            and d.defaclobjtype = 'r'
            and privilege.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
       ) as client_default_privileges`,
    );
    const probes: RlsProbeResult[] = [];
    if (options.activeProbes) {
      for (const probe of ACTIVE_DENIAL_PROBES) probes.push(await probeDeniedRead(client, probe));
    }
    return {
      ...evaluateRlsPosture({
        clientDefaultPrivileges: Boolean(defaultResult.rows[0]?.client_default_privileges),
        probes,
        rows: tableResult.rows,
      }),
      observedAt: new Date().toISOString(),
      source: "canonical-postgres-catalog",
    };
  } finally {
    client.release();
  }
}
