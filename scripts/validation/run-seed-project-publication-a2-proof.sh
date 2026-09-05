#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_seed_project_${suffix}"
role="seed_project_proof_${suffix}"
password="seed_project_disposable_${suffix}"

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${database}" >/dev/null
  docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${role}" >/dev/null
}
trap cleanup EXIT

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='luzione_api_runtime') then create role luzione_api_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls; end if; end \$\$;"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant luzione_api_runtime to ${role}"
docker exec "${container_name}" createdb -U postgres "${database}"

apply() {
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "$1"
}

apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply scripts/validation/seed-project-publication-a2-proof-fixture.sql
apply supabase/migrations/20260905083212_seed_project_publication_a2.sql

apply scripts/validation/rollback-seed-project-publication-a2.sql
reversed_objects="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'seed_%'")"
test "${reversed_objects}" = "0"
apply supabase/migrations/20260905083212_seed_project_publication_a2.sql

rls_tables="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('seed_projects','seed_project_packages','seed_spaces','seed_specifications','seed_specification_lines','seed_specification_revisions') and relrowsecurity and relforcerowsecurity")"
policy_roles="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_policies where schemaname='public' and tablename like 'seed_%' and roles='{luzione_api_runtime}'")"
runtime_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name like 'seed_%' and privilege_type in ('SELECT','INSERT')")"
unsafe_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name like 'seed_%' and privilege_type in ('UPDATE','DELETE','TRUNCATE')")"
public_function_execute="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.seed_project_publication_reject_mutation()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')::int")"
test "${rls_tables}" = "6"
test "${policy_roles}" = "6"
test "${runtime_grants}" = "12"
test "${unsafe_grants}" = "0"
test "${public_function_execute}" = "0"

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to luzione_api_runtime; grant select,insert,update on public.p110_command_receipts,public.p110_outbox_messages to luzione_api_runtime; grant select,insert on public.p110_event_envelopes,public.p110_idempotency_conflicts to luzione_api_runtime" >/dev/null

NODE_PATH=scripts/validation/node-stubs \
DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" \
node --import tsx scripts/validation/seed-project-publication-a2-postgres-proof.ts

rollback_guarded=0
if apply scripts/validation/rollback-seed-project-publication-a2.sql; then
  echo "rollback unexpectedly removed admitted A2 data" >&2
  exit 1
else
  rollback_guarded=1
fi
test "${rollback_guarded}" = "1"

echo "rollback_objects=${reversed_objects}"
echo "forced_rls_tables=${rls_tables}"
echo "explicit_runtime_policies=${policy_roles}"
echo "runtime_select_insert_grants=${runtime_grants}"
echo "unsafe_runtime_grants=${unsafe_grants}"
echo "public_trigger_function_execute=${public_function_execute}"
echo "admitted_data_rollback_guard=${rollback_guarded}"
echo "cleanup=scheduled"
