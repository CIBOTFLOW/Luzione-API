#!/usr/bin/env bash
set -euo pipefail

container_name="${1:-luzione_postgres}"
host_port="${2:-5432}"
suffix="$$"
database="luzione_seed_proposal_a2p_${suffix}"
role="seed_proposal_a2p_${suffix}"
password="seed_proposal_a2p_disposable_${suffix}"

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
apply supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql
apply scripts/validation/seed-project-publication-a2-proof-fixture.sql
apply scripts/validation/seed-procurement-a3-proof-fixture.sql
apply supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql
apply supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql
apply supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql
apply supabase/migrations/20260831080000_provider_worker_runtime.sql
apply supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql
# These two proof-fixture relations predate API-PC-013's enumerated production
# relation list. Restore read-only runtime access solely for the disposable A2/A2S prerequisites.
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "grant select on public.opportunities,public.accounts to luzione_api_runtime" >/dev/null
apply supabase/migrations/20260905083212_seed_project_publication_a2.sql
apply supabase/migrations/20260905091246_seed_procurement_a3.sql
apply supabase/migrations/20260905171927_seed_supplier_identity_a2s.sql
apply supabase/migrations/20260906003727_seed_procurement_a3_correction_01.sql
apply supabase/migrations/20260906032814_seed_proposal_owner_a2p.sql
apply scripts/validation/seed-proposal-owner-a2p-proof-fixture.sql

owner_tables="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('commercial_case_proposal_template_versions','commercial_case_proposal_v1_identity_map','commercial_case_proposal_line_versions','commercial_case_proposal_client_decision_versions','commercial_case_proposal_render_preparations')")"
forced_rls="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('commercial_case_proposal_template_versions','commercial_case_proposal_v1_identity_map','commercial_case_proposal_line_versions','commercial_case_proposal_client_decision_versions','commercial_case_proposal_render_preparations') and relrowsecurity and relforcerowsecurity")"
tenant_policies="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_policies where schemaname='public' and tablename in ('commercial_case_proposal_template_versions','commercial_case_proposal_v1_identity_map','commercial_case_proposal_line_versions','commercial_case_proposal_client_decision_versions','commercial_case_proposal_render_preparations') and roles @> array['luzione_api_runtime']::name[]")"
owner_select_insert_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('commercial_case_proposal_template_versions','commercial_case_proposal_v1_identity_map','commercial_case_proposal_line_versions','commercial_case_proposal_client_decision_versions','commercial_case_proposal_render_preparations') and privilege_type in ('SELECT','INSERT')")"
unsafe_owner_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('commercial_case_proposal_template_versions','commercial_case_proposal_v1_identity_map','commercial_case_proposal_line_versions','commercial_case_proposal_client_decision_versions','commercial_case_proposal_render_preparations') and privilege_type in ('UPDATE','DELETE','TRUNCATE')")"
integrity_triggers="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger where not tgisinternal and tgname in ('commercial_case_proposal_templates_integrity','commercial_case_proposal_identity_integrity','commercial_case_proposal_lines_integrity','commercial_case_proposal_decisions_integrity','commercial_case_proposal_renders_integrity','commercial_case_proposal_review_a2p_integrity','seed_purchase_order_a2p_integrity')")"
predecessor_protection="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger where not tgisinternal and tgname in ('commercial_case_proposal_context_a2p_immutable','commercial_case_proposal_document_a2p_immutable','commercial_case_proposal_review_a2p_immutable','quotes_a2p_immutable','quote_lines_a2p_immutable','quote_economics_a2p_immutable')")"
parallel_truth_tables="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('seed_proposals','seed_proposal_versions')")"
po_holds="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_trigger where not tgisinternal and tgname in ('seed_purchase_order_dependency_hold','seed_purchase_order_ack_dependency_hold')")"
po_insert_grants="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from information_schema.role_table_grants where grantee='luzione_api_runtime' and table_schema='public' and table_name in ('seed_purchase_order_drafts','seed_purchase_order_acknowledgements') and privilege_type='INSERT'")"
public_function_execute="$(docker exec "${container_name}" psql -At -v ON_ERROR_STOP=1 -U postgres -d "${database}" -c "select count(*) from pg_proc p,lateral aclexplode(p.proacl) a where p.oid in ('public.seed_proposal_a2p_reject_mutation()'::regprocedure,'public.seed_proposal_a2p_protect_predecessor()'::regprocedure,'public.seed_proposal_a2p_validate_integrity()'::regprocedure,'public.seed_proposal_a2p_validate_review_integrity()'::regprocedure,'public.seed_proposal_a2p_validate_purchase_order()'::regprocedure) and a.grantee=0 and a.privilege_type='EXECUTE'")"

test "${owner_tables}" = "5"
test "${forced_rls}" = "5"
test "${tenant_policies}" = "5"
test "${owner_select_insert_grants}" = "10"
test "${unsafe_owner_grants}" = "0"
test "${integrity_triggers}" = "7"
test "${predecessor_protection}" = "6"
test "${parallel_truth_tables}" = "0"
test "${po_holds}" = "1"
test "${po_insert_grants}" = "1"
test "${public_function_execute}" = "0"

NODE_PATH=scripts/validation/node-stubs \
DATABASE_URL="postgres://${role}:${password}@127.0.0.1:${host_port}/${database}" \
node --import tsx scripts/validation/seed-proposal-owner-a2p-postgres-proof.ts

echo "owner_tables=${owner_tables}"
echo "forced_rls_tables=${forced_rls}"
echo "explicit_tenant_policies=${tenant_policies}"
echo "owner_select_insert_grants=${owner_select_insert_grants}"
echo "unsafe_owner_grants=${unsafe_owner_grants}"
echo "deferred_integrity_triggers=${integrity_triggers}"
echo "predecessor_immutability_triggers=${predecessor_protection}"
echo "parallel_proposal_truth_tables=${parallel_truth_tables}"
echo "po_dependency_holds=${po_holds}"
echo "po_insert_grants=${po_insert_grants}"
echo "public_trigger_function_execute=${public_function_execute}"
echo "proof_fixture_prerequisite_grants=SELECT_ONLY"
echo "schema_recovery=drop_disposable_database"
echo "cleanup=scheduled"
