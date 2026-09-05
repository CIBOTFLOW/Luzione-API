#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_connector_revocation_${suffix}"
role="connector_revocation_proof_${suffix}"
password="connector_revocation_disposable_${suffix}"

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${database}" >/dev/null
  docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${role}" >/dev/null
}
trap cleanup EXIT

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='luzione_api_runtime') then create role luzione_api_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls; end if; end \$\$;"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant luzione_api_runtime to ${role}"
docker exec "${container_name}" createdb -U postgres "${database}"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "create extension if not exists pgcrypto" >/dev/null

apply() {
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "$1"
}

apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply supabase/migrations/20260831080000_provider_worker_runtime.sql
apply supabase/migrations/20260905090000_effect_admission_evidence.sql
apply supabase/migrations/20260901123000_sultan_agent_policy_envelopes.sql
apply supabase/migrations/20260901130000_sultan_agent_internal_actions.sql
apply supabase/migrations/20260902010000_sultan_stage5_authority_outcomes.sql
apply supabase/migrations/20260902010100_sultan_stage5_post_inference_receipt_constraints.sql
apply supabase/migrations/20260905120000_effect_admission_l1_correction.sql
apply supabase/migrations/20260905130000_connector_revocation_receipts.sql
apply supabase/migrations/20260905131000_effect_admission_l1_correction_02.sql

apply scripts/validation/rollback-connector-revocation-l1-g0.sql
apply scripts/validation/rollback-effect-admission-l1-correction-02.sql
reversed_objects="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select (to_regclass('public.connector_revocation_receipts') is not null)::int + (to_regprocedure('public.connector_revocation_receipts_append_only()') is not null)::int + (select count(*) from information_schema.columns where table_schema='public' and table_name='p110_reconciliation_checkpoints' and column_name in ('originating_delivery_attempt_id','originating_delivery_attempt_number'))")"
test "${reversed_objects}" = "0"
apply supabase/migrations/20260905130000_connector_revocation_receipts.sql
apply supabase/migrations/20260905131000_effect_admission_l1_correction_02.sql
reapplied_objects="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select (to_regclass('public.connector_revocation_receipts') is not null)::int + (to_regprocedure('public.connector_revocation_receipts_append_only()') is not null)::int + (select count(*) from information_schema.columns where table_schema='public' and table_name='p110_reconciliation_checkpoints' and column_name in ('originating_delivery_attempt_id','originating_delivery_attempt_number'))")"
test "${reapplied_objects}" = "4"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to luzione_api_runtime; grant select,insert,update on public.p110_command_receipts,public.p110_outbox_messages,public.p110_kill_switches,public.p110_delivery_attempts,public.p110_dead_letters,public.p110_reconciliation_checkpoints to luzione_api_runtime; grant select,insert on public.p110_event_envelopes,public.p110_idempotency_conflicts to luzione_api_runtime" >/dev/null
NODE_PATH=scripts/validation/node-stubs \
DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" \
LUZIONE_API_SERVICE_TOKEN=proof-only \
LUZIONE_API_MUTATIONS_ENABLED=true \
LUZIONE_API_CONNECTOR_REVOCATIONS_ENABLED=true \
LUZIONE_API_CONNECTOR_REVOCATION_TENANTS=tenant-proof-a \
LUZIONE_API_PROVIDER_SANDBOX_ENABLED=true \
LUZIONE_API_PROVIDER_SANDBOX_TENANTS=tenant-proof-a \
LUZIONE_API_PROVIDER_SANDBOX_DESTINATIONS=sandbox.connector-revocation \
LUZIONE_API_EFFECT_ADMISSION_ENABLED=true \
LUZIONE_API_EFFECT_ADMISSION_BINDINGS='tenant-proof-a|service:proof|luzione-connector-revocation-emulator|sandbox.connector-revocation|credential-binding:none:connector-revocation-emulator/v1' \
node --import tsx scripts/validation/connector-revocation-postgres-proof.ts

echo "rollback_objects=${reversed_objects}"
echo "reapplied_objects=${reapplied_objects}"
echo "cleanup=scheduled"
