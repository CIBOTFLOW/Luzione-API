import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION,
  SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
  SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION,
  SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION,
  canonicalClaimEvidenceBinding,
  outcomeExpectationBindingHash,
  outcomeExpectationHash,
  sultanInteractionReceiptHash,
  stage5EvidenceRefsHash,
  type CanonicalReadbackReceipt,
  type CanonicalSubjectType,
  type OutcomeExpectationProof,
  type Stage5AdmissionAssertion,
  type Stage5Pins,
  type SultanInteractionReceiptProof,
} from "@/modules/sultan-stage5/contracts";
import { SultanStage5StoreError, PostgresSultanStage5Store } from "@/modules/sultan-stage5/postgresStore";
import { SultanStage5Service } from "@/modules/sultan-stage5/service";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const READ_AT = "2026-09-02T12:00:00.000Z";
const ADMIT_AT = "2026-09-02T12:01:00.000Z";
const OUTCOME_AT = "2026-09-02T12:03:00.000Z";
const API_SHA = "a".repeat(40);
const SULTAN_CONTRACT_SHA = "5b43e539eb27e83a8f14dffbcf9a401d740b6cd9";
const SULTAN_DEPLOYMENT_SHA = "c".repeat(40);
const UI_DEPLOYMENT_SHA = "d".repeat(40);

const pool = new Pool({ connectionString, allowExitOnIdle: true, max: 4 });
const store = new PostgresSultanStage5Store(pool);
const pins: Stage5Pins = {
  apiDeploymentSha: API_SHA,
  maximumEvidenceAgeMs: 300_000,
  participationContractSha: SULTAN_CONTRACT_SHA,
  participationContractVersion: SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION,
  sultanDeploymentSha: SULTAN_DEPLOYMENT_SHA,
  uiDeploymentSha: UI_DEPLOYMENT_SHA,
};

const osActor: ApiActor = {
  actorId: "service:sultan-os",
  actorType: "service",
  capabilities: [
    "analysis.read", "sultan.stage5.admission.request", "sultan.canonical.readback.read",
    "sultan.outcome.observe", "sultan.case.read", "sultan.tool.invoke",
    "sultan.command.prepare", "sultan.internal.command", "sultan.rfq.canary.send",
  ],
  source: "vercel-oidc",
  tenantId: "luzione",
};
const uiActor: ApiActor = {
  actorId: "service:luzione-ui",
  actorType: "service",
  capabilities: ["sultan.canonical.readback.read", "sultan.outcome.observe"],
  source: "vercel-oidc",
  tenantId: "luzione",
};

const subjects: ReadonlyArray<[CanonicalSubjectType, string]> = [
  ["ORDER", "stage5-order-001"],
  ["SHIPMENT", "shipment-stage5-001"],
  ["ACCOUNT", "account-stage5-001"],
  ["OPPORTUNITY", "opportunity-stage5-001"],
  ["COMMITMENT", "commitment-stage5-001"],
  ["LOGISTICS", "stage5-order-001"],
  ["ECONOMIC_CALCULATION", "stage5-quote-001"],
  ["FEP_ALLOCATION", "fep-stage5-001"],
];

