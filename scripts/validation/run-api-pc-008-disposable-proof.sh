#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
run_suffix="$$"
fresh_database="luzione_api_pc_008_fresh_${run_suffix}"
legacy_database="luzione_api_pc_008_legacy_${run_suffix}"
proof_role="api_pc_008_proof_${run_suffix}"
proof_password="api_pc_008_disposable_${run_suffix}"

for identifier in "${fresh_database}" "${legacy_database}" "${proof_role}"; do
  if [[ ! "${identifier}" =~ ^[a-z0-9_]+$ ]]; then
    echo "refusing unsafe disposable identifier: ${identifier}" >&2
    exit 2
  fi
done

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${fresh_database}" >/dev/null
  docker exec "${container_name}" dropdb -U postgres --if-exists "${legacy_database}" >/dev/null
  docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${proof_role}" >/dev/null
}
trap cleanup EXIT

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "create role ${proof_role} login password '${proof_password}' bypassrls"
docker exec "${container_name}" createdb -U postgres "${fresh_database}"
docker exec "${container_name}" createdb -U postgres "${legacy_database}"

apply_migration() {
  local database="$1"
  local migration="$2"
  docker exec -i "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "${migration}"
}

apply_migration "${fresh_database}" supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply_migration "${fresh_database}" supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply_migration "${fresh_database}" supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql

apply_migration "${legacy_database}" scripts/validation/api-pc-008-observed-legacy.sql
apply_migration "${legacy_database}" supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply_migration "${legacy_database}" supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply_migration "${legacy_database}" supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql

grant_proof_access() {
  local database="$1"
  docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c \
    "grant usage on schema public to ${proof_role};
     grant select, insert, update, delete on all tables in schema public to ${proof_role};
     grant usage, select on all sequences in schema public to ${proof_role};
     alter table public.commercial_cases owner to ${proof_role}"
}

grant_proof_access "${fresh_database}"
grant_proof_access "${legacy_database}"

run_proof() {
  local database="$1"
  NODE_PATH=scripts/validation/node-stubs \
    DATABASE_URL="postgres://${proof_role}:${proof_password}@127.0.0.1:${host_port}/${database}" \
    node --import tsx scripts/validation/api-pc-008-lead-commercial-case.ts
}

echo "proof_shape=fresh"
run_proof "${fresh_database}"
echo "proof_shape=observed_ui_legacy"
run_proof "${legacy_database}"
echo "cleanup=scheduled"
