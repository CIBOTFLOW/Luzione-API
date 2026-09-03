-- Bounded Sultan command preparation and A1 internal action readback.
-- A2/A3 execution is intentionally absent. No policy envelope is seeded.

begin;

create table if not exists public.sultan_agent_command_reservations (
  tenant_id text not null,
  reservation_id text not null,
  operation_id text not null,
  run_id text not null,
  tool_call_id text not null,
  tool_id text not null,
  tool_version text not null,
  agent_id text not null,
  agent_version text not null,
  case_id text not null,
  case_type text not null,
  expected_version text not null,
  effect_class text not null,
  approval_mode text not null,
  arguments_hash text not null,
  command_hash text not null,
  state text not null,
  preview jsonb not null,
  receipt_id text,
  approval_id text,
  approved_by text,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  executed_at timestamptz,
  primary key (tenant_id, reservation_id),
  unique (tenant_id, operation_id),
  check (effect_class in ('A1','A2','A3')),
  check (approval_mode in ('BLOCKED','PER_COMMAND_HUMAN','POLICY_ENVELOPE')),
  check (state in ('PREPARED','EXECUTED','CANCELLED','RECONCILIATION_REQUIRED')),
  check (arguments_hash ~ '^[a-f0-9]{64}$' and command_hash ~ '^[a-f0-9]{64}$'),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);

create table if not exists public.sultan_agent_internal_actions (
  tenant_id text not null,
  action_id text not null,
  receipt_id text not null,
  reservation_id text not null,
  operation_id text not null,
  run_id text not null,
  tool_call_id text not null,
  tool_id text not null,
  case_id text not null,
  case_type text not null,
  object_version text not null,
  campaign_id text not null,
  payload jsonb not null,
  state text not null,
  approval_id text not null,
  approved_by text not null,
  approved_at timestamptz not null,
  external_effect_authorized boolean not null default false,
  provider_dispatch_authorized boolean not null default false,
  created_at timestamptz not null,
  archived_at timestamptz,
  primary key (tenant_id, action_id),
  unique (tenant_id, receipt_id),
  unique (tenant_id, reservation_id),
  foreign key (tenant_id, reservation_id)
    references public.sultan_agent_command_reservations(tenant_id, reservation_id) on delete restrict,
  check (tool_id in (
    'luzione.proposal_revision.create',
    'luzione.task.create',
    'luzione.note.append',
    'luzione.gmail_draft.create'
  )),
  check (state in ('SOURCE_CONFIRMED','ARCHIVED')),
  check (campaign_id ~ '^sultan-campaign-[a-z0-9][a-z0-9-]{2,80}$'),
  check (approved_by ~ '^user_[a-f0-9]{64}$'),
  check (external_effect_authorized = false and provider_dispatch_authorized = false)
);

create index if not exists sultan_agent_command_case_idx
  on public.sultan_agent_command_reservations (tenant_id, case_type, case_id, created_at desc);
create index if not exists sultan_agent_internal_action_campaign_idx
  on public.sultan_agent_internal_actions (tenant_id, campaign_id, created_at desc);

alter table public.sultan_agent_command_reservations enable row level security;
alter table public.sultan_agent_command_reservations force row level security;
alter table public.sultan_agent_internal_actions enable row level security;
alter table public.sultan_agent_internal_actions force row level security;

create policy sultan_agent_command_reservations_tenant
  on public.sultan_agent_command_reservations to luzione_api_runtime
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''))
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''));
create policy sultan_agent_internal_actions_tenant
  on public.sultan_agent_internal_actions to luzione_api_runtime
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''))
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''));

revoke all on public.sultan_agent_command_reservations, public.sultan_agent_internal_actions
  from public, anon, authenticated, service_role;
grant select, insert, update on public.sultan_agent_command_reservations to luzione_api_runtime;
grant select, insert, update on public.sultan_agent_internal_actions to luzione_api_runtime;

create or replace function public.sultan_agent_internal_action_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Sultan internal action evidence is append-only.';
  end if;
  if old.tool_id = 'luzione.note.append' then
    raise exception 'Sultan notes are append-only.';
  end if;
  if new.archived_at is null or new.state <> 'ARCHIVED'
     or new.payload <> old.payload or new.receipt_id <> old.receipt_id
     or new.approved_by <> old.approved_by or new.external_effect_authorized
     or new.provider_dispatch_authorized then
    raise exception 'Only archival of reversible Sultan internal actions is allowed.';
  end if;
  return new;
end;
$$;

revoke all on function public.sultan_agent_internal_action_guard() from public;
grant execute on function public.sultan_agent_internal_action_guard() to luzione_api_runtime;

create trigger sultan_agent_internal_action_no_delete
  before delete on public.sultan_agent_internal_actions
  for each row execute function public.sultan_agent_internal_action_guard();
create trigger sultan_agent_internal_action_archive_only
  before update on public.sultan_agent_internal_actions
  for each row execute function public.sultan_agent_internal_action_guard();

comment on table public.sultan_agent_command_reservations is
  'Exact, expiring Sultan command preparations. Discovery or preparation never grants execution authority.';
comment on table public.sultan_agent_internal_actions is
  'Luzione-owned authoritative readback for approved A1 campaign actions. External/provider effects are structurally prohibited.';

commit;
