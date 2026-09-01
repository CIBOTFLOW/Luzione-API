export const ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION =
  "luzione-room-plan-proposal-attachment/v0.1";

export type RoomPlanProposalAttachment = {
  artifactDigest: string;
  attachmentId: string;
  authority: {
    bindingAcceptanceAuthorized: false;
    customerSendAuthorized: false;
    pricingAuthoritative: false;
  };
  commercialCaseId: string;
  contractVersion: typeof ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION;
  generatedDocument: {
    assetId: string;
    documentId: string;
    documentType: "CLIENT_PRESENTATION" | "PROJECT_SUMMARY";
    version: number;
  };
  integrationState: "DRAFT" | "REVIEWED" | "SUPERSEDED";
  plannerProject: {
    projectId: string;
    projectVersion: number;
    sourceSystem: "LUZIONE_ROOM_PLANNER";
  };
  proposalContextVersionId: string;
  review: {
    decisionId: string;
    reviewedAt: string;
    reviewerActorRef: string;
  } | null;
  rooms: readonly {
    conceptId: string | null;
    roomId: string;
    roomVersion: number;
    selectedProducts: readonly {
      configurationSnapshotId: string | null;
      quantity: number;
      roomProductId: string;
    }[];
  }[];
  tenantId: string;
};

export type RoomPlanAttachmentDecision = {
  attachable: boolean;
  authorityGranted: false;
  bindingAcceptanceAuthorized: false;
  contractVersion: typeof ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION;
  customerSendAuthorized: false;
  pricingAuthoritative: false;
  reasonCodes: readonly string[];
};

const SHA256 = /^[a-f0-9]{64}$/;

function hasText(value: string) {
  return value.trim().length > 0 && value.length <= 500;
}

export function evaluateRoomPlanProposalAttachment(input: {
  attachment: RoomPlanProposalAttachment;
  expectedCommercialCaseId: string;
  expectedProposalContextVersionId: string;
  expectedTenantId: string;
}): RoomPlanAttachmentDecision {
  const { attachment } = input;
  const reasons: string[] = [];
  if (attachment.contractVersion !== ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION) {
    reasons.push("CONTRACT_VERSION_MISMATCH");
  }
  if (attachment.tenantId !== input.expectedTenantId) reasons.push("TENANT_MISMATCH");
  if (!hasText(attachment.attachmentId)
    || !hasText(attachment.tenantId)
    || !hasText(attachment.commercialCaseId)
    || !hasText(attachment.proposalContextVersionId)) {
    reasons.push("ATTACHMENT_IDENTITY_INVALID");
  }
  if (attachment.commercialCaseId !== input.expectedCommercialCaseId) {
    reasons.push("COMMERCIAL_CASE_MISMATCH");
  }
  if (attachment.proposalContextVersionId !== input.expectedProposalContextVersionId) {
    reasons.push("PROPOSAL_CONTEXT_VERSION_MISMATCH");
  }
  if (attachment.plannerProject.sourceSystem !== "LUZIONE_ROOM_PLANNER") {
    reasons.push("SOURCE_SYSTEM_MISMATCH");
  }
  if (!hasText(attachment.plannerProject.projectId) || attachment.plannerProject.projectVersion < 1) {
    reasons.push("PLANNER_PROJECT_VERSION_INVALID");
  }
  if (!SHA256.test(attachment.artifactDigest)) reasons.push("ARTIFACT_DIGEST_INVALID");
  if (attachment.integrationState !== "REVIEWED" || !attachment.review) {
    reasons.push("HUMAN_REVIEW_REQUIRED");
  } else if (!hasText(attachment.review.decisionId)
    || !hasText(attachment.review.reviewerActorRef)
    || !Number.isFinite(Date.parse(attachment.review.reviewedAt))) {
    reasons.push("REVIEW_EVIDENCE_INVALID");
  }
  if (attachment.generatedDocument.version < 1
    || !hasText(attachment.generatedDocument.documentId)
    || !hasText(attachment.generatedDocument.assetId)) {
    reasons.push("GENERATED_DOCUMENT_VERSION_INVALID");
  }
  if (attachment.rooms.length === 0) reasons.push("ROOMS_REQUIRED");
  const roomIds = new Set<string>();
  for (const room of attachment.rooms) {
    if (!hasText(room.roomId) || room.roomVersion < 1) reasons.push("ROOM_VERSION_INVALID");
    if (room.conceptId !== null && !hasText(room.conceptId)) reasons.push("CONCEPT_ID_INVALID");
    if (roomIds.has(room.roomId)) reasons.push("DUPLICATE_ROOM");
    roomIds.add(room.roomId);
    const productIds = new Set<string>();
    for (const product of room.selectedProducts) {
      if (!hasText(product.roomProductId) || !Number.isSafeInteger(product.quantity) || product.quantity < 1) {
        reasons.push("ROOM_PRODUCT_INVALID");
      }
      if (product.configurationSnapshotId !== null
        && !hasText(product.configurationSnapshotId)) {
        reasons.push("CONFIGURATION_SNAPSHOT_ID_INVALID");
      }
      if (productIds.has(product.roomProductId)) reasons.push("DUPLICATE_ROOM_PRODUCT");
      productIds.add(product.roomProductId);
    }
  }
  if (attachment.authority.customerSendAuthorized
    || attachment.authority.bindingAcceptanceAuthorized
    || attachment.authority.pricingAuthoritative) {
    reasons.push("AUTHORITY_SMUGGLING_DENIED");
  }

  return {
    attachable: reasons.length === 0,
    authorityGranted: false,
    bindingAcceptanceAuthorized: false,
    contractVersion: ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION,
    customerSendAuthorized: false,
    pricingAuthoritative: false,
    reasonCodes: Object.freeze([...new Set(reasons)]),
  };
}

export const roomPlannerProposalBridge = Object.freeze({
  contractVersion: ROOM_PLAN_PROPOSAL_ATTACHMENT_CONTRACT_VERSION,
  eventType: "room_plan.proposal_attachment.ready",
  eventVersion: 1,
  integrationPattern: "PLANNER_OUTBOX_TO_API_VERSIONED_ATTACHMENT",
  proposalPlacement: "Commercial Case proposal evidence before final proposal review",
  requiredEvidence: Object.freeze([
    "exact planner project version",
    "exact room and selected-product versions",
    "versioned generated document and asset references",
    "artifact SHA-256 digest",
    "credential-bound human review",
  ]),
  sourceRepository: "CIBOTFLOW/Luzione-Room-Planner-MVP",
  targetRepository: "CIBOTFLOW/Luzione-API",
});
