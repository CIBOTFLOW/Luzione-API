begin;

insert into public.onboarding_import_batches (
  tenant_id, batch_id, mandate_id, expected_mandate_object_version,
  dedupe_key, source_digest, mapping_version, canonical_batch,
  object_version, created_by, created_by_type, created_at
) values (
  'tenant-reverse-proof',
  '35555555-5555-4555-8555-555555555555',
  '22222222-2222-4222-8222-222222222222',
  'setup-mandate:legacy@v1',
  'legacy-row-parent-proof',
  repeat('9', 64),
  'CRMImportDryRunMap/v1',
  '{"contractVersion":"ImportBatch/v1","tenantId":"tenant-reverse-proof","batchId":"35555555-5555-4555-8555-555555555555","mandateRef":"22222222-2222-4222-8222-222222222222","effectMode":"NO_EFFECT","mappingVersion":"CRMImportDryRunMap/v1","source":{"digest":"9999999999999999999999999999999999999999999999999999999999999999"},"status":"STAGED"}'::jsonb,
  'import-batch:legacy-row-parent@v1',
  'service:reverse-proof',
  'service',
  '2026-09-05T01:00:00Z'
);

insert into public.onboarding_import_rows (
  tenant_id, batch_id, source_row_id, payload_digest, outcome, reason_code,
  exception_ref, reconciliation_ref, created_at, match_key_digest
) values (
  'tenant-reverse-proof',
  '35555555-5555-4555-8555-555555555555',
  'row-v2-match-key',
  repeat('a', 64),
  'ACCEPTED',
  null,
  null,
  null,
  '2026-09-05T01:00:00Z',
  repeat('b', 64)
);

commit;
