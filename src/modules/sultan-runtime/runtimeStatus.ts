export type SultanRuntimeAggregate = {
  agentRunCount: number;
  agreementCount: number;
  airtableConnectionCount: number;
  chatMessageCount: number;
  chatSessionCount: number;
  completedRunCount: number;
  completedShopifySyncCount: number;
  crmAiProposalCount: number;
  disagreementCount: number;
  evaluationCount: number;
  gmailConnectionCount: number;
  googleDriveConnectionCount: number;
  googleVerifiedDocumentCount: number;
  latestAgentRunAt: string | null;
  latestEvaluationAt: string | null;
  latestModelCallAt: string | null;
  latestShopifySyncAt: string | null;
  latestShopifySyncStatus: string | null;
  lessonMemoryCount: number;
  lunaCallCount: number;
  modelCallCount: number;
  needsReviewMemoryCount: number;
  openReviewCandidateCount: number;
  pendingFeedbackCount: number;
  proposalDocumentCount: number;
  proposalGateCount: number;
  proposalReviewCount: number;
  shopifyProductCount: number;
  shopifySyncCount: number;
  solCallCount: number;
  successfulModelCallCount: number;
  terraCallCount: number;
};

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function hoursSince(timestamp: string | null, observedAt: string) {
  if (!timestamp) return null;
  const elapsed = Date.parse(observedAt) - Date.parse(timestamp);
  return Number.isFinite(elapsed) ? elapsed / 3_600_000 : null;
}

