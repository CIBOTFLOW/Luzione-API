begin;

insert into public.onboarding_import_batches (
  tenant_id, batch_id, mandate_id, expected_mandate_object_version,
  dedupe_key, source_digest, mapping_version, canonical_batch,
  object_version, created_by, created_by_type, created_at
) values (
  'tenant-reverse-proof',
  '36666666-6666-4666-8666-666666666666',
  '22222222-2222-4222-8222-222222222222',
  'setup-mandate:legacy@v1',
  'legacy-receipt-parent-proof',
  repeat('c', 64),
  'CRMImportDryRunMap/v1',
  '{"contractVersion":"ImportBatch/v1","tenantId":"tenant-reverse-proof","batchId":"36666666-6666-4666-8666-666666666666","mandateRef":"22222222-2222-4222-8222-222222222222","effectMode":"NO_EFFECT","mappingVersion":"CRMImportDryRunMap/v1","source":{"digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"status":"VALIDATED"}'::jsonb,
  'import-batch:legacy-receipt-parent@v1',
  'service:reverse-proof',
  'service',
  '2026-09-05T01:00:00Z'
);

insert into public.onboarding_import_receipts (
  tenant_id, batch_id, canonical_receipt, finality, reconciliation_ref,
  object_version, created_at, source_binding_digest, measured_runtime_ms,
  deadline_at
) values (
  'tenant-reverse-proof',
  '36666666-6666-4666-8666-666666666666',
  '{"contractVersion":"ImportReceipt/v1","tenantId":"tenant-reverse-proof","batchId":"36666666-6666-4666-8666-666666666666","effectMode":"NO_EFFECT","finality":"VALIDATED_NO_EFFECT","reconciliationRef":null}'::jsonb,
  'VALIDATED_NO_EFFECT',
  null,
  'import-receipt:v2-runtime@v1',
  '2026-09-05T01:00:01Z',
  repeat('d', 64),
  1000,
  '2026-09-05T01:30:00Z'
);

commit;
