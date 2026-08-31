#!/usr/bin/env bash
set -euo pipefail
container_name="${1:-luzione_postgres}"; host_port="${2:-5432}"; suffix="$$"
fresh="luzione_api_pc_013_fresh_${suffix}"; observed="luzione_api_pc_013_observed_${suffix}"
proof_role="api_pc_013_proof_${suffix}"; password="api_pc_013_disposable_${suffix}"
cleanup(){ docker exec "${container_name}" dropdb -U postgres --if-exists "${fresh}" >/dev/null; docker exec "${container_name}" dropdb -U postgres --if-exists "${observed}" >/dev/null; docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${proof_role}" >/dev/null; }; trap cleanup EXIT
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end \$\$; create role ${proof_role} login password '${password}' bypassrls; grant anon, authenticated, service_role to ${proof_role};"
docker exec "${container_name}" createdb -U postgres "${fresh}"; docker exec "${container_name}" createdb -U postgres "${observed}"
apply(){ docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "$1" < "$2"; }
for db in "${fresh}" "${observed}"; do apply "$db" supabase/migrations/20260831022000_p110_command_ledger_baseline.sql; apply "$db" supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql; done
apply "${observed}" scripts/validation/api-pc-008-observed-legacy.sql
apply "${observed}" scripts/validation/api-pc-009-observed-ui.sql
apply "${observed}" scripts/validation/api-pc-011-observed-worker.sql
for db in "${fresh}" "${observed}"; do
  apply "$db" supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql
  apply "$db" supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql
  apply "$db" supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
  apply "$db" supabase/migrations/20260831080000_provider_worker_runtime.sql
  apply "$db" supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
  apply "$db" supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
  docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "$db" -c "grant usage on schema public to ${proof_role}; grant select,insert,update,delete on all tables in schema public to ${proof_role}; grant luzione_api_runtime, luzione_provider_worker to ${proof_role};" >/dev/null
done
run(){ DATABASE_URL="postgres://${proof_role}:${password}@127.0.0.1:${host_port}/$1" PROOF_SHAPE="$2" node --import tsx scripts/validation/api-pc-013-security-rls.ts; }
echo "proof_shape=fresh"; run "${fresh}" fresh
echo "proof_shape=observed_upgrade"; run "${observed}" observed_upgrade
echo "cleanup=scheduled"
