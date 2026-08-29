import "server-only";

import { databasePool } from "@/lib/db";
import {
  deriveSultanRuntimeStatus,
  type SultanRuntimeAggregate,
} from "@/modules/sultan-runtime/runtimeStatus";

type RuntimeAggregateRow = Record<string, Date | number | string | null>;

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
               'snapshot_checksum',
               'google_readback_at'
             )
        ) = 9
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
               'external_ids'
             )
        ) = 5 as schema_ready
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
         and jsonb_array_length(d.google_artifacts) >= 3
         and jsonb_typeof(e.external_ids) = 'array'
         and jsonb_array_length(e.external_ids) >= 3
    `);
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
