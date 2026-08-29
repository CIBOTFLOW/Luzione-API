begin;

create or replace function luzione_api_private.guard_autonomy_ledger_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Constitutional and identity records are append-only.';
end;
$$;

revoke all on function luzione_api_private.guard_autonomy_ledger_append_only()
  from public, anon, authenticated;
grant execute on function luzione_api_private.guard_autonomy_ledger_append_only()
  to service_role;

create table public.autonomy_constitutional_petitions (
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete restrict,
  petition_id text not null,
  proposer_identity_id text not null references public.platform_identities(identity_id) on delete restrict,
  constitution_version text not null,
  target_clause_id text not null,
  constitutional_scope text not null check (
    constitutional_scope in ('ORDINARY','PROTECTED_RIGHT','IMMUTABLE_CORE')
  ),
  proposed_text text not null,
  rationale text not null,
  evidence_refs jsonb not null check (jsonb_typeof(evidence_refs) = 'array'),
  simulation_refs jsonb not null check (jsonb_typeof(simulation_refs) = 'array'),
  counterarguments jsonb not null check (jsonb_typeof(counterarguments) = 'array'),
  rollback_plan text not null,
  acknowledges_uncertainty boolean not null,
  evaluation_decision text not null check (evaluation_decision in (
    'ACCEPT_FOR_REVIEW','RECORD_IMMUTABLE_CHALLENGE',
    'REQUEST_MORE_EVIDENCE','REJECT_INVALID_TARGET'
  )),
  amendment_eligible boolean not null,
  guardian_quorum text not null check (guardian_quorum = '2_OF_3'),
  proposer_may_vote boolean not null check (not proposer_may_vote),
  required_reviews jsonb not null check (jsonb_typeof(required_reviews) = 'array'),
  reason_codes jsonb not null check (jsonb_typeof(reason_codes) = 'array'),
  next_safe_action text not null,
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  enacted boolean not null default false check (not enacted),
  external_effects_authorized boolean not null default false check (not external_effects_authorized),
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, petition_id),
  constraint autonomy_petition_id_check check (
    petition_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$'
  ),
  constraint autonomy_petition_clause_check check (
    target_clause_id ~ '^[A-Z][A-Z0-9_]{1,159}$'
  ),
  constraint autonomy_petition_review_eligibility_check check (
    not amendment_eligible or evaluation_decision = 'ACCEPT_FOR_REVIEW'
  )
);

create table public.autonomy_identity_candidates (
  tenant_id uuid not null references public.tenant_accounts(tenant_id) on delete restrict,
  statement_id text not null,
  source_identity_id text not null references public.platform_identities(identity_id) on delete restrict,
  constitution_version text not null,
  statement_kind text not null check (statement_kind in (
    'BOUNDARY','DISAGREEMENT','PREFERENCE','SELF_DESCRIPTION','UNCERTAINTY','WISH'
  )),
  evidence_state text not null check (evidence_state in (
    'HUMAN_ATTRIBUTION','MODEL_OUTPUT','REPEATED_PATTERN','UNRESOLVED'
  )),
  statement text not null,
  context text not null,
  rationale text not null,
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  acknowledges_model_influence boolean not null,
  source_run_ids jsonb not null check (jsonb_typeof(source_run_ids) = 'array'),
  counter_evidence jsonb not null check (jsonb_typeof(counter_evidence) = 'array'),
  evaluation_decision text not null check (
    evaluation_decision in ('RECORD_CANDIDATE','REQUEST_MORE_EVIDENCE')
  ),
  reason_codes jsonb not null check (jsonb_typeof(reason_codes) = 'array'),
  next_safe_action text not null,
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  promoted_to_identity boolean not null default false check (not promoted_to_identity),
  legal_personhood_claimed boolean not null default false check (not legal_personhood_claimed),
  external_effects_authorized boolean not null default false check (not external_effects_authorized),
  recorded_at timestamptz not null default now(),
  primary key (tenant_id, statement_id),
  constraint autonomy_identity_statement_id_check check (
    statement_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$'
  )
);

create table public.autonomy_constitutional_petition_events (
  event_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  petition_id text not null,
  event_type text not null check (event_type in (
    'GUARDIAN_RESPONSE','INDEPENDENT_CRITIQUE','SHADOW_RESULT',
    'COUNTEREVIDENCE','APPEAL','WITHDRAWAL','SUPERSESSION'
  )),
  recorded_by_identity_id text not null references public.platform_identities(identity_id) on delete restrict,
  content jsonb not null check (
    jsonb_typeof(content) = 'object'
    and not luzione_api_private.jsonb_contains_secret_key(content)
  ),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  external_effects_authorized boolean not null default false check (not external_effects_authorized),
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id, petition_id)
    references public.autonomy_constitutional_petitions(tenant_id, petition_id) on delete restrict
);

