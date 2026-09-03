-- Bind Stage 5 JSON receipts to indexed lineage, exact producer releases and
-- claim-level evidence. Additive, append-only and authority-free.

begin;

alter table public.sultan_canonical_readback_receipts
  add column api_deployment_sha text generated always as (receipt ->> 'apiDeploymentSha') stored,
  add constraint sultan_stage5_readback_api_sha_format
    check (api_deployment_sha ~ '^[a-f0-9]{40}$'),
  add constraint sultan_stage5_readback_receipt_exact_binding check ((
    receipt ->> 'contractVersion' = 'luzione-canonical-business-readback/v1'
    and receipt ->> 'readbackReceiptId' = readback_receipt_id
    and receipt ->> 'tenantId' = tenant_id
    and receipt ->> 'subjectType' = subject_type
    and receipt ->> 'subjectId' = subject_id
    and receipt ->> 'status' = status
    and receipt -> 'consumer' ->> 'actorId' = consumer_actor_id
    and receipt -> 'consumer' ->> 'deploymentSha' = consumer_deployment_sha
    and (receipt -> 'provenance' ->> 'sourceVersion') is not distinct from source_version
    and (receipt ->> 'observedAt')::timestamptz = observed_at
    and (receipt ->> 'freshUntil')::timestamptz is not distinct from fresh_until
    and receipt ->> 'idempotencyKey' = idempotency_key
    and receipt -> 'idempotentReplay' = 'false'::jsonb
    and receipt ->> 'readbackHash' = readback_hash
    and jsonb_typeof(receipt -> 'claims') = 'array'
    and jsonb_typeof(receipt -> 'provenance' -> 'sourceRefs') = 'array'
    and not jsonb_path_exists(receipt, '$.claims[*] ? (@.kind != "FACT" && @.kind != "CALCULATION")')
  ) is true);

alter table public.sultan_canonical_readback_receipts
  add constraint sultan_stage5_readback_exact_lineage_key
  unique (tenant_id, readback_receipt_id, readback_hash, api_deployment_sha),
  add constraint sultan_stage5_readback_hash_lineage_key
  unique (tenant_id, readback_receipt_id, readback_hash);

comment on constraint sultan_stage5_readback_receipt_exact_binding
  on public.sultan_canonical_readback_receipts is
  'Binds canonical JSON, consumer, tenant, subject, timestamps, hash and exact API producer SHA to indexed columns.';