export function deriveSultanRuntimeStatus(
  aggregate: SultanRuntimeAggregate,
  observedAt = new Date().toISOString(),
) {
  const evaluationCoverage = ratio(aggregate.evaluationCount, aggregate.completedRunCount);
  const cognitionStatus = aggregate.completedRunCount === 0
    ? "NOT_AVAILABLE"
    : evaluationCoverage !== null && evaluationCoverage < 1
      ? "DEGRADED_PARTIAL_LEDGER"
      : "ACTIVE";

  const feedbackCount = aggregate.agreementCount + aggregate.disagreementCount;
  const learningStatus = aggregate.evaluationCount === 0
    ? "NOT_AVAILABLE"
    : aggregate.openReviewCandidateCount > 0 || aggregate.needsReviewMemoryCount > 0
      ? "REVIEW_REQUIRED"
      : feedbackCount === 0
        ? "AWAITING_FEEDBACK"
        : aggregate.pendingFeedbackCount > 0
          ? "ACTIVE_WITH_PENDING_FEEDBACK"
          : "ACTIVE";

  const modelSuccessRate = ratio(aggregate.successfulModelCallCount, aggregate.modelCallCount);
  const economyShare = ratio(aggregate.lunaCallCount, aggregate.modelCallCount);
  const modelRoutingStatus = aggregate.modelCallCount === 0
    ? "NOT_AVAILABLE"
    : modelSuccessRate !== null && modelSuccessRate < 0.9
      ? "DEGRADED_FAILURE_RATE"
      : aggregate.lunaCallCount === 0
        ? "DEGRADED_NO_LUNA_EVIDENCE"
        : economyShare !== null && economyShare < 0.5
          ? "ACTIVE_REBALANCING"
          : "ACTIVE";

  const shopifySyncAgeHours = hoursSince(aggregate.latestShopifySyncAt, observedAt);
  const shopifyStatus = aggregate.shopifyProductCount === 0
    ? "NOT_AVAILABLE"
    : aggregate.completedShopifySyncCount === 0
      ? "DEGRADED_NO_COMPLETED_SYNC"
      : aggregate.latestShopifySyncStatus !== "completed"
        || shopifySyncAgeHours === null
        || shopifySyncAgeHours > 48
        ? "DEGRADED_STALE_SYNC"
        : "ACTIVE";

  const proposalEvidenceCount = aggregate.proposalDocumentCount
    + aggregate.proposalReviewCount
    + aggregate.proposalGateCount
    + aggregate.crmAiProposalCount;
  const proposalStatus = proposalEvidenceCount > 0 ? "ACTIVE" : "FOUNDATION_ONLY";
  const chatStatus = aggregate.chatSessionCount > 0 && aggregate.chatMessageCount > 0
    ? "ACTIVE"
    : "NOT_AVAILABLE";

  const degraded = [cognitionStatus, modelRoutingStatus, shopifyStatus]
    .some((status) => status.startsWith("DEGRADED"));
  const overallStatus = aggregate.agentRunCount === 0 && aggregate.chatSessionCount === 0
    ? "NOT_AVAILABLE"
    : degraded || proposalStatus === "FOUNDATION_ONLY"
      ? "DEGRADED"
      : "ACTIVE";

  return {
    overallStatus,
    observedAt,
    cognition: {
      status: cognitionStatus,
      runCount: aggregate.agentRunCount,
      completedRunCount: aggregate.completedRunCount,
      evaluationCount: aggregate.evaluationCount,
      evaluationCoverage,
      latestRunAt: aggregate.latestAgentRunAt,
      latestEvaluationAt: aggregate.latestEvaluationAt,
    },
    learning: {
      status: learningStatus,
      pendingFeedbackCount: aggregate.pendingFeedbackCount,
      agreementCount: aggregate.agreementCount,
      disagreementCount: aggregate.disagreementCount,
      lessonMemoryCount: aggregate.lessonMemoryCount,
      needsReviewMemoryCount: aggregate.needsReviewMemoryCount,
      openReviewCandidateCount: aggregate.openReviewCandidateCount,
    },
    chat: {
      status: chatStatus,
      sessionCount: aggregate.chatSessionCount,
      messageCount: aggregate.chatMessageCount,
    },
    modelRouting: {
      status: modelRoutingStatus,
      windowDays: 30,
      callCount: aggregate.modelCallCount,
      successfulCallCount: aggregate.successfulModelCallCount,
      successRate: modelSuccessRate,
      economyShare,
      tiers: {
        luna: aggregate.lunaCallCount,
        terra: aggregate.terraCallCount,
        sol: aggregate.solCallCount,
      },
      latestCallAt: aggregate.latestModelCallAt,
    },
    connectors: {
      googleDocs: {
        status: aggregate.googleDriveConnectionCount > 0 ? "CONNECTED" : "NOT_AVAILABLE",
        connectedAccountCount: aggregate.googleDriveConnectionCount,
        generationVerified:
          aggregate.googleDriveConnectionCount > 0
          && aggregate.googleVerifiedDocumentCount > 0,
      },
      email: {
        status: aggregate.gmailConnectionCount > 0 ? "CONNECTED" : "NOT_AVAILABLE",
        connectedAccountCount: aggregate.gmailConnectionCount,
        sendAuthority: "APPROVAL_REQUIRED",
      },
      airtable: {
        status: aggregate.airtableConnectionCount > 0 ? "CONNECTED" : "NOT_AVAILABLE",
        connectedAccountCount: aggregate.airtableConnectionCount,
        role: "TRANSITIONAL_WORKSPACE_ONLY",
      },
      shopify: {
        status: shopifyStatus,
        productCount: aggregate.shopifyProductCount,
        syncCount: aggregate.shopifySyncCount,
        completedSyncCount: aggregate.completedShopifySyncCount,
        latestSyncStatus: aggregate.latestShopifySyncStatus,
        latestSyncAt: aggregate.latestShopifySyncAt,
        syncAgeHours: shopifySyncAgeHours === null ? null : Number(shopifySyncAgeHours.toFixed(2)),
      },
    },
    proposals: {
      status: proposalStatus,
      documentVersionCount: aggregate.proposalDocumentCount,
      reviewVersionCount: aggregate.proposalReviewCount,
      gateReviewCount: aggregate.proposalGateCount,
      crmAiProposalCount: aggregate.crmAiProposalCount,
      sendAuthority: "APPROVAL_REQUIRED",
    },
    boundaries: {
      aggregateOnly: true,
      rawConversationContentExposed: false,
      recordIdentifiersExposed: false,
      mutationAuthority: "DISABLED_FAIL_CLOSED",
      externalEffectsAuthorized: false,
    },
  } as const;
}