async function main() {
  try {
    const readbackService = serviceAt(READ_AT);
    const readbacks = new Map<CanonicalSubjectType, CanonicalReadbackReceipt>();
    for (const [subjectType, subjectId] of subjects) {
      const receipt = await readbackService.canonicalReadback(uiActor, {
        consumerDeploymentSha: UI_DEPLOYMENT_SHA,
        contractVersion: SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
        idempotencyKey: `stage5-read-${subjectType.toLowerCase()}`,
        requestedAt: READ_AT,
        subjectId,
        subjectType,
      });
      assert.equal(receipt.status, "AVAILABLE", `${subjectType} must be available in the disposable canonical fixture`);
      assert.ok(receipt.claims.length > 0, `${subjectType} must carry bounded claims`);
      assert.ok(receipt.claims.every((claim) => claim.kind === "FACT" || claim.kind === "CALCULATION"));
      assert.equal(receipt.provenance.authority, "CANONICAL_POSTGRES");
      readbacks.set(subjectType, receipt);
    }

    const opportunityEvidence = required(readbacks.get("OPPORTUNITY"));
    const admission = await serviceAt(ADMIT_AT).admit(osActor, assertion({
      evidenceReceipt: opportunityEvidence,
      operationId: "stage5-operation-read-001",
      requestedAt: "2026-09-02T12:00:30.000Z",
    }));
    assert.equal(admission.status, "ADMITTED_NO_EFFECT");
    assert.equal(admission.externalEffectsAuthorized, false);
    const replay = await serviceAt(ADMIT_AT).admit(osActor, assertion({
      evidenceReceipt: opportunityEvidence,
      operationId: "stage5-operation-read-001",
      requestedAt: "2026-09-02T12:00:30.000Z",
    }));
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.receiptHash, admission.receiptHash);

    const actionAdmission = await serviceAt(ADMIT_AT).admit(osActor, assertion({
      evidenceReceipt: opportunityEvidence,
      operationId: "stage5-operation-action-001",
      phase: "ACTION_PREPARATION",
      requestedAt: "2026-09-02T12:00:31.000Z",
      requestedCapability: "sultan.internal.command",
      requestedEffectClass: "A1",
    }));
    assert.equal(actionAdmission.status, "DENIED");
    assert.ok(actionAdmission.reasonCodes.includes("POST_INFERENCE_PURPOSE_SCOPE_MISMATCH"));
    assert.equal(actionAdmission.externalEffectsAuthorized, false);
    const actionCount = await tenantCount("luzione", "sultan_agent_internal_actions");
    assert.equal(actionCount, 0, "denied Stage 5 admission may not prepare or execute an action");

    const laterReadback = await serviceAt(OUTCOME_AT).canonicalReadback(osActor, {
      consumerDeploymentSha: SULTAN_DEPLOYMENT_SHA,
      contractVersion: SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
      idempotencyKey: "stage5-read-opportunity-later",
      requestedAt: OUTCOME_AT,
      subjectId: "opportunity-stage5-001",
      subjectType: "OPPORTUNITY",
    });
    const outcome = await serviceAt(OUTCOME_AT).observeOutcome(uiActor, {
      admissionReceiptId: admission.admissionReceiptId,
      contractVersion: SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION,
      idempotencyKey: "stage5-outcome-confirmed-001",
      mode: "OBSERVE",
      readbackReceiptId: laterReadback.readbackReceiptId,
      requestedAt: OUTCOME_AT,
      supersedesObservationId: null,
    });
    assert.equal(outcome.classification, "CONFIRMED");
    assert.equal(outcome.evidence.claimId, "opportunity.stage");

    const refutedAdmission = await serviceAt(ADMIT_AT).admit(osActor, assertion({
      evidenceReceipt: opportunityEvidence,
      expectedValue: "lost",
      operationId: "stage5-operation-refuted-001",
      requestedAt: "2026-09-02T12:00:32.000Z",
    }));
    const refuted = await serviceAt(OUTCOME_AT).observeOutcome(uiActor, {
      admissionReceiptId: refutedAdmission.admissionReceiptId,
      contractVersion: SULTAN_STAGE5_OUTCOME_CONTRACT_VERSION,
      idempotencyKey: "stage5-outcome-refuted-001",
      mode: "OBSERVE",
      readbackReceiptId: laterReadback.readbackReceiptId,
      requestedAt: OUTCOME_AT,
      supersedesObservationId: null,
    });
    assert.equal(refuted.classification, "REFUTED");

    const wrongSha = assertion({ evidenceReceipt: opportunityEvidence, operationId: "stage5-operation-wrong-sha", requestedAt: "2026-09-02T12:00:33.000Z" });
    wrongSha.participation.contractSha = "e".repeat(40);
    const denial = await serviceAt(ADMIT_AT).admit(osActor, wrongSha);
    assert.equal(denial.status, "DENIED");
    assert.ok(denial.reasonCodes.includes("PARTICIPATION_CONTRACT_SHA_MISMATCH"));
    assert.equal(denial.externalEffectsAuthorized, false);

    await assert.rejects(
      () => readbackService.canonicalReadback(uiActor, {
        consumerDeploymentSha: "f".repeat(40),
        contractVersion: SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
        idempotencyKey: "stage5-wrong-consumer-sha",
        requestedAt: READ_AT,
        subjectId: "stage5-order-001",
        subjectType: "ORDER",
      }),
      (error: unknown) => error instanceof SultanStage5StoreError && error.code === "CONSUMER_DEPLOYMENT_SHA_MISMATCH",
    );
    await assert.rejects(
      () => readbackService.canonicalReadback(uiActor, {
        consumerDeploymentSha: UI_DEPLOYMENT_SHA,
        contractVersion: SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
        idempotencyKey: "stage5-read-order",
        requestedAt: READ_AT,
        subjectId: "different-order",
        subjectType: "ORDER",
      }),
      (error: unknown) => error instanceof SultanStage5StoreError && error.code === "READBACK_IDEMPOTENCY_CONFLICT",
    );

    await assertTenantAndPrivilegeBoundaries();
    const persistedAdmission = await store.readAdmission("luzione", admission.admissionReceiptId);
    const persistedOutcome = await store.readOutcome("luzione", outcome.observationId);
    assert.equal(persistedAdmission?.receiptHash, admission.receiptHash);
    assert.equal(persistedOutcome?.receiptHash, outcome.receiptHash);
    const serialized = JSON.stringify({ admission: persistedAdmission, outcome: persistedOutcome, readbacks: [...readbacks.values()] });
    assert.doesNotMatch(serialized, /rawPrompt|raw_response|systemPrompt|messages|secret|apiKey|token/i);
    await assertDatabaseLineageNegatives({ admission, outcome, readback: opportunityEvidence });

    console.log(JSON.stringify({
      admissionReceiptId: admission.admissionReceiptId,
      admissionStatus: admission.status,
      canonicalReadbackTypes: [...readbacks.keys()].sort(),
      consequentialAdmissionStatus: actionAdmission.status,
      externalEffectsAuthorized: false,
      idempotentReplayVerified: replay.idempotentReplay,
      outcomeClassifications: [outcome.classification, refuted.classification].sort(),
      outcomeObservationId: outcome.observationId,
      participantContractSha: SULTAN_CONTRACT_SHA,
      tenantIsolationVerified: true,
    }));
  } finally {
    await pool.end();
  }
}

