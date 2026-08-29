begin;

create table public.tenant_vault_secret_refs (
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  vault_secret_id uuid not null,
  state text not null default 'ACTIVE' check (state in ('ACTIVE','DISABLED')),
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  primary key (tenant_id, vault_secret_id),
  constraint tenant_vault_secret_disabled_check check (
    state <> 'DISABLED' or disabled_at is not null
  )
);

create or replace function luzione_api_private.read_vault_secret(
  requested_tenant_id uuid,
  requested_vault_secret_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  material text;
begin
  if not exists (
    select 1
    from public.tenant_secret_backend_settings settings
    where settings.tenant_id = requested_tenant_id
      and settings.backend = 'VAULT'
      and settings.validation_status = 'PASS'
  ) then
    raise exception using errcode = '42501', message = 'The tenant Vault backend is not validated.';
  end if;

  if not exists (
    select 1
    from public.tenant_vault_secret_refs secret_ref
    where secret_ref.tenant_id = requested_tenant_id
      and secret_ref.vault_secret_id = requested_vault_secret_id
      and secret_ref.state = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'The Vault reference is not active for this tenant.';
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise exception using errcode = '55000', message = 'The selected secure backend is unavailable.';
  end if;

  execute
    'select decrypted_secret from vault.decrypted_secrets where id = $1'
    into material
    using requested_vault_secret_id;

  if material is null then
    raise exception using errcode = '55000', message = 'The selected secure backend is unavailable.';
  end if;
  return material;
end;
$$;

create or replace function luzione_api_private.create_vault_secret(
  requested_tenant_id uuid,
  secret_material text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  secret_id uuid;
  secret_name text;
begin
  if octet_length(secret_material) = 0 or octet_length(secret_material) > 65536 then
    raise exception using errcode = '22023', message = 'Secret material is outside the secure storage limit.';
  end if;

  if not exists (
    select 1
    from public.tenant_secret_backend_settings settings
    where settings.tenant_id = requested_tenant_id
      and settings.backend = 'VAULT'
      and settings.validation_status = 'PASS'
      and settings.allow_new_secret_writes
  ) then
    raise exception using errcode = '42501', message = 'New tenant secret writes are disabled.';
  end if;

  if to_regprocedure('vault.create_secret(text,text,text)') is null then
    raise exception using errcode = '55000', message = 'The selected secure backend is unavailable.';
  end if;

  secret_name := 'luzione/' || requested_tenant_id::text || '/' || gen_random_uuid()::text;
  execute
    'select vault.create_secret($1, $2, $3)'
    into secret_id
    using secret_material, secret_name, 'Luzione tenant connection secret';

  insert into public.tenant_vault_secret_refs (tenant_id, vault_secret_id)
  values (requested_tenant_id, secret_id);
  return secret_id;
end;
$$;

alter table public.tenant_vault_secret_refs enable row level security;
alter table public.tenant_vault_secret_refs force row level security;

revoke all on table public.tenant_vault_secret_refs from public, anon, authenticated, service_role;
grant select, insert, update on table public.tenant_vault_secret_refs to service_role;

revoke all on function luzione_api_private.read_vault_secret(uuid, uuid) from public, anon, authenticated;
revoke all on function luzione_api_private.create_vault_secret(uuid, text) from public, anon, authenticated;
grant execute on function luzione_api_private.read_vault_secret(uuid, uuid) to service_role;
grant execute on function luzione_api_private.create_vault_secret(uuid, text) to service_role;

comment on table public.tenant_vault_secret_refs is
  'Opaque tenant ownership for Supabase Vault UUIDs. No decrypted or encrypted secret material is stored here.';
comment on function luzione_api_private.create_vault_secret(uuid, text) is
  'Fail-closed Vault write boundary. Requires a validated tenant backend and an explicit write enablement flag.';

commit;
