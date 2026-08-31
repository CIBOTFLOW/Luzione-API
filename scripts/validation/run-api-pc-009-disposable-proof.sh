#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
run_suffix="$$"
fresh_database="luzione_api_pc_009_fresh_${run_suffix}"
observed_database="luzione_api_pc_009_observed_${run_suffix}"
proof_role="api_pc_009_proof_${run_suffix}"
proof_password="api_pc_009_disposable_${run_suffix}"

for identifier in "${fresh_database}" "${observed_database}" "${proof_role}"; do
  [[ "${identifier}" =~ ^[a-z0-9_]+$ ]] || { echo "unsafe disposable identifier" >&2; exit 2; }
done

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${fresh_database}" >/dev/null
  docker exec "${container_name}" dropdb -U postgres --if-exists "${observed_database}" >/dev/null
  docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${proof_role}" >/dev/null
}
trap cleanup EXIT

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "create role ${proof_role} login password '${proof_password}' bypassrls"
docker exec "${container_name}" createdb -U postgres "${fresh_database}"
docker exec "${container_name}" createdb -U postgres "${observed_database}"

apply() { docker exec -i "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "$1" < "$2"; }
for database in "${fresh_database}" "${observed_database}"; do
  apply "${database}" supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
  apply "${database}" supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
  apply "${database}" supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql
done
apply "${observed_database}" scripts/validation/api-pc-009-observed-ui.sql
apply "${fresh_database}" supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql
apply "${observed_database}" supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql

for database in "${fresh_database}" "${observed_database}"; do
  docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to ${proof_role}; grant select,insert,update,delete on all tables in schema public to ${proof_role}; grant usage,select on all sequences in schema public to ${proof_role}; alter table public.p110_command_receipts owner to ${proof_role}"
done

run_proof() {
  NODE_PATH=scripts/validation/node-stubs DATABASE_URL="postgres://${proof_role}:${proof_password}@127.0.0.1:${host_port}/$1" node --import tsx scripts/validation/api-pc-009-proposal-quote-approval.ts
}
echo "proof_shape=fresh"; run_proof "${fresh_database}"
echo "proof_shape=observed_ui"; run_proof "${observed_database}"
echo "cleanup=scheduled"
