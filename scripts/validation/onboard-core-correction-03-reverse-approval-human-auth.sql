begin;

insert into public.onboarding_tenant_blueprint_approvals (
  tenant_id, approval_event_id, blueprint_id, action, approval_ref,
  supersedes_approval_ref, canonical_blueprint, object_version, actor_id,
  actor_type, approved_at, created_at, proposal_actor_id,
  human_authentication_ref
) values (
  'tenant-reverse-proof',
  '32222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'APPROVED',
  'approval:v2-human-proof',
  null,
  '{"contractVersion":"TenantBlueprint/v1","tenantId":"tenant-reverse-proof","blueprintId":"11111111-1111-4111-8111-111111111111","approval":{"state":"APPROVED","approvalRef":"approval:v2-human-proof","approvedAt":"2026-09-05T01:00:00Z"}}'::jsonb,
  'tenant-blueprint:approved@v2',
  'user:human-approver',
  'user',
  '2026-09-05T01:00:00Z',
  '2026-09-05T01:00:00Z',
  'service:reverse-proof',
  'supabase-session:v2-human-proof'
);

commit;
