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

export async function readSultanRuntimeStatus() {
  const result = await databasePool().query<RuntimeAggregateRow>(`
    with sultan_runs as (
      select count(*)::int as agent_run_count,
             count(*) filter (where status = 'completed')::int as completed_run_count,
             max(created_at) as latest_agent_run_at
        from public.agent_runs
       where lower(agent_code) like 'sultan%'
    ),
    sultan_evaluations as (
      select count(*)::int as evaluation_count,
             count(*) filter (where coalesce(e.human_agreement, 'pending') = 'pending')::int as pending_feedback_count,
             count(*) filter (where e.human_agreement = 'agree')::int as agreement_count,
             count(*) filter (where e.human_agreement = 'disagree')::int as disagreement_count,
             max(e.created_at) as latest_evaluation_at
        from public.agent_evaluations e
        join public.agent_runs r on r.run_id = e.agent_run_id
       where lower(r.agent_code) like 'sultan%'
    ),
    memory_state as (
      select count(*) filter (where memory_type = 'evaluation_lesson')::int as lesson_memory_count,
             count(*) filter (where memory_type = 'evaluation_lesson' and review_status = 'needs_review')::int as needs_review_memory_count
        from public.memories
    ),
    model_state as (
      select count(*)::int as model_call_count,
             count(*) filter (where success)::int as successful_model_call_count,
             count(*) filter (where model like '%-luna')::int as luna_call_count,
             count(*) filter (where model like '%-terra')::int as terra_call_count,
             count(*) filter (where model like '%-sol')::int as sol_call_count,
             max(created_at) as latest_model_call_at
        from public.ai_usage_telemetry
       where task_type = 'sultan_chat'
         and created_at >= now() - interval '30 days'
    ),
    connection_state as (
      select count(*) filter (where provider = 'google-drive' and status = 'connected')::int as google_drive_connection_count,
             count(*) filter (where provider = 'gmail' and status = 'connected')::int as gmail_connection_count,
             count(*) filter (where provider = 'airtable' and status = 'connected')::int as airtable_connection_count
        from public.connected_accounts
    ),
    shopify_state as (
      select count(*)::int as shopify_sync_count,
             count(*) filter (where status = 'completed')::int as completed_shopify_sync_count,
             (array_agg(status order by started_at desc nulls last))[1] as latest_shopify_sync_status,
             max(coalesce(completed_at, started_at)) as latest_shopify_sync_at
        from public.shopify_sync_runs
    )
    select sr.*,
           se.*,
           ms.*,
           (select count(*)::int from public.memory_review_candidates where status = 'open') as open_review_candidate_count,
           (select count(*)::int from public.sultan_chat_sessions) as chat_session_count,
           (select count(*)::int from public.sultan_chat_messages) as chat_message_count,
           models.*,
           connections.*,
           (select count(*)::int from public.shopify_products_read_model) as shopify_product_count,
           shopify.*,
           (select count(*)::int from public.commercial_case_proposal_document_versions) as proposal_document_count,
           (select count(*)::int from public.commercial_case_proposal_review_versions) as proposal_review_count,
           (select count(*)::int from public.proposal_gate_reviews) as proposal_gate_count,
           (select count(*)::int from public.crm_ai_proposals) as crm_ai_proposal_count
      from sultan_runs sr
      cross join sultan_evaluations se
      cross join memory_state ms
      cross join model_state models
      cross join connection_state connections
      cross join shopify_state shopify
  `);
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
