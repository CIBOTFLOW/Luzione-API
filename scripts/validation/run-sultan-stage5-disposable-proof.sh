#!/usr/bin/env bash
set -euo pipefail

suffix="$$"
container_name="luzione_stage5_postgres_${suffix}"
primary_database="luzione_stage5_primary_${suffix}"
recovered_database="luzione_stage5_recovered_${suffix}"
proof_role="luzione_stage5_proof_${suffix}"
proof_password="luzione_stage5_disposable_${suffix}"
temporary_directory="$(mktemp -d)"
pre_stage5_dump="${temporary_directory}/pre_stage5.dump"

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
    echo "Sultan Stage 5 disposable Postgres did not become ready." >&2
    exit 1
  fi
  sleep 1
done

host_port="$(docker port "${container_name}" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "create role anon nologin; create role authenticated nologin; create role service_role nologin; create role ${proof_role} login password '${proof_password}' inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant anon, authenticated, service_role to ${proof_role};" >/dev/null

apply() {
  local database_name="$1"
  local path="$2"
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database_name}" < "${path}"
}

apply_pre_stage5_migrations() {
  local database_name="$1"
  apply "${database_name}" supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql
  apply "${database_name}" supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql
  apply "${database_name}" supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
  apply "${database_name}" supabase/migrations/20260831080000_provider_worker_runtime.sql
  apply "${database_name}" supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
  apply "${database_name}" supabase/migrations/20260901123000_sultan_agent_policy_envelopes.sql
  apply "${database_name}" supabase/migrations/20260901130000_sultan_agent_internal_actions.sql
}

run_stage5_proof() {
  local database_name="$1"
  local proof_shape="$2"
  apply "${database_name}" supabase/migrations/20260902010000_sultan_stage5_authority_outcomes.sql
  apply "${database_name}" supabase/migrations/20260902010100_sultan_stage5_post_inference_receipt_constraints.sql
  apply "${database_name}" scripts/validation/sultan-stage5-canonical-fixture.sql
  docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
    "grant luzione_api_runtime to ${proof_role};" >/dev/null
  local connection_url="postgres://${proof_role}:${proof_password}@127.0.0.1:${host_port}/${database_name}"
  echo "proof_stage=${proof_shape}"
  DATABASE_URL="${connection_url}" NODE_PATH=scripts/validation/node-stubs \
    node --import tsx scripts/validation/sultan-stage5-rehearsal.ts
}

docker exec "${container_name}" createdb -U postgres "${primary_database}"
apply "${primary_database}" supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply "${primary_database}" supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply "${primary_database}" scripts/validation/api-pc-008-observed-legacy.sql
apply "${primary_database}" scripts/validation/api-pc-009-observed-ui.sql
apply "${primary_database}" scripts/validation/api-pc-011-observed-worker.sql
apply_pre_stage5_migrations "${primary_database}"

docker exec "${container_name}" pg_dump -Fc -U postgres -d "${primary_database}" > "${pre_stage5_dump}"
run_stage5_proof "${primary_database}" "fresh_forward_migration"

docker exec "${container_name}" createdb -U postgres "${recovered_database}"
docker exec -i "${container_name}" pg_restore -U postgres -d "${recovered_database}" < "${pre_stage5_dump}"
stage5_before_forward="$(docker exec "${container_name}" psql -At -U postgres -d "${recovered_database}" -c "select to_regclass('public.sultan_api_admission_receipts') is null")"
test "${stage5_before_forward}" = "t"
echo "proof_stage=pre_stage5_restore_verified"
run_stage5_proof "${recovered_database}" "restore_then_forward_recovery"

migration_checksums="$(sha256sum \
  supabase/migrations/20260902010000_sultan_stage5_authority_outcomes.sql \
  supabase/migrations/20260902010100_sultan_stage5_post_inference_receipt_constraints.sql)"
echo "sultan_stage5_migration_checksums=${migration_checksums}"
echo "sultan_stage5_disposable_rehearsal=PASS"
