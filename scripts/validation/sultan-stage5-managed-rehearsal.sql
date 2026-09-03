\set ON_ERROR_STOP on

-- Synthetic managed-validation proof for the final Stage 5 schema. The
-- fixture transaction is always rolled back and proves no business value,
-- live learning, production connectivity, AGI or consciousness.
begin;
set local role luzione_api_runtime;
select set_config('app.tenant_id','luzione',true);

insert into public.sultan_canonical_readback_receipts (
  tenant_id,readback_receipt_id,idempotency_key,consumer_actor_id,consumer_deployment_sha,
  subject_type,subject_id,status,source_version,observed_at,fresh_until,request_hash,
  readback_hash,receipt
) values (
  'luzione','s5read_11111111111111111111111111111111','stage5-managed-readback-1',
  'service:luzione-ui',repeat('d',40),'OPPORTUNITY','opportunity-stage5-001','AVAILABLE',
  'validation:opportunity:v1','2026-09-03T02:15:00Z','2026-09-03T02:20:00Z',
  repeat('a',64),repeat('b',64),
  jsonb_build_object(
    'contractVersion','luzione-canonical-business-readback/v1',
    'readbackReceiptId','s5read_11111111111111111111111111111111',
    'tenantId','luzione','subjectType','OPPORTUNITY','subjectId','opportunity-stage5-001',
    'status','AVAILABLE','apiDeploymentSha',repeat('a',40),
    'consumer',jsonb_build_object('actorId','service:luzione-ui','deploymentSha',repeat('d',40)),
    'claims',jsonb_build_array(jsonb_build_object(
      'claimId','opportunity.stage','kind','FACT','value','qualified','valueType','STRING','unit',null
    )),
    'provenance',jsonb_build_object(
      'authority','CANONICAL_POSTGRES','sourceVersion','validation:opportunity:v1',
      'sourceRefs',jsonb_build_array('postgres:opportunity-stage5-001:v1')
    ),
    'observedAt','2026-09-03T02:15:00Z','freshUntil','2026-09-03T02:20:00Z',
    'idempotencyKey','stage5-managed-readback-1','idempotentReplay',false,
    'readbackHash',repeat('b',64),'grantsAuthority',false
  )
);

