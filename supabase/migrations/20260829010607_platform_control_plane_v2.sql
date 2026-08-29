begin;

create schema if not exists luzione_api_private;
revoke all on schema luzione_api_private from public, anon, authenticated;
grant usage on schema luzione_api_private to service_role;

create or replace function luzione_api_private.jsonb_contains_secret_key(document jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  item record;
begin
  if document is null then
    return false;
  end if;
  if jsonb_typeof(document) = 'object' then
    for item in select key, value from jsonb_each(document)
    loop
      if item.key ~* '(secret|token|password|credential|api[_-]?key|private[_-]?key)'
         or luzione_api_private.jsonb_contains_secret_key(item.value) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(document) = 'array' then
    for item in select value from jsonb_array_elements(document)
    loop
      if luzione_api_private.jsonb_contains_secret_key(item.value) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

revoke all on function luzione_api_private.jsonb_contains_secret_key(jsonb) from public, anon, authenticated;
grant execute on function luzione_api_private.jsonb_contains_secret_key(jsonb) to service_role;

create or replace function luzione_api_private.guard_tenant_code_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.code is distinct from new.code then
    raise exception 'Canonical tenant codes are immutable.';
  end if;
  return new;
end;
$$;

revoke all on function luzione_api_private.guard_tenant_code_mutation() from public, anon, authenticated;
grant execute on function luzione_api_private.guard_tenant_code_mutation() to service_role;

create trigger tenant_accounts_immutable_code
before update of code on public.tenant_accounts
for each row execute function luzione_api_private.guard_tenant_code_mutation();

create table public.platform_object_ownership_registry (
  object_schema text not null,
  object_name text not null,
  owner_repository text not null,
  previous_owner_repository text,
  ownership_contract_version text not null,
  transferred_at timestamptz not null default now(),
  transfer_evidence_ref text not null,
  primary key (object_schema, object_name),
  constraint platform_object_ownership_name_check check (
    object_schema ~ '^[a-z][a-z0-9_]*$' and object_name ~ '^[a-z][a-z0-9_]*$'
  )
);

create table public.tenant_legacy_id_mappings (
  canonical_tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  legacy_system text not null,
  legacy_tenant_id text not null,
  verified_at timestamptz,
  verification_ref text,
  created_at timestamptz not null default now(),
  primary key (legacy_system, legacy_tenant_id),
  unique (canonical_tenant_id, legacy_system),
  constraint tenant_legacy_id_system_check check (legacy_system ~ '^[a-z][a-z0-9._-]+$')
);

create table public.platform_identities (
  identity_id text primary key,
  identity_type text not null check (identity_type in ('USER','SERVICE','AGENT')),
  auth_user_id uuid unique references public.auth_users(user_id) on delete restrict,
  display_name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','REVOKED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_identity_id_check check (identity_id ~ '^(user|service|agent):[A-Za-z0-9._:@-]{1,190}$'),
  constraint platform_identity_user_binding_check check (
    (identity_type = 'USER' and auth_user_id is not null)
    or (identity_type <> 'USER' and auth_user_id is null)
  )
);

create table public.tenant_memberships (
  membership_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  identity_id text not null references public.platform_identities(identity_id) on delete cascade,
  role text not null,
  capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(capabilities) = 'array'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','REVOKED')),
  source text not null default 'PLATFORM' check (source in ('BACKFILL','PLATFORM')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, identity_id),
  constraint tenant_membership_role_check check (role ~ '^[A-Za-z][A-Za-z0-9 _.-]{1,63}$'),
  constraint tenant_membership_revocation_check check (
    (status = 'REVOKED' and revoked_at is not null) or status <> 'REVOKED'
  )
);

create table public.integration_capability_registry (
  provider text not null,
  capability text not null,
  authority_contract_version text not null default 'luzione-authority/v2',
  authority_class text not null check (authority_class in ('A0','A1','A2','A3','A4')),
  operation_kind text not null check (operation_kind in ('READ','INTERNAL','EXTERNAL','PROHIBITED')),
  provider_effect boolean not null,
  ai_allowed boolean not null default false,
  approval_required boolean not null default false,
  compensation_required boolean not null default false,
  adapter_version text not null,
  enabled boolean not null default true,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, capability),
  constraint integration_capability_provider_check check (provider ~ '^[a-z][a-z0-9._-]+$'),
  constraint integration_capability_code_check check (capability ~ '^[a-z][a-z0-9._-]+$'),
  constraint integration_capability_a4_check check (
    authority_class <> 'A4' or (operation_kind = 'PROHIBITED' and not enabled)
  ),
  constraint integration_capability_approval_check check (
    authority_class <> 'A3' or approval_required
  )
);

