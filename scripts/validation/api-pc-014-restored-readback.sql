\set ON_ERROR_STOP on

do $$
declare
  forced_count integer;
  client_grant_count integer;
  runtime_select_count integer;
  unsafe_role_count integer;
begin
  select count(*)::int into forced_count
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public' and relation.relforcerowsecurity
     and relation.relname = any(array[
       'p110_command_receipts','p110_event_envelopes','p110_idempotency_conflicts','p110_outbox_messages',
       'p110_kill_switches','p110_inbox_messages','p110_delivery_attempts','p110_dead_letters',
       'p110_reconciliation_checkpoints','p111_workflow_instances','p111_workflow_checkpoints',
       'p111_step_attempts','p111_workflow_timers','p111_human_task_refs','p111_compensation_intents',
       'p111_recovery_receipts','crm_leads','commercial_case_identities','commercial_cases',
       'commercial_policy_configurations','quotes','quote_lines','quote_economics_versions',
       'quote_margin_approval_records','commercial_case_proposal_context_versions',
       'commercial_case_proposal_document_versions','commercial_case_proposal_review_versions',
       'orders','order_lines','order_fulfillment_intents'
     ]::name[]);
  if forced_count <> 30 then raise exception 'restored forced-RLS count mismatch: %', forced_count; end if;

  select count(*)::int into client_grant_count
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon','authenticated','service_role')
     and table_name = any(array['orders','quotes','p110_command_receipts','p110_outbox_messages']);
  if client_grant_count <> 0 then raise exception 'restored client/legacy grants remain: %', client_grant_count; end if;

  select count(*)::int into runtime_select_count
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relname = any(array[
       'p110_command_receipts','p110_event_envelopes','p110_idempotency_conflicts','p110_outbox_messages',
       'p110_kill_switches','p110_inbox_messages','p110_delivery_attempts','p110_dead_letters',
       'p110_reconciliation_checkpoints','p111_workflow_instances','p111_workflow_checkpoints',
       'p111_step_attempts','p111_workflow_timers','p111_human_task_refs','p111_compensation_intents',
       'p111_recovery_receipts','crm_leads','commercial_case_identities','commercial_cases',
       'commercial_policy_configurations','quotes','quote_lines','quote_economics_versions',
       'quote_margin_approval_records','commercial_case_proposal_context_versions',
       'commercial_case_proposal_document_versions','commercial_case_proposal_review_versions',
       'orders','order_lines','order_fulfillment_intents'
     ]::name[])
     and has_table_privilege('luzione_api_runtime', relation.oid, 'SELECT');
  if runtime_select_count <> 30 then raise exception 'restored runtime SELECT coverage mismatch: %', runtime_select_count; end if;
  if has_table_privilege('luzione_api_runtime','public.orders','DELETE')
     or has_table_privilege('luzione_provider_worker','public.orders','SELECT') then
    raise exception 'restored runtime/worker privilege ceiling mismatch';
  end if;

  select count(*)::int into unsafe_role_count from pg_roles
   where rolname in ('luzione_api_runtime','luzione_provider_worker')
     and (rolsuper or rolcreatedb or rolcreaterole or rolcanlogin or rolreplication or rolbypassrls);
  if unsafe_role_count <> 0 then raise exception 'restored runtime role attributes are unsafe'; end if;

  if (select count(*) from public.orders where external_order_id = 'api-pc-014-restore-order') <> 1 then
    raise exception 'restored canonical Order fixture is missing';
  end if;
  if (select count(*) from public.p110_kill_switches where switch_id = 'api-pc-014-restore-switch') <> 1 then
    raise exception 'restored P110 fixture is missing';
  end if;
end $$;

select 'api_pc_014_restored_readback_pass' as result;
