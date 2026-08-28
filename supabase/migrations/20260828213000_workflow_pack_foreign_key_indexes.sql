begin;

create index if not exists tenant_workflow_pack_settings_pack_idx
  on public.tenant_workflow_pack_settings (workflow_pack_id);

create index if not exists tenant_workflow_pack_settings_policy_idx
  on public.tenant_workflow_pack_settings (policy_definition_id)
  where policy_definition_id is not null;

commit;