create table public.integration_connections (
  connection_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  provider text not null,
  display_name text not null,
  state text not null default 'DISCONNECTED' check (state in (
    'DISCONNECTED','CONNECTING','CONNECTED','DEGRADED','ERROR','REVOKED','LEGACY_MANAGED'
  )),
  auth_method text not null check (auth_method in ('OAUTH2','API_KEY','BASIC','DATABASE','NONE','LEGACY')),
  secret_ref text,
  external_account_id text,
  scopes jsonb not null default '[]'::jsonb check (jsonb_typeof(scopes) = 'array'),
  configuration jsonb not null default '{}'::jsonb check (
    jsonb_typeof(configuration) = 'object'
    and not luzione_api_private.jsonb_contains_secret_key(configuration)
  ),
  adapter_version text not null,
  token_expires_at timestamptz,
  last_validated_at timestamptz,
  last_validation_status text check (last_validation_status is null or last_validation_status in ('PASS','WARN','FAIL')),
  last_error_code text,
  last_error_summary text,
  kill_switch_active boolean not null default true,
  legacy_source_ref text,
  created_by_identity_id text not null references public.platform_identities(identity_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, connection_id),
  constraint integration_connection_provider_check check (provider ~ '^[a-z][a-z0-9._-]+$'),
  constraint integration_connection_secret_ref_check check (
    secret_ref is null
    or (
      secret_ref ~ '^(vault|legacy|env):[A-Za-z0-9._:/@-]+$'
      and char_length(secret_ref) <= 507
    )
  ),
  constraint integration_connection_active_secret_check check (
    state in ('DISCONNECTED','REVOKED') or auth_method = 'NONE' or secret_ref is not null
  ),
  constraint integration_connection_legacy_check check (
    state <> 'LEGACY_MANAGED' or (auth_method = 'LEGACY' and legacy_source_ref is not null)
  )
);

create table public.integration_connection_capabilities (
  tenant_id uuid not null,
  connection_id uuid not null,
  provider text not null,
  capability text not null,
  enabled boolean not null default false,
  resource_scope jsonb not null default '[]'::jsonb check (jsonb_typeof(resource_scope) = 'array'),
  budget_policy_ref text,
  updated_by_identity_id text not null references public.platform_identities(identity_id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, connection_id, capability),
  foreign key (tenant_id, connection_id)
    references public.integration_connections(tenant_id, connection_id) on delete cascade,
  foreign key (provider, capability)
    references public.integration_capability_registry(provider, capability) on delete restrict
);

create table public.integration_sync_runs (
  sync_run_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  connection_id uuid not null,
  capability text not null,
  state text not null check (state in (
    'PLANNED','RUNNING','WAITING_FOR_PROVIDER','RECONCILIATION_REQUIRED',
    'COMPLETED','FAILED','CANCELLED','DEAD_LETTERED'
  )),
  idempotency_key text not null,
  correlation_id text not null,
  cursor_checkpoint jsonb not null default '{}'::jsonb check (jsonb_typeof(cursor_checkpoint) = 'object'),
  records_observed integer not null default 0 check (records_observed >= 0),
  records_committed integer not null default 0 check (records_committed >= 0),
  external_write_authorized boolean not null default false,
  source_readback_ref text,
  estimated_cost jsonb,
  actual_cost jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  last_error_code text,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, connection_id, capability, idempotency_key),
  foreign key (tenant_id, connection_id)
    references public.integration_connections(tenant_id, connection_id) on delete restrict,
  constraint integration_sync_complete_readback_check check (
    state <> 'COMPLETED' or source_readback_ref is not null
  )
);

create table public.integration_webhook_receipts (
  webhook_receipt_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  connection_id uuid not null,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  deduplication_key text not null,
  signature_status text not null check (signature_status in ('VERIFIED','REJECTED')),
  state text not null check (state in ('RECEIVED','PROCESSED','DUPLICATE','REJECTED','DEAD_LETTERED')),
  normalized_event_ref text,
  correlation_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (tenant_id, provider, provider_event_id),
  unique (tenant_id, provider, deduplication_key),
  foreign key (tenant_id, connection_id)
    references public.integration_connections(tenant_id, connection_id) on delete restrict,
  constraint integration_webhook_verified_processing_check check (
    state not in ('PROCESSED','DUPLICATE') or signature_status = 'VERIFIED'
  )
);

