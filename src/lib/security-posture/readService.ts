import "server-only";

import { databasePool } from "@/lib/db";
import {
  ACTIVE_DENIAL_PROBES,
  EXPECTED_RLS_TABLES,
  FORCED_TENANT_RLS_TABLES,
  evaluateRlsPosture,
  probeDeniedRead,
  type GlobalClientExposureRow,
  type RoleTablePostureRow,
  type RlsPostureRow,
  type RlsProbeResult,
} from "@/modules/security-posture/rlsPosture";

export async function readRlsReadiness(options: { activeProbes?: boolean } = {}) {
  const client = await databasePool().connect();
  try {
    const tableResult = await client.query<RlsPostureRow>(
      `select c.relname as table_name,
              c.relrowsecurity as rls_enabled,
              c.relforcerowsecurity as rls_forced,
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
      [EXPECTED_RLS_TABLES],
    );
    const roleResult = await client.query<RoleTablePostureRow>(
      `with expected_roles(role_name) as (
         values ('luzione_api_runtime'::text), ('luzione_provider_worker'::text)
       )
       select expected.role_name,
              role.oid is not null as role_exists,
              role.rolsuper as superuser,
              role.rolcreatedb as create_db,
              role.rolcreaterole as create_role,
              role.rolcanlogin as can_login,
              role.rolreplication as replication,
              role.rolbypassrls as bypass_rls,
              relation.relname as table_name,
              coalesce(relation.relowner = role.oid, false) as owns_table,
              case when role.oid is null then null else has_table_privilege(role.rolname, relation.oid, 'SELECT') end as select_access,
              case when role.oid is null then null else has_table_privilege(role.rolname, relation.oid, 'INSERT') end as insert_access,
              case when role.oid is null then null else has_table_privilege(role.rolname, relation.oid, 'UPDATE') end as update_access,
              case when role.oid is null then null else has_table_privilege(role.rolname, relation.oid, 'DELETE') end as delete_access,
              case when role.oid is null then null else has_table_privilege(role.rolname, relation.oid, 'TRUNCATE') end as truncate_access,
              case when role.oid is null then null else has_table_privilege(role.rolname, relation.oid, 'TRIGGER') end as trigger_access
         from expected_roles expected
         left join pg_roles role on role.rolname = expected.role_name
        cross join pg_class relation
         join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          and relation.relname = any($1::text[])
        order by expected.role_name, relation.relname`,
      [FORCED_TENANT_RLS_TABLES],
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
    const globalExposureResult = await client.query<GlobalClientExposureRow>(
      `select count(*)::int as public_table_count,
              count(*) filter (where not c.relrowsecurity)::int as rls_disabled_table_count,
              count(*) filter (
                where not c.relrowsecurity
                  and (
                    has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                    or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                  )
              )::int as rls_disabled_client_accessible_count,
              count(*) filter (
                where not c.relrowsecurity
                  and (
                    has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE')
                    or has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE')
                  )
              )::int as rls_disabled_client_writable_count
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')`,
    );
    const probes: RlsProbeResult[] = [];
    if (options.activeProbes) {
      for (const probe of ACTIVE_DENIAL_PROBES) probes.push(await probeDeniedRead(client, probe));
    }
    return {
      ...evaluateRlsPosture({
        clientDefaultPrivileges: Boolean(defaultResult.rows[0]?.client_default_privileges),
        expectedTables: EXPECTED_RLS_TABLES,
        forceRlsTables: FORCED_TENANT_RLS_TABLES,
        globalExposure: globalExposureResult.rows[0] ?? {
          public_table_count: 0,
          rls_disabled_client_accessible_count: 0,
          rls_disabled_client_writable_count: 0,
          rls_disabled_table_count: 0,
        },
        probes,
        roleRows: roleResult.rows,
        rows: tableResult.rows,
      }),
      observedAt: new Date().toISOString(),
      source: "canonical-postgres-catalog",
    };
  } finally {
    client.release();
  }
}
