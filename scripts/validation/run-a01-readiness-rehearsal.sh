#!/usr/bin/env bash
set -euo pipefail

suffix="$$"
container_name="luzione_a01_postgres_${suffix}"
database_name="luzione_a01_${suffix}"
proof_role="luzione_a01_proof_${suffix}"
password="luzione_a01_disposable_${suffix}"
temporary_directory="$(mktemp -d)"
baseline_dump="${temporary_directory}/pre_migration.dump"

cleanup() {
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT

docker run --detach --rm --name "${container_name}" \
  --env POSTGRES_PASSWORD=postgres \
  --publish 127.0.0.1::5432 \
  postgres:16 >/dev/null

for attempt in $(seq 1 30); do
  if docker exec "${container_name}" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  if [ "${attempt}" -eq 30 ]; then
    echo "A01 disposable Postgres did not become ready." >&2
    exit 1
  fi
  sleep 1
done

host_port="$(docker port "${container_name}" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
docker exec "${container_name}" createdb -U postgres "${database_name}"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "create role anon nologin; create role authenticated nologin; create role service_role nologin; create role ${proof_role} login password '${password}' bypassrls; grant anon, authenticated, service_role to ${proof_role};" >/dev/null

apply() {
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" < "$1"
}

apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply scripts/validation/api-pc-008-observed-legacy.sql
apply scripts/validation/api-pc-009-observed-ui.sql
apply scripts/validation/api-pc-011-observed-worker.sql
apply supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql
apply supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql
apply supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
apply supabase/migrations/20260831080000_provider_worker_runtime.sql
apply scripts/validation/a01-observed-security-baseline.sql

connection_url="postgres://${proof_role}:${password}@127.0.0.1:${host_port}/${database_name}"
echo "proof_stage=observed_production_drift"
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PRODUCTION_DRIFT \
  NODE_PATH=scripts/validation/node-stubs node --import tsx scripts/validation/a01-readiness-preflight.ts

docker exec "${container_name}" pg_dump -Fc -U postgres -d "${database_name}" > "${baseline_dump}"

apply supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
apply supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
apply supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" -c \
  "grant usage on schema public to ${proof_role}; grant select,insert,update,delete on all tables in schema public to ${proof_role}; grant luzione_api_runtime, luzione_provider_worker to ${proof_role};" >/dev/null

echo "proof_stage=candidate_40_of_40"
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PASS \
  NODE_PATH=scripts/validation/node-stubs node --import tsx scripts/validation/a01-readiness-preflight.ts
DATABASE_URL="${connection_url}" PROOF_SHAPE=observed_upgrade \
  node --import tsx scripts/validation/api-pc-013-security-rls.ts

echo "proof_stage=rollback_restore"
docker exec "${container_name}" dropdb -U postgres "${database_name}"
docker exec "${container_name}" createdb -U postgres "${database_name}"
docker exec -i "${container_name}" pg_restore -U postgres -d "${database_name}" < "${baseline_dump}"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "revoke luzione_api_runtime, luzione_provider_worker from ${proof_role}; drop role luzione_api_runtime; drop role luzione_provider_worker;" >/dev/null
DATABASE_URL="${connection_url}" A01_EXPECTED_POSTURE=PRODUCTION_DRIFT \
  NODE_PATH=scripts/validation/node-stubs node --import tsx scripts/validation/a01-readiness-preflight.ts

echo "a01_rehearsal=PASS"
