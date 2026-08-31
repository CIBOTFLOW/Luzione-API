\set ON_ERROR_STOP on

do $$
declare
  table_count integer;
  force_rls_count integer;
begin
  select count(*)
    into table_count
    from pg_class
   where oid in (
     'public.p110_command_receipts'::regclass,
     'public.p110_event_envelopes'::regclass,
     'public.p110_idempotency_conflicts'::regclass,
     'public.p110_outbox_messages'::regclass
   );
  if table_count <> 4 then
    raise exception 'expected four command-ledger relations, observed %', table_count;
  end if;

  select count(*)
    into force_rls_count
    from pg_class
   where oid in (
     'public.p110_command_receipts'::regclass,
     'public.p110_event_envelopes'::regclass,
     'public.p110_idempotency_conflicts'::regclass,
     'public.p110_outbox_messages'::regclass
   )
     and relrowsecurity
     and relforcerowsecurity;
  if force_rls_count <> 4 then
    raise exception 'expected RLS and FORCE RLS on four relations, observed %', force_rls_count;
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'p110_idempotency_conflicts'
       and column_name = 'resolved_at'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'p110_idempotency_conflicts'
       and column_name = 'resolution_ref'
  ) then
    raise exception 'idempotency conflict resolution columns are incomplete';
  end if;
end $$;

begin;
select set_config('app.tenant_id', 'api-pc-005-tenant-a', true);

insert into public.p110_command_receipts (
  tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
  correlation_id, target_owner_project, target_object_type, target_object_id,
  expected_object_version, committed_object_version, policy_version,
  actor_id, actor_type, state, event_id, outbox_message_id, requested_at, committed_at
) values (
  'api-pc-005-tenant-a', 'receipt-accepted', 'command-accepted', 'test.command',
  'idem-accepted', 'payload-hash-accepted', 'correlation-accepted', 'luzione-api',
  'test_object', 'object-accepted', 'v0', 'v1', 'policy-v1', 'system-probe',
  'system', 'DOMAIN_COMMITTED', 'event-accepted', 'outbox-accepted', now(), now()
);

insert into public.p110_event_envelopes (
  tenant_id, event_id, event_type, event_version, authority_class, producer_project,
  subject_owner_project, subject_object_type, subject_object_id, subject_object_version,
  actor_id, actor_type, correlation_id, command_id, idempotency_key,
  occurred_at, recorded_at, payload_hash
) values (
  'api-pc-005-tenant-a', 'event-accepted', 'test.command_accepted', 1,
  'COMMAND_EVIDENCE', 'luzione-api', 'luzione-api', 'test_object',
  'object-accepted', 'v1', 'system-probe', 'system', 'correlation-accepted',
  'command-accepted', 'idem-accepted', now(), now(), 'payload-hash-accepted'
);

insert into public.p110_outbox_messages (
  tenant_id, outbox_message_id, receipt_id, event_id, destination, effect_class,
  idempotency_key, payload_hash
) values (
  'api-pc-005-tenant-a', 'outbox-accepted', 'receipt-accepted', 'event-accepted',
  'INTERNAL_WORKFLOW', 'NO_EFFECT', 'idem-accepted', 'payload-hash-accepted'
);

commit;

do $$
begin
  perform set_config('app.tenant_id', 'api-pc-005-tenant-a', true);
  begin
    insert into public.p110_command_receipts (
      tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
      correlation_id, target_owner_project, target_object_type, target_object_id,
      expected_object_version, committed_object_version, policy_version,
      actor_id, actor_type, state, event_id, outbox_message_id, requested_at, committed_at
    ) values (
      'api-pc-005-tenant-a', 'receipt-rollback', 'command-rollback', 'test.command',
      'idem-rollback', 'payload-hash-rollback', 'correlation-rollback', 'luzione-api',
      'test_object', 'object-rollback', 'v0', 'v1', 'policy-v1', 'system-probe',
      'system', 'DOMAIN_COMMITTED', 'event-rollback', 'outbox-rollback', now(), now()
    );
    insert into public.p110_event_envelopes (
      tenant_id, event_id, event_type, event_version, authority_class, producer_project,
      subject_owner_project, subject_object_type, subject_object_id, subject_object_version,
      actor_id, actor_type, correlation_id, command_id, idempotency_key,
      occurred_at, recorded_at, payload_hash
    ) values (
      'api-pc-005-tenant-a', 'event-rollback', 'test.command_accepted', 1,
      'COMMAND_EVIDENCE', 'luzione-api', 'luzione-api', 'test_object',
      'object-rollback', 'v1', 'system-probe', 'system', 'correlation-rollback',
      'command-rollback', 'idem-rollback', now(), now(), 'payload-hash-rollback'
    );
    insert into public.p110_outbox_messages (
      tenant_id, outbox_message_id, receipt_id, event_id, destination, effect_class,
      idempotency_key, payload_hash
    ) values (
      'api-pc-005-tenant-a', 'outbox-rollback', 'receipt-rollback', 'event-rollback',
      'INTERNAL_WORKFLOW', 'NO_EFFECT', 'idem-rollback', 'payload-hash-rollback'
    );
    raise exception 'intentional rollback probe';
  exception when raise_exception then
    null;
  end;

  if exists (
    select 1 from public.p110_command_receipts
     where tenant_id = 'api-pc-005-tenant-a' and receipt_id = 'receipt-rollback'
  ) or exists (
    select 1 from public.p110_event_envelopes
     where tenant_id = 'api-pc-005-tenant-a' and event_id = 'event-rollback'
  ) or exists (
    select 1 from public.p110_outbox_messages
     where tenant_id = 'api-pc-005-tenant-a' and outbox_message_id = 'outbox-rollback'
  ) then
    raise exception 'atomic rollback probe left partial ledger state';
  end if;
end $$;

drop role if exists api_pc005_probe;
create role api_pc005_probe nologin;
grant usage on schema public to api_pc005_probe;
grant select, insert on table public.p110_command_receipts,
  public.p110_event_envelopes, public.p110_idempotency_conflicts,
  public.p110_outbox_messages to api_pc005_probe;

begin;
set local role api_pc005_probe;
select set_config('app.tenant_id', 'api-pc-005-tenant-b', true);

do $$
declare
  visible_count integer;
  denied boolean := false;
begin
  select count(*) into visible_count from public.p110_command_receipts;
  if visible_count <> 0 then
    raise exception 'tenant-b observed tenant-a command receipts';
  end if;

  begin
    insert into public.p110_idempotency_conflicts (
      tenant_id, conflict_id, command_id, idempotency_key, existing_payload_hash,
      received_payload_hash, correlation_id
    ) values (
      'api-pc-005-tenant-a', 'cross-tenant-conflict', 'cross-tenant-command',
      'cross-tenant-idempotency', 'hash-a', 'hash-b', 'cross-tenant-correlation'
    );
  exception when insufficient_privilege then
    denied := true;
  end;

  if not denied then
    raise exception 'cross-tenant insert was not denied by RLS';
  end if;
end $$;

rollback;
revoke all on table public.p110_command_receipts, public.p110_event_envelopes,
  public.p110_idempotency_conflicts, public.p110_outbox_messages from api_pc005_probe;
revoke usage on schema public from api_pc005_probe;
drop role api_pc005_probe;

select 'API_PC_005_LOCAL_DATABASE_PROOF_PASS' as proof_result;
