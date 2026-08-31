begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'luzione_api_runtime') then
    create role luzione_api_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'luzione_provider_worker') then
    create role luzione_provider_worker nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;

alter role luzione_api_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role luzione_provider_worker nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

revoke all on schema public from luzione_api_runtime, luzione_provider_worker;
grant usage on schema public to luzione_api_runtime, luzione_provider_worker;
revoke all on all tables in schema public from luzione_api_runtime, luzione_provider_worker;
revoke all on all sequences in schema public from luzione_api_runtime, luzione_provider_worker;

do $$
declare
  relation_name text;
  policy_record record;
  tenant_relations constant text[] := array[
    'p110_command_receipts','p110_event_envelopes','p110_idempotency_conflicts','p110_outbox_messages',
    'p110_kill_switches','p110_inbox_messages','p110_delivery_attempts','p110_dead_letters',
    'p110_reconciliation_checkpoints','p111_workflow_instances','p111_workflow_checkpoints',
    'p111_step_attempts','p111_workflow_timers','p111_human_task_refs','p111_compensation_intents',
    'p111_recovery_receipts','crm_leads','commercial_case_identities','commercial_cases',
    'commercial_policy_configurations','quotes','quote_economics_versions',
    'quote_margin_approval_records','commercial_case_proposal_context_versions',
    'commercial_case_proposal_document_versions','commercial_case_proposal_review_versions',
    'orders','order_lines','order_fulfillment_intents'
  ];
begin
  foreach relation_name in array tenant_relations loop
    if to_regclass(format('public.%I', relation_name)) is null then
      raise exception 'API-PC-013 expected relation public.% is missing', relation_name;
    end if;
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I force row level security', relation_name);
    for policy_record in
      select polname from pg_policy
       where polrelid = format('public.%I', relation_name)::regclass
    loop
      execute format('drop policy %I on public.%I', policy_record.polname, relation_name);
    end loop;
    execute format(
      'create policy api_pc013_runtime_tenant on public.%I to luzione_api_runtime using (tenant_id::text = (select current_setting(''app.tenant_id'', true))) with check (tenant_id::text = (select current_setting(''app.tenant_id'', true)))',
      relation_name
    );
    execute format('revoke all on table public.%I from public', relation_name);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', relation_name);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table public.%I from authenticated', relation_name);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on table public.%I from service_role', relation_name);
    end if;
  end loop;
end $$;

alter table public.quote_lines enable row level security;
alter table public.quote_lines force row level security;
do $$
declare policy_record record;
begin
  for policy_record in
    select polname from pg_policy where polrelid = 'public.quote_lines'::regclass
  loop
    execute format('drop policy %I on public.quote_lines', policy_record.polname);
  end loop;
end $$;
create policy api_pc013_runtime_tenant on public.quote_lines to luzione_api_runtime
  using (exists (
    select 1 from public.quotes quote
     where quote.id = quote_lines.quote_id
       and quote.tenant_id = (select current_setting('app.tenant_id', true))
  ))
  with check (exists (
    select 1 from public.quotes quote
     where quote.id = quote_lines.quote_id
       and quote.tenant_id = (select current_setting('app.tenant_id', true))
  ));
revoke all on table public.quote_lines from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.quote_lines from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.quote_lines from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.quote_lines from service_role;
  end if;
end $$;

grant select, insert, update on table
  public.p110_command_receipts,
  public.p110_outbox_messages,
  public.p110_kill_switches,
  public.p110_inbox_messages,
  public.p110_delivery_attempts,
  public.p110_dead_letters,
  public.p110_reconciliation_checkpoints,
  public.p111_workflow_instances,
  public.p111_workflow_checkpoints,
  public.p111_step_attempts,
  public.p111_workflow_timers,
  public.p111_human_task_refs,
  public.p111_compensation_intents,
  public.p111_recovery_receipts,
  public.crm_leads,
  public.commercial_case_identities,
  public.commercial_cases,
  public.quotes
to luzione_api_runtime;

grant select, insert on table
  public.p110_event_envelopes,
  public.p110_idempotency_conflicts,
  public.quote_lines,
  public.quote_economics_versions,
  public.quote_margin_approval_records,
  public.commercial_case_proposal_review_versions,
  public.orders,
  public.order_lines,
  public.order_fulfillment_intents
to luzione_api_runtime;

grant select on table
  public.commercial_policy_configurations,
  public.commercial_case_proposal_context_versions,
  public.commercial_case_proposal_document_versions
to luzione_api_runtime;

do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'p110_command_receipts','p110_outbox_messages','p110_kill_switches',
    'p110_delivery_attempts','p110_dead_letters','p110_reconciliation_checkpoints'
  ] loop
    execute format(
      'create policy api_pc013_worker_tenant on public.%I to luzione_provider_worker using (tenant_id::text = (select current_setting(''app.tenant_id'', true))) with check (tenant_id::text = (select current_setting(''app.tenant_id'', true)))',
      relation_name
    );
  end loop;
end $$;

grant select on table
  public.p110_command_receipts,
  public.p110_outbox_messages,
  public.p110_kill_switches,
  public.p110_delivery_attempts,
  public.p110_dead_letters,
  public.p110_reconciliation_checkpoints
to luzione_provider_worker;
grant update on table
  public.p110_command_receipts,
  public.p110_outbox_messages,
  public.p110_delivery_attempts,
  public.p110_reconciliation_checkpoints
to luzione_provider_worker;
grant insert on table
  public.p110_delivery_attempts,
  public.p110_dead_letters,
  public.p110_reconciliation_checkpoints
to luzione_provider_worker;

comment on role luzione_api_runtime is
  'NOLOGIN API-PC-013 group role. Deployed credential membership requires separate release authority.';
comment on role luzione_provider_worker is
  'NOLOGIN API-PC-013 provider-worker group role with delivery-only privileges and forced tenant RLS.';

commit;
