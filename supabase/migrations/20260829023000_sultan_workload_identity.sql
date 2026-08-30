begin;

insert into public.platform_identities
  (identity_id, identity_type, display_name, status)
values
  ('agent:sultan-os', 'AGENT', 'Sultan OS governed planner', 'ACTIVE')
on conflict (identity_id) do nothing;

insert into public.tenant_memberships
  (tenant_id, identity_id, role, capabilities, status, source)
select distinct
  tenant.tenant_id,
  'agent:sultan-os',
  'SULTAN_AGENT',
  '["governance.evaluate","models.read","commands.request"]'::jsonb,
  'ACTIVE',
  'PLATFORM'
from public.tenant_accounts tenant
left join public.tenant_legacy_id_mappings legacy
  on legacy.canonical_tenant_id = tenant.tenant_id
 and legacy.legacy_system = 'luzione-ui'
where tenant.status = 'ACTIVE'
  and (tenant.code = 'LUZIONE_INTERNAL' or legacy.legacy_tenant_id = 'luzione')
on conflict (tenant_id, identity_id) do nothing;

commit;
