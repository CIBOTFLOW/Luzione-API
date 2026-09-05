#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_effect_admission_${suffix}"
role="effect_admission_proof_${suffix}"
password="effect_admission_disposable_${suffix}"

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${database}" >/dev/null
  docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${role}" >/dev/null
}
trap cleanup EXIT

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "create role ${role} login password '${password}' bypassrls"
docker exec "${container_name}" createdb -U postgres "${database}"

apply() {
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "$1"
}

apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply supabase/migrations/20260831080000_provider_worker_runtime.sql
apply supabase/migrations/20260905090000_effect_admission_evidence.sql
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to ${role}; grant select on public.p110_delivery_attempts to ${role}; grant select,insert,update,delete on public.p110_kill_switches to ${role}" >/dev/null

NODE_PATH=scripts/validation/node-stubs \
DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" \
node --import tsx scripts/validation/effect-admission-postgres-proof.ts

apply scripts/validation/rollback-effect-admission-evidence.sql
reversed_columns="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.columns where table_schema='public' and table_name='p110_delivery_attempts' and column_name like 'effect_admission_%' or table_schema='public' and table_name='p110_delivery_attempts' and column_name='credential_binding_id'")"
test "${reversed_columns}" = "0"
apply supabase/migrations/20260905090000_effect_admission_evidence.sql
restored_columns="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.columns where table_schema='public' and table_name='p110_delivery_attempts' and (column_name like 'effect_admission_%' or column_name='credential_binding_id')")"
test "${restored_columns}" = "5"
echo "rollback_columns=${reversed_columns}"
echo "reapplied_columns=${restored_columns}"
echo "cleanup=scheduled"
