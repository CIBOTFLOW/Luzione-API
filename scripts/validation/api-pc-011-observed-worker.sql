insert into public.p110_command_receipts (
  tenant_id, receipt_id, command_id, command_type, idempotency_key, payload_hash,
  correlation_id, target_owner_project, target_object_type, target_object_id,
  expected_object_version, committed_object_version, policy_version, actor_id,
  actor_type, state, event_id, outbox_message_id, requested_at, committed_at
) values (
  'api-pc-011-observed-legacy', 'receipt-legacy', 'command-legacy', 'legacy.provider.command',
  'idempotency-legacy', repeat('a',64), 'correlation-legacy', 'CIBOTFLOW/Luzione-API',
  'legacy_object', 'legacy-1', 'legacy:v0', 'legacy:v1', 'legacy-policy', 'legacy-service',
  'service', 'RECONCILIATION_REQUIRED', 'event-legacy', 'outbox-legacy', now(), now()
);
insert into public.p110_event_envelopes (
  tenant_id,event_id,event_type,event_version,authority_class,producer_project,
  subject_owner_project,subject_object_type,subject_object_id,subject_object_version,
  actor_id,actor_type,correlation_id,command_id,idempotency_key,occurred_at,recorded_at,
  payload,payload_hash
) values (
  'api-pc-011-observed-legacy','event-legacy','legacy.provider.requested',1,'COMMAND_EVIDENCE',
  'CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-API','legacy_object','legacy-1','legacy:v1',
  'legacy-service','service','correlation-legacy','command-legacy','idempotency-legacy',now(),now(),
  '{}',repeat('a',64)
);
insert into public.p110_outbox_messages (
  tenant_id,outbox_message_id,receipt_id,event_id,destination,effect_class,authorization_ref,
  idempotency_key,payload,payload_hash,state
) values (
  'api-pc-011-observed-legacy','outbox-legacy','receipt-legacy','event-legacy','legacy.provider',
  'EXTERNAL_EFFECT','legacy-authorization','idempotency-legacy','{}',repeat('a',64),'RECONCILIATION_REQUIRED'
);
insert into public.p110_reconciliation_checkpoints (
  tenant_id,reconciliation_id,receipt_id,outbox_message_id,source_system,source_object_ref,
  expected_object_version,result,checked_at,checked_by,notes
) values (
  'api-pc-011-observed-legacy','reconcile-legacy','receipt-legacy','outbox-legacy',
  'legacy.provider','legacy_object:legacy-1','legacy:v1','PENDING',now(),'legacy-worker','pre-API-PC-011 row'
);