create table public.platform_effect_approvals (
  approval_id text primary key,
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  authority_contract_version text not null check (authority_contract_version = 'luzione-authority/v2'),
  authority_class text not null check (authority_class = 'A3'),
  capability text not null,
  action_id text not null,
  action_version text not null,
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  provider text not null,
  resource_scope jsonb not null check (jsonb_typeof(resource_scope) = 'array'),
  estimated_cost jsonb not null,
  requested_by_identity_id text not null references public.platform_identities(identity_id),
  approved_by_identity_id text references public.platform_identities(identity_id),
  status text not null default 'REQUESTED' check (status in (
    'REQUESTED','APPROVED','DENIED','EXPIRED','CONSUMED','REVOKED'
  )),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  consumed_by_command_id text,
  decision_rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_effect_approval_scope_check check (jsonb_array_length(resource_scope) > 0),
  constraint platform_effect_approval_state_check check (
    (status in ('APPROVED','CONSUMED') and approved_by_identity_id is not null and approved_at is not null)
    or status not in ('APPROVED','CONSUMED')
  ),
  constraint platform_effect_approval_consumed_check check (
    (status = 'CONSUMED' and consumed_at is not null and consumed_by_command_id is not null)
    or status <> 'CONSUMED'
  )
);

create or replace function luzione_api_private.guard_effect_approval_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Effect approval receipts are immutable and cannot be deleted.';
  end if;
  if row(
    old.approval_id, old.tenant_id, old.authority_contract_version, old.authority_class,
    old.capability, old.action_id, old.action_version, old.content_digest,
    old.provider, old.resource_scope, old.estimated_cost, old.requested_by_identity_id,
    old.expires_at, old.created_at
  ) is distinct from row(
    new.approval_id, new.tenant_id, new.authority_contract_version, new.authority_class,
    new.capability, new.action_id, new.action_version, new.content_digest,
    new.provider, new.resource_scope, new.estimated_cost, new.requested_by_identity_id,
    new.expires_at, new.created_at
  ) then
    raise exception 'Effect approval scope is immutable.';
  end if;
  if not (
    (old.status = 'REQUESTED' and new.status in ('APPROVED','DENIED','EXPIRED','REVOKED'))
    or (old.status = 'APPROVED' and new.status in ('CONSUMED','EXPIRED','REVOKED'))
    or old.status = new.status
  ) then
    raise exception 'Invalid effect approval transition % -> %.', old.status, new.status;
  end if;
  if old.status <> 'REQUESTED' and row(
    old.approved_by_identity_id, old.approved_at, old.decision_rationale
  ) is distinct from row(
    new.approved_by_identity_id, new.approved_at, new.decision_rationale
  ) then
    raise exception 'Effect approval decision evidence is immutable after decision.';
  end if;
  return new;
end;
$$;

revoke all on function luzione_api_private.guard_effect_approval_mutation() from public, anon, authenticated;
grant execute on function luzione_api_private.guard_effect_approval_mutation() to service_role;

create trigger platform_effect_approvals_guard
before update or delete on public.platform_effect_approvals
for each row execute function luzione_api_private.guard_effect_approval_mutation();

create table public.platform_usage_events (
  usage_event_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  identity_id text not null references public.platform_identities(identity_id),
  correlation_id text not null,
  command_id text,
  connection_id uuid,
  provider text not null,
  model text,
  usage_kind text not null check (usage_kind in ('MODEL','PROVIDER','FINANCIAL')),
  input_units bigint not null default 0 check (input_units >= 0),
  output_units bigint not null default 0 check (output_units >= 0),
  estimated_cost jsonb,
  actual_cost jsonb,
  price_catalog_ref text,
  provider_request_ref text,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (tenant_id, provider, provider_request_ref),
  foreign key (tenant_id, connection_id)
    references public.integration_connections(tenant_id, connection_id) on delete restrict
);

create table public.tenant_budget_policies (
  budget_policy_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete cascade,
  scope_type text not null check (scope_type in ('GLOBAL','PROVIDER','MODEL','CONNECTION','CAPABILITY','WORKFLOW')),
  scope_ref text not null,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  soft_limit numeric(18,6) not null check (soft_limit >= 0),
  hard_limit numeric(18,6) not null check (hard_limit >= soft_limit),
  period text not null check (period in ('RUN','DAY','MONTH')),
  active boolean not null default true,
  updated_by_identity_id text not null references public.platform_identities(identity_id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, scope_type, scope_ref, period)
);

