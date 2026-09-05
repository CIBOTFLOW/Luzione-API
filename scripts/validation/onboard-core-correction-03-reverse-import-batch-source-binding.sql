begin;

insert into public.onboarding_import_batches (
  tenant_id, batch_id, mandate_id, expected_mandate_object_version,
  dedupe_key, source_digest, mapping_version, canonical_batch,
  object_version, created_by, created_by_type, created_at,
  source_binding_digest
) values (
  'tenant-reverse-proof',
  '34444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  'setup-mandate:legacy@v1',
  'v2-import-batch-proof',
  repeat('7', 64),
  'CRMImportDryRunMap/v2',
  '{"contractVersion":"ImportBatch/v1","tenantId":"tenant-reverse-proof","batchId":"34444444-4444-4444-8444-444444444444","mandateRef":"22222222-2222-4222-8222-222222222222","effectMode":"NO_EFFECT","mappingVersion":"CRMImportDryRunMap/v2","source":{"digest":"7777777777777777777777777777777777777777777777777777777777777777"},"status":"STAGED"}'::jsonb,
  'import-batch:v2-source-bound@v1',
  'service:reverse-proof',
  'service',
  '2026-09-05T01:00:00Z',
  repeat('8', 64)
);

commit;
