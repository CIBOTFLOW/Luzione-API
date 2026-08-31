\set ON_ERROR_STOP on

do $$
declare
  protected_count integer;
begin
  select count(*) into protected_count
    from pg_class
   where oid in (
     'public.p110_outbox_messages'::regclass,
     'public.p110_kill_switches'::regclass,
     'public.p110_inbox_messages'::regclass,
     'public.p110_delivery_attempts'::regclass,
     'public.p110_dead_letters'::regclass,
     'public.p110_reconciliation_checkpoints'::regclass,
     'public.p111_workflow_instances'::regclass,
     'public.p111_workflow_checkpoints'::regclass,
     'public.p111_step_attempts'::regclass,
     'public.p111_workflow_timers'::regclass,
     'public.p111_human_task_refs'::regclass,
     'public.p111_compensation_intents'::regclass,
     'public.p111_recovery_receipts'::regclass
   ) and relrowsecurity and relforcerowsecurity;
  if protected_count <> 13 then
    raise exception 'expected thirteen forced-RLS workflow/delivery relations, observed %', protected_count;
  end if;
end $$;

begin;
select set_config('app.tenant_id', 'api-pc-006-tenant-a', true);

insert into public.p110_command_receipts (
  tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
  correlation_id, target_owner_project, target_object_type, target_object_id,
  expected_object_version, committed_object_version, policy_version,
  actor_id, actor_type, state, event_id, outbox_message_id, requested_at, committed_at
) values (
  'api-pc-006-tenant-a', 'receipt-delivery', 'command-delivery', 'test.delivery',
  'idem-delivery', 'hash-delivery', 'correlation-delivery', 'luzione-api',
  'test_object', 'object-delivery', 'v0', 'v1', 'policy-v1', 'system-probe',
  'system', 'DISPATCH_PENDING', 'event-delivery', 'outbox-delivery', now(), now()
);
insert into public.p110_event_envelopes (
  tenant_id, event_id, event_type, event_version, authority_class, producer_project,
  subject_owner_project, subject_object_type, subject_object_id, subject_object_version,
  actor_id, actor_type, correlation_id, command_id, idempotency_key,
  occurred_at, recorded_at, payload_hash
) values (
  'api-pc-006-tenant-a', 'event-delivery', 'test.delivery_accepted', 1,
  'COMMAND_EVIDENCE', 'luzione-api', 'luzione-api', 'test_object',
  'object-delivery', 'v1', 'system-probe', 'system', 'correlation-delivery',
  'command-delivery', 'idem-delivery', now(), now(), 'hash-delivery'
);
insert into public.p110_outbox_messages (
  tenant_id, outbox_message_id, receipt_id, event_id, destination, effect_class,
  idempotency_key, payload_hash, max_attempts
) values (
  'api-pc-006-tenant-a', 'outbox-delivery', 'receipt-delivery', 'event-delivery',
  'INTERNAL_WORKFLOW', 'NO_EFFECT', 'idem-delivery', 'hash-delivery', 2
);
insert into public.p111_workflow_instances (
  tenant_id, flow_id, definition_id, definition_version, state,
  object_owner_project, object_type, object_id, object_version,
  correlation_id, idempotency_key, created_by
) values (
  'api-pc-006-tenant-a', 'flow-delivery', 'test-flow', 1, 'PLANNED',
  'luzione-api', 'test_object', 'object-delivery', 'v1',
  'correlation-delivery', 'flow-idem-delivery', 'system-probe'
);

with candidates as (
  select outbox_message_id from public.p110_outbox_messages
   where tenant_id = 'api-pc-006-tenant-a' and state = 'PENDING'
   for update skip locked
), claimed as (
  update public.p110_outbox_messages outbox
     set state = 'CLAIMED', attempt_count = attempt_count + 1,
         locked_at = now(), heartbeat_at = now(), lock_owner = 'worker-a',
         lease_expires_at = now() + interval '60 seconds',
         request_deadline_at = now() + interval '45 seconds'
    from candidates
   where outbox.tenant_id = 'api-pc-006-tenant-a'
     and outbox.outbox_message_id = candidates.outbox_message_id
  returning outbox.outbox_message_id
)
select count(*) as first_claim_count from claimed;

do $$
declare second_claim_count integer;
begin
  with candidates as (
    select outbox_message_id from public.p110_outbox_messages
     where tenant_id = 'api-pc-006-tenant-a' and state in ('PENDING','RETRY_SCHEDULED')
     for update skip locked
  ) select count(*) into second_claim_count from candidates;
  if second_claim_count <> 0 then raise exception 'competing claim observed leased work'; end if;
end $$;

update public.p110_outbox_messages
   set locked_at = now() - interval '120 seconds',
       heartbeat_at = now() - interval '120 seconds',
       lease_expires_at = now() - interval '60 seconds',
       request_deadline_at = now() - interval '75 seconds'
 where tenant_id = 'api-pc-006-tenant-a' and outbox_message_id = 'outbox-delivery';
update public.p110_outbox_messages
   set state = 'RETRY_SCHEDULED', locked_at = null, heartbeat_at = null,
       lock_owner = null, lease_expires_at = null, request_deadline_at = null,
       not_before = now(), last_error_code = 'LEASE_EXPIRED'
 where tenant_id = 'api-pc-006-tenant-a' and outbox_message_id = 'outbox-delivery'
   and state = 'CLAIMED' and lease_expires_at <= now();

update public.p110_outbox_messages
   set state = 'CLAIMED', attempt_count = attempt_count + 1,
       locked_at = now(), heartbeat_at = now(), lock_owner = 'worker-b',
       lease_expires_at = now() + interval '60 seconds',
       request_deadline_at = now() + interval '45 seconds'
 where tenant_id = 'api-pc-006-tenant-a' and outbox_message_id = 'outbox-delivery'
   and state = 'RETRY_SCHEDULED';