function serviceAt(now: string) {
  return new SultanStage5Service(store, pins, () => new Date(now));
}

function assertion(input: {
  evidenceReceipt: CanonicalReadbackReceipt;
  expectedValue?: string;
  operationId: string;
  phase?: Stage5AdmissionAssertion["phase"];
  requestedAt: string;
  requestedCapability?: string;
  requestedEffectClass?: Stage5AdmissionAssertion["requestedEffectClass"];
}): Stage5AdmissionAssertion {
  const reference = {
    apiDeploymentSha: input.evidenceReceipt.apiDeploymentSha,
    claimEvidence: input.evidenceReceipt.claims.map((claim) =>
      canonicalClaimEvidenceBinding(input.evidenceReceipt, claim)),
    consumerActorId: input.evidenceReceipt.consumer.actorId,
    consumerReleaseSha: input.evidenceReceipt.consumer.deploymentSha,
    freshUntil: input.evidenceReceipt.freshUntil,
    observedAt: input.evidenceReceipt.observedAt,
    readbackHash: input.evidenceReceipt.readbackHash,
    readbackReceiptId: input.evidenceReceipt.readbackReceiptId,
    sourceRefs: input.evidenceReceipt.provenance.sourceRefs,
    sourceVersion: input.evidenceReceipt.provenance.sourceVersion,
    status: input.evidenceReceipt.status,
    subjectId: input.evidenceReceipt.subjectId,
    subjectType: input.evidenceReceipt.subjectType,
    tenantId: input.evidenceReceipt.tenantId,
  };
  const runId = `run-${input.operationId}`;
  const outcomeExpectation = {
    claimId: "opportunity.stage",
    expectedValue: input.expectedValue ?? "qualified",
    operator: "EQ",
    subjectId: "opportunity-stage5-001",
    subjectType: "OPPORTUNITY",
  } as const;
  const expectationHash = outcomeExpectationHash(outcomeExpectation);
  const consumedClaim = required(reference.claimEvidence.find((claim) =>
    claim.claimId === outcomeExpectation.claimId));
  const interactionMaterial: Omit<SultanInteractionReceiptProof, "interactionId" | "receiptHash"> = {
    actorId: `user_${"7".repeat(64)}`,
    contextHash: sha256(["context", input.operationId]),
    contractVersion: SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION,
    controls: {
      authorityGranted: false,
      businessStateMutated: false,
      canonicalBeliefChanged: false,
      canonicalMemoryChanged: false,
      externalEffectAuthorized: false,
      learningState: "OBSERVATION_ONLY",
      noRawPromptPersisted: true,
      noRawResponsePersisted: true,
      policyChanged: false,
      reviewRequiredForPromotion: true,
    },
    deploymentSha: SULTAN_DEPLOYMENT_SHA,
    evidenceHashesUsed: [consumedClaim.evidenceHash],
    evidenceRefsUsed: [consumedClaim.evidenceRef],
    groundingAssemblerDeploymentSha: UI_DEPLOYMENT_SHA,
    groundingAssemblerWorkloadId: "service:luzione-ui",
    groundingPacketHash: sha256(["grounding", input.operationId]),
    identityContractHash: sha256("sultan-sovereign-identity-v1"),
    identityContractVersion: "sultan.sovereign-identity.v1",
    model: "stage5-disposable-model",
    modelVersion: "stage5-disposable-model-v1",
    occurredAt: input.requestedAt,
    outcomeExpectationHash: expectationHash,
    participantSetHash: sha256(["agent.luzione.revenue-steward@v1", "agent.control.independent-critic@v1"]),
    queryHash: sha256(["query", input.operationId]),
    responseHash: sha256(["response", input.operationId]),
    schemaVersion: "sultan.developmental-interaction-receipt.v2",
    shadowReviewRefsUsed: [],
    sourceInteractionRefHash: sha256(["source-interaction", input.operationId]),
    sourceRunIdHash: sha256(runId),
    status: "READY",
    surface: "AGENT_CASE",
    tenantId: "luzione",
  };
  const interactionReceiptHash = sultanInteractionReceiptHash(interactionMaterial);
  const interactionReceipt: SultanInteractionReceiptProof = {
    ...interactionMaterial,
    interactionId: `interaction_${interactionReceiptHash.slice(0, 32)}`,
    receiptHash: interactionReceiptHash,
  };
  const proofMaterial: Omit<OutcomeExpectationProof, "bindingHash"> = {
    contractVersion: "sultan.outcome-expectation-binding/v1",
    expectationHash,
    interactionId: interactionReceipt.interactionId,
    interactionReceiptHash,
  };
  return {
    caseRef: { caseId: "case-stage5-001", caseType: "COMMERCIAL", expectedVersion: "commercial-case:case-stage5-001:v1" },
    contractVersion: SULTAN_STAGE5_ADMISSION_CONTRACT_VERSION,
    evidence: { evidenceRefsHash: stage5EvidenceRefsHash([reference]), readbackReceiptIds: [reference.readbackReceiptId] },
    idempotencyKey: `admit-${input.operationId}`,
    interactionId: interactionReceipt.interactionId,
    interactionReceipt,
    interactionReceiptHash,
    logicalAgent: { agentId: "agent.luzione.revenue-steward", agentVersion: "v1" },
    operationId: input.operationId,
    outcomeExpectation,
    outcomeExpectationProof: {
      ...proofMaterial,
      bindingHash: outcomeExpectationBindingHash(proofMaterial),
    },
    participation: {
      contextHash: sha256(["context", input.operationId]),
      contractSha: SULTAN_CONTRACT_SHA,
      contractVersion: SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION,
      criticAgent: { agentId: "agent.control.independent-critic", agentVersion: "v1" },
      groundingAssemblerDeploymentSha: UI_DEPLOYMENT_SHA,
      groundingPacketHash: sha256(["grounding", input.operationId]),
      identityContractHash: sha256("sultan-sovereign-identity-v1"),
      identityContractVersion: "sultan.sovereign-identity.v1",
      modelVersion: "stage5-disposable-model-v1",
      participantSetHash: sha256(["agent.luzione.revenue-steward@v1", "agent.control.independent-critic@v1"]),
      primaryAgent: { agentId: "agent.luzione.revenue-steward", agentVersion: "v1" },
      sultanDeploymentSha: SULTAN_DEPLOYMENT_SHA,
    },
    phase: input.phase ?? "SIMULATION",
    purpose: "agent-case-post-inference",
    requestedAt: input.requestedAt,
    requestedCapability: input.requestedCapability ?? "analysis.read",
    requestedEffectClass: input.requestedEffectClass ?? "A0",
    runId,
  };
}

