begin;

create index integration_connection_capabilities_provider_idx
  on public.integration_connection_capabilities (provider, capability);
create index integration_connection_capabilities_updated_by_idx
  on public.integration_connection_capabilities (updated_by_identity_id);
create index integration_connections_created_by_idx
  on public.integration_connections (created_by_identity_id);
create index integration_webhook_receipts_tenant_connection_idx
  on public.integration_webhook_receipts (tenant_id, connection_id);
create index platform_effect_approvals_requested_by_idx
  on public.platform_effect_approvals (requested_by_identity_id);
create index platform_effect_approvals_approved_by_idx
  on public.platform_effect_approvals (approved_by_identity_id)
  where approved_by_identity_id is not null;
create index platform_usage_events_identity_idx
  on public.platform_usage_events (identity_id);
create index platform_usage_events_tenant_connection_idx
  on public.platform_usage_events (tenant_id, connection_id)
  where connection_id is not null;
create index tenant_budget_policies_updated_by_idx
  on public.tenant_budget_policies (updated_by_identity_id);
create index tenant_secret_backend_settings_updated_by_idx
  on public.tenant_secret_backend_settings (updated_by_identity_id);

commit;
