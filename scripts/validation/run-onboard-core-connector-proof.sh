#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_onboard_core_connector_${suffix}"
role="onboard_connector_proof_${suffix}"
password="onboard_connector_disposable_${suffix}"

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
apply supabase/migrations/20260905040000_onboard_core_blueprints_mandates.sql
apply supabase/migrations/20260905041000_onboard_core_import_dry_runs.sql
apply supabase/migrations/20260905050000_onboard_core_correction_01.sql
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to ${role}; grant select,insert,update,delete on all tables in schema public to ${role}" >/dev/null

NODE_PATH=scripts/validation/node-stubs \
DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" \
LUZIONE_API_SERVICE_TOKEN=proof-only \
LUZIONE_API_MUTATIONS_ENABLED=true \
LUZIONE_API_CONNECTOR_SYNC_VALIDATIONS_ENABLED=true \
LUZIONE_API_CONNECTOR_SYNC_VALIDATION_TENANTS=onboard-connector-proof-a \
LUZIONE_API_PROVIDER_SANDBOX_ENABLED=true \
LUZIONE_API_PROVIDER_SANDBOX_TENANTS=onboard-connector-proof-a \
LUZIONE_API_PROVIDER_SANDBOX_DESTINATIONS=sandbox.echo \
LUZIONE_API_EFFECT_ADMISSION_ENABLED=true \
LUZIONE_API_EFFECT_ADMISSION_BINDINGS='onboard-connector-proof-a|service:onboard-connector-proof|luzione-deterministic-simulator|sandbox.echo|credential-binding:none:sandbox-echo/v1' \
node --import tsx scripts/validation/onboard-core-connector-proof.ts

schema_delta="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname like 'onboarding_%' and relkind='r'")"
test "${schema_delta}" = "7"
echo "connector_added_schema_relations=0;onboarding_baseline_relations=${schema_delta}"
echo "cleanup=scheduled"
