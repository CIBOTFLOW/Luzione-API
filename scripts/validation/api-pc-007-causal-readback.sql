\set ON_ERROR_STOP on

begin;

insert into public.p110_command_receipts (
  tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
  correlation_id, target_owner_project, target_object_type, target_object_id,
  expected_object_version, committed_object_version, policy_version, actor_id,
  actor_type, state, requested_at, committed_at, event_id, outbox_message_id
) values (
  'api-pc-007-a', 'rcpt-readback-1', 'cmd-readback-1', 'lead.update',
  'idem-readback-1', repeat('a', 64), 'corr-readback-1', 'LUZIONE_P008',
  'lead', 'lead-1', 'lead:v1', 'lead:v2', 'policy:v1', 'actor-1', 'service',
  'DOMAIN_COMMITTED', now() - interval '2 minutes', now() - interval '2 minutes',
  'evt-readback-1', 'out-readback-1'
);

insert into public.p110_event_envelopes (
  tenant_id, event_id, event_type, event_version, authority_class, producer_project,
  subject_owner_project, subject_object_type, subject_object_id, subject_object_version,
  actor_id, actor_type, correlation_id, command_id, idempotency_key, occurred_at,
  recorded_at, payload_hash
) values (
  'api-pc-007-a', 'evt-readback-1', 'lead.updated', 1, 'BUSINESS_FACT',
  'CIBOTFLOW/Luzione-API', 'LUZIONE_P008', 'lead', 'lead-1', 'lead:v2',
  'actor-1', 'service', 'corr-readback-1', 'cmd-readback-1', 'idem-readback-1',
  now() - interval '2 minutes', now() - interval '2 minutes', repeat('b', 64)
);

insert into public.p110_outbox_messages (
  tenant_id, outbox_message_id, receipt_id, event_id, destination, effect_class,
  idempotency_key, payload_hash, state, attempt_count, provider_acknowledged_at,
  provider_acknowledgement_ref
) values (
  'api-pc-007-a', 'out-readback-1', 'rcpt-readback-1', 'evt-readback-1',
  'INTERNAL_WORKFLOW', 'NO_EFFECT', 'idem-readback-1', repeat('b', 64),
  'PROVIDER_ACKNOWLEDGED', 1, now() - interval '1 minute', 'provider:ack-1'
);

insert into public.p110_delivery_attempts (
  tenant_id, attempt_id, outbox_message_id, attempt_number, result, started_at,
  finished_at, provider_acknowledgement_ref
) values (
  'api-pc-007-a', 'attempt-readback-1', 'out-readback-1', 1, 'SUCCEEDED',
  now() - interval '90 seconds', now() - interval '1 minute', 'provider:ack-1'
);

do $$
declare
  finality text;
begin
  select case
           when coalesce(o.source_readback_ref, r.source_readback_ref) is not null then 'SOURCE_CONFIRMED'
           when o.provider_acknowledgement_ref is not null then 'PROVIDER_ACKNOWLEDGED'
           else 'DOMAIN_COMMITTED'
         end
    into finality
    from public.p110_command_receipts r
    left join public.p110_outbox_messages o
      on o.tenant_id = r.tenant_id and o.receipt_id = r.receipt_id
   where r.tenant_id = 'api-pc-007-a' and r.receipt_id = 'rcpt-readback-1';
  if finality <> 'PROVIDER_ACKNOWLEDGED' then
    raise exception 'provider acknowledgement was incorrectly classified: %', finality;
  end if;
end $$;

insert into public.p110_reconciliation_checkpoints (
  tenant_id, reconciliation_id, receipt_id, outbox_message_id, source_system,
  source_object_ref, expected_object_version, observed_object_version,
  source_readback_ref, result, checked_at, checked_by
) values (
  'api-pc-007-a', 'reconcile-readback-1', 'rcpt-readback-1', 'out-readback-1',
  'shopify', 'lead-1', 'lead:v2', 'lead:v2', 'shopify:lead-1:v2', 'MATCHED',
  now(), 'worker-1'
);

update public.p110_command_receipts
   set state = 'SOURCE_CONFIRMED', source_confirmed_at = now(),
       source_readback_ref = 'shopify:lead-1:v2'
 where tenant_id = 'api-pc-007-a' and receipt_id = 'rcpt-readback-1';

update public.p110_outbox_messages
   set state = 'SOURCE_CONFIRMED', source_confirmed_at = now(),
       source_readback_ref = 'shopify:lead-1:v2'
 where tenant_id = 'api-pc-007-a' and outbox_message_id = 'out-readback-1';

do $$
declare
  matched_count integer;
begin
  select count(*) into matched_count
    from public.p110_command_receipts r
    join public.p110_reconciliation_checkpoints c
      on c.tenant_id = r.tenant_id and c.receipt_id = r.receipt_id
   where r.tenant_id = 'api-pc-007-a'
     and r.receipt_id = 'rcpt-readback-1'
     and r.state = 'SOURCE_CONFIRMED'
     and r.source_readback_ref is not null
     and c.result = 'MATCHED'
     and c.source_readback_ref is not null;
  if matched_count <> 1 then
    raise exception 'authoritative source readback was not causally closed';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'api_pc_007_reader') then
    create role api_pc_007_reader nologin;
  end if;
end $$;
grant usage on schema public to api_pc_007_reader;
grant select on public.p110_command_receipts, public.p110_event_envelopes,
  public.p110_outbox_messages, public.p110_delivery_attempts,
  public.p110_reconciliation_checkpoints to api_pc_007_reader;

set local role api_pc_007_reader;
select set_config('app.tenant_id', 'api-pc-007-b', true);

do $$
declare
  leaked integer;
begin
  select count(*) into leaked
    from public.p110_command_receipts
   where receipt_id = 'rcpt-readback-1';
  if leaked <> 0 then
    raise exception 'cross-tenant receipt existence leaked';
  end if;
end $$;

reset role;
rollback;
