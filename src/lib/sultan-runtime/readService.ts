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
  const result = await databasePool().query<RuntimeAggregateRow>(
    "select * from public.luzione_sultan_runtime_status_v1()",
  );
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