create table public.model_price_catalog (
  price_catalog_id text primary key,
  provider text not null,
  model text not null,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  input_price_per_million numeric(18,6) not null check (input_price_per_million >= 0),
  cached_input_price_per_million numeric(18,6) check (cached_input_price_per_million >= 0),
  output_price_per_million numeric(18,6) not null check (output_price_per_million >= 0),
  effective_from timestamptz not null,
  effective_until timestamptz,
  source_url text not null,
  observed_at timestamptz not null,
  active boolean not null default true,
  unique (provider, model, effective_from),
  constraint model_price_window_check check (effective_until is null or effective_until > effective_from)
);

create table public.tenant_secret_backend_settings (
  tenant_id uuid primary key references public.tenant_accounts(tenant_id) on delete cascade,
  backend text not null check (backend in ('VAULT','LEGACY','ENVIRONMENT')),
  allow_new_secret_writes boolean not null default false,
  validation_status text not null default 'NOT_VALIDATED' check (
    validation_status in ('NOT_VALIDATED','PASS','FAIL')
  ),
  validated_at timestamptz,
  validation_evidence_ref text,
  updated_by_identity_id text not null references public.platform_identities(identity_id),
  updated_at timestamptz not null default now(),
  constraint tenant_secret_backend_write_check check (
    not allow_new_secret_writes or validation_status = 'PASS'
  )
);

alter table public.policy_evaluations
  add column if not exists authority_contract_version text,
  add column if not exists authority_class text,
  add column if not exists capability text,
  add column if not exists resource_scope jsonb,
  add column if not exists estimated_cost jsonb,
  add column if not exists approval_id text,
  add column if not exists correlation_id text;

alter table public.p110_command_receipts
  add column if not exists canonical_tenant_id uuid references public.tenant_accounts(tenant_id),
  add column if not exists authority_contract_version text,
  add column if not exists authority_class text,
  add column if not exists capability text,
  add column if not exists policy_decision_id text,
  add column if not exists approval_id text references public.platform_effect_approvals(approval_id),
  add column if not exists resource_scope jsonb,
  add column if not exists estimated_cost jsonb,
  add column if not exists actual_cost jsonb,
  add column if not exists compensation_plan_ref text;

alter table public.p110_command_receipts
  add constraint p110_authority_v2_envelope_check check (
    authority_contract_version is distinct from 'luzione-authority/v2'
    or (
      canonical_tenant_id is not null
      and authority_class in ('A0','A1','A2','A3','A4')
      and capability ~ '^[a-z][a-z0-9._-]+$'
      and policy_decision_id is not null
      and jsonb_typeof(resource_scope) = 'array'
      and (authority_class <> 'A3' or approval_id is not null)
      and (authority_class <> 'A4' or state = 'BLOCKED')
      and (
        authority_class <> 'A2'
        or compensation_plan_ref is not null
        or coalesce(metadata->>'safeReconciliationPlanned','false') = 'true'
      )
    )
  ) not valid;

alter table public.p110_event_envelopes
  add column if not exists canonical_tenant_id uuid references public.tenant_accounts(tenant_id),
  add column if not exists authority_contract_version text;

alter table public.p110_outbox_messages
  add column if not exists canonical_tenant_id uuid references public.tenant_accounts(tenant_id),
  add column if not exists authority_contract_version text,
  add column if not exists authority_class text,
  add column if not exists provider_connection_id uuid references public.integration_connections(connection_id),
  add column if not exists approval_id text references public.platform_effect_approvals(approval_id);

alter table public.p110_outbox_messages
  add constraint p110_outbox_authority_v2_check check (
    authority_contract_version is distinct from 'luzione-authority/v2'
    or (
      canonical_tenant_id is not null
      and authority_class in ('A1','A2','A3')
      and (authority_class <> 'A3' or approval_id is not null)
    )
  ) not valid;

alter table public.p110_kill_switches
  add column if not exists canonical_tenant_id uuid references public.tenant_accounts(tenant_id);

alter table public.p110_kill_switches drop constraint if exists p110_kill_switch_scope_check;
alter table public.p110_kill_switches add constraint p110_kill_switch_scope_check check (
  scope_type in (
    'GLOBAL','DESTINATION','WORKFLOW_DEFINITION','WORKFLOW_INSTANCE','COMMAND_TYPE',
    'CONNECTION','CAPABILITY','MODEL','PROVIDER'
  )
);

alter table public.p111_workflow_instances
  add column if not exists canonical_tenant_id uuid references public.tenant_accounts(tenant_id),
  add column if not exists connection_id uuid references public.integration_connections(connection_id);

insert into public.tenant_legacy_id_mappings
  (canonical_tenant_id, legacy_system, legacy_tenant_id, verified_at, verification_ref)
