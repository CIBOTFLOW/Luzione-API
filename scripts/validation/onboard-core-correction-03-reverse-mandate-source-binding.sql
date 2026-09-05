begin;

insert into public.onboarding_setup_mandates (
  tenant_id, mandate_id, blueprint_id, blueprint_version, approval_ref,
  canonical_mandate, object_version, expires_at, revoked_at, revocation_ref,
  created_by, created_by_type, created_at, source_binding_digest
) values (
  'tenant-reverse-proof',
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'TenantBlueprint/v1',
  'approval:v2-binding-proof',
  '{"contractVersion":"SetupMandate/v1","tenantId":"tenant-reverse-proof","mandateId":"33333333-3333-4333-8333-333333333333"}'::jsonb,
  'setup-mandate:v2-source-bound@v1',
  '2026-09-06T00:00:00Z',
  null,
  null,
  'service:reverse-proof',
  'service',
  '2026-09-05T01:00:00Z',
  repeat('6', 64)
);

commit;
