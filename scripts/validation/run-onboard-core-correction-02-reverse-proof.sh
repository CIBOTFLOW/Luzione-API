#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
suffix="$$"
database="luzione_onboard_core_correction_02_${suffix}"

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${database}" >/dev/null
}
trap cleanup EXIT

docker exec "${container_name}" createdb -U postgres "${database}"

apply() {
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "$1"
}

apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply supabase/migrations/20260905040000_onboard_core_blueprints_mandates.sql
apply supabase/migrations/20260905041000_onboard_core_import_dry_runs.sql
apply supabase/migrations/20260905050000_onboard_core_correction_01.sql

apply scripts/validation/rollback-onboard-core-correction-01.sql
empty_reverse="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select json_build_object('revocations',to_regclass('public.onboarding_setup_mandate_revocations'),'source_binding_column',(select count(*) from information_schema.columns where table_schema='public' and table_name='onboarding_tenant_blueprint_drafts' and column_name='source_binding'))")"
test "${empty_reverse}" = '{"revocations" : null, "source_binding_column" : 0}'
echo "empty_reverse=${empty_reverse}"

apply supabase/migrations/20260905050000_onboard_core_correction_01.sql
apply scripts/validation/onboard-core-correction-02-reverse-fixture.sql

if apply scripts/validation/rollback-onboard-core-correction-01.sql; then
  echo "populated_reverse=unexpected_success"
  exit 1
else
  echo "populated_reverse=refused_before_ddl"
fi

preserved="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select json_build_object('revocations_relation',to_regclass('public.onboarding_setup_mandate_revocations'),'revocation_rows',(select count(*) from public.onboarding_setup_mandate_revocations),'legacy_mandate_rows',(select count(*) from public.onboarding_setup_mandates where object_version='setup-mandate:legacy@v1'),'source_binding_column',(select count(*) from information_schema.columns where table_schema='public' and table_name='onboarding_tenant_blueprint_drafts' and column_name='source_binding'),'runtime_column',(select count(*) from information_schema.columns where table_schema='public' and table_name='onboarding_import_receipts' and column_name='measured_runtime_ms'))")"
test "${preserved}" = '{"revocations_relation" : "onboarding_setup_mandate_revocations", "revocation_rows" : 1, "legacy_mandate_rows" : 1, "source_binding_column" : 1, "runtime_column" : 1}'
echo "populated_reverse_readback=${preserved}"
echo "cleanup=scheduled"