select ta.tenant_id, 'luzione-ui', app.tenant_id, now(), 'platform-control-plane-v2-backfill'
from public.app_tenants app
join public.tenant_accounts ta
  on lower(ta.code) = lower(app.tenant_id)
  or (app.tenant_id = 'luzione' and ta.code = 'LUZIONE_INTERNAL')
on conflict (legacy_system, legacy_tenant_id) do nothing;

insert into public.platform_identities
  (identity_id, identity_type, auth_user_id, display_name, status)
select 'user:' || au.user_id::text, 'USER', au.user_id, au.name, 'ACTIVE'
from public.auth_users au
on conflict (identity_id) do nothing;

insert into public.platform_identities
  (identity_id, identity_type, display_name, status)
values ('service:legacy-import', 'SERVICE', 'Legacy connection migration', 'ACTIVE')
on conflict (identity_id) do nothing;

insert into public.tenant_memberships
  (tenant_id, identity_id, role, status, source, revoked_at)
select
  mapping.canonical_tenant_id,
  'user:' || membership.user_id::text,
  membership.role,
  case membership.status
    when 'active' then 'ACTIVE'
    when 'suspended' then 'SUSPENDED'
    when 'revoked' then 'REVOKED'
  end,
  'BACKFILL',
  case when membership.status = 'revoked' then membership.updated_at end
from (
  select tenant_id, user_id, role, status, updated_at
  from public.auth_tenant_memberships
  union all
  select user_row.tenant_id, user_row.user_id, user_row.role, 'active', user_row.created_at
  from public.auth_users user_row
  where not exists (
    select 1
    from public.auth_tenant_memberships existing
    where existing.tenant_id = user_row.tenant_id
      and existing.user_id = user_row.user_id
  )
) membership
join public.tenant_legacy_id_mappings mapping
  on mapping.legacy_system = 'luzione-ui'
 and mapping.legacy_tenant_id = membership.tenant_id
on conflict (tenant_id, identity_id) do nothing;

insert into public.tenant_memberships
  (tenant_id, identity_id, role, status, source)
select mapping.canonical_tenant_id, 'service:legacy-import', 'SYSTEM_MIGRATION', 'ACTIVE', 'BACKFILL'
from public.tenant_legacy_id_mappings mapping
where mapping.legacy_system = 'luzione-ui'
on conflict (tenant_id, identity_id) do nothing;

insert into public.integration_connections
  (connection_id, tenant_id, provider, display_name, state, auth_method, secret_ref,
   external_account_id, scopes, adapter_version, token_expires_at,
   last_validation_status, last_error_summary, legacy_source_ref, created_by_identity_id,
   created_at, updated_at)
select
  gen_random_uuid(),
  mapping.canonical_tenant_id,
  regexp_replace(lower(account.provider), '[^a-z0-9._-]+', '-', 'g'),
  account.display_name,
  'LEGACY_MANAGED',
  'LEGACY',
  'legacy:connected_accounts/' || account.id,
  coalesce(account.account_external_id, account.business_external_id),
  account.scopes_granted,
  'legacy-v1',
  account.token_expires_at,
  case when account.last_error is null then 'WARN' else 'FAIL' end,
  account.last_error,
  'connected_accounts:' || account.id,
  'service:legacy-import',
  account.created_at,
  account.updated_at
from public.connected_accounts account
join public.tenant_legacy_id_mappings mapping
  on mapping.legacy_system = 'luzione-ui'
 and mapping.legacy_tenant_id = 'luzione'
where not exists (
  select 1 from public.integration_connections existing
  where existing.tenant_id = mapping.canonical_tenant_id
    and existing.legacy_source_ref = 'connected_accounts:' || account.id
);

insert into public.integration_connections
  (connection_id, tenant_id, provider, display_name, state, auth_method, secret_ref,
   external_account_id, scopes, adapter_version, last_validation_status,
   last_error_summary, legacy_source_ref, created_by_identity_id, created_at, updated_at)
select
  gen_random_uuid(),
  mapping.canonical_tenant_id,
  regexp_replace(lower(credential.provider), '[^a-z0-9._-]+', '-', 'g'),
  credential.account_label,
  'LEGACY_MANAGED',
  'LEGACY',
  'legacy:manual_connector_credentials/' || credential.id,
  credential.external_account_id,
  credential.scopes,
  'legacy-v1',
  case credential.last_test_status when 'success' then 'WARN' when 'failed' then 'FAIL' else null end,
  credential.last_error,
  'manual_connector_credentials:' || credential.id,
  'service:legacy-import',
  credential.created_at,
  credential.updated_at
