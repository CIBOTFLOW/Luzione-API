begin;

insert into public.onboarding_tenant_blueprint_drafts (
  tenant_id, blueprint_id, source_pack_id, source_pack_version, source_digest,
  source_schema_digest, mapping_version, draft_payload_hash, canonical_blueprint,
  object_version, created_by, created_by_type, created_at
) values (
  'tenant-reverse-proof',
  '11111111-1111-4111-8111-111111111111',
  'legacy-pack',
  '1.0.0',
  repeat('1', 64),
  'c94dd71d93d72b048ceaa77b1ba08cb84e1f610393f139060f49ead684d28eb4',
  'TenantBlueprintMap/v1',
  repeat('2', 64),
  '{"contractVersion":"TenantBlueprint/v1","tenantId":"tenant-reverse-proof","blueprintId":"11111111-1111-4111-8111-111111111111","approval":{"state":"DRAFT","approvalRef":null,"approvedAt":null}}'::jsonb,
  'tenant-blueprint:legacy@v1',
  'service:reverse-proof',
  'service',
  '2026-09-05T00:00:00Z'
);

insert into public.onboarding_setup_mandates (
  tenant_id, mandate_id, blueprint_id, blueprint_version, approval_ref,
  canonical_mandate, object_version, expires_at, revoked_at, revocation_ref,
  created_by, created_by_type, created_at
) values (
  'tenant-reverse-proof',
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'TenantBlueprint/v1',
  'approval:legacy-proof',
  '{"contractVersion":"SetupMandate/v1","tenantId":"tenant-reverse-proof","mandateId":"22222222-2222-4222-8222-222222222222"}'::jsonb,
  'setup-mandate:legacy@v1',
  '2026-09-06T00:00:00Z',
  null,
  null,
  'service:reverse-proof',
  'service',
  '2026-09-05T00:00:00Z'
);

commit;