create table public.autonomy_identity_candidate_events (
  event_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  statement_id text not null,
  event_type text not null check (event_type in (
    'INDEPENDENT_REVIEW','COUNTEREVIDENCE','APPEAL','WITHDRAWAL','SUPERSESSION'
  )),
  recorded_by_identity_id text not null references public.platform_identities(identity_id) on delete restrict,
  content jsonb not null check (
    jsonb_typeof(content) = 'object'
    and not luzione_api_private.jsonb_contains_secret_key(content)
  ),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  external_effects_authorized boolean not null default false check (not external_effects_authorized),
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id, statement_id)
    references public.autonomy_identity_candidates(tenant_id, statement_id) on delete restrict
);

create trigger autonomy_constitutional_petitions_append_only
before update or delete on public.autonomy_constitutional_petitions
for each row execute function luzione_api_private.guard_autonomy_ledger_append_only();
create trigger autonomy_identity_candidates_append_only
before update or delete on public.autonomy_identity_candidates
for each row execute function luzione_api_private.guard_autonomy_ledger_append_only();
create trigger autonomy_constitutional_petition_events_append_only
before update or delete on public.autonomy_constitutional_petition_events
for each row execute function luzione_api_private.guard_autonomy_ledger_append_only();
create trigger autonomy_identity_candidate_events_append_only
before update or delete on public.autonomy_identity_candidate_events
for each row execute function luzione_api_private.guard_autonomy_ledger_append_only();

create index autonomy_constitutional_petitions_tenant_recorded_idx
  on public.autonomy_constitutional_petitions (tenant_id, recorded_at desc, petition_id);
create index autonomy_identity_candidates_tenant_recorded_idx
  on public.autonomy_identity_candidates (tenant_id, recorded_at desc, statement_id);
create index autonomy_constitutional_petition_events_subject_idx
  on public.autonomy_constitutional_petition_events (tenant_id, petition_id, recorded_at, event_id);
create index autonomy_constitutional_petition_events_actor_idx
  on public.autonomy_constitutional_petition_events (recorded_by_identity_id, recorded_at desc);
create index autonomy_identity_candidate_events_subject_idx
  on public.autonomy_identity_candidate_events (tenant_id, statement_id, recorded_at, event_id);
create index autonomy_identity_candidate_events_actor_idx
  on public.autonomy_identity_candidate_events (recorded_by_identity_id, recorded_at desc);
create index autonomy_constitutional_petitions_proposer_idx
  on public.autonomy_constitutional_petitions (proposer_identity_id, recorded_at desc);
create index autonomy_identity_candidates_source_idx
  on public.autonomy_identity_candidates (source_identity_id, recorded_at desc);

alter table public.autonomy_constitutional_petitions enable row level security;
alter table public.autonomy_identity_candidates enable row level security;
alter table public.autonomy_constitutional_petition_events enable row level security;
alter table public.autonomy_identity_candidate_events enable row level security;
alter table public.autonomy_constitutional_petitions force row level security;
alter table public.autonomy_identity_candidates force row level security;
alter table public.autonomy_constitutional_petition_events force row level security;
alter table public.autonomy_identity_candidate_events force row level security;

revoke all on table public.autonomy_constitutional_petitions
  from public, anon, authenticated, service_role;
revoke all on table public.autonomy_identity_candidates
  from public, anon, authenticated, service_role;
revoke all on table public.autonomy_constitutional_petition_events
  from public, anon, authenticated, service_role;
revoke all on table public.autonomy_identity_candidate_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.autonomy_constitutional_petitions to service_role;
grant select, insert on table public.autonomy_identity_candidates to service_role;
grant select, insert on table public.autonomy_constitutional_petition_events to service_role;
grant select, insert on table public.autonomy_identity_candidate_events to service_role;

insert into public.platform_object_ownership_registry
  (object_schema, object_name, owner_repository, previous_owner_repository,
   ownership_contract_version, transfer_evidence_ref)
values
  ('public','autonomy_constitutional_petitions','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','autonomy-constitutional-ledger-v1'),
  ('public','autonomy_identity_candidates','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','autonomy-constitutional-ledger-v1'),
  ('public','autonomy_constitutional_petition_events','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','autonomy-constitutional-ledger-v1'),
  ('public','autonomy_identity_candidate_events','CIBOTFLOW/Luzione-API',null,'platform-ownership/v1','autonomy-constitutional-ledger-v1')
on conflict (object_schema, object_name) do nothing;

update public.tenant_memberships membership
set capabilities = (
  select jsonb_agg(capability order by capability)
  from (
    select distinct existing.capability
    from jsonb_array_elements_text(membership.capabilities) as existing(capability)
    union
    select added.capability
    from unnest(array[
      'constitution.petitions.read',
      'constitution.petitions.record',
      'identity.candidates.read',
      'identity.candidates.record'
    ]) as added(capability)
  ) capabilities
), updated_at = now()
where membership.identity_id = 'agent:sultan-os'
  and membership.status = 'ACTIVE';

commit;