async function assertTenantAndPrivilegeBoundaries() {
  const visible = await tenantCount("luzione", "sultan_api_admission_receipts");
  const crossTenant = await tenantCount("other", "sultan_api_admission_receipts");
  assert.ok(visible >= 3);
  assert.equal(crossTenant, 0);

  await expectPermissionDenied(async (client) => {
    await client.query("set local role anon");
    await client.query("select 1 from public.sultan_api_admission_receipts");
  });
  await expectPermissionDenied(async (client) => {
    await client.query("set local role authenticated");
    await client.query("select 1 from public.sultan_canonical_readback_receipts");
  });
  await expectPermissionDenied(async (client) => {
    await client.query("set local role service_role");
    await client.query("select 1 from public.sultan_outcome_observations");
  });
  await expectPermissionDenied(async (client) => {
    await client.query("set local role luzione_api_runtime");
    await client.query("select set_config('app.tenant_id','luzione',true)");
    await client.query("update public.sultan_api_admission_receipts set status='DENIED'");
  });
}

async function assertDatabaseLineageNegatives(input: {
  admission: Awaited<ReturnType<SultanStage5Service["admit"]>>;
  outcome: Awaited<ReturnType<SultanStage5Service["observeOutcome"]>>;
  readback: CanonicalReadbackReceipt;
}) {
  await expectSqlState("23514", async (client) => {
    await client.query(
      `insert into public.sultan_canonical_readback_receipts (
         tenant_id,readback_receipt_id,idempotency_key,consumer_actor_id,consumer_deployment_sha,
         subject_type,subject_id,status,source_version,observed_at,fresh_until,request_hash,
         readback_hash,receipt
       ) select tenant_id,$1,$2,consumer_actor_id,consumer_deployment_sha,subject_type,subject_id,
                status,source_version,observed_at,fresh_until,$3,$4,receipt
           from public.sultan_canonical_readback_receipts
          where tenant_id='luzione' and readback_receipt_id=$5`,
      ["s5read_ffffffffffffffffffffffffffffffff", "sql-negative-readback-json", "e".repeat(64), "f".repeat(64), input.readback.readbackReceiptId],
    );
  });

  await expectSqlState("23514", async (client) => {
    await client.query(
      `insert into public.sultan_api_admission_evidence_refs (
         tenant_id,admission_receipt_id,admission_receipt_hash,readback_receipt_id,
         readback_hash,claim_id,evidence_ref,evidence_hash,ordinal
       ) values ('luzione',$1,$2,$3,$4,'opportunity.amountCents',$3 || '/opportunity.amountCents',$5,1)`,
      [input.admission.admissionReceiptId, input.admission.receiptHash, input.readback.readbackReceiptId, input.readback.readbackHash, "f".repeat(64)],
    );
  });

  await expectSqlState("23514", async (client) => {
    await client.query(
      `insert into public.sultan_api_admission_receipts (
         tenant_id,admission_receipt_id,idempotency_key,operation_id,run_id,interaction_id,
         status,phase,credential_actor_id,logical_agent_id,logical_agent_version,case_id,
         case_type,requested_capability,requested_effect_class,participation_contract_sha,
         sultan_deployment_sha,grounding_assembler_deployment_sha,api_deployment_sha,context_hash,
         grounding_packet_hash,participant_set_hash,interaction_receipt_hash,evidence_refs_hash,
         policy_version,request_hash,receipt_hash,requested_at,decided_at,external_effects_authorized,receipt
       ) select tenant_id,$1,$2,$3,$4,interaction_id,status,phase,credential_actor_id,
                logical_agent_id,logical_agent_version,case_id,case_type,requested_capability,
                requested_effect_class,participation_contract_sha,sultan_deployment_sha,
                grounding_assembler_deployment_sha,api_deployment_sha,context_hash,
                grounding_packet_hash,participant_set_hash,interaction_receipt_hash,evidence_refs_hash,
                policy_version,$5,$6,requested_at,decided_at,false,
                receipt || jsonb_build_object(
                  'admissionReceiptId',$1,'idempotencyKey',$2,'operationId',$3,'runId',$4,'receiptHash',$6
                )
           from public.sultan_api_admission_receipts
          where tenant_id='luzione' and admission_receipt_id=$7`,
      ["s5admit_dddddddddddddddddddddddddddddddd", "sql-negative-admission-run-digest", "sql-negative-run-operation", "run-sql-negative", "c".repeat(64), "d".repeat(64), input.admission.admissionReceiptId],
    );
  });

  await expectSqlState("23514", async (client) => {
    await client.query(
      `insert into public.sultan_api_admission_receipts (
         tenant_id,admission_receipt_id,idempotency_key,operation_id,run_id,interaction_id,
         status,phase,credential_actor_id,logical_agent_id,logical_agent_version,case_id,
         case_type,requested_capability,requested_effect_class,participation_contract_sha,
         sultan_deployment_sha,grounding_assembler_deployment_sha,api_deployment_sha,context_hash,
         grounding_packet_hash,participant_set_hash,interaction_receipt_hash,evidence_refs_hash,
         policy_version,request_hash,receipt_hash,requested_at,decided_at,external_effects_authorized,receipt
       ) select tenant_id,$1,$2,$3,run_id,interaction_id,status,phase,credential_actor_id,
                logical_agent_id,logical_agent_version,case_id,case_type,requested_capability,
                requested_effect_class,participation_contract_sha,sultan_deployment_sha,
                grounding_assembler_deployment_sha,api_deployment_sha,context_hash,
                grounding_packet_hash,participant_set_hash,interaction_receipt_hash,evidence_refs_hash,
                policy_version,$4,$5,requested_at,decided_at,false,
                receipt || jsonb_build_object(
                  'admissionReceiptId',$1,'idempotencyKey',$2,'operationId',$3,'receiptHash',$5
                )
           from public.sultan_api_admission_receipts
          where tenant_id='luzione' and admission_receipt_id=$6`,
      ["s5admit_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "sql-negative-missing-evidence", "sql-negative-operation", "d".repeat(64), "e".repeat(64), input.admission.admissionReceiptId],
    );
    await client.query("set constraints sultan_stage5_admission_evidence_complete immediate");
  });

  await expectSqlState("23503", async (client) => {
    await client.query(
      `insert into public.sultan_outcome_observations (
         tenant_id,observation_id,idempotency_key,admission_receipt_id,readback_receipt_id,
         classification,supersedes_observation_id,observer_actor_id,request_hash,receipt_hash,
         observed_at,receipt
       ) select tenant_id,$1,$2,admission_receipt_id,readback_receipt_id,classification,
                supersedes_observation_id,observer_actor_id,$3,$4,observed_at,
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(receipt,'{observationId}',to_jsonb($1::text)),
                      '{idempotencyKey}',to_jsonb($2::text)
                    ),
                    '{observationRequest,idempotencyKey}',to_jsonb($2::text)
                  ),
                  '{evidence,readbackHash}',to_jsonb($5::text)
                ) || jsonb_build_object('receiptHash',$4)
           from public.sultan_outcome_observations
          where tenant_id='luzione' and observation_id=$6`,
      ["s5out_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "sql-negative-outcome-parent", "c".repeat(64), "d".repeat(64), "f".repeat(64), input.outcome.observationId],
    );
  });

  await expectSqlState("23514", async (client) => {
    await client.query(
      `insert into public.sultan_outcome_observations (
         tenant_id,observation_id,idempotency_key,admission_receipt_id,readback_receipt_id,
         classification,supersedes_observation_id,observer_actor_id,request_hash,receipt_hash,
         observed_at,receipt
       ) select tenant_id,$1,$2,admission_receipt_id,readback_receipt_id,classification,
                supersedes_observation_id,observer_actor_id,$3,$4,observed_at,
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(receipt,'{observationId}',to_jsonb($1::text)),
                      '{idempotencyKey}',to_jsonb($2::text)
                    ),
                    '{observationRequest,idempotencyKey}',to_jsonb($2::text)
                  ),
                  '{admissionLineage,contextHash}',to_jsonb($5::text)
                ) || jsonb_build_object('receiptHash',$4)
           from public.sultan_outcome_observations
          where tenant_id='luzione' and observation_id=$6`,
      ["s5out_dddddddddddddddddddddddddddddddd", "sql-negative-outcome-lineage", "b".repeat(64), "c".repeat(64), "f".repeat(64), input.outcome.observationId],
    );
  });
}

async function expectSqlState(expectedCode: string, work: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id','luzione',true)");
    let observedCode: string | undefined;
    try {
      await work(client);
      await client.query("commit");
    } catch (error) {
      observedCode = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
      await client.query("rollback");
    }
    assert.equal(observedCode, expectedCode, `expected SQLSTATE ${expectedCode}, received ${observedCode ?? "success"}`);
  } finally {
    client.release();
  }
}

async function tenantCount(tenantId: string, table: string) {
  const allowed = new Set(["sultan_api_admission_receipts", "sultan_agent_internal_actions"]);
  if (!allowed.has(table)) throw new Error("Unsupported proof relation.");
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("set local role luzione_api_runtime");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    const result = await client.query<{ count: string }>(`select count(*)::text as count from public.${table}`);
    await client.query("rollback");
    return Number(result.rows[0]?.count ?? "0");
  } finally {
    client.release();
  }
}

async function expectPermissionDenied(work: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await assert.rejects(
      () => work(client),
      (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "42501",
    );
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required disposable proof value is missing.");
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