insert into public.sultan_api_admission_receipts (
  tenant_id,admission_receipt_id,idempotency_key,operation_id,run_id,interaction_id,
  status,phase,credential_actor_id,logical_agent_id,logical_agent_version,case_id,
  case_type,requested_capability,requested_effect_class,participation_contract_sha,
  sultan_deployment_sha,grounding_assembler_deployment_sha,api_deployment_sha,context_hash,
  grounding_packet_hash,participant_set_hash,interaction_receipt_hash,evidence_refs_hash,
  policy_version,request_hash,receipt_hash,requested_at,decided_at,external_effects_authorized,receipt
) values (
  'luzione','s5admit_1111111111111111111111111111111','stage5-managed-admission-1',
  'stage5-managed-operation-1','stage5-managed-run-1','stage5-managed-interaction-1',
  'ADMITTED_NO_EFFECT','SIMULATION','service:sultan-os','agent.luzione.revenue-steward','v1',
  'case-stage5-001','COMMERCIAL','analysis.read','A0',
  '5b43e539eb27e83a8f14dffbcf9a401d740b6cd9',repeat('c',40),repeat('d',40),repeat('a',40),
  repeat('1',64),repeat('2',64),repeat('3',64),repeat('4',64),repeat('5',64),
  'luzione-sultan-stage5-policy/2026-09-03.v1',repeat('6',64),repeat('7',64),
  '2026-09-03T02:16:00Z','2026-09-03T02:16:01Z',false,
  jsonb_build_object(
    'contractVersion','luzione-sultan-api-admission/v1','admissionTiming','POST_INFERENCE',
    'authorizesInference',false,'admissionReceiptId','s5admit_1111111111111111111111111111111',
    'idempotencyKey','stage5-managed-admission-1','operationId','stage5-managed-operation-1',
    'runId','stage5-managed-run-1','interactionId','stage5-managed-interaction-1',
    'interactionReceiptHash',repeat('4',64),'status','ADMITTED_NO_EFFECT','phase','SIMULATION',
    'credentialActor',jsonb_build_object('actorId','service:sultan-os','tenantId','luzione'),
    'logicalAgent',jsonb_build_object('agentId','agent.luzione.revenue-steward','agentVersion','v1'),
    'caseRef',jsonb_build_object('caseId','case-stage5-001','caseType','COMMERCIAL'),
    'purpose','agent-case-post-inference','requestedCapability','analysis.read','requestedEffectClass','A0',
    'participation',jsonb_build_object(
      'contractSha','5b43e539eb27e83a8f14dffbcf9a401d740b6cd9',
      'sultanDeploymentSha',repeat('c',40),'groundingAssemblerDeploymentSha',repeat('d',40),
      'contextHash',repeat('1',64),'groundingPacketHash',repeat('2',64),'participantSetHash',repeat('3',64)
    ),
    'apiDeploymentSha',repeat('a',40),
    'interactionReceipt',jsonb_build_object(
      'contractVersion','sultan.stage5-developmental-participation.v2',
      'schemaVersion','sultan.developmental-interaction-receipt.v2',
      'interactionId','stage5-managed-interaction-1','receiptHash',repeat('4',64),
      'tenantId','luzione','surface','AGENT_CASE','status','READY',
      'sourceRunIdHash','44f2e06c8264628fef8aa9810f137778e13b7034ba2726982bf7af53778f9d0c',
      'contextHash',repeat('1',64),'deploymentSha',repeat('c',40),
      'groundingPacketHash',repeat('2',64),'groundingAssemblerDeploymentSha',repeat('d',40),
      'participantSetHash',repeat('3',64),'outcomeExpectationHash',repeat('e',64),
      'controls',jsonb_build_object(
        'authorityGranted',false,'businessStateMutated',false,'canonicalBeliefChanged',false,
        'canonicalMemoryChanged',false,'externalEffectAuthorized',false,
        'noRawPromptPersisted',true,'noRawResponsePersisted',true,'policyChanged',false
      )
    ),
    'evidence',jsonb_build_object(
      'evidenceRefsHash',repeat('5',64),
      'readbackReceiptIds',jsonb_build_array('s5read_11111111111111111111111111111111'),
      'consumedEvidence',jsonb_build_array(jsonb_build_object(
        'claimId','opportunity.stage','evidenceHash',repeat('8',64),
        'evidenceRef','s5read_11111111111111111111111111111111/opportunity.stage',
        'readbackHash',repeat('b',64),'readbackReceiptId','s5read_11111111111111111111111111111111'
      )),
      'sourceVerification','API_CANONICAL_READBACKS_VERIFIED_CONTEXT_HASH_SULTAN_ASSERTED'
    ),
    'outcomeExpectation',jsonb_build_object(
      'claimId','opportunity.stage','expectedValue','qualified','operator','EQ',
      'subjectId','opportunity-stage5-001','subjectType','OPPORTUNITY'
    ),
    'outcomeExpectationProof',jsonb_build_object(
      'contractVersion','sultan.outcome-expectation-binding/v1','expectationHash',repeat('e',64),
      'interactionId','stage5-managed-interaction-1','interactionReceiptHash',repeat('4',64),
      'bindingHash',repeat('f',64)
    ),
    'outcomeExpectationBinding',jsonb_build_object(
      'expectationHash',repeat('e',64),'proofHash',repeat('f',64),
      'source','AUTHENTICATED_SULTAN_INTERACTION_RECEIPT','interactionReceiptBound',true
    ),
    'policyVersion','luzione-sultan-stage5-policy/2026-09-03.v1',
    'requestedAt','2026-09-03T02:16:00Z','decidedAt','2026-09-03T02:16:01Z',
    'receiptHash',repeat('7',64),'idempotentReplay',false,
    'effectAuthority','NO_EFFECT','externalEffectsAuthorized',false
  )
);

insert into public.sultan_api_admission_evidence_refs (
  tenant_id,admission_receipt_id,admission_receipt_hash,readback_receipt_id,
  readback_hash,claim_id,evidence_ref,evidence_hash,ordinal
) values (
  'luzione','s5admit_1111111111111111111111111111111',repeat('7',64),
  's5read_11111111111111111111111111111111',repeat('b',64),'opportunity.stage',
  's5read_11111111111111111111111111111111/opportunity.stage',repeat('8',64),0
);
set constraints sultan_stage5_admission_evidence_complete immediate;
set constraints sultan_stage5_admission_evidence_complete deferred;

