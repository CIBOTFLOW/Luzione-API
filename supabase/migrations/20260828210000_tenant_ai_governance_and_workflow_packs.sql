begin;

create table if not exists public.workflow_pack_registry (
  workflow_pack_id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9._-]+$'),
  name text not null,
  vertical text not null check (vertical in ('CORE', 'LUXURY_HOME')),
  maximum_effect_class text not null check (maximum_effect_class in ('A0','A1','A2','A3')),
  capabilities jsonb not null check (jsonb_typeof(capabilities) = 'array'),
  outcome text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_workflow_pack_settings (
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  workflow_pack_id uuid not null references public.workflow_pack_registry(workflow_pack_id) on delete cascade,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  policy_definition_id uuid references public.policy_definitions(policy_definition_id),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, workflow_pack_id)
);

create table if not exists public.tenant_field_definitions (
  field_definition_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  entity_code text not null check (entity_code ~ '^[a-z][a-z0-9._-]+$'),
  field_code text not null check (field_code ~ '^[a-z][a-z0-9._-]+$'),
  label text not null,
  field_type text not null check (field_type in ('TEXT','NUMBER','CURRENCY','BOOLEAN','DATE','DATETIME','SELECT','MULTISELECT','RELATION','JSON')),
  required boolean not null default false,
  searchable boolean not null default false,
  classification text not null default 'INTERNAL' check (classification in ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  ai_access text not null default 'READ' check (ai_access in ('NONE','READ','PROPOSE','WRITE')),
  vertical text not null default 'CORE',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity_code, field_code)
);

alter table public.workflow_pack_registry enable row level security;
alter table public.tenant_workflow_pack_settings enable row level security;
alter table public.tenant_field_definitions enable row level security;

revoke all on public.workflow_pack_registry from anon, authenticated;
revoke all on public.tenant_workflow_pack_settings from anon, authenticated;
revoke all on public.tenant_field_definitions from anon, authenticated;
grant select, insert, update, delete on public.workflow_pack_registry to service_role;
grant select, insert, update, delete on public.tenant_workflow_pack_settings to service_role;
grant select, insert, update, delete on public.tenant_field_definitions to service_role;

alter table public.policy_evaluations add column if not exists tenant_id uuid references public.tenant_accounts(tenant_id);
alter table public.policy_evaluations add column if not exists actor_ref text;
alter table public.policy_evaluations add column if not exists policy_definition_id uuid references public.policy_definitions(policy_definition_id);
alter table public.policy_evaluations add column if not exists request_id text;
create index if not exists policy_evaluations_tenant_created_idx
  on public.policy_evaluations (tenant_id, created_at desc);

insert into public.workflow_pack_registry
  (code, name, vertical, maximum_effect_class, capabilities, outcome)
values
  ('growth.signal_to_account','Growth signal to account','CORE','A2','["analysis.read","lead.score","record.internal.update"]','Ingest, deduplicate, enrich, score and attach buying signals to an account.'),
  ('crm.lead_qualification','Lead qualification and routing','CORE','A1','["analysis.read","lead.score","lead.route","task.internal.create"]','Qualify, explain, route and assign a lead under tenant SLAs.'),
  ('growth.outreach','Outreach orchestration','CORE','A3','["draft.internal.create","outreach.sequence.enroll","email.send"]','Draft personalized outreach and, when approved, enroll contacts in a provider sequence.'),
  ('crm.opportunity','Opportunity progression','CORE','A2','["analysis.read","opportunity.next_action.create","crm.stage.advance"]','Summarize an opportunity, recommend next actions and advance compliant stages.'),
  ('commercial.proposal','Proposal generation','CORE','A3','["proposal.artifact.create","proposal.revision.create","proposal.send"]','Build, revise, approve and transmit a versioned commercial proposal.'),
  ('work.task_copilot','Task copilot','CORE','A2','["task.internal.create","task.internal.update","task.internal.complete"]','Create, prioritize, update and complete work with evidence-linked receipts.'),
  ('service.customer_followup','Customer follow-up','CORE','A3','["support.response.draft","task.internal.create","email.send"]','Draft responses, create follow-ups and send only within tenant communication policy.'),
  ('fulfillment.exception','Fulfillment exception management','CORE','A3','["fulfillment.exception.triage","task.internal.create","supplier.rfq.send"]','Triage delays, create recovery tasks and prepare supplier or customer communications.'),
  ('luxury.design_partner','Design partner pursuit','LUXURY_HOME','A1','["lead.score","opportunity.next_action.create","proposal.artifact.create"]','Rank design firms, coordinate placement pursuits and build project-specific proposals.')
on conflict (code) do update set
  name = excluded.name,
  vertical = excluded.vertical,
  maximum_effect_class = excluded.maximum_effect_class,
  capabilities = excluded.capabilities,
  outcome = excluded.outcome,
  updated_at = now();

insert into public.policy_definitions
  (tenant_id, code, version, status, schema_version, policy_json, compiled_json, checksum)
select
  ta.tenant_id,
  'sultan.autonomy',
  1,
  'ACTIVE'::public.policy_definition_status,
  'sultan-autonomy/v1',
  policy.document,
  policy.document,
  encode(digest(policy.document::text, 'sha256'), 'hex')
from public.tenant_accounts ta
cross join lateral (
  select jsonb_build_object(
    'defaultDecision','APPROVAL',
    'maximumDataClassification','CONFIDENTIAL',
    'maximumEffectClass','A3',
    'rules', jsonb_build_array(
      jsonb_build_object('capability','analysis.read','decision','ALLOW','actorTypes',jsonb_build_array('agent','service','user'),'purposes','[]'::jsonb,'maximumEffectClass','A0'),
      jsonb_build_object('capability','lead.score','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','lead.route','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','opportunity.next_action.create','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','proposal.artifact.create','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','proposal.revision.create','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','task.internal.create','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','task.internal.update','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','support.response.draft','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','fulfillment.exception.triage','decision','ALLOW','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A1'),
      jsonb_build_object('capability','record.internal.update','decision','APPROVAL','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A2'),
      jsonb_build_object('capability','crm.stage.advance','decision','APPROVAL','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A2'),
      jsonb_build_object('capability','task.internal.complete','decision','APPROVAL','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A2'),
      jsonb_build_object('capability','outreach.sequence.enroll','decision','APPROVAL','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A3'),
      jsonb_build_object('capability','email.send','decision','APPROVAL','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A3'),
      jsonb_build_object('capability','calendar.meeting.book','decision','APPROVAL','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A3'),
      jsonb_build_object('capability','proposal.send','decision','APPROVAL','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A3'),
      jsonb_build_object('capability','supplier.rfq.send','decision','APPROVAL','actorTypes',jsonb_build_array('agent','service'),'purposes','[]'::jsonb,'maximumEffectClass','A3')
    )
  ) as document
) policy
where ta.code in ('luzione', 'LUZIONE_INTERNAL')
  and not exists (
    select 1 from public.policy_definitions pd
    where pd.tenant_id = ta.tenant_id and pd.code = 'sultan.autonomy' and pd.version = 1
  );

commit;
