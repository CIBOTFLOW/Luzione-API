#!/usr/bin/env bash
set -euo pipefail
container_name="${1:-luzione_postgres}"; host_port="${2:-5432}"; suffix="$$"
fresh="luzione_api_pc_011_fresh_${suffix}"; observed="luzione_api_pc_011_observed_${suffix}"; role="api_pc_011_proof_${suffix}"; password="api_pc_011_disposable_${suffix}"
cleanup(){ docker exec "${container_name}" dropdb -U postgres --if-exists "${fresh}" >/dev/null; docker exec "${container_name}" dropdb -U postgres --if-exists "${observed}" >/dev/null; docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${role}" >/dev/null; }; trap cleanup EXIT
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "create role ${role} login password '${password}' bypassrls"
docker exec "${container_name}" createdb -U postgres "${fresh}"; docker exec "${container_name}" createdb -U postgres "${observed}"
apply(){ docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "$1" < "$2"; }
for db in "${fresh}" "${observed}"; do apply "$db" supabase/migrations/20260831022000_p110_command_ledger_baseline.sql; apply "$db" supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql; done
apply "${observed}" scripts/validation/api-pc-011-observed-worker.sql
for db in "${fresh}" "${observed}"; do apply "$db" supabase/migrations/20260831080000_provider_worker_runtime.sql; docker exec "${container_name}" psql -U postgres -d "$db" -c "grant usage on schema public to ${role}; grant select,insert,update,delete on all tables in schema public to ${role}; grant usage,select on all sequences in schema public to ${role}" >/dev/null; done
run(){ NODE_PATH=scripts/validation/node-stubs DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/$1" LUZIONE_API_SERVICE_TOKEN=proof-token LUZIONE_API_MUTATIONS_ENABLED=true LUZIONE_API_PROVIDER_SANDBOX_ENABLED=true LUZIONE_API_PROVIDER_SANDBOX_TENANTS=api-pc-011-a LUZIONE_API_PROVIDER_SANDBOX_DESTINATIONS=sandbox.echo PROOF_SHAPE="$2" node --import tsx scripts/validation/api-pc-011-provider-runtime.ts; }
echo "proof_shape=fresh"; run "${fresh}" fresh; echo "proof_shape=observed_worker"; run "${observed}" observed; echo "cleanup=scheduled"
