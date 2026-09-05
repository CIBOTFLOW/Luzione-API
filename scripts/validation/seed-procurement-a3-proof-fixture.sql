begin;

create table public.accounts (
  tenant_id text not null,
  id text not null,
  name text not null,
  status text not null,
  version integer not null check (version > 0),
  updated_at timestamptz not null,
  primary key (tenant_id, id)
);

create index accounts_tenant_id_idx on public.accounts (tenant_id, id);
alter table public.accounts enable row level security;
alter table public.accounts force row level security;
revoke all on table public.accounts from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    execute 'create policy accounts_runtime_tenant on public.accounts to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    grant select on table public.accounts to luzione_api_runtime;
  end if;
end $$;

insert into public.accounts (tenant_id,id,name,status,version,updated_at) values
  ('tenant-proof-a','supplier-account-a','Supplier Account A','active',1,'2026-09-05T09:00:00.000Z'),
  ('tenant-proof-b','supplier-account-b','Supplier Account B','active',1,'2026-09-05T09:00:00.000Z'),
  ('tenant-proof-b','supplier-cross-tenant','Other Tenant Supplier','active',1,'2026-09-05T09:00:00.000Z');

commit;