insert into public.p110_delivery_attempts (
  tenant_id, attempt_id, outbox_message_id, attempt_number, failure_class,
  result, started_at, finished_at, error_code, error_summary
) values (
  'api-pc-006-tenant-a', 'attempt-ambiguous', 'outbox-delivery', 2,
  'AMBIGUOUS_AFTER_ACK', 'RECONCILIATION_REQUIRED', now(), now(),
  'AMBIGUOUS', 'Provider may have acknowledged the request.'
);
update public.p110_outbox_messages
   set state = 'RECONCILIATION_REQUIRED', failure_class = 'AMBIGUOUS_AFTER_ACK',
       locked_at = null, heartbeat_at = null, lock_owner = null,
       lease_expires_at = null, request_deadline_at = null
 where tenant_id = 'api-pc-006-tenant-a' and outbox_message_id = 'outbox-delivery';
insert into public.p110_reconciliation_checkpoints (
  tenant_id, reconciliation_id, receipt_id, outbox_message_id, source_system,
  source_object_ref, expected_object_version, result, checked_at, checked_by
) values (
  'api-pc-006-tenant-a', 'reconcile-delivery', 'receipt-delivery', 'outbox-delivery',
  'INTERNAL_WORKFLOW', 'test_object:object-delivery', 'v0', 'PENDING', now(), 'worker-b'
);
update public.p110_reconciliation_checkpoints
   set result = 'MATCHED', observed_object_version = 'v1',
       source_readback_ref = 'readback:object-delivery:v1', checked_at = now()
 where tenant_id = 'api-pc-006-tenant-a' and reconciliation_id = 'reconcile-delivery';
update public.p110_outbox_messages
   set state = 'SOURCE_CONFIRMED', source_confirmed_at = now(),
       source_readback_ref = 'readback:object-delivery:v1'
 where tenant_id = 'api-pc-006-tenant-a' and outbox_message_id = 'outbox-delivery';

insert into public.p110_inbox_messages (
  tenant_id, inbox_message_id, producer, producer_message_id, event_type,
  correlation_id, payload_hash
) values (
  'api-pc-006-tenant-a', 'inbox-1', 'test-producer', 'producer-message-1',
  'test.signal_received', 'correlation-inbox', 'hash-inbox'
);
insert into public.p110_inbox_messages (
  tenant_id, inbox_message_id, producer, producer_message_id, event_type,
  correlation_id, payload_hash
) values (
  'api-pc-006-tenant-a', 'inbox-duplicate', 'test-producer', 'producer-message-1',
  'test.signal_received', 'correlation-inbox', 'hash-inbox'
) on conflict (tenant_id, producer, producer_message_id) do nothing;

update public.p111_workflow_instances
   set state = 'RUNNING', state_version = state_version + 1, started_at = now()
 where tenant_id = 'api-pc-006-tenant-a' and flow_id = 'flow-delivery' and state_version = 1;
update public.p111_workflow_instances
   set state = 'FAILED', state_version = state_version + 1
 where tenant_id = 'api-pc-006-tenant-a' and flow_id = 'flow-delivery' and state_version = 1;

do $$
declare inbox_count integer; flow_version integer; outbox_state text;
begin
  select count(*) into inbox_count from public.p110_inbox_messages
   where tenant_id = 'api-pc-006-tenant-a' and producer = 'test-producer' and producer_message_id = 'producer-message-1';
  select state_version into flow_version from public.p111_workflow_instances
   where tenant_id = 'api-pc-006-tenant-a' and flow_id = 'flow-delivery';
  select state into outbox_state from public.p110_outbox_messages
   where tenant_id = 'api-pc-006-tenant-a' and outbox_message_id = 'outbox-delivery';
  if inbox_count <> 1 then raise exception 'inbox producer identity did not deduplicate'; end if;
  if flow_version <> 2 then raise exception 'stale workflow CAS mutated state'; end if;
  if outbox_state <> 'SOURCE_CONFIRMED' then raise exception 'reconciliation did not preserve source-confirmed state'; end if;
end $$;

commit;

drop role if exists api_pc006_probe;
create role api_pc006_probe nologin;
grant usage on schema public to api_pc006_probe;
grant select, insert on table public.p110_inbox_messages, public.p110_outbox_messages,
  public.p110_dead_letters, public.p111_workflow_instances to api_pc006_probe;
begin;
set local role api_pc006_probe;
select set_config('app.tenant_id', 'api-pc-006-tenant-b', true);
do $$
declare visible_count integer; denied boolean := false;
begin
  select count(*) into visible_count from public.p111_workflow_instances;
  if visible_count <> 0 then raise exception 'tenant-b observed tenant-a workflow'; end if;
  begin
    insert into public.p110_inbox_messages (
      tenant_id, inbox_message_id, producer, producer_message_id, event_type,
      correlation_id, payload_hash
    ) values (
      'api-pc-006-tenant-a', 'cross-tenant-inbox', 'probe', 'probe-1',
      'probe.signal_received', 'probe-correlation', 'probe-hash'
    );
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'cross-tenant inbox insert was not denied'; end if;
end $$;
rollback;
revoke all on table public.p110_inbox_messages, public.p110_outbox_messages,
  public.p110_dead_letters, public.p111_workflow_instances from api_pc006_probe;
revoke usage on schema public from api_pc006_probe;
drop role api_pc006_probe;

select 'API_PC_006_LOCAL_DATABASE_PROOF_PASS' as proof_result;