alter table public.sultan_api_admission_receipts
  add constraint sultan_stage5_admission_exact_lineage_key
  unique (tenant_id, admission_receipt_id, receipt_hash, api_deployment_sha),
  add constraint sultan_stage5_admission_hash_lineage_key
  unique (tenant_id, admission_receipt_id, receipt_hash),
  add constraint sultan_stage5_admission_receipt_exact_binding check ((
    receipt ->> 'contractVersion' = 'luzione-sultan-api-admission/v1'
    and receipt ->> 'admissionTiming' = 'POST_INFERENCE'
    and receipt -> 'authorizesInference' = 'false'::jsonb
    and receipt ->> 'admissionReceiptId' = admission_receipt_id
    and receipt ->> 'idempotencyKey' = idempotency_key
    and receipt ->> 'operationId' = operation_id
    and receipt ->> 'runId' = run_id
    and receipt ->> 'interactionId' = interaction_id
    and receipt ->> 'interactionReceiptHash' = interaction_receipt_hash
    and receipt ->> 'status' = status
    and receipt ->> 'phase' = phase
    and receipt -> 'credentialActor' ->> 'actorId' = credential_actor_id
    and receipt -> 'credentialActor' ->> 'tenantId' = tenant_id
    and receipt -> 'logicalAgent' ->> 'agentId' = logical_agent_id
    and receipt -> 'logicalAgent' ->> 'agentVersion' = logical_agent_version
    and receipt -> 'caseRef' ->> 'caseId' = case_id
    and receipt -> 'caseRef' ->> 'caseType' = case_type
    and receipt ->> 'requestedCapability' = requested_capability
    and receipt ->> 'requestedEffectClass' = requested_effect_class
    and receipt -> 'participation' ->> 'contractSha' = participation_contract_sha
    and receipt -> 'participation' ->> 'sultanDeploymentSha' = sultan_deployment_sha
    and receipt -> 'participation' ->> 'groundingAssemblerDeploymentSha' = grounding_assembler_deployment_sha
    and receipt ->> 'apiDeploymentSha' = api_deployment_sha
    and receipt -> 'participation' ->> 'contextHash' = context_hash
    and receipt -> 'participation' ->> 'groundingPacketHash' = grounding_packet_hash
    and receipt -> 'participation' ->> 'participantSetHash' = participant_set_hash
    and receipt -> 'interactionReceipt' ->> 'interactionId' = interaction_id
    and receipt -> 'interactionReceipt' ->> 'receiptHash' = interaction_receipt_hash
    and receipt -> 'interactionReceipt' ->> 'tenantId' = tenant_id
    and receipt -> 'interactionReceipt' ->> 'contractVersion' = 'sultan.stage5-developmental-participation.v2'
    and receipt -> 'interactionReceipt' ->> 'schemaVersion' = 'sultan.developmental-interaction-receipt.v2'
    and receipt -> 'interactionReceipt' -> 'controls' -> 'authorityGranted' = 'false'::jsonb
    and receipt -> 'interactionReceipt' -> 'controls' -> 'businessStateMutated' = 'false'::jsonb
    and receipt -> 'interactionReceipt' -> 'controls' -> 'externalEffectAuthorized' = 'false'::jsonb
    and receipt -> 'interactionReceipt' -> 'controls' -> 'canonicalMemoryChanged' = 'false'::jsonb
    and receipt -> 'interactionReceipt' -> 'controls' -> 'policyChanged' = 'false'::jsonb
    and receipt -> 'interactionReceipt' -> 'controls' -> 'noRawPromptPersisted' = 'true'::jsonb
    and receipt -> 'interactionReceipt' -> 'controls' -> 'noRawResponsePersisted' = 'true'::jsonb
    and receipt -> 'evidence' ->> 'evidenceRefsHash' = evidence_refs_hash
    and jsonb_typeof(receipt -> 'evidence' -> 'readbackReceiptIds') = 'array'
    and jsonb_typeof(receipt -> 'evidence' -> 'consumedEvidence') = 'array'
    and receipt -> 'evidence' ->> 'sourceVerification' in (
      'API_CANONICAL_READBACKS_VERIFIED_CONTEXT_HASH_SULTAN_ASSERTED','FAILED'
    )
    and ((status = 'DENIED') = (receipt -> 'evidence' ->> 'sourceVerification' = 'FAILED'))
    and receipt ->> 'policyVersion' = policy_version
    and (receipt ->> 'requestedAt')::timestamptz = requested_at
    and (receipt ->> 'decidedAt')::timestamptz = decided_at
    and receipt ->> 'receiptHash' = receipt_hash
    and receipt -> 'idempotentReplay' = 'false'::jsonb
    and receipt -> 'externalEffectsAuthorized' = 'false'::jsonb
    and (
      (receipt -> 'outcomeExpectation' = 'null'::jsonb
        and receipt -> 'outcomeExpectationProof' = 'null'::jsonb
        and receipt -> 'interactionReceipt' -> 'outcomeExpectationHash' = 'null'::jsonb
        and receipt -> 'outcomeExpectationBinding' -> 'expectationHash' = 'null'::jsonb
        and receipt -> 'outcomeExpectationBinding' -> 'proofHash' = 'null'::jsonb
        and receipt -> 'outcomeExpectationBinding' ->> 'source' = 'NONE')
      or
      (jsonb_typeof(receipt -> 'outcomeExpectation') = 'object'
        and jsonb_typeof(receipt -> 'outcomeExpectationProof') = 'object'
        and receipt -> 'outcomeExpectationBinding' ->> 'expectationHash' = receipt -> 'interactionReceipt' ->> 'outcomeExpectationHash'
        and receipt -> 'outcomeExpectationBinding' ->> 'expectationHash' = receipt -> 'outcomeExpectationProof' ->> 'expectationHash'
        and receipt -> 'outcomeExpectationBinding' ->> 'proofHash' = receipt -> 'outcomeExpectationProof' ->> 'bindingHash'
        and receipt -> 'outcomeExpectationProof' ->> 'interactionId' = interaction_id
        and receipt -> 'outcomeExpectationProof' ->> 'interactionReceiptHash' = interaction_receipt_hash
        and receipt -> 'outcomeExpectationBinding' ->> 'source' = 'AUTHENTICATED_SULTAN_INTERACTION_RECEIPT')
    )
    and receipt -> 'outcomeExpectationBinding' -> 'interactionReceiptBound' = 'true'::jsonb
    and (
      status = 'DENIED'
      or (
        receipt ->> 'purpose' = 'agent-case-post-inference'
        and phase = 'SIMULATION'
        and requested_capability = 'analysis.read'
        and requested_effect_class = 'A0'
        and receipt -> 'interactionReceipt' ->> 'surface' = 'AGENT_CASE'
        and receipt -> 'interactionReceipt' ->> 'status' = 'READY'
        and receipt -> 'interactionReceipt' ->> 'sourceRunIdHash' = encode(digest(run_id, 'sha256'), 'hex')
        and receipt -> 'interactionReceipt' ->> 'contextHash' = context_hash
        and receipt -> 'interactionReceipt' ->> 'deploymentSha' = sultan_deployment_sha
        and receipt -> 'interactionReceipt' ->> 'groundingPacketHash' = grounding_packet_hash
        and receipt -> 'interactionReceipt' ->> 'groundingAssemblerDeploymentSha' = grounding_assembler_deployment_sha
        and receipt -> 'interactionReceipt' ->> 'participantSetHash' = participant_set_hash)
    )
  ) is true);

