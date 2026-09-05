begin;

create table public.opportunities (
  tenant_id text not null,
  id text not null,
  account_id text not null,
  version integer not null check (version > 0),
  primary key (tenant_id, id)
);

create index opportunities_tenant_id_idx on public.opportunities (tenant_id, id);
alter table public.opportunities enable row level security;
alter table public.opportunities force row level security;
revoke all on table public.opportunities from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    execute 'create policy opportunities_runtime_tenant on public.opportunities to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    grant select on table public.opportunities to luzione_api_runtime;
  end if;
end $$;

insert into public.opportunities (tenant_id, id, account_id, version) values
  ('tenant-proof-a', 'opportunity-primary', 'account-primary', 4),
  ('tenant-proof-a', 'opportunity-fault', 'account-fault', 1),
  ('tenant-proof-a', 'opportunity-concurrent', 'account-concurrent', 2),
  ('tenant-proof-b', 'opportunity-primary', 'account-other-tenant', 1);

commit;
