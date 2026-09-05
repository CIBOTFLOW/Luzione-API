#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_onboard_core_import_${suffix}"
role="onboard_import_proof_${suffix}"
password="onboard_import_disposable_${suffix}"

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
apply supabase/migrations/20260905040000_onboard_core_blueprints_mandates.sql
apply supabase/migrations/20260905041000_onboard_core_import_dry_runs.sql
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to ${role}; grant select,insert,update,delete on all tables in schema public to ${role}" >/dev/null

NODE_PATH=scripts/validation/node-stubs DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" node --import tsx scripts/validation/onboard-core-import-proof.ts

apply scripts/validation/rollback-onboard-core-import-dry-runs.sql
reverse_state="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select json_build_object('batches',to_regclass('public.onboarding_import_batches'),'rows',to_regclass('public.onboarding_import_rows'),'receipts',to_regclass('public.onboarding_import_receipts'),'mandates',to_regclass('public.onboarding_setup_mandates'))")"
test "${reverse_state}" = '{"batches" : null, "rows" : null, "receipts" : null, "mandates" : "onboarding_setup_mandates"}'
echo "rollback=${reverse_state}"

apply supabase/migrations/20260905041000_onboard_core_import_dry_runs.sql
reapply_count="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where oid in ('public.onboarding_import_batches'::regclass,'public.onboarding_import_rows'::regclass,'public.onboarding_import_receipts'::regclass)")"
test "${reapply_count}" = "3"
echo "reapply_relations=${reapply_count}"
echo "cleanup=scheduled"
