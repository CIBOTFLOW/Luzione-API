\set ON_ERROR_STOP on

-- Disposable A01 fixture only: reproduce the exact non-secret production catalog
-- signature observed on 2026-09-02 without importing production data.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'auth_users','connected_accounts','connected_assets','connector_sync_logs',
    'manual_connector_credentials','migration_discipline_records','policy_constant_migrations',
    'schema_migrations','secret_registry','service_auth_clients'
  ] loop
    execute format('create table public.%I (id bigint generated always as identity primary key)', relation_name);
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I no force row level security', relation_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', relation_name);
    execute format('grant select on table public.%I to service_role', relation_name);
  end loop;

  foreach relation_name in array array[
    'p110_command_receipts','p110_event_envelopes','p110_idempotency_conflicts','p110_outbox_messages',
    'p110_kill_switches','p110_inbox_messages','p110_delivery_attempts','p110_dead_letters',
    'p110_reconciliation_checkpoints','p111_workflow_instances','p111_workflow_checkpoints',
    'p111_step_attempts','p111_workflow_timers','p111_human_task_refs','p111_compensation_intents',
    'p111_recovery_receipts','crm_leads','commercial_case_identities','commercial_cases',
    'commercial_policy_configurations','quotes','quote_lines','quote_economics_versions',
    'quote_margin_approval_records','commercial_case_proposal_context_versions',
    'commercial_case_proposal_document_versions','commercial_case_proposal_review_versions',
    'orders','order_lines'
  ] loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I no force row level security', relation_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', relation_name);
    execute format('grant select on table public.%I to service_role', relation_name);
  end loop;
end $$;

drop table public.order_fulfillment_intents cascade;
