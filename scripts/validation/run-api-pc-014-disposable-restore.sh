#!/usr/bin/env bash
set -euo pipefail
container_name="${1:-luzione_postgres}"; suffix="$$"
source_database="luzione_api_pc_014_source_${suffix}"
target_database="luzione_api_se014_restore_pc014_${suffix}"
cleanup(){ docker exec "${container_name}" dropdb -U postgres --if-exists "${source_database}" >/dev/null; }; trap cleanup EXIT
docker exec "${container_name}" createdb -U postgres "${source_database}"
apply(){ docker exec -i "${container_name}" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${source_database}" < "$1"; }
for migration in \
  supabase/migrations/20260831022000_p110_command_ledger_baseline.sql \
  supabase/migrations/20260831030000_p110_p111_workflow_delivery_baseline.sql \
  supabase/migrations/20260831050000_lead_commercial_case_dark_path.sql \
  supabase/migrations/20260831060000_proposal_quote_approval_dark_path.sql \
  supabase/migrations/20260831070000_order_fulfillment_intent_dark_path.sql \
  supabase/migrations/20260831080000_provider_worker_runtime.sql \
  supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql; do apply "${migration}"; done
docker exec "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d "${source_database}" -c "insert into public.orders (tenant_id,external_order_id,status,currency,total_cents,source_system) values ('api-pc-014','api-pc-014-restore-order','created','USD',1,'proof'); insert into public.p110_kill_switches (tenant_id,switch_id,scope_type,scope_ref,reason,activated_by) values ('api-pc-014','api-pc-014-restore-switch','GLOBAL','*','proof','proof');" >/dev/null
scripts/run-disposable-postgres-restore-drill.sh "${source_database}" "${target_database}" "${container_name}" supabase/migrations/20260831090000_api_pc_013_least_privilege_roles_rls.sql scripts/validation/api-pc-014-restored-readback.sql
echo "source_cleanup=scheduled"