comment on constraint sultan_stage5_admission_receipt_exact_binding
  on public.sultan_api_admission_receipts is
  'Requires post-inference/no-effect JSON, acyclic expectation proof lineage and exact indexed identity/context/hash bindings.';

create table public.sultan_api_admission_evidence_refs (
  tenant_id text not null,
  admission_receipt_id text not null,
  admission_receipt_hash text not null check (admission_receipt_hash ~ '^[a-f0-9]{64}$'),
  readback_receipt_id text not null,
  readback_hash text not null check (readback_hash ~ '^[a-f0-9]{64}$'),
  claim_id text not null check (claim_id ~ '^[a-z][a-zA-Z0-9._-]{2,127}$'),
  evidence_ref text not null,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  ordinal integer not null check (ordinal between 0 and 255),
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, admission_receipt_id, evidence_ref),
  unique (tenant_id, admission_receipt_id, ordinal),
  foreign key (tenant_id, admission_receipt_id, admission_receipt_hash)
    references public.sultan_api_admission_receipts(tenant_id, admission_receipt_id, receipt_hash) on delete restrict,
  foreign key (tenant_id, readback_receipt_id, readback_hash)
    references public.sultan_canonical_readback_receipts(tenant_id, readback_receipt_id, readback_hash) on delete restrict,
  check (evidence_ref = readback_receipt_id || '/' || claim_id)
);

create index sultan_stage5_admission_evidence_readback_idx
  on public.sultan_api_admission_evidence_refs (tenant_id, readback_receipt_id, readback_hash);
create index sultan_stage5_admission_evidence_parent_idx
  on public.sultan_api_admission_evidence_refs
  (tenant_id, admission_receipt_id, admission_receipt_hash);

alter table public.sultan_api_admission_evidence_refs enable row level security;
alter table public.sultan_api_admission_evidence_refs force row level security;

create policy sultan_stage5_admission_evidence_runtime_tenant on public.sultan_api_admission_evidence_refs
  to luzione_api_runtime
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''))
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), ''));

revoke all on public.sultan_api_admission_evidence_refs
  from public, anon, authenticated, service_role, luzione_provider_worker;
grant select, insert on public.sultan_api_admission_evidence_refs to luzione_api_runtime;

