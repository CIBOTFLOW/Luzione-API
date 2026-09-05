begin;

do $$
begin
  if to_regclass('public.accounts') is null then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S requires canonical public.accounts';
  end if;
  if to_regclass('public.seed_procurement_evidence_artifacts') is null then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S requires admitted A3 EvidenceArtifact persistence';
  end if;
  if to_regclass('public.p110_command_receipts') is null then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S requires the P110 command ledger';
  end if;
end $$;

create table public.seed_supplier_profile_versions (
  tenant_id text not null,
  supplier_profile_id text not null,
  version integer not null check (version >= 1),
  account_id text not null,
  account_version text not null,
  status text not null check (status in ('ARCHIVED','ELIGIBLE','EXPIRED','PROPOSED','REVOKED','SUSPENDED')),
  capabilities jsonb not null check (jsonb_typeof(capabilities) = 'array' and jsonb_array_length(capabilities) > 0),
  approved_categories jsonb not null check (jsonb_typeof(approved_categories) = 'array' and jsonb_array_length(approved_categories) > 0),
  approved_regions jsonb not null check (jsonb_typeof(approved_regions) = 'array' and jsonb_array_length(approved_regions) > 0),
  contact_refs jsonb not null check (jsonb_typeof(contact_refs) = 'array'),
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) > 0),
  provenance_refs jsonb not null check (jsonb_typeof(provenance_refs) = 'array' and jsonb_array_length(provenance_refs) > 0),
  identity_conflict_refs jsonb not null check (jsonb_typeof(identity_conflict_refs) = 'array'),
  duplicate_account_refs jsonb not null check (jsonb_typeof(duplicate_account_refs) = 'array'),
  valid_from timestamptz not null,
  valid_until timestamptz not null check (valid_until > valid_from),
  transition_action text not null check (transition_action in ('ACTIVATE','ARCHIVE','EXPIRE','PROPOSE','REVISE','REVOKE','SUSPEND')),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  command_payload jsonb not null check (jsonb_typeof(command_payload) = 'object'),
  command_payload_hash text not null check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  object_version text not null,
  expected_object_version text not null,
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type in ('agent','service','user')),
  proposal_actor_id text not null,
  proposer_authentication_ref text not null,
  human_authentication_ref text,
  created_at timestamptz not null,
  primary key (tenant_id, supplier_profile_id, version),
  unique (tenant_id, supplier_profile_id, object_version),
  unique (tenant_id, account_id, version),
  foreign key (tenant_id, created_command_id)
    references public.p110_command_receipts(tenant_id, command_id)
    deferrable initially deferred
);

create table public.seed_supplier_portal_account_binding_versions (
  tenant_id text not null,
  binding_id text not null,
  version integer not null check (version >= 1),
  organization_id text not null,
  account_id text not null,
  account_version text not null,
  membership_ref jsonb not null check (jsonb_typeof(membership_ref)='object'),
  object_grant_ref jsonb not null check (jsonb_typeof(object_grant_ref)='object'),
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs)='array' and jsonb_array_length(evidence_refs)>0),
  status text not null check (status in ('ACTIVE','REVOKED')),
  revocation_ref text,
  object_version text not null,
  expected_object_version text not null,
  command_payload jsonb not null check (jsonb_typeof(command_payload)='object'),
  command_payload_hash text not null check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  created_command_id text not null,
  created_by text not null,
  created_by_type text not null check (created_by_type='user'),
  human_authentication_ref text not null,
  workload_actor_id text not null check (workload_actor_id='service:luzione-supplier-portal'),
  created_at timestamptz not null,
  primary key (tenant_id,binding_id,version),
  unique (tenant_id,binding_id,object_version),
  unique (tenant_id,organization_id,version),
  foreign key (tenant_id,created_command_id)
    references public.p110_command_receipts(tenant_id,command_id)
    deferrable initially deferred,
  check ((status='ACTIVE' and revocation_ref is null) or (status='REVOKED' and revocation_ref is not null))
);

