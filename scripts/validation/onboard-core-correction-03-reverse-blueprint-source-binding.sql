begin;

insert into public.onboarding_tenant_blueprint_drafts (
  tenant_id, blueprint_id, source_pack_id, source_pack_version, source_digest,
  source_schema_digest, mapping_version, draft_payload_hash, canonical_blueprint,
  object_version, created_by, created_by_type, created_at, source_binding,
  source_binding_digest
) values (
  'tenant-reverse-proof',
  '31111111-1111-4111-8111-111111111111',
  'v2-source-bound-pack',
  '2.0.0',
  repeat('3', 64),
  'c94dd71d93d72b048ceaa77b1ba08cb84e1f610393f139060f49ead684d28eb4',
  'TenantBlueprintMap/v2',
  repeat('4', 64),
  '{"contractVersion":"TenantBlueprint/v1","tenantId":"tenant-reverse-proof","blueprintId":"31111111-1111-4111-8111-111111111111","approval":{"state":"DRAFT","approvalRef":null,"approvedAt":null}}'::jsonb,
  'tenant-blueprint:v2-source-bound@v1',
  'service:reverse-proof',
  'service',
  '2026-09-05T01:00:00Z',
  '{"contractVersion":"TenantPackSourceBinding/v1","sourceSchemaDigest":"c94dd71d93d72b048ceaa77b1ba08cb84e1f610393f139060f49ead684d28eb4"}'::jsonb,
  repeat('5', 64)
);

commit;