from public.manual_connector_credentials credential
join public.tenant_legacy_id_mappings mapping
  on mapping.legacy_system = 'luzione-ui'
 and mapping.legacy_tenant_id = credential.organization_id
where not exists (
  select 1 from public.integration_connections existing
  where existing.tenant_id = mapping.canonical_tenant_id
    and existing.legacy_source_ref = 'manual_connector_credentials:' || credential.id
);

update public.p110_command_receipts receipt
set canonical_tenant_id = mapping.canonical_tenant_id,
    authority_contract_version = coalesce(receipt.authority_contract_version, 'luzione-authority/v1')
from public.tenant_legacy_id_mappings mapping
where mapping.legacy_system = 'luzione-ui'
  and mapping.legacy_tenant_id = receipt.tenant_id
  and receipt.canonical_tenant_id is null;

update public.p110_outbox_messages message
set canonical_tenant_id = mapping.canonical_tenant_id,
    authority_contract_version = coalesce(message.authority_contract_version, 'luzione-authority/v1')
from public.tenant_legacy_id_mappings mapping
where mapping.legacy_system = 'luzione-ui'
  and mapping.legacy_tenant_id = message.tenant_id
  and message.canonical_tenant_id is null;

update public.p110_event_envelopes event
set canonical_tenant_id = mapping.canonical_tenant_id,
    authority_contract_version = coalesce(event.authority_contract_version, 'luzione-authority/v1')
from public.tenant_legacy_id_mappings mapping
where mapping.legacy_system = 'luzione-ui'
  and mapping.legacy_tenant_id = event.tenant_id
  and event.canonical_tenant_id is null;

update public.p110_kill_switches switch
set canonical_tenant_id = mapping.canonical_tenant_id
from public.tenant_legacy_id_mappings mapping
where mapping.legacy_system = 'luzione-ui'
  and mapping.legacy_tenant_id = switch.tenant_id
  and switch.canonical_tenant_id is null;

update public.p111_workflow_instances workflow
set canonical_tenant_id = mapping.canonical_tenant_id
from public.tenant_legacy_id_mappings mapping
where mapping.legacy_system = 'luzione-ui'
  and mapping.legacy_tenant_id = workflow.tenant_id
  and workflow.canonical_tenant_id is null;

insert into public.integration_capability_registry
  (provider, capability, authority_class, operation_kind, provider_effect, ai_allowed,
   approval_required, compensation_required, adapter_version, enabled, description)
values
  ('gmail','email.read','A0','READ',false,true,false,false,'v1',true,'Read tenant-authorized mailbox metadata and content.'),
  ('gmail','email.draft.create','A1','INTERNAL',false,true,false,false,'v1',true,'Create an internal review draft without sending.'),
  ('gmail','email.send','A3','EXTERNAL',true,false,true,false,'v1',true,'Send exact approved content to an approved recipient.'),
  ('google-drive','file.read','A0','READ',false,true,false,false,'v1',true,'Read authorized Drive files.'),
  ('google-drive','proposal.artifact.create','A2','EXTERNAL',true,false,false,true,'v1',true,'Create a private reversible proposal artifact.'),
  ('shopify','catalog.read','A0','READ',false,true,false,false,'v1',true,'Read and reconcile the product catalog.'),
  ('shopify','product.draft.update','A2','EXTERNAL',true,false,false,true,'v1',true,'Update a reversible product draft.'),
  ('shopify','product.publish','A3','EXTERNAL',true,false,true,false,'v1',true,'Publish an exact approved product version.'),
  ('quickbooks','chart-of-accounts.read','A0','READ',false,true,false,false,'v1',true,'Read chart-of-accounts metadata.'),
  ('quickbooks','transaction.write','A3','EXTERNAL',true,false,true,false,'v1',true,'Create a binding accounting transaction.'),
  ('airtable','records.read','A0','READ',false,true,false,false,'v1',true,'Read authorized Airtable records.'),
  ('airtable','record.sync','A2','EXTERNAL',true,false,false,true,'v1',true,'Synchronize a bounded reversible record set.'),
  ('apollo','contact.enrich','A0','READ',false,true,false,false,'v1',true,'Read enrichment evidence.'),
  ('apollo','sequence.enroll','A3','EXTERNAL',true,false,true,false,'v1',true,'Enroll an approved contact in an outreach sequence.'),
  ('meta','analytics.read','A0','READ',false,true,false,false,'v1',true,'Read Meta analytics evidence.'),
  ('meta-ads','campaign.update','A3','EXTERNAL',true,false,true,false,'v1',true,'Change an approved paid campaign.'),
  ('linkedin','analytics.read','A0','READ',false,true,false,false,'v1',true,'Read LinkedIn analytics evidence.'),
  ('linkedin-ads','campaign.update','A3','EXTERNAL',true,false,true,false,'v1',true,'Change an approved paid campaign.'),
  ('n8n','workflow.trigger','A2','EXTERNAL',true,false,false,true,'v1',true,'Trigger a bounded reversible workflow.'),
  ('postgres','data.read','A0','READ',false,true,false,false,'v1',true,'Read canonical tenant-scoped data.'),
  ('postgres','task.internal.create','A1','INTERNAL',false,true,false,false,'v1',true,'Create an internal task.'),
  ('easyship','quote.read','A0','READ',false,true,false,false,'v1',true,'Read a shipping quote.'),
  ('easyship','shipment.book','A3','EXTERNAL',true,false,true,false,'v1',true,'Book an approved shipment.'),
  ('rxo','quote.read','A0','READ',false,true,false,false,'v1',true,'Read a freight quote.'),
  ('rxo','freight.book','A3','EXTERNAL',true,false,true,false,'v1',true,'Book approved freight.'),
  ('posthog','events.read','A0','READ',false,true,false,false,'v1',true,'Read tenant-attributed product analytics.'),
  ('openai','response.create','A0','READ',false,true,false,false,'v1',true,'Create a governed reasoning response with no operational effect.'),
  ('public-research','source.read','A0','READ',false,true,false,false,'v1',true,'Read public evidence with provenance.'),
  ('platform','authority.self-grant','A4','PROHIBITED',false,false,false,false,'v1',false,'Self-granted authority is prohibited.'),
  ('platform','audit.delete','A4','PROHIBITED',false,false,false,false,'v1',false,'Audit deletion is prohibited.'),
  ('platform','kill-switch.bypass','A4','PROHIBITED',false,false,false,false,'v1',false,'Kill-switch bypass is prohibited.')
