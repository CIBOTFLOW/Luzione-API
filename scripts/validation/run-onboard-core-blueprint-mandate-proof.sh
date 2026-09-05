#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_onboard_core_blueprints_${suffix}"
role="onboard_core_proof_${suffix}"
password="onboard_core_disposable_${suffix}"

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
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to ${role}; grant select,insert,update,delete on all tables in schema public to ${role}" >/dev/null

NODE_PATH=scripts/validation/node-stubs DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" node --import tsx scripts/validation/onboard-core-blueprint-mandate-proof.ts

apply scripts/validation/rollback-onboard-core-blueprints-mandates.sql
reverse_state="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select json_build_object('drafts',to_regclass('public.onboarding_tenant_blueprint_drafts'),'approvals',to_regclass('public.onboarding_tenant_blueprint_approvals'),'mandates',to_regclass('public.onboarding_setup_mandates'),'p110',to_regclass('public.p110_command_receipts'))")"
test "${reverse_state}" = '{"drafts" : null, "approvals" : null, "mandates" : null, "p110" : "p110_command_receipts"}'
echo "rollback=${reverse_state}"

apply supabase/migrations/20260905040000_onboard_core_blueprints_mandates.sql
reapply_count="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where oid in ('public.onboarding_tenant_blueprint_drafts'::regclass,'public.onboarding_tenant_blueprint_approvals'::regclass,'public.onboarding_setup_mandates'::regclass)")"
test "${reapply_count}" = "3"
echo "reapply_relations=${reapply_count}"
echo "cleanup=scheduled"
