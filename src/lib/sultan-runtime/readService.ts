import "server-only";

import { databasePool } from "@/lib/db";
import {
  deriveSultanRuntimeStatus,
  type SultanRuntimeAggregate,
} from "@/modules/sultan-runtime/runtimeStatus";

type RuntimeAggregateRow = Record<string, Date | number | string | null>;

const GOOGLE_PROPOSAL_READBACK_CONTRACT_VERSION = "luzione-google-proposal-readback/v2";
const GOOGLE_PROPOSAL_REQUIRED_SECTIONS = {
  itemized_quote: [
    "Quote Summary",
    "Pricing and Fulfillment Basis",
    "Review and Acceptance Boundary",
    "Itemized Products",
    "Investment Summary",
    "Commercial Terms",
    "Assumptions and Open Items",
  ],
  sales_proposal: [
    "Executive Summary",
    "Project Intent and Scope",
    "Delivery and Installation Plan",
    "Review and Acceptance Boundary",
    "Project Facts",
    "Recommended Solution",
    "Investment Summary",
    "Delivery Milestones",
  ],
  whole_home_proposal: [
    "Whole-Home Design Brief",
    "Room and Zone Schedule",
    "Procurement and Installation Plan",
    "Review and Acceptance Boundary",
    "Project Facts",
    "Product Palette",
    "Room and Zone Requirements",
    "Design Assumptions and Open Items",
  ],
} as const;