create index seed_supplier_profiles_account_latest_idx
  on public.seed_supplier_profile_versions (tenant_id, account_id, version desc);
create index seed_supplier_profiles_status_validity_idx
  on public.seed_supplier_profile_versions (tenant_id, status, valid_until, supplier_profile_id);
create index seed_supplier_profiles_capabilities_idx
  on public.seed_supplier_profile_versions using gin (capabilities);
create index seed_supplier_portal_bindings_org_latest_idx
  on public.seed_supplier_portal_account_binding_versions (tenant_id,organization_id,version desc);
create index seed_supplier_portal_bindings_account_latest_idx
  on public.seed_supplier_portal_account_binding_versions (tenant_id,account_id,version desc);

create function public.seed_supplier_identity_a2s_reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SEED-SUPPLIER-IDENTITY-A2S versions are immutable; append a new exact version';
end
$$;

revoke all on function public.seed_supplier_identity_a2s_reject_mutation() from public;

create function public.seed_supplier_identity_a2s_validate_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  account_source_version text;
  expected_object_version text;
  prior_row public.seed_supplier_profile_versions%rowtype;
begin
  if new.tenant_id<>btrim(new.tenant_id) or new.tenant_id=''
    or new.supplier_profile_id<>btrim(new.supplier_profile_id) or new.supplier_profile_id=''
    or new.account_id<>btrim(new.account_id) or new.account_id=''
    or new.created_command_id<>btrim(new.created_command_id) or new.created_command_id=''
    or new.created_by<>btrim(new.created_by) or new.created_by=''
    or new.proposal_actor_id<>btrim(new.proposal_actor_id) or new.proposal_actor_id=''
    or new.proposer_authentication_ref<>btrim(new.proposer_authentication_ref) or new.proposer_authentication_ref=''
    or (new.human_authentication_ref is not null and (new.human_authentication_ref<>btrim(new.human_authentication_ref) or new.human_authentication_ref='')) then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S canonical identity fields must be non-empty and unpadded';
  end if;
  execute 'select ''account:'' || id::text || '':v'' || version::text from public.accounts where tenant_id=$1 and id::text=$2 limit 1'
    into account_source_version using new.tenant_id,new.account_id;
  if account_source_version is null then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Account is not tenant-visible';
  end if;
  if account_source_version <> new.account_version then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Account version is stale';
  end if;

  if new.object_version <> 'supplier-profile:' || new.supplier_profile_id || ':v' || new.version::text then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S object version is inconsistent';
  end if;
  if new.canonical_payload #>> '{accountRef,accountId}' is distinct from new.account_id
    or new.canonical_payload #>> '{accountRef,accountVersion}' is distinct from new.account_version then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Account payload linkage is inconsistent';
  end if;
  if new.canonical_payload -> 'capabilities' is distinct from new.capabilities
    or new.canonical_payload -> 'approvedCategories' is distinct from new.approved_categories
    or new.canonical_payload -> 'approvedRegions' is distinct from new.approved_regions
    or new.canonical_payload -> 'contactRefs' is distinct from new.contact_refs
    or new.canonical_payload -> 'evidenceRefs' is distinct from new.evidence_refs
    or new.canonical_payload -> 'provenanceRefs' is distinct from new.provenance_refs
    or new.canonical_payload #> '{identityReview,conflictRefs}' is distinct from new.identity_conflict_refs
    or new.canonical_payload #> '{identityReview,duplicateAccountRefs}' is distinct from new.duplicate_account_refs then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S canonical payload columns are inconsistent';
  end if;
  if new.canonical_payload ->> 'validFrom' is distinct from to_char(new.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or new.canonical_payload ->> 'validUntil' is distinct from to_char(new.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or new.canonical_payload #>> '{decision,decidedAt}' is distinct from to_char(new.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    or new.canonical_payload #>> '{decision,action}' is distinct from new.transition_action then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S decision or validity payload is inconsistent';
  end if;
  if new.command_payload ->> 'commandId' is distinct from new.created_command_id
    or new.command_payload ->> 'expectedVersion' is distinct from new.expected_object_version
    or new.command_payload ->> 'commandType' is distinct from (case
      when new.transition_action = 'PROPOSE' then 'supplier_profile.propose'
      when new.transition_action = 'REVISE' then 'supplier_profile.revise'
      else 'supplier_profile.transition'
    end) then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S command payload identity is inconsistent';
  end if;

  select * into prior_row
    from public.seed_supplier_profile_versions
   where tenant_id=new.tenant_id and supplier_profile_id=new.supplier_profile_id
   order by version desc limit 1;

  if new.version = 1 then
    if found or new.expected_object_version <> 'ABSENT' or new.transition_action <> 'PROPOSE' or new.status <> 'PROPOSED'
      or new.created_by_type <> 'user' or new.created_by <> new.proposal_actor_id
      or new.proposer_authentication_ref is null or new.human_authentication_ref is not null
      or new.canonical_payload #> '{decision,humanActorId}' is distinct from 'null'::jsonb
      or new.canonical_payload #> '{decision,humanAuthenticationRef}' is distinct from 'null'::jsonb then
      raise exception 'SEED-SUPPLIER-IDENTITY-A2S initial proposal is invalid';
    end if;
  else
    if not found or prior_row.version <> new.version - 1 then
      raise exception 'SEED-SUPPLIER-IDENTITY-A2S version sequence is not contiguous';
    end if;
    expected_object_version := 'supplier-profile:' || prior_row.supplier_profile_id || ':v' || prior_row.version::text;
    if new.expected_object_version <> expected_object_version
      or prior_row.account_id <> new.account_id then
      raise exception 'SEED-SUPPLIER-IDENTITY-A2S prior version binding is stale or inconsistent';
    end if;
    if new.transition_action = 'REVISE' then
      if prior_row.status in ('ARCHIVED','REVOKED') or new.status <> 'PROPOSED'
        or new.created_by_type <> 'user' or new.created_by <> new.proposal_actor_id
        or new.proposer_authentication_ref is null or new.human_authentication_ref is not null
        or new.canonical_payload #> '{decision,humanActorId}' is distinct from 'null'::jsonb
        or new.canonical_payload #> '{decision,humanAuthenticationRef}' is distinct from 'null'::jsonb then
        raise exception 'SEED-SUPPLIER-IDENTITY-A2S revision must return to proposed review';
      end if;
    else
      if new.created_by_type <> 'user' or new.human_authentication_ref is null
        or new.created_by = new.proposal_actor_id
        or new.proposal_actor_id <> prior_row.proposal_actor_id
        or new.proposer_authentication_ref <> prior_row.proposer_authentication_ref
        or new.canonical_payload #>> '{decision,humanActorId}' is distinct from new.created_by
        or new.canonical_payload #>> '{decision,humanAuthenticationRef}' is distinct from new.human_authentication_ref then
        raise exception 'SEED-SUPPLIER-IDENTITY-A2S transition requires a distinct credential-bound human';
      end if;
      if new.transition_action = 'ACTIVATE' then
        if prior_row.status <> 'PROPOSED' or new.status <> 'ELIGIBLE'
          or jsonb_array_length(new.identity_conflict_refs) <> 0
          or jsonb_array_length(new.duplicate_account_refs) <> 0
          or new.created_at >= new.valid_until then
          raise exception 'SEED-SUPPLIER-IDENTITY-A2S activation is not eligible';
        end if;
      elsif new.transition_action = 'SUSPEND' then
        if prior_row.status <> 'ELIGIBLE' or new.status <> 'SUSPENDED' then
          raise exception 'SEED-SUPPLIER-IDENTITY-A2S suspension transition is invalid';
        end if;
      elsif new.transition_action = 'EXPIRE' then
        if prior_row.status not in ('ELIGIBLE','SUSPENDED') or new.status <> 'EXPIRED'
          or new.created_at < new.valid_until then
          raise exception 'SEED-SUPPLIER-IDENTITY-A2S expiration transition is invalid';
        end if;
      elsif new.transition_action = 'REVOKE' then
        if prior_row.status in ('ARCHIVED','REVOKED') or new.status <> 'REVOKED' then
          raise exception 'SEED-SUPPLIER-IDENTITY-A2S revocation transition is invalid';
        end if;
      elsif new.transition_action = 'ARCHIVE' then
        if prior_row.status = 'ARCHIVED' or new.status <> 'ARCHIVED' then
          raise exception 'SEED-SUPPLIER-IDENTITY-A2S archive transition is invalid';
        end if;
      else
        raise exception 'SEED-SUPPLIER-IDENTITY-A2S transition action is invalid';
      end if;
    end if;
  end if;
  if found and new.created_at <= prior_row.created_at then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S created_at must advance monotonically';
  end if;
  return new;
end
$$;

revoke all on function public.seed_supplier_identity_a2s_validate_version() from public;

create function public.seed_supplier_identity_a2s_validate_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  receipt public.p110_command_receipts%rowtype;
  expected_command_type text;
begin
  select * into receipt
    from public.p110_command_receipts
   where tenant_id=new.tenant_id and command_id=new.created_command_id;
  if not found then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S exact P110 receipt is missing';
  end if;
  expected_command_type := case
    when new.transition_action = 'PROPOSE' then 'supplier_profile.propose'
    when new.transition_action = 'REVISE' then 'supplier_profile.revise'
    else 'supplier_profile.transition'
  end;
  if receipt.command_type is distinct from expected_command_type
    or receipt.idempotency_key is distinct from new.command_payload ->> 'idempotencyKey'
    or receipt.payload_hash is distinct from new.command_payload_hash
    or receipt.expected_object_version is distinct from new.expected_object_version
    or receipt.committed_object_version is distinct from new.object_version
    or receipt.actor_id is distinct from new.created_by
    or receipt.actor_type is distinct from new.created_by_type
    or receipt.target_owner_project is distinct from 'LUZIONE_SUPPLIER_IDENTITY'
    or receipt.target_object_type is distinct from 'supplier_profile'
    or receipt.target_object_id is distinct from new.supplier_profile_id
    or receipt.policy_version is distinct from '2026-09-05.seed-supplier-identity.no-effect.v1'
    or receipt.requested_at is distinct from new.created_at
    or receipt.committed_at is null
    or receipt.state is distinct from 'DOMAIN_COMMITTED' then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S P110 receipt does not bind exact command, actor, target, payload, and version';
  end if;
  return null;
end
$$;

revoke all on function public.seed_supplier_identity_a2s_validate_receipt() from public;

create function public.seed_supplier_identity_a2s_validate_portal_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  account_source_version text;
  prior_row public.seed_supplier_portal_account_binding_versions%rowtype;
begin
  if new.tenant_id<>btrim(new.tenant_id) or new.tenant_id=''
    or new.binding_id<>btrim(new.binding_id) or new.binding_id=''
    or new.organization_id<>btrim(new.organization_id) or new.organization_id=''
    or new.account_id<>btrim(new.account_id) or new.account_id=''
    or new.created_command_id<>btrim(new.created_command_id) or new.created_command_id=''
    or new.human_authentication_ref<>btrim(new.human_authentication_ref) or new.human_authentication_ref='' then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Portal binding identity fields must be non-empty and unpadded';
  end if;
  execute 'select ''account:'' || id::text || '':v'' || version::text from public.accounts where tenant_id=$1 and id::text=$2 limit 1'
    into account_source_version using new.tenant_id,new.account_id;
  if account_source_version is null or account_source_version <> new.account_version then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Portal binding Account is missing or stale';
  end if;
  if new.object_version <> 'portal-account-binding:' || new.binding_id || ':v' || new.version::text then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Portal binding object version is inconsistent';
  end if;
  if new.created_by_type<>'user' or new.human_authentication_ref is null or btrim(new.human_authentication_ref)=''
    or new.created_by is null or btrim(new.created_by)='' or new.created_by<>btrim(new.created_by)
    or new.created_by = new.workload_actor_id or new.workload_actor_id<>'service:luzione-supplier-portal' then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Portal binding requires distinct human approval and Portal workload attribution';
  end if;
  if new.command_payload->>'commandId' is distinct from new.created_command_id
    or new.command_payload->>'expectedVersion' is distinct from new.expected_object_version
    or new.command_payload->>'bindingId' is distinct from new.binding_id
    or new.command_payload->'membershipRef' is distinct from new.membership_ref
    or new.command_payload->'objectGrantRef' is distinct from new.object_grant_ref
    or new.command_payload->'evidenceRefs' is distinct from new.evidence_refs
    or new.command_payload->>'commandType' is distinct from (case when new.version=1 then 'portal_account_access_binding.record' else 'portal_account_access_binding.revoke' end) then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Portal binding command payload is inconsistent';
  end if;
  select * into prior_row from public.seed_supplier_portal_account_binding_versions
   where tenant_id=new.tenant_id and binding_id=new.binding_id order by version desc limit 1;
  if new.version=1 then
    if found or new.expected_object_version<>'ABSENT' or new.status<>'ACTIVE'
      or new.revocation_ref is not null
      or new.command_payload->>'accountId' is distinct from new.account_id
      or new.command_payload->>'accountVersion' is distinct from new.account_version
      or new.command_payload->>'organizationId' is distinct from new.organization_id
      or new.membership_ref->>'status' is distinct from 'ACTIVE'
      or new.object_grant_ref->>'status' is distinct from 'ACTIVE' then
      raise exception 'SEED-SUPPLIER-IDENTITY-A2S initial Portal access binding is invalid';
    end if;
  else
    if not found or prior_row.version<>new.version-1
      or prior_row.object_version<>new.expected_object_version
      or prior_row.status<>'ACTIVE' or new.status<>'REVOKED'
      or prior_row.organization_id<>new.organization_id
      or prior_row.account_id<>new.account_id
      or prior_row.account_version<>new.account_version
      or prior_row.membership_ref->>'id' is distinct from new.membership_ref->>'id'
      or prior_row.object_grant_ref->>'id' is distinct from new.object_grant_ref->>'id'
      or prior_row.membership_ref->>'version' is not distinct from new.membership_ref->>'version'
      or prior_row.object_grant_ref->>'version' is not distinct from new.object_grant_ref->>'version'
      or new.command_payload->>'revocationRef' is distinct from new.revocation_ref
      or (new.membership_ref->>'status' is distinct from 'REVOKED' and new.object_grant_ref->>'status' is distinct from 'REVOKED')
      or new.created_at<=prior_row.created_at then
      raise exception 'SEED-SUPPLIER-IDENTITY-A2S Portal access revocation is stale or invalid';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.seed_supplier_identity_a2s_validate_portal_binding() from public;

create function public.seed_supplier_identity_a2s_validate_portal_binding_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  receipt public.p110_command_receipts%rowtype;
begin
  select * into receipt from public.p110_command_receipts
   where tenant_id=new.tenant_id and command_id=new.created_command_id;
  if not found
    or receipt.command_type is distinct from (case when new.version=1 then 'portal_account_access_binding.record' else 'portal_account_access_binding.revoke' end)
    or receipt.idempotency_key is distinct from new.command_payload->>'idempotencyKey'
    or receipt.payload_hash is distinct from new.command_payload_hash
    or receipt.expected_object_version is distinct from new.expected_object_version
    or receipt.committed_object_version is distinct from new.object_version
    or receipt.actor_id is distinct from new.created_by
    or receipt.actor_type is distinct from 'user'
    or receipt.target_owner_project is distinct from 'LUZIONE_SUPPLIER_IDENTITY'
    or receipt.target_object_type is distinct from 'portal_account_access_binding'
    or receipt.target_object_id is distinct from new.binding_id
    or receipt.policy_version is distinct from '2026-09-05.seed-supplier-identity.no-effect.v1'
    or receipt.requested_at is distinct from new.created_at
    or receipt.committed_at is null
    or receipt.state is distinct from 'DOMAIN_COMMITTED' then
    raise exception 'SEED-SUPPLIER-IDENTITY-A2S Portal binding receipt is not exact';
  end if;
  return null;
end
$$;

revoke all on function public.seed_supplier_identity_a2s_validate_portal_binding_receipt() from public;

create trigger seed_supplier_profile_versions_append_only
  before update or delete on public.seed_supplier_profile_versions
  for each row execute function public.seed_supplier_identity_a2s_reject_mutation();
create trigger seed_supplier_profile_versions_validate
  before insert on public.seed_supplier_profile_versions
  for each row execute function public.seed_supplier_identity_a2s_validate_version();
create constraint trigger seed_supplier_profile_versions_receipt_integrity
  after insert on public.seed_supplier_profile_versions
  deferrable initially deferred
  for each row execute function public.seed_supplier_identity_a2s_validate_receipt();
create trigger seed_supplier_portal_account_binding_versions_append_only
  before update or delete on public.seed_supplier_portal_account_binding_versions
  for each row execute function public.seed_supplier_identity_a2s_reject_mutation();
create trigger seed_supplier_portal_account_binding_versions_validate
  before insert on public.seed_supplier_portal_account_binding_versions
  for each row execute function public.seed_supplier_identity_a2s_validate_portal_binding();
create constraint trigger seed_supplier_portal_account_binding_versions_receipt_integrity
  after insert on public.seed_supplier_portal_account_binding_versions
  deferrable initially deferred
  for each row execute function public.seed_supplier_identity_a2s_validate_portal_binding_receipt();

alter table public.seed_supplier_profile_versions enable row level security;
alter table public.seed_supplier_profile_versions force row level security;
alter table public.seed_supplier_portal_account_binding_versions enable row level security;
alter table public.seed_supplier_portal_account_binding_versions force row level security;

revoke all on table public.seed_supplier_profile_versions from public;
revoke all on table public.seed_supplier_portal_account_binding_versions from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname='anon') then
    revoke all on table public.seed_supplier_profile_versions from anon;
    revoke all on table public.seed_supplier_portal_account_binding_versions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    revoke all on table public.seed_supplier_profile_versions from authenticated;
    revoke all on table public.seed_supplier_portal_account_binding_versions from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname='service_role') then
    revoke all on table public.seed_supplier_profile_versions from service_role;
    revoke all on table public.seed_supplier_portal_account_binding_versions from service_role;
  end if;
  if exists (select 1 from pg_roles where rolname='luzione_api_runtime') then
    execute 'create policy seed_supplier_profile_versions_runtime_tenant on public.seed_supplier_profile_versions to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    execute 'create policy seed_supplier_portal_account_binding_versions_runtime_tenant on public.seed_supplier_portal_account_binding_versions to luzione_api_runtime using (tenant_id = (select current_setting(''app.tenant_id'', true))) with check (tenant_id = (select current_setting(''app.tenant_id'', true)))';
    grant select,insert on table public.seed_supplier_profile_versions,public.seed_supplier_portal_account_binding_versions to luzione_api_runtime;
  end if;
end $$;

comment on table public.seed_supplier_profile_versions is
  'API-owned append-only SupplierProfile/v1 eligibility decisions over exact tenant Account versions. Portal organization or membership state never grants eligibility.';
comment on table public.seed_supplier_portal_account_binding_versions is
  'API-owned projection of exact Portal organization, membership, object-grant, and revocation access metadata. It never creates or activates supplier eligibility.';

commit;