on conflict (provider, capability) do update set
  authority_contract_version = excluded.authority_contract_version,
  authority_class = excluded.authority_class,
  operation_kind = excluded.operation_kind,
  provider_effect = excluded.provider_effect,
  ai_allowed = excluded.ai_allowed,
  approval_required = excluded.approval_required,
  compensation_required = excluded.compensation_required,
  adapter_version = excluded.adapter_version,
  enabled = excluded.enabled,
  description = excluded.description,
  updated_at = now();

insert into public.model_price_catalog
  (price_catalog_id, provider, model, input_price_per_million,
   cached_input_price_per_million, output_price_per_million, effective_from,
   source_url, observed_at)
values
  ('openai:gpt-5.6-luna:2026-08-28','openai','gpt-5.6-luna',0.20,null,1.20,
   '2026-08-28T00:00:00Z','https://developers.openai.com/api/docs/models','2026-08-28T00:00:00Z'),
  ('openai:gpt-5.6-terra:2026-08-28','openai','gpt-5.6-terra',2.00,0.20,12.00,
   '2026-08-28T00:00:00Z','https://developers.openai.com/api/docs/models','2026-08-28T00:00:00Z'),
  ('openai:gpt-5.6-sol:2026-08-28','openai','gpt-5.6-sol',4.00,null,20.00,
   '2026-08-28T00:00:00Z','https://developers.openai.com/api/docs/models','2026-08-28T00:00:00Z')
on conflict (price_catalog_id) do nothing;

insert into public.platform_object_ownership_registry
  (object_schema, object_name, owner_repository, previous_owner_repository,
   ownership_contract_version, transfer_evidence_ref)
values
  ('public','p110_command_receipts','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p110_event_envelopes','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p110_outbox_messages','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p110_inbox_messages','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p110_delivery_attempts','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p110_reconciliation_checkpoints','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p110_dead_letters','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p110_idempotency_conflicts','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p110_kill_switches','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p111_workflow_instances','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2'),
  ('public','p111_workflow_checkpoints','CIBOTFLOW/Luzione-API','CIBOTFLOW/Luzione-UI','platform-ownership/v1','platform-control-plane-v2')
on conflict (object_schema, object_name) do update set
  owner_repository = excluded.owner_repository,
  previous_owner_repository = excluded.previous_owner_repository,
  ownership_contract_version = excluded.ownership_contract_version,
  transfer_evidence_ref = excluded.transfer_evidence_ref,
  transferred_at = now();

create index tenant_memberships_identity_status_idx
  on public.tenant_memberships (identity_id, status, tenant_id);
create index integration_connections_tenant_state_idx
  on public.integration_connections (tenant_id, state, provider);