insert into public.sultan_outcome_observations (
  tenant_id,observation_id,idempotency_key,admission_receipt_id,readback_receipt_id,
  classification,supersedes_observation_id,observer_actor_id,request_hash,receipt_hash,observed_at,receipt
) values (
  'luzione','s5out_11111111111111111111111111111111','stage5-managed-outcome-1',
  's5admit_1111111111111111111111111111111','s5read_11111111111111111111111111111111',
  'CONFIRMED',null,'service:luzione-ui',repeat('9',64),repeat('0',64),'2026-09-03T02:17:00Z',
  jsonb_build_object(
    'contractVersion','luzione-sultan-outcome-observation/v1',
    'observationId','s5out_11111111111111111111111111111111',
    'admissionReceiptId','s5admit_1111111111111111111111111111111',
    'admissionLineage',jsonb_build_object(
      'admissionReceiptHash',repeat('7',64),'apiDeploymentSha',repeat('a',40),
      'contextHash',repeat('1',64),'groundingPacketHash',repeat('2',64),
      'interactionId','stage5-managed-interaction-1','interactionReceiptHash',repeat('4',64),
      'operationId','stage5-managed-operation-1','runId','stage5-managed-run-1',
      'sultanDeploymentSha',repeat('c',40)
    ),
    'apiDeploymentSha',repeat('a',40),'classification','CONFIRMED',
    'evidence',jsonb_build_object(
      'apiDeploymentSha',repeat('a',40),'claimId','opportunity.stage','observedValue','qualified',
      'readbackHash',repeat('b',64),'readbackReceiptId','s5read_11111111111111111111111111111111',
      'sourceRefs',jsonb_build_array('postgres:opportunity-stage5-001:v1')
    ),
    'expectationBinding',jsonb_build_object(
      'expectationHash',repeat('e',64),'proofHash',repeat('f',64),
      'source','AUTHENTICATED_SULTAN_INTERACTION_RECEIPT','interactionReceiptBound',true
    ),
    'observer',jsonb_build_object('actorId','service:luzione-ui','actorType','service','tenantId','luzione'),
    'reasonCode','CANONICAL_CLAIM_MATCHED','supersedesObservationId',null,
    'observationRequest',jsonb_build_object(
      'contractVersion','luzione-sultan-outcome-observation/v1',
      'admissionReceiptId','s5admit_1111111111111111111111111111111',
      'readbackReceiptId','s5read_11111111111111111111111111111111',
      'idempotencyKey','stage5-managed-outcome-1','mode','OBSERVE',
      'requestedAt','2026-09-03T02:17:00Z','supersedesObservationId',null
    ),
    'observedAt','2026-09-03T02:17:00Z','idempotencyKey','stage5-managed-outcome-1',
    'idempotentReplay',false,'receiptHash',repeat('0',64)
  )
);

do $$
begin
  begin
    insert into public.sultan_canonical_readback_receipts (
      tenant_id,readback_receipt_id,idempotency_key,consumer_actor_id,consumer_deployment_sha,
      subject_type,subject_id,status,source_version,observed_at,fresh_until,request_hash,readback_hash,receipt
    ) select 'other','s5read_22222222222222222222222222222222','stage5-managed-cross-tenant',
      consumer_actor_id,consumer_deployment_sha,subject_type,subject_id,status,source_version,
      observed_at,fresh_until,repeat('2',64),repeat('3',64),
      receipt || jsonb_build_object(
        'tenantId','other','readbackReceiptId','s5read_22222222222222222222222222222222',
        'idempotencyKey','stage5-managed-cross-tenant','readbackHash',repeat('3',64)
      )
    from public.sultan_canonical_readback_receipts
    where tenant_id='luzione' and readback_receipt_id='s5read_11111111111111111111111111111111';
    raise exception 'cross-tenant insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.sultan_canonical_readback_receipts (
      tenant_id,readback_receipt_id,idempotency_key,consumer_actor_id,consumer_deployment_sha,
      subject_type,subject_id,status,source_version,observed_at,fresh_until,request_hash,readback_hash,receipt
    ) select tenant_id,'s5read_33333333333333333333333333333333','stage5-managed-forged-json',
      consumer_actor_id,consumer_deployment_sha,subject_type,subject_id,status,source_version,
      observed_at,fresh_until,repeat('4',64),repeat('5',64),receipt
    from public.sultan_canonical_readback_receipts
    where tenant_id='luzione' and readback_receipt_id='s5read_11111111111111111111111111111111';
    raise exception 'forged JSON binding unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into public.sultan_api_admission_evidence_refs (
      tenant_id,admission_receipt_id,admission_receipt_hash,readback_receipt_id,
      readback_hash,claim_id,evidence_ref,evidence_hash,ordinal
    ) values (
      'luzione','s5admit_1111111111111111111111111111111',repeat('7',64),
      's5read_11111111111111111111111111111111',repeat('b',64),'opportunity.amountCents',
      's5read_11111111111111111111111111111111/opportunity.amountCents',repeat('6',64),1
    );
    raise exception 'forged evidence child unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into public.sultan_api_admission_receipts
    select (jsonb_populate_record(
      null::public.sultan_api_admission_receipts,
      to_jsonb(a) || jsonb_build_object(
        'admission_receipt_id','s5admit_3333333333333333333333333333333',
        'idempotency_key','stage5-managed-missing-evidence',
        'operation_id','stage5-managed-missing-evidence-operation',
        'request_hash',repeat('d',64),'receipt_hash',repeat('e',64),
        'receipt',a.receipt || jsonb_build_object(
          'admissionReceiptId','s5admit_3333333333333333333333333333333',
          'idempotencyKey','stage5-managed-missing-evidence',
          'operationId','stage5-managed-missing-evidence-operation','receiptHash',repeat('e',64)
        )
      )
    )).* from public.sultan_api_admission_receipts a
    where a.tenant_id='luzione' and a.admission_receipt_id='s5admit_1111111111111111111111111111111';
    set constraints sultan_stage5_admission_evidence_complete immediate;
    raise exception 'incomplete evidence unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    update public.sultan_api_admission_receipts set status='DENIED'
     where tenant_id='luzione' and admission_receipt_id='s5admit_1111111111111111111111111111111';
    raise exception 'append-only admission update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  when sqlstate 'P0001' then
    if sqlerrm not like 'Sultan Stage 5 receipts and conflicts are append-only%' then raise; end if;
  end;