create or replace function public.sultan_stage5_assert_admission_evidence_child()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare parent_item jsonb;
begin
  select (receipt #> '{evidence,consumedEvidence}') -> new.ordinal into parent_item
    from public.sultan_api_admission_receipts
   where tenant_id = new.tenant_id
     and admission_receipt_id = new.admission_receipt_id
     and receipt_hash = new.admission_receipt_hash;
  if parent_item is distinct from jsonb_build_object(
    'claimId',new.claim_id,'evidenceHash',new.evidence_hash,'evidenceRef',new.evidence_ref,
    'readbackHash',new.readback_hash,'readbackReceiptId',new.readback_receipt_id
  ) then
    raise exception using errcode='23514', message='admission evidence row does not match exact receipt item';
  end if;
  return new;
end;
$$;

create or replace function public.sultan_stage5_assert_admission_evidence_complete()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare expected_count integer;
declare observed_count integer;
begin
  expected_count := jsonb_array_length(new.receipt #> '{evidence,consumedEvidence}');
  if new.status = 'DENIED' and expected_count = 0 then
    return new;
  end if;
  select count(*)::integer into observed_count
    from public.sultan_api_admission_evidence_refs
   where tenant_id = new.tenant_id
     and admission_receipt_id = new.admission_receipt_id
     and admission_receipt_hash = new.receipt_hash;
  if observed_count <> expected_count or exists (
    (select jsonb_array_elements_text(new.receipt #> '{evidence,readbackReceiptIds}') as readback_receipt_id
     except
     select distinct readback_receipt_id
       from public.sultan_api_admission_evidence_refs
      where tenant_id = new.tenant_id
        and admission_receipt_id = new.admission_receipt_id
        and admission_receipt_hash = new.receipt_hash)
    union all
    (select distinct readback_receipt_id
       from public.sultan_api_admission_evidence_refs
      where tenant_id = new.tenant_id
        and admission_receipt_id = new.admission_receipt_id
        and admission_receipt_hash = new.receipt_hash
     except
     select jsonb_array_elements_text(new.receipt #> '{evidence,readbackReceiptIds}') as readback_receipt_id)
  ) then
    raise exception using errcode='23514', message='admission evidence rows are incomplete';
  end if;
  return new;
end;
$$;

revoke all on function public.sultan_stage5_assert_admission_evidence_child()
  from public, anon, authenticated, service_role, luzione_provider_worker;
revoke all on function public.sultan_stage5_assert_admission_evidence_complete()
  from public, anon, authenticated, service_role, luzione_provider_worker;
grant execute on function public.sultan_stage5_assert_admission_evidence_child() to luzione_api_runtime;
grant execute on function public.sultan_stage5_assert_admission_evidence_complete() to luzione_api_runtime;

create trigger sultan_stage5_admission_evidence_exact_child
  before insert on public.sultan_api_admission_evidence_refs
  for each row execute function public.sultan_stage5_assert_admission_evidence_child();
create constraint trigger sultan_stage5_admission_evidence_complete
  after insert on public.sultan_api_admission_receipts
  deferrable initially deferred
  for each row execute function public.sultan_stage5_assert_admission_evidence_complete();
create trigger sultan_stage5_admission_evidence_append_only
  before update or delete on public.sultan_api_admission_evidence_refs
  for each row execute function public.sultan_stage5_append_only_guard();

create or replace function public.sultan_stage5_assert_outcome_parent_lineage()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare admission_receipt jsonb;
declare canonical_receipt jsonb;
declare observed_claim jsonb;
begin
  select receipt into admission_receipt
    from public.sultan_api_admission_receipts
   where tenant_id = new.tenant_id
     and admission_receipt_id = new.admission_receipt_id
     and receipt_hash = new.receipt #>> '{admissionLineage,admissionReceiptHash}'
     and api_deployment_sha = new.receipt #>> '{admissionLineage,apiDeploymentSha}';
  select receipt into canonical_receipt
    from public.sultan_canonical_readback_receipts
   where tenant_id = new.tenant_id
     and readback_receipt_id = new.readback_receipt_id
     and readback_hash = new.receipt #>> '{evidence,readbackHash}'
     and api_deployment_sha = new.receipt #>> '{evidence,apiDeploymentSha}';
  if admission_receipt is null or canonical_receipt is null then
    raise exception using errcode='23503', message='outcome parent receipt lineage is missing';
  end if;
  if new.receipt -> 'admissionLineage' is distinct from jsonb_build_object(
    'admissionReceiptHash',admission_receipt ->> 'receiptHash',
    'apiDeploymentSha',admission_receipt ->> 'apiDeploymentSha',
    'contextHash',admission_receipt #>> '{participation,contextHash}',
    'groundingPacketHash',admission_receipt #>> '{participation,groundingPacketHash}',
    'interactionId',admission_receipt ->> 'interactionId',
    'interactionReceiptHash',admission_receipt ->> 'interactionReceiptHash',
    'operationId',admission_receipt ->> 'operationId',
    'runId',admission_receipt ->> 'runId',
    'sultanDeploymentSha',admission_receipt #>> '{participation,sultanDeploymentSha}'
  ) then
    raise exception using errcode='23514', message='outcome admission lineage does not match exact parent receipt';
  end if;
  if new.receipt -> 'expectationBinding' is distinct from admission_receipt -> 'outcomeExpectationBinding'
    or new.receipt #>> '{evidence,apiDeploymentSha}' is distinct from canonical_receipt ->> 'apiDeploymentSha'
    or new.receipt #>> '{evidence,readbackHash}' is distinct from canonical_receipt ->> 'readbackHash'
    or new.receipt #>> '{evidence,readbackReceiptId}' is distinct from canonical_receipt ->> 'readbackReceiptId'
    or new.receipt #> '{evidence,sourceRefs}' is distinct from canonical_receipt #> '{provenance,sourceRefs}' then
    raise exception using errcode='23514', message='outcome evidence lineage does not match exact parent receipt';
  end if;
  if new.receipt #>> '{evidence,claimId}' is null then
    if new.receipt #> '{evidence,observedValue}' is distinct from 'null'::jsonb then
      raise exception using errcode='23514', message='outcome without a claim must not assert an observed value';
    end if;
  else
    select claim into observed_claim
      from jsonb_array_elements(canonical_receipt -> 'claims') claim
     where claim ->> 'claimId' = new.receipt #>> '{evidence,claimId}'
     limit 1;
    if observed_claim is null
      or new.receipt #> '{evidence,observedValue}' is distinct from observed_claim -> 'value' then
      raise exception using errcode='23514', message='outcome claim/value does not match exact canonical parent claim';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sultan_stage5_assert_outcome_parent_lineage()
  from public, anon, authenticated, service_role, luzione_provider_worker;
grant execute on function public.sultan_stage5_assert_outcome_parent_lineage() to luzione_api_runtime;

create trigger sultan_stage5_outcome_exact_parent_lineage
  before insert on public.sultan_outcome_observations
  for each row execute function public.sultan_stage5_assert_outcome_parent_lineage();

alter table public.sultan_outcome_observations
  add column admission_receipt_hash text generated always as (receipt #>> '{admissionLineage,admissionReceiptHash}') stored,
  add column admission_api_deployment_sha text generated always as (receipt #>> '{admissionLineage,apiDeploymentSha}') stored,
  add column readback_hash text generated always as (receipt #>> '{evidence,readbackHash}') stored,
  add column readback_api_deployment_sha text generated always as (receipt #>> '{evidence,apiDeploymentSha}') stored,
  add constraint sultan_stage5_outcome_parent_hash_formats check (
    admission_receipt_hash ~ '^[a-f0-9]{64}$'
    and admission_api_deployment_sha ~ '^[a-f0-9]{40}$'
    and readback_hash ~ '^[a-f0-9]{64}$'
    and readback_api_deployment_sha ~ '^[a-f0-9]{40}$'
  ),
  add constraint sultan_stage5_outcome_exact_admission_fk
    foreign key (tenant_id, admission_receipt_id, admission_receipt_hash, admission_api_deployment_sha)
    references public.sultan_api_admission_receipts(tenant_id, admission_receipt_id, receipt_hash, api_deployment_sha)
    on delete restrict,
  add constraint sultan_stage5_outcome_exact_readback_fk
    foreign key (tenant_id, readback_receipt_id, readback_hash, readback_api_deployment_sha)
    references public.sultan_canonical_readback_receipts(tenant_id, readback_receipt_id, readback_hash, api_deployment_sha)
    on delete restrict,
  add constraint sultan_stage5_outcome_receipt_exact_binding check ((
    receipt ->> 'contractVersion' = 'luzione-sultan-outcome-observation/v1'
    and receipt ->> 'observationId' = observation_id
    and receipt ->> 'admissionReceiptId' = admission_receipt_id
    and receipt ->> 'classification' = classification
    and receipt -> 'evidence' ->> 'readbackReceiptId' = readback_receipt_id
    and receipt -> 'observer' ->> 'actorId' = observer_actor_id
    and receipt -> 'observer' ->> 'tenantId' = tenant_id
    and receipt ->> 'idempotencyKey' = idempotency_key
    and receipt -> 'idempotentReplay' = 'false'::jsonb
    and receipt -> 'observationRequest' ->> 'contractVersion' = 'luzione-sultan-outcome-observation/v1'
    and receipt -> 'observationRequest' ->> 'admissionReceiptId' = admission_receipt_id
    and receipt -> 'observationRequest' ->> 'readbackReceiptId' = readback_receipt_id
    and receipt -> 'observationRequest' ->> 'idempotencyKey' = idempotency_key
    and receipt -> 'observationRequest' ->> 'supersedesObservationId' is not distinct from supersedes_observation_id
    and ((receipt -> 'observationRequest' ->> 'mode' = 'SUPERSEDE') = (supersedes_observation_id is not null))
    and (receipt -> 'observationRequest' ->> 'requestedAt')::timestamptz >= observed_at
    and (receipt ->> 'supersedesObservationId') is not distinct from supersedes_observation_id
    and (receipt ->> 'observedAt')::timestamptz = observed_at
    and receipt ->> 'receiptHash' = receipt_hash
    and receipt ->> 'apiDeploymentSha' ~ '^[a-f0-9]{40}$'
    and receipt -> 'admissionLineage' ->> 'admissionReceiptHash' = admission_receipt_hash
    and receipt -> 'admissionLineage' ->> 'apiDeploymentSha' = admission_api_deployment_sha
    and receipt -> 'evidence' ->> 'readbackHash' = readback_hash
    and receipt -> 'evidence' ->> 'apiDeploymentSha' = readback_api_deployment_sha
    and receipt -> 'expectationBinding' -> 'interactionReceiptBound' = 'true'::jsonb
    and (
      (receipt -> 'expectationBinding' -> 'expectationHash' = 'null'::jsonb
        and receipt -> 'expectationBinding' -> 'proofHash' = 'null'::jsonb
        and receipt -> 'expectationBinding' ->> 'source' = 'NONE'
        and classification in ('UNRESOLVED','SUPERSEDED'))
      or
      (receipt -> 'expectationBinding' ->> 'expectationHash' ~ '^[a-f0-9]{64}$'
        and receipt -> 'expectationBinding' ->> 'proofHash' ~ '^[a-f0-9]{64}$'
        and receipt -> 'expectationBinding' ->> 'source' = 'AUTHENTICATED_SULTAN_INTERACTION_RECEIPT')
    )
    and (classification not in ('CONFIRMED','REFUTED')
      or (receipt -> 'evidence' ->> 'claimId' is not null
        and receipt -> 'expectationBinding' ->> 'expectationHash' ~ '^[a-f0-9]{64}$'))
  ) is true);

comment on constraint sultan_stage5_outcome_receipt_exact_binding
  on public.sultan_outcome_observations is
  'Binds outcome JSON to exact admission/readback hashes and producer SHAs; terminal outcomes require interaction-bound proof.';
create index sultan_stage5_outcome_exact_admission_idx
  on public.sultan_outcome_observations
  (tenant_id, admission_receipt_id, admission_receipt_hash, admission_api_deployment_sha);
create index sultan_stage5_outcome_exact_readback_idx
  on public.sultan_outcome_observations
  (tenant_id, readback_receipt_id, readback_hash, readback_api_deployment_sha);
comment on table public.sultan_api_admission_evidence_refs is
  'Append-only claim mapping from a Sultan interaction receipt to exact canonical API readbacks.';

commit;