function numberValue(value: Date | number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampValue(value: Date | number | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function readGoogleVerifiedDocumentCount() {
  try {
    const readiness = await databasePool().query<{ schema_ready: boolean }>(`
      select
        to_regclass('public.commercial_case_proposal_document_versions') is not null
        and to_regclass('public.commercial_case_google_rendering_events') is not null
        and (
          select count(distinct a.attname)
            from pg_catalog.pg_attribute a
           where a.attrelid = to_regclass('public.commercial_case_proposal_document_versions')
             and not a.attisdropped
             and a.attname in (
               'tenant_id',
               'case_id',
               'proposal_document_version_id',
               'google_generation_state',
               'google_primary_document_id',
               'google_primary_url',
               'google_artifacts',
               'google_readback_proof',
               'snapshot_checksum',
               'google_readback_at'
             )
        ) = 10
        and (
          select count(distinct a.attname)
            from pg_catalog.pg_attribute a
           where a.attrelid = to_regclass('public.commercial_case_google_rendering_events')
             and not a.attisdropped
             and a.attname in (
               'tenant_id',
               'case_id',
               'proposal_document_version_id',
               'state',
               'external_ids',
               'snapshot_checksum',
               'readback_proof'
             )
        ) = 7 as schema_ready
    `);
    if (readiness.rows[0]?.schema_ready !== true) return 0;

    const verified = await databasePool().query<{
      verified_document_count: number | string | null;
    }>(`
      select count(distinct (
               d.tenant_id,
               d.case_id,
               d.proposal_document_version_id
             ))::int as verified_document_count
        from public.commercial_case_proposal_document_versions d
        join public.commercial_case_google_rendering_events e
          on e.tenant_id = d.tenant_id
         and e.case_id = d.case_id
         and e.proposal_document_version_id = d.proposal_document_version_id
         and e.state = 'readback_verified'
       where d.google_generation_state = 'readback_verified'
         and nullif(btrim(d.google_primary_document_id), '') is not null
         and nullif(btrim(d.google_primary_url), '') is not null
         and d.google_readback_at is not null
         and d.snapshot_checksum ~ '^[a-f0-9]{64}$'
         and jsonb_typeof(d.google_artifacts) = 'array'
         and jsonb_array_length(d.google_artifacts) = 3
         and jsonb_typeof(d.google_readback_proof) = 'object'
         and (select count(*) from jsonb_object_keys(d.google_readback_proof)) = 3
         and e.snapshot_checksum = d.snapshot_checksum
         and e.readback_proof = d.google_readback_proof
         and jsonb_typeof(e.external_ids) = 'array'
         and jsonb_array_length(e.external_ids) = 3
         and e.external_ids = (
           select jsonb_agg(artifact.value->>'documentId' order by artifact.ordinality)
           from jsonb_array_elements(d.google_artifacts) with ordinality artifact(value, ordinality)
         )
         and d.google_primary_document_id = d.google_readback_proof->'sales_proposal'->>'documentId'
         and not exists (
           select 1
           from (values
             ('sales_proposal', $1::jsonb, 8),
             ('itemized_quote', $2::jsonb, 7),
             ('whole_home_proposal', $3::jsonb, 8)
           ) as contract(role, required_sections, section_count)
           where not (
             jsonb_typeof(d.google_readback_proof->contract.role) = 'object'
             and d.google_readback_proof->contract.role->>'contractVersion' = $4
             and d.google_readback_proof->contract.role->>'bodyChecksum' ~ '^[a-f0-9]{64}
  } catch {
    // Verification is evidence-based and fail-closed. Missing or drifting schema is never success.
    return 0;
  }
}

export async function readSultanRuntimeStatus() {
  const [result, googleVerifiedDocumentCount] = await Promise.all([
    databasePool().query<RuntimeAggregateRow>(
      "select * from public.luzione_sultan_runtime_status_v1()",
    ),
    readGoogleVerifiedDocumentCount(),
  ]);
  const row = result.rows[0] ?? {};
  const aggregate: SultanRuntimeAggregate = {
    agentRunCount: numberValue(row.agent_run_count),
    agreementCount: numberValue(row.agreement_count),
    airtableConnectionCount: numberValue(row.airtable_connection_count),
    chatMessageCount: numberValue(row.chat_message_count),
    chatSessionCount: numberValue(row.chat_session_count),
    completedRunCount: numberValue(row.completed_run_count),
    completedShopifySyncCount: numberValue(row.completed_shopify_sync_count),
    crmAiProposalCount: numberValue(row.crm_ai_proposal_count),
    disagreementCount: numberValue(row.disagreement_count),
    evaluationCount: numberValue(row.evaluation_count),
    gmailConnectionCount: numberValue(row.gmail_connection_count),
    googleDriveConnectionCount: numberValue(row.google_drive_connection_count),
    googleVerifiedDocumentCount,
    latestAgentRunAt: timestampValue(row.latest_agent_run_at),
    latestEvaluationAt: timestampValue(row.latest_evaluation_at),
    latestModelCallAt: timestampValue(row.latest_model_call_at),
    latestShopifySyncAt: timestampValue(row.latest_shopify_sync_at),
    latestShopifySyncStatus: typeof row.latest_shopify_sync_status === "string" ? row.latest_shopify_sync_status : null,
    lessonMemoryCount: numberValue(row.lesson_memory_count),
    lunaCallCount: numberValue(row.luna_call_count),
    modelCallCount: numberValue(row.model_call_count),
    needsReviewMemoryCount: numberValue(row.needs_review_memory_count),
    openReviewCandidateCount: numberValue(row.open_review_candidate_count),
    pendingFeedbackCount: numberValue(row.pending_feedback_count),
    proposalDocumentCount: numberValue(row.proposal_document_count),
    proposalGateCount: numberValue(row.proposal_gate_count),
    proposalReviewCount: numberValue(row.proposal_review_count),
    shopifyProductCount: numberValue(row.shopify_product_count),
    shopifySyncCount: numberValue(row.shopify_sync_count),
    solCallCount: numberValue(row.sol_call_count),
    successfulModelCallCount: numberValue(row.successful_model_call_count),
    terraCallCount: numberValue(row.terra_call_count),
  };
  return deriveSultanRuntimeStatus(aggregate);
}

             and nullif(btrim(d.google_readback_proof->contract.role->>'documentId'), '') is not null
             and nullif(btrim(d.google_readback_proof->contract.role->>'quoteVersion'), '') is not null
             and d.google_readback_proof->contract.role->>'tableCount' ~ '^[0-9]+
  } catch {
    // Verification is evidence-based and fail-closed. Missing or drifting schema is never success.
    return 0;
  }
}

export async function readSultanRuntimeStatus() {
  const [result, googleVerifiedDocumentCount] = await Promise.all([
    databasePool().query<RuntimeAggregateRow>(
      "select * from public.luzione_sultan_runtime_status_v1()",
    ),
    readGoogleVerifiedDocumentCount(),
  ]);
  const row = result.rows[0] ?? {};
  const aggregate: SultanRuntimeAggregate = {
    agentRunCount: numberValue(row.agent_run_count),
    agreementCount: numberValue(row.agreement_count),
    airtableConnectionCount: numberValue(row.airtable_connection_count),
    chatMessageCount: numberValue(row.chat_message_count),
    chatSessionCount: numberValue(row.chat_session_count),
    completedRunCount: numberValue(row.completed_run_count),
    completedShopifySyncCount: numberValue(row.completed_shopify_sync_count),
    crmAiProposalCount: numberValue(row.crm_ai_proposal_count),
    disagreementCount: numberValue(row.disagreement_count),
    evaluationCount: numberValue(row.evaluation_count),
    gmailConnectionCount: numberValue(row.gmail_connection_count),
    googleDriveConnectionCount: numberValue(row.google_drive_connection_count),
    googleVerifiedDocumentCount,
    latestAgentRunAt: timestampValue(row.latest_agent_run_at),
    latestEvaluationAt: timestampValue(row.latest_evaluation_at),
    latestModelCallAt: timestampValue(row.latest_model_call_at),
    latestShopifySyncAt: timestampValue(row.latest_shopify_sync_at),
    latestShopifySyncStatus: typeof row.latest_shopify_sync_status === "string" ? row.latest_shopify_sync_status : null,
    lessonMemoryCount: numberValue(row.lesson_memory_count),
    lunaCallCount: numberValue(row.luna_call_count),
    modelCallCount: numberValue(row.model_call_count),
    needsReviewMemoryCount: numberValue(row.needs_review_memory_count),
    openReviewCandidateCount: numberValue(row.open_review_candidate_count),
    pendingFeedbackCount: numberValue(row.pending_feedback_count),
    proposalDocumentCount: numberValue(row.proposal_document_count),
    proposalGateCount: numberValue(row.proposal_gate_count),
    proposalReviewCount: numberValue(row.proposal_review_count),
    shopifyProductCount: numberValue(row.shopify_product_count),
    shopifySyncCount: numberValue(row.shopify_sync_count),
    solCallCount: numberValue(row.sol_call_count),
    successfulModelCallCount: numberValue(row.successful_model_call_count),
    terraCallCount: numberValue(row.terra_call_count),
  };
  return deriveSultanRuntimeStatus(aggregate);
}

             and (d.google_readback_proof->contract.role->>'tableCount')::int = 4
             and d.google_readback_proof->contract.role->>'sectionCount' ~ '^[0-9]+
  } catch {
    // Verification is evidence-based and fail-closed. Missing or drifting schema is never success.
    return 0;
  }
}

export async function readSultanRuntimeStatus() {
  const [result, googleVerifiedDocumentCount] = await Promise.all([
    databasePool().query<RuntimeAggregateRow>(
      "select * from public.luzione_sultan_runtime_status_v1()",
    ),
    readGoogleVerifiedDocumentCount(),
  ]);
  const row = result.rows[0] ?? {};
  const aggregate: SultanRuntimeAggregate = {
    agentRunCount: numberValue(row.agent_run_count),
    agreementCount: numberValue(row.agreement_count),
    airtableConnectionCount: numberValue(row.airtable_connection_count),
    chatMessageCount: numberValue(row.chat_message_count),
    chatSessionCount: numberValue(row.chat_session_count),
    completedRunCount: numberValue(row.completed_run_count),
    completedShopifySyncCount: numberValue(row.completed_shopify_sync_count),
    crmAiProposalCount: numberValue(row.crm_ai_proposal_count),
    disagreementCount: numberValue(row.disagreement_count),
    evaluationCount: numberValue(row.evaluation_count),
    gmailConnectionCount: numberValue(row.gmail_connection_count),
    googleDriveConnectionCount: numberValue(row.google_drive_connection_count),
    googleVerifiedDocumentCount,
    latestAgentRunAt: timestampValue(row.latest_agent_run_at),
    latestEvaluationAt: timestampValue(row.latest_evaluation_at),
    latestModelCallAt: timestampValue(row.latest_model_call_at),
    latestShopifySyncAt: timestampValue(row.latest_shopify_sync_at),
    latestShopifySyncStatus: typeof row.latest_shopify_sync_status === "string" ? row.latest_shopify_sync_status : null,
    lessonMemoryCount: numberValue(row.lesson_memory_count),
    lunaCallCount: numberValue(row.luna_call_count),
    modelCallCount: numberValue(row.model_call_count),
    needsReviewMemoryCount: numberValue(row.needs_review_memory_count),
    openReviewCandidateCount: numberValue(row.open_review_candidate_count),
    pendingFeedbackCount: numberValue(row.pending_feedback_count),
    proposalDocumentCount: numberValue(row.proposal_document_count),
    proposalGateCount: numberValue(row.proposal_gate_count),
    proposalReviewCount: numberValue(row.proposal_review_count),
    shopifyProductCount: numberValue(row.shopify_product_count),
    shopifySyncCount: numberValue(row.shopify_sync_count),
    solCallCount: numberValue(row.sol_call_count),
    successfulModelCallCount: numberValue(row.successful_model_call_count),
    terraCallCount: numberValue(row.terra_call_count),
  };
  return deriveSultanRuntimeStatus(aggregate);
}

             and (d.google_readback_proof->contract.role->>'sectionCount')::int = contract.section_count
             and d.google_readback_proof->contract.role->'requiredSections' = contract.required_sections
             and (
               select count(*)
               from jsonb_array_elements(d.google_artifacts) artifact
               where artifact->>'role' = contract.role
                 and artifact->>'documentId' = d.google_readback_proof->contract.role->>'documentId'
                 and artifact->'readbackProof' = d.google_readback_proof->contract.role
             ) = 1
           )
         )
    `, [
      JSON.stringify(GOOGLE_PROPOSAL_REQUIRED_SECTIONS.sales_proposal),
      JSON.stringify(GOOGLE_PROPOSAL_REQUIRED_SECTIONS.itemized_quote),
      JSON.stringify(GOOGLE_PROPOSAL_REQUIRED_SECTIONS.whole_home_proposal),
      GOOGLE_PROPOSAL_READBACK_CONTRACT_VERSION,
    ]);
    return numberValue(verified.rows[0]?.verified_document_count);
  } catch {
    // Verification is evidence-based and fail-closed. Missing or drifting schema is never success.
    return 0;
  }
}

export async function readSultanRuntimeStatus() {
  const [result, googleVerifiedDocumentCount] = await Promise.all([
    databasePool().query<RuntimeAggregateRow>(
      "select * from public.luzione_sultan_runtime_status_v1()",
    ),
    readGoogleVerifiedDocumentCount(),
  ]);
  const row = result.rows[0] ?? {};
  const aggregate: SultanRuntimeAggregate = {
    agentRunCount: numberValue(row.agent_run_count),
    agreementCount: numberValue(row.agreement_count),
    airtableConnectionCount: numberValue(row.airtable_connection_count),
    chatMessageCount: numberValue(row.chat_message_count),
    chatSessionCount: numberValue(row.chat_session_count),
    completedRunCount: numberValue(row.completed_run_count),
    completedShopifySyncCount: numberValue(row.completed_shopify_sync_count),
    crmAiProposalCount: numberValue(row.crm_ai_proposal_count),
    disagreementCount: numberValue(row.disagreement_count),
    evaluationCount: numberValue(row.evaluation_count),
    gmailConnectionCount: numberValue(row.gmail_connection_count),
    googleDriveConnectionCount: numberValue(row.google_drive_connection_count),
    googleVerifiedDocumentCount,
    latestAgentRunAt: timestampValue(row.latest_agent_run_at),
    latestEvaluationAt: timestampValue(row.latest_evaluation_at),
    latestModelCallAt: timestampValue(row.latest_model_call_at),
    latestShopifySyncAt: timestampValue(row.latest_shopify_sync_at),
    latestShopifySyncStatus: typeof row.latest_shopify_sync_status === "string" ? row.latest_shopify_sync_status : null,
    lessonMemoryCount: numberValue(row.lesson_memory_count),
    lunaCallCount: numberValue(row.luna_call_count),
    modelCallCount: numberValue(row.model_call_count),
    needsReviewMemoryCount: numberValue(row.needs_review_memory_count),
    openReviewCandidateCount: numberValue(row.open_review_candidate_count),
    pendingFeedbackCount: numberValue(row.pending_feedback_count),
    proposalDocumentCount: numberValue(row.proposal_document_count),
    proposalGateCount: numberValue(row.proposal_gate_count),
    proposalReviewCount: numberValue(row.proposal_review_count),
    shopifyProductCount: numberValue(row.shopify_product_count),
    shopifySyncCount: numberValue(row.shopify_sync_count),
    solCallCount: numberValue(row.sol_call_count),
    successfulModelCallCount: numberValue(row.successful_model_call_count),
    terraCallCount: numberValue(row.terra_call_count),
  };
  return deriveSultanRuntimeStatus(aggregate);
}