create index integration_sync_runs_due_idx
  on public.integration_sync_runs (state, next_attempt_at, created_at)
  where state in ('PLANNED','WAITING_FOR_PROVIDER','RECONCILIATION_REQUIRED');
create index integration_webhook_receipts_connection_received_idx
  on public.integration_webhook_receipts (connection_id, received_at desc);
create index platform_effect_approvals_tenant_status_idx
  on public.platform_effect_approvals (tenant_id, status, expires_at);
create index platform_usage_events_tenant_observed_idx
  on public.platform_usage_events (tenant_id, observed_at desc);
create index p110_command_receipts_canonical_tenant_idx
  on public.p110_command_receipts (canonical_tenant_id, requested_at desc)
  where canonical_tenant_id is not null;
create index p110_outbox_messages_canonical_due_idx
  on public.p110_outbox_messages (canonical_tenant_id, state, not_before)
  where canonical_tenant_id is not null
    and state in ('PENDING','RETRY_SCHEDULED','RECONCILIATION_REQUIRED');
create index p111_workflow_instances_canonical_attention_idx
  on public.p111_workflow_instances (canonical_tenant_id, state, last_transition_at)
  where canonical_tenant_id is not null
    and state not in ('COMPLETED','CANCELLED','SUPERSEDED');

alter table public.platform_object_ownership_registry enable row level security;
alter table public.tenant_legacy_id_mappings enable row level security;
alter table public.platform_identities enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.integration_capability_registry enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_connection_capabilities enable row level security;
alter table public.integration_sync_runs enable row level security;
alter table public.integration_webhook_receipts enable row level security;
alter table public.platform_effect_approvals enable row level security;
alter table public.platform_usage_events enable row level security;
alter table public.tenant_budget_policies enable row level security;
alter table public.model_price_catalog enable row level security;
alter table public.tenant_secret_backend_settings enable row level security;

alter table public.platform_object_ownership_registry force row level security;
alter table public.tenant_legacy_id_mappings force row level security;
alter table public.platform_identities force row level security;
alter table public.tenant_memberships force row level security;
alter table public.integration_capability_registry force row level security;
alter table public.integration_connections force row level security;
alter table public.integration_connection_capabilities force row level security;
alter table public.integration_sync_runs force row level security;
alter table public.integration_webhook_receipts force row level security;
alter table public.platform_effect_approvals force row level security;
alter table public.platform_usage_events force row level security;
alter table public.tenant_budget_policies force row level security;
alter table public.model_price_catalog force row level security;
alter table public.tenant_secret_backend_settings force row level security;

revoke all on table public.platform_object_ownership_registry from public, anon, authenticated, service_role;
revoke all on table public.tenant_legacy_id_mappings from public, anon, authenticated, service_role;
revoke all on table public.platform_identities from public, anon, authenticated, service_role;
revoke all on table public.tenant_memberships from public, anon, authenticated, service_role;
revoke all on table public.integration_capability_registry from public, anon, authenticated, service_role;
revoke all on table public.integration_connections from public, anon, authenticated, service_role;
revoke all on table public.integration_connection_capabilities from public, anon, authenticated, service_role;
revoke all on table public.integration_sync_runs from public, anon, authenticated, service_role;
revoke all on table public.integration_webhook_receipts from public, anon, authenticated, service_role;
revoke all on table public.platform_effect_approvals from public, anon, authenticated, service_role;
revoke all on table public.platform_usage_events from public, anon, authenticated, service_role;
revoke all on table public.tenant_budget_policies from public, anon, authenticated, service_role;
revoke all on table public.model_price_catalog from public, anon, authenticated, service_role;
revoke all on table public.tenant_secret_backend_settings from public, anon, authenticated, service_role;

grant select on table public.platform_object_ownership_registry to service_role;
grant select, insert, update on table public.tenant_legacy_id_mappings to service_role;
grant select, insert, update on table public.platform_identities to service_role;
grant select, insert, update on table public.tenant_memberships to service_role;
grant select, insert, update on table public.integration_capability_registry to service_role;
grant select, insert, update on table public.integration_connections to service_role;
grant select, insert, update on table public.integration_connection_capabilities to service_role;
grant select, insert, update on table public.integration_sync_runs to service_role;
grant select, insert, update on table public.integration_webhook_receipts to service_role;
grant select, insert, update on table public.platform_effect_approvals to service_role;
grant select, insert on table public.platform_usage_events to service_role;
grant select, insert, update on table public.tenant_budget_policies to service_role;
grant select, insert on table public.model_price_catalog to service_role;
grant select, insert, update on table public.tenant_secret_backend_settings to service_role;

commit;
