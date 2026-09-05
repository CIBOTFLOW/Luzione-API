#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_seed_procurement_${suffix}"
role="seed_procurement_proof_${suffix}"
password="seed_procurement_disposable_${suffix}"

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

apply scripts/validation/rollback-seed-procurement-a3.sql
reversed_objects="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('seed_procurement_evidence_artifacts','seed_product_sources','seed_product_candidates','seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions','seed_purchase_order_drafts','seed_purchase_order_acknowledgements')")"
test "${reversed_objects}" = "0"
apply supabase/migrations/20260905091246_seed_procurement_a3.sql

rls_tables="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('seed_procurement_evidence_artifacts','seed_product_sources','seed_product_candidates','seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions','seed_purchase_order_drafts','seed_purchase_order_acknowledgements') and relrowsecurity and relforcerowsecurity")"
policy_roles="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_policies where schemaname='public' and tablename in ('seed_procurement_evidence_artifacts','seed_product_sources','seed_product_candidates','seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions','seed_purchase_order_drafts','seed_purchase_order_acknowledgements') and roles='{luzione_api_runtime}'")"
runtime_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('seed_procurement_evidence_artifacts','seed_product_sources','seed_product_candidates','seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions','seed_purchase_order_drafts','seed_purchase_order_acknowledgements') and privilege_type in ('SELECT','INSERT')")"
downstream_insert_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions','seed_purchase_order_drafts','seed_purchase_order_acknowledgements') and privilege_type='INSERT'")"
unsafe_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('seed_procurement_evidence_artifacts','seed_product_sources','seed_product_candidates','seed_rfq_drafts','seed_supplier_quotes','seed_bid_comparisons','seed_procurement_selection_decisions','seed_purchase_order_drafts','seed_purchase_order_acknowledgements') and privilege_type in ('UPDATE','DELETE','TRUNCATE')")"
dependency_holds="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger where not tgisinternal and tgname like 'seed_%_dependency_hold'")"
lineage_triggers="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger where not tgisinternal and tgname like 'seed_product_%_validate_lineage'")"
public_function_execute="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_proc p,lateral aclexplode(p.proacl) a where p.oid in ('public.seed_procurement_a3_reject_mutation()'::regprocedure,'public.seed_procurement_a3_hold_unresolved_dependencies()'::regprocedure,'public.seed_procurement_a3_validate_product_lineage()'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE'")"
test "${rls_tables}" = "9"
test "${policy_roles}" = "9"
test "${runtime_grants}" = "12"
test "${downstream_insert_grants}" = "0"
test "${unsafe_grants}" = "0"
test "${dependency_holds}" = "6"
test "${lineage_triggers}" = "2"
test "${public_function_execute}" = "0"

docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant usage on schema public to luzione_api_runtime; grant select,insert,update on public.p110_command_receipts,public.p110_outbox_messages to luzione_api_runtime; grant select,insert on public.p110_event_envelopes,public.p110_idempotency_conflicts to luzione_api_runtime" >/dev/null

NODE_PATH=scripts/validation/node-stubs \
DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" \
node --import tsx scripts/validation/seed-procurement-a3-postgres-proof.ts

rollback_guarded=0
if apply scripts/validation/rollback-seed-procurement-a3.sql; then
  echo "rollback unexpectedly removed admitted A3 data" >&2
  exit 1
else
  rollback_guarded=1
fi
test "${rollback_guarded}" = "1"

echo "rollback_objects=${reversed_objects}"
echo "forced_rls_tables=${rls_tables}"
echo "explicit_runtime_policies=${policy_roles}"
echo "runtime_select_insert_grants=${runtime_grants}"
echo "downstream_insert_grants=${downstream_insert_grants}"
echo "unsafe_runtime_grants=${unsafe_grants}"
echo "dependency_hold_triggers=${dependency_holds}"
echo "product_lineage_triggers=${lineage_triggers}"
echo "public_trigger_function_execute=${public_function_execute}"
echo "admitted_data_rollback_guard=${rollback_guarded}"
echo "cleanup=scheduled"
