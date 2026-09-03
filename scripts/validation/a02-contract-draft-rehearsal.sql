\set ON_ERROR_STOP on

begin;
select set_config('app.tenant_id', 'a02-tenant-a', true);

insert into public.p110_command_receipts (
  tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
  correlation_id, target_owner_project, target_object_type, target_object_id,
  expected_object_version, committed_object_version, policy_version, actor_id,
  actor_type, state, requested_at, committed_at, event_id, outbox_message_id,
  metadata
) values (
  'a02-tenant-a', 'receipt-a02-1', 'command-a02-1', 'fulfillment.readiness.evaluate',
  'idempotency-a02-1', :'payload_hash', 'correlation-a02-1',
  'LUZIONE_COMMERCE_ORDER', 'order', 'order-a02-1', 'order:v7', 'order:v7',
  'policy:v3', 'fulfillment-steward@v1', 'agent', 'DISPATCH_PENDING',
  '2026-09-02T20:00:00.000Z', '2026-09-02T20:00:00.000Z',
  'event-a02-1', 'outbox-a02-1',
  jsonb_build_object(
    'bundleVersion', 'luzione-shared-contracts/v0.2-draft.1',
    'identityTenantVersion', 'luzione-identity-tenant/v0.2-draft.1',
    'commandVersion', 'luzione-command-envelope/v0.2-draft.1',
    'receiptVersion', 'luzione-receipt-envelope/v0.2-draft.1',
    'readbackVersion', 'luzione-readback-envelope/v0.2-draft.1',
    'activation', 'DRAFT_ONLY',
    'effectAuthority', 'NO_EFFECT'
  )
);

insert into public.p110_event_envelopes (
  tenant_id, event_id, event_type, event_version, authority_class, producer_project,
  subject_owner_project, subject_object_type, subject_object_id, subject_object_version,
  actor_id, actor_type, correlation_id, command_id, idempotency_key, occurred_at,
  recorded_at, payload, payload_hash
) values (
  'a02-tenant-a', 'event-a02-1', 'fulfillment.readiness_evaluated', 1,
  'COMMAND_EVIDENCE', 'CIBOTFLOW/Luzione-API', 'LUZIONE_COMMERCE_ORDER',
  'order', 'order-a02-1', 'order:v7', 'fulfillment-steward@v1', 'agent',
  'correlation-a02-1', 'command-a02-1', 'idempotency-a02-1',
  '2026-09-02T20:00:00.000Z', '2026-09-02T20:00:00.000Z',
  '{"orderId":"order-a02-1","simulation":true}'::jsonb, :'payload_hash'
);

insert into public.p110_outbox_messages (
  tenant_id, outbox_message_id, receipt_id, event_id, destination, effect_class,
  idempotency_key, payload, payload_hash, state
) values (
  'a02-tenant-a', 'outbox-a02-1', 'receipt-a02-1', 'event-a02-1',
  'INTERNAL_WORKFLOW', 'NO_EFFECT', 'idempotency-a02-1',
  '{"eventId":"event-a02-1","activation":"DRAFT_ONLY"}'::jsonb,
  :'payload_hash', 'PENDING'
);

commit;

select set_config('a02.expected_payload_hash', :'payload_hash', false);

do $$
begin
  perform set_config('app.tenant_id', 'a02-tenant-a', true);
  begin
    insert into public.p110_command_receipts (
      tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
      correlation_id, target_owner_project, target_object_type, target_object_id,
      expected_object_version, committed_object_version, policy_version, actor_id,
      actor_type, state, requested_at, committed_at
    ) values (
      'a02-tenant-a', 'receipt-a02-rollback', 'command-a02-rollback',
      'fulfillment.readiness.evaluate', 'idempotency-a02-rollback', repeat('a', 64),
      'correlation-a02-rollback', 'LUZIONE_COMMERCE_ORDER', 'order',
      'order-a02-rollback', 'order:v1', 'order:v1', 'policy:v3',
      'fulfillment-steward@v1', 'agent', 'DOMAIN_COMMITTED', now(), now()
    );
    raise exception 'intentional A02 rollback';
  exception when raise_exception then
    null;
  end;
  if exists (
    select 1 from public.p110_command_receipts
     where tenant_id = 'a02-tenant-a' and receipt_id = 'receipt-a02-rollback'
  ) then
    raise exception 'A02 rollback left partial receipt state';
  end if;
end $$;

do $$
declare
  conflict_denied boolean := false;
  retained_hash text;
begin
  perform set_config('app.tenant_id', 'a02-tenant-a', true);
  begin
    insert into public.p110_command_receipts (
      tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
      correlation_id, target_owner_project, target_object_type, target_object_id,
      expected_object_version, committed_object_version, policy_version, actor_id,
      actor_type, state, requested_at, committed_at
    ) values (
      'a02-tenant-a', 'receipt-a02-conflict', 'command-a02-conflict',
      'fulfillment.readiness.evaluate', 'idempotency-a02-1', repeat('b', 64),
      'correlation-a02-conflict', 'LUZIONE_COMMERCE_ORDER', 'order',
      'order-a02-1', 'order:v7', 'order:v7', 'policy:v3',
      'fulfillment-steward@v1', 'agent', 'DOMAIN_COMMITTED', now(), now()
    );
  exception when unique_violation then
    conflict_denied := true;
  end;
  select payload_hash into retained_hash
    from public.p110_command_receipts
   where tenant_id = 'a02-tenant-a' and receipt_id = 'receipt-a02-1';
  if not conflict_denied or retained_hash <> current_setting('a02.expected_payload_hash') then
    raise exception 'A02 idempotency conflict did not preserve the original payload';
  end if;
end $$;

select 'A02_CONTRACT_DRAFT_PERSISTENCE_PASS' as proof_result;
