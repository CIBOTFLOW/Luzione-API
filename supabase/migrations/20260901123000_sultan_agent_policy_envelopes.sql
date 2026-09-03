-- Exact, expiring policy envelopes for Sultan consequential tools. No envelope
-- is seeded: the A2 RFQ path therefore fails closed until a human-controlled
-- deployment process inserts one exact 24-hour activation.

begin;

create table if not exists public.sultan_agent_policy_envelopes (
  tenant_id text not null,
  envelope_id text not null,
  agent_id text not null,
  agent_version text not null,
  tool_id text not null,
  case_id text not null,
  case_type text not null,
  sender_address text not null,
  recipient_address text not null,
  subject_prefix text not null,
  evidence_class text not null,
  maximum_per_run integer not null,
  maximum_per_day integer not null,
  activated_at timestamptz not null,
  expires_at timestamptz not null,
  approved_by text not null,
  approval_ref text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, envelope_id),
  constraint sultan_policy_envelope_case_type check (case_type = 'COMMERCIAL'),
  constraint sultan_policy_envelope_id_format check (envelope_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,255}$'),
  constraint sultan_policy_envelope_case_id_format check (case_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,255}$'),
  constraint sultan_policy_envelope_sender_format check (sender_address ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  constraint sultan_policy_envelope_approval_nonempty check (length(btrim(approved_by)) between 2 and 256 and length(btrim(approval_ref)) between 2 and 512),
  constraint sultan_policy_envelope_tool check (tool_id = 'luzione.supplier_rfq_email.send'),
  constraint sultan_policy_envelope_agent check (agent_id = 'agent.luzione.revenue-steward'),
  constraint sultan_policy_envelope_recipient check (recipient_address = 'hello@ciflow.io'),
  constraint sultan_policy_envelope_subject check (subject_prefix = '[SULTAN RFQ CANARY]'),
  constraint sultan_policy_envelope_evidence check (evidence_class = 'SYNTHETIC_ALLOWLISTED'),
  constraint sultan_policy_envelope_per_run check (maximum_per_run = 1),
  constraint sultan_policy_envelope_daily check (maximum_per_day between 1 and 3),
  constraint sultan_policy_envelope_lifetime check (
    expires_at > activated_at and expires_at <= activated_at + interval '24 hours'
  )
);

create index if not exists sultan_agent_policy_envelope_lookup_idx
  on public.sultan_agent_policy_envelopes (
    tenant_id, agent_id, agent_version, tool_id, case_id, activated_at desc
  );

alter table public.sultan_agent_policy_envelopes enable row level security;
alter table public.sultan_agent_policy_envelopes force row level security;

drop policy if exists sultan_agent_policy_envelopes_tenant_policy on public.sultan_agent_policy_envelopes;
create policy sultan_agent_policy_envelopes_tenant_policy
  on public.sultan_agent_policy_envelopes
  to luzione_api_runtime
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''))
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''));

revoke all on public.sultan_agent_policy_envelopes from public, anon, authenticated, service_role;
grant select, insert on public.sultan_agent_policy_envelopes to luzione_api_runtime;

create or replace function public.sultan_agent_policy_envelope_block_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Sultan policy envelopes are immutable; containment uses the P110 kill switch.';
end;
$$;

revoke all on function public.sultan_agent_policy_envelope_block_mutation() from public;
grant execute on function public.sultan_agent_policy_envelope_block_mutation() to luzione_api_runtime;

drop trigger if exists sultan_agent_policy_envelopes_no_update on public.sultan_agent_policy_envelopes;
create trigger sultan_agent_policy_envelopes_no_update
  before update on public.sultan_agent_policy_envelopes
  for each row execute function public.sultan_agent_policy_envelope_block_mutation();

drop trigger if exists sultan_agent_policy_envelopes_no_delete on public.sultan_agent_policy_envelopes;
create trigger sultan_agent_policy_envelopes_no_delete
  before delete on public.sultan_agent_policy_envelopes
  for each row execute function public.sultan_agent_policy_envelope_block_mutation();

comment on table public.sultan_agent_policy_envelopes is
  'Immutable, exact, expiring human activation evidence for bounded Sultan policy-envelope actions. No row means no authority.';

commit;