end $$;

do $$
declare visible_count bigint;
begin
  perform set_config('app.tenant_id','other',true);
  select count(*) into visible_count from public.sultan_api_admission_receipts;
  if visible_count <> 0 then raise exception 'cross-tenant admission read exposed % rows',visible_count; end if;
  select count(*) into visible_count from public.sultan_canonical_readback_receipts;
  if visible_count <> 0 then raise exception 'cross-tenant readback read exposed % rows',visible_count; end if;
  select count(*) into visible_count from public.sultan_outcome_observations;
  if visible_count <> 0 then raise exception 'cross-tenant outcome read exposed % rows',visible_count; end if;
end $$;

reset role;

do $$
declare relation_name text;
declare posture record;
begin
  foreach relation_name in array array[
    'sultan_agent_policy_envelopes','sultan_agent_command_reservations',
    'sultan_agent_internal_actions','sultan_stage5_idempotency_conflicts',
    'sultan_canonical_readback_receipts','sultan_api_admission_receipts',
    'sultan_api_admission_evidence_refs','sultan_outcome_observations'
  ] loop
    select c.relrowsecurity,c.relforcerowsecurity,
           (select count(*) from pg_catalog.pg_policy p where p.polrelid=c.oid) policy_count
      into posture from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname=relation_name;
    if posture.relrowsecurity is not true or posture.relforcerowsecurity is not true
       or posture.policy_count <> 1 then raise exception 'RLS posture failed for %',relation_name; end if;
    if has_table_privilege('anon','public.'||relation_name,'SELECT')
       or has_table_privilege('authenticated','public.'||relation_name,'SELECT')
       or has_table_privilege('service_role','public.'||relation_name,'SELECT')
       or has_table_privilege('luzione_provider_worker','public.'||relation_name,'SELECT') then
      raise exception 'forbidden read privilege exists on %',relation_name;
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_roles
     where rolname in ('luzione_api_runtime','luzione_provider_worker')
       and (rolsuper or rolcreatedb or rolcreaterole or rolcanlogin or rolreplication or rolbypassrls)
  ) then raise exception 'unsafe Stage 5 role attributes remain'; end if;
end $$;

rollback;

select jsonb_build_object(
  'result','PASS','fixtureClass','RECEIPT_VERIFIED_SYNTHETIC','fixtureRolledBack',true,
  'sultanContractSha','5b43e539eb27e83a8f14dffbcf9a401d740b6cd9',
  'positiveReceipts',jsonb_build_array(
    's5read_11111111111111111111111111111111',
    's5admit_1111111111111111111111111111111',
    's5out_11111111111111111111111111111111'
  ),
  'externalEffectsAuthorized',false,'productionEvidence',false
) as rehearsal_receipt;
