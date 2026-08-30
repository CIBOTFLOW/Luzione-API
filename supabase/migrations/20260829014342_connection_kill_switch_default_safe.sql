begin;

alter table public.integration_connections
  alter column kill_switch_active set default false;

update public.integration_connections
set kill_switch_active = false,
    updated_at = now()
where state = 'LEGACY_MANAGED'
  and created_by_identity_id = 'service:legacy-import'
  and legacy_source_ref is not null;

commit;
