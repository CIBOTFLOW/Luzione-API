#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_api_pc_012_context_${suffix}"
proof_role="api_pc_012_context_${suffix}"
password="api_pc_012_disposable_${suffix}"

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${database}" >/dev/null
  docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${proof_role}" >/dev/null
}
trap cleanup EXIT

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end \$\$; create role ${proof_role} login password '${password}' nobypassrls"
docker exec "${container_name}" createdb -U postgres "${database}"

apply() {
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "$1"
}

apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql
apply supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql
apply supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
apply supabase/migrations/20260831080000_provider_worker_runtime.sql
apply supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
apply scripts/validation/api-pc-012-canonical-context-fixture.sql

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant luzione_api_runtime to ${proof_role}; grant usage on schema public to ${proof_role}; grant select on all tables in schema public to ${proof_role}" >/dev/null

NODE_PATH=scripts/validation/node-stubs \
DATABASE_URL="postgres://${proof_role}:${password}@127.0.0.1:${host_port}/${database}" \
node --import tsx scripts/validation/api-pc-012-canonical-context.ts

echo "cleanup=scheduled"
