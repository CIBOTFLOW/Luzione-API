#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
suffix="$$"
database=""

cleanup() {
  if [[ -n "${database}" ]]; then
    docker exec "${container_name}" dropdb -U postgres --if-exists "${database}" >/dev/null
  fi
}
trap cleanup EXIT

create_database() {
  database="luzione_onboard_core_correction_03_${1}_${suffix}"
  docker exec "${container_name}" createdb -U postgres "${database}"
}

drop_database() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${database}" >/dev/null
  database=""
}

apply() {
  docker exec -i "${container_name}" psql -q -X -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "$1"
}

apply_baseline() {
  apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
  apply supabase/migrations/20260905040000_onboard_core_blueprints_mandates.sql
  apply supabase/migrations/20260905041000_onboard_core_import_dry_runs.sql
  apply supabase/migrations/20260905050000_onboard_core_correction_01.sql
}

snapshot() {
  {
    docker exec "${container_name}" psql -AtX -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "
      with onboarding_tables(table_name) as (
        values
          ('onboarding_tenant_blueprint_drafts'),
          ('onboarding_tenant_blueprint_approvals'),
          ('onboarding_setup_mandates'),
          ('onboarding_setup_mandate_revocations'),
          ('onboarding_import_batches'),
          ('onboarding_import_rows'),
          ('onboarding_import_receipts')
      ), signatures(line) as (
        select format('RELATION|%s|%s|%s', c.relname, c.relrowsecurity, c.relforcerowsecurity)
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
          join onboarding_tables t on t.table_name=c.relname where n.nspname='public'
        union all
        select format('COLUMN|%s|%s|%s|%s|%s', c.table_name, c.ordinal_position, c.column_name, c.data_type, coalesce(c.column_default,''))
          from information_schema.columns c join onboarding_tables t using (table_name)
         where c.table_schema='public'
        union all
        select format('CONSTRAINT|%s|%s|%s', c.relname, x.conname, pg_get_constraintdef(x.oid, true))
          from pg_constraint x join pg_class c on c.oid=x.conrelid
          join pg_namespace n on n.oid=c.relnamespace join onboarding_tables t on t.table_name=c.relname
         where n.nspname='public'
        union all
        select format('TRIGGER|%s|%s|%s', c.relname, g.tgname, pg_get_triggerdef(g.oid, true))
          from pg_trigger g join pg_class c on c.oid=g.tgrelid
          join pg_namespace n on n.oid=c.relnamespace join onboarding_tables t on t.table_name=c.relname
         where n.nspname='public' and not g.tgisinternal
        union all
        select format('POLICY|%s|%s|%s|%s', p.tablename, p.policyname, coalesce(p.qual,''), coalesce(p.with_check,''))
          from pg_policies p join onboarding_tables t on t.table_name=p.tablename where p.schemaname='public'
      )
      select line from signatures order by line"
    docker exec "${container_name}" psql -AtX -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "
      select line from (
        select 'onboarding_tenant_blueprint_drafts|' || to_jsonb(t)::text line from public.onboarding_tenant_blueprint_drafts t
        union all select 'onboarding_tenant_blueprint_approvals|' || to_jsonb(t)::text from public.onboarding_tenant_blueprint_approvals t
        union all select 'onboarding_setup_mandates|' || to_jsonb(t)::text from public.onboarding_setup_mandates t
        union all select 'onboarding_setup_mandate_revocations|' || to_jsonb(t)::text from public.onboarding_setup_mandate_revocations t
        union all select 'onboarding_import_batches|' || to_jsonb(t)::text from public.onboarding_import_batches t
        union all select 'onboarding_import_rows|' || to_jsonb(t)::text from public.onboarding_import_rows t
        union all select 'onboarding_import_receipts|' || to_jsonb(t)::text from public.onboarding_import_receipts t
      ) rows order by line"
  } | shasum -a 256 | awk '{print $1}'
}

create_database "empty"
apply_baseline
apply scripts/validation/rollback-onboard-core-correction-01.sql
empty_reverse="$(docker exec "${container_name}" psql -AtX -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select json_build_object('revocations',to_regclass('public.onboarding_setup_mandate_revocations'),'v2_columns',(select count(*) from information_schema.columns where table_schema='public' and ((table_name='onboarding_tenant_blueprint_drafts' and column_name in ('source_binding','source_binding_digest')) or (table_name='onboarding_tenant_blueprint_approvals' and column_name in ('proposal_actor_id','human_authentication_ref')) or (table_name='onboarding_setup_mandates' and column_name='source_binding_digest') or (table_name='onboarding_import_batches' and column_name='source_binding_digest') or (table_name='onboarding_import_rows' and column_name='match_key_digest') or (table_name='onboarding_import_receipts' and column_name in ('source_binding_digest','measured_runtime_ms','deadline_at')))))")"
test "${empty_reverse}" = '{"revocations" : null, "v2_columns" : 0}'
apply supabase/migrations/20260905050000_onboard_core_correction_01.sql
empty_reapply="$(docker exec "${container_name}" psql -AtX -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select json_build_object('revocations',to_regclass('public.onboarding_setup_mandate_revocations'),'v2_columns',(select count(*) from information_schema.columns where table_schema='public' and ((table_name='onboarding_tenant_blueprint_drafts' and column_name in ('source_binding','source_binding_digest')) or (table_name='onboarding_tenant_blueprint_approvals' and column_name in ('proposal_actor_id','human_authentication_ref')) or (table_name='onboarding_setup_mandates' and column_name='source_binding_digest') or (table_name='onboarding_import_batches' and column_name='source_binding_digest') or (table_name='onboarding_import_rows' and column_name='match_key_digest') or (table_name='onboarding_import_receipts' and column_name in ('source_binding_digest','measured_runtime_ms','deadline_at')))))")"
test "${empty_reapply}" = '{"revocations" : "onboarding_setup_mandate_revocations", "v2_columns" : 10}'
echo "empty_reverse=${empty_reverse}"
echo "empty_reapply=${empty_reapply}"
drop_database

fixture_specs=(
  "revocation:scripts/validation/onboard-core-correction-02-reverse-fixture.sql"
  "blueprint_source_binding:scripts/validation/onboard-core-correction-03-reverse-blueprint-source-binding.sql"
  "approval_human_auth:scripts/validation/onboard-core-correction-03-reverse-approval-human-auth.sql"
  "mandate_source_binding:scripts/validation/onboard-core-correction-03-reverse-mandate-source-binding.sql"
  "import_batch_source_binding:scripts/validation/onboard-core-correction-03-reverse-import-batch-source-binding.sql"
  "import_row_match_key:scripts/validation/onboard-core-correction-03-reverse-import-row-match-key.sql"
  "receipt_runtime_deadline:scripts/validation/onboard-core-correction-03-reverse-receipt-runtime.sql"
)

for fixture_spec in "${fixture_specs[@]}"; do
  category="${fixture_spec%%:*}"
  fixture="${fixture_spec#*:}"
  create_database "${category}"
  apply_baseline
  if [[ "${category}" != "revocation" ]]; then
    apply scripts/validation/onboard-core-correction-03-reverse-base-v1.sql
  fi
  apply "${fixture}"
  before="$(snapshot)"
  if apply scripts/validation/rollback-onboard-core-correction-01.sql; then
    echo "populated_reverse_${category}=unexpected_success"
    exit 1
  fi
  after="$(snapshot)"
  test "${before}" = "${after}"
  echo "populated_reverse_${category}=refused_before_ddl rows_and_schema_sha256=${after}"
  drop_database
done

echo "populated_reverse_cases=7/7"
echo "cleanup=complete"
