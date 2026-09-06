#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_seed_procurement_a3c_${suffix}"
role="seed_procurement_a3c_${suffix}"
password="seed_procurement_a3c_disposable_${suffix}"

cleanup() {
  docker exec "${container_name}" dropdb -U postgres --if-exists "${database}" >/dev/null
  docker exec "${container_name}" psql -U postgres -d postgres -c "drop role if exists ${role}" >/dev/null
}
trap cleanup EXIT

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='luzione_api_runtime') then create role luzione_api_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls; end if; end \$\$;"
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls; grant luzione_api_runtime to ${role}"
docker exec "${container_name}" createdb -U postgres "${database}"

apply() {
  docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${database}" < "$1"
}

apply supabase/migrations/20260831022000_p110_command_ledger_baseline.sql
apply scripts/validation/seed-project-publication-a2-proof-fixture.sql
apply scripts/validation/seed-procurement-a3-proof-fixture.sql
apply supabase/migrations/20260905083212_seed_project_publication_a2.sql
apply supabase/migrations/20260905091246_seed_procurement_a3.sql
apply supabase/migrations/20260905171927_seed_supplier_identity_a2s.sql
apply supabase/migrations/20260906003727_seed_procurement_a3_correction_01.sql

apply scripts/validation/rollback-seed-procurement-a3-correction-01.sql
columns_after_rollback="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.columns where table_schema='public' and column_name in ('upstream_artifact_refs','supplier_profile_version','command_payload_hash') and table_name in ('seed_product_sources','seed_product_candidates','seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions')")"
test "${columns_after_rollback}" = "0"
apply supabase/migrations/20260906003727_seed_procurement_a3_correction_01.sql

downstream_insert_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions') and privilege_type='INSERT'")"
downstream_total_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions')")"
po_insert_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('seed_purchase_order_drafts','seed_purchase_order_acknowledgements') and privilege_type='INSERT'")"
supplier_hold_triggers="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger where not tgisinternal and tgname in ('seed_rfq_dependency_hold','seed_supplier_quote_dependency_hold','seed_bid_comparison_dependency_hold','seed_selection_decision_dependency_hold')")"
po_hold_triggers="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger where not tgisinternal and tgname in ('seed_purchase_order_dependency_hold','seed_purchase_order_ack_dependency_hold')")"
po_hold_functions="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal and t.tgname in ('seed_purchase_order_dependency_hold','seed_purchase_order_ack_dependency_hold') and p.proname='seed_procurement_a3_hold_unresolved_dependencies'")"
integrity_triggers="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger where not tgisinternal and tgname in ('seed_rfq_a3c_integrity','seed_quote_a3c_integrity','seed_bid_a3c_integrity','seed_selection_a3c_integrity')")"
tenant_policies="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_policies where schemaname='public' and tablename in ('seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions') and roles @> array['luzione_api_runtime']::name[]")"
browser_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public' and table_name in ('seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions')")"
public_function_execute="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_proc p,lateral aclexplode(p.proacl) a where p.oid in ('public.seed_procurement_a3c_validate_downstream()'::regprocedure,'public.seed_procurement_a3_hold_unresolved_dependencies()'::regprocedure,'public.seed_procurement_a3_validate_product_lineage()'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE'")"
test "${downstream_insert_grants}" = "4"
test "${downstream_total_grants}" = "8"
test "${po_insert_grants}" = "0"
test "${supplier_hold_triggers}" = "0"
test "${po_hold_triggers}" = "2"
test "${po_hold_functions}" = "2"
test "${integrity_triggers}" = "4"
test "${tenant_policies}" = "4"
test "${browser_grants}" = "0"
test "${public_function_execute}" = "0"

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to luzione_api_runtime; grant select,insert,update on public.p110_command_receipts,public.p110_outbox_messages to luzione_api_runtime; grant select,insert on public.p110_event_envelopes,public.p110_idempotency_conflicts to luzione_api_runtime" >/dev/null

NODE_PATH=scripts/validation/node-stubs \
DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" \
node --import tsx scripts/validation/seed-procurement-a3-postgres-proof.ts

rollback_guarded=0
if apply scripts/validation/rollback-seed-procurement-a3-correction-01.sql; then
  echo "A3C rollback unexpectedly removed admitted correction state" >&2
  exit 1
else
  rollback_guarded=1
fi
test "${rollback_guarded}" = "1"

echo "correction_columns_after_empty_rollback=${columns_after_rollback}"
echo "rfq_quote_bid_selection_insert_grants=${downstream_insert_grants}"
echo "rfq_quote_bid_selection_total_select_insert_grants=${downstream_total_grants}"
echo "po_insert_grants=${po_insert_grants}"
echo "supplier_hold_triggers=${supplier_hold_triggers}"
echo "po_hold_triggers=${po_hold_triggers}"
echo "po_hold_original_function_bindings=${po_hold_functions}"
echo "deferred_integrity_triggers=${integrity_triggers}"
echo "explicit_tenant_policies=${tenant_policies}"
echo "anon_authenticated_grants=${browser_grants}"
echo "public_trigger_function_execute=${public_function_execute}"
echo "admitted_data_rollback_guard=${rollback_guarded}"
echo "cleanup=scheduled"
