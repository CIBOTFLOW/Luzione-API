import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
  type CanonicalClaim,
  type CanonicalReadbackStatus,
  type Stage5Pins,
} from "./contracts";
import {
  buildRecordContextDraft,
  parseRecordContextDraftRequest,
  RECORD_CONTEXT_DRAFT_VERSION,
  RecordContextDraftError,
  type RecordContextDraft,
  type RecordContextSource,
} from "./recordContextDraft";
import { isExactStage5ConsumerWorkload } from "./workload";

export const RECORD_CONTEXT_RECEIPT_PREPARATION_VERSION =
  "luzione-sultan-record-context-receipt-preparation/v1-draft.1" as const;

export type RecordContextReceiptMaterial = {
  apiDeploymentSha: string;
  claims: readonly CanonicalClaim[];
  consumer: Readonly<{ actorId: string; deploymentSha: string }>;
  freshUntil: string | null;
  idempotencyKey: string;
  observedAt: string;
  provenance: Readonly<{
    authority: "CANONICAL_POSTGRES" | "NONE";
    sourceRefs: readonly string[];
    sourceVersion: string | null;
  }>;
  status: CanonicalReadbackStatus;
  subjectId: string;
  subjectType: "LEAD" | "COMMERCIAL_CASE";
  tenantId: string;
};

export type RecordContextReceiptPreparation = {
  admissionEligible: false;
  businessStateMutated: false;
  contractVersion: typeof RECORD_CONTEXT_RECEIPT_PREPARATION_VERSION;
  contextContractVersion: typeof RECORD_CONTEXT_DRAFT_VERSION;
  contextDraft: RecordContextDraft;
  contextDraftHash: string;
  grantsAuthority: false;
  idempotencyKey: string;
  idempotencySemantics: "PERSISTED_STORE_MUST_REPLAY_OR_CONFLICT";
  persistence: "UNPERSISTED_PREPARATION";
  preparationHash: string;
  preparationId: string;
  receiptCompatibility: Readonly<{
    blockers: readonly (
      | "CURRENT_STAGE5_V1_SUBJECT_TYPE_UNSUPPORTED"
      | "DRAFT_STATUS_NOT_CANONICAL_RECEIPT_COMPATIBLE"
      | "DURABLE_PERSISTENCE_NOT_IMPLEMENTED"
      | "HTTP_ROUTE_NOT_MOUNTED"
    )[];
    currentContractVersion: typeof SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION;
    currentPersistenceCompatible: false;
    materialState: "BLOCKED_BY_DRAFT_STATUS" | "RECEIPT_MATERIAL_PREPARED";
    requiredEvolution: "NEW_VERSION_AND_ADDITIVE_STORAGE_MIGRATION";
  }>;
  receiptMaterial: RecordContextReceiptMaterial | null;
  receiptMaterialHash: string | null;
  requestHash: string;
};

export class RecordContextReceiptPreparationError extends Error {
  constructor(readonly code: "CONTEXT_DRAFT_INTEGRITY_FAILED" | "INVALID_IDEMPOTENCY_KEY") {
    super(`Record context receipt preparation rejected: ${code}.`);
    this.name = "RecordContextReceiptPreparationError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;

/**
 * Unmounted G0 integration boundary. This prepares exact material for a future,
 * separately versioned durable receipt without changing or impersonating Stage 5 v1.
 */
export async function prepareRecordContextReceipt(input: {
  actor: ApiActor;
  idempotencyKey: string;
  now: string;
  pins: Pick<Stage5Pins, "apiDeploymentSha" | "uiDeploymentSha" | "sultanDeploymentSha" | "maximumEvidenceAgeMs">;
  request: unknown;
  source: RecordContextSource;
}): Promise<RecordContextReceiptPreparation> {
  if (!isExactStage5ConsumerWorkload(input.actor, "sultan.canonical.readback.read")) {
    throw new RecordContextDraftError("WORKLOAD_IDENTITY_DENIED");
  }
  assertIdempotencyKey(input.idempotencyKey);
  const parsedRequest = parseRecordContextDraftRequest(input.request);
  const contextDraft = await buildRecordContextDraft(input);
  return buildRecordContextReceiptPreparation({
    actor: input.actor,
    contextDraft,
    idempotencyKey: input.idempotencyKey,
    parsedRequest,
    pins: input.pins,
  });
}

export function buildRecordContextReceiptPreparation(input: {
  actor: ApiActor;
  contextDraft: RecordContextDraft;
  idempotencyKey: string;
  parsedRequest: ReturnType<typeof parseRecordContextDraftRequest>;
  pins: Pick<Stage5Pins, "apiDeploymentSha">;
}): RecordContextReceiptPreparation {
  assertIdempotencyKey(input.idempotencyKey);
  assertDraftIntegrity(input);
  const receiptStatus = canonicalReceiptStatus(input.contextDraft.status);
  const receiptMaterial = receiptStatus === null
    ? null
    : buildReceiptMaterial(input.contextDraft, input.idempotencyKey, receiptStatus);
  const receiptMaterialHash = receiptMaterial === null ? null : sha256(receiptMaterial);
  const requestHash = sha256({
    actorId: input.actor.actorId,
    apiDeploymentSha: input.pins.apiDeploymentSha,
    context: input.parsedRequest,
    contractVersion: RECORD_CONTEXT_RECEIPT_PREPARATION_VERSION,
    idempotencyKey: input.idempotencyKey,
    tenantId: input.actor.tenantId,
  });
  const blockers: RecordContextReceiptPreparation["receiptCompatibility"]["blockers"] = Object.freeze([
    "CURRENT_STAGE5_V1_SUBJECT_TYPE_UNSUPPORTED",
    ...(receiptStatus === null ? ["DRAFT_STATUS_NOT_CANONICAL_RECEIPT_COMPATIBLE" as const] : []),
    "DURABLE_PERSISTENCE_NOT_IMPLEMENTED",
    "HTTP_ROUTE_NOT_MOUNTED",
  ]);
  const withoutHash: Omit<RecordContextReceiptPreparation, "preparationHash"> = {
    admissionEligible: false,
    businessStateMutated: false,
    contractVersion: RECORD_CONTEXT_RECEIPT_PREPARATION_VERSION,
    contextContractVersion: RECORD_CONTEXT_DRAFT_VERSION,
    contextDraft: input.contextDraft,
    contextDraftHash: input.contextDraft.draftHash,
    grantsAuthority: false,
    idempotencyKey: input.idempotencyKey,
    idempotencySemantics: "PERSISTED_STORE_MUST_REPLAY_OR_CONFLICT",
    persistence: "UNPERSISTED_PREPARATION",
    preparationId: `s5ctxprep_${sha256([input.actor.tenantId, input.idempotencyKey]).slice(0, 32)}`,
    receiptCompatibility: Object.freeze({
      blockers,
      currentContractVersion: SULTAN_STAGE5_CANONICAL_READBACK_CONTRACT_VERSION,
      currentPersistenceCompatible: false,
      materialState: receiptStatus === null ? "BLOCKED_BY_DRAFT_STATUS" : "RECEIPT_MATERIAL_PREPARED",
      requiredEvolution: "NEW_VERSION_AND_ADDITIVE_STORAGE_MIGRATION",
    }),
    receiptMaterial,
    receiptMaterialHash,
    requestHash,
  };
  return Object.freeze({ ...withoutHash, preparationHash: sha256(withoutHash) });
}

export function verifyRecordContextReceiptPreparation(preparation: RecordContextReceiptPreparation) {
  const { preparationHash, ...hashMaterial } = preparation;
  const materialHash = preparation.receiptMaterial === null ? null : sha256(preparation.receiptMaterial);
  return sha256(hashMaterial) === preparationHash
    && preparation.contextDraftHash === preparation.contextDraft.draftHash
    && materialHash === preparation.receiptMaterialHash
    && preparation.persistence === "UNPERSISTED_PREPARATION"
    && preparation.admissionEligible === false
    && preparation.grantsAuthority === false
    && preparation.businessStateMutated === false
    && preparation.idempotencySemantics === "PERSISTED_STORE_MUST_REPLAY_OR_CONFLICT"
    && !("readbackReceiptId" in preparation);
}

function assertIdempotencyKey(value: string) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new RecordContextReceiptPreparationError("INVALID_IDEMPOTENCY_KEY");
  }
}

function assertDraftIntegrity(input: Parameters<typeof buildRecordContextReceiptPreparation>[0]) {
  const { draftHash, ...draftMaterial } = input.contextDraft;
  const expectedSourceShape = input.contextDraft.status === "AVAILABLE"
    ? input.contextDraft.provenance.sourceContractVersion !== null
      && input.contextDraft.provenance.sourceVersion !== null
      && input.contextDraft.provenance.sourceRefs.length > 0
      && input.contextDraft.provenance.currentWriteOwner === "CIBOTFLOW/Luzione-UI"
      && input.contextDraft.freshUntil !== null
    : input.contextDraft.claims.length === 0
      && input.contextDraft.freshUntil === null
      && input.contextDraft.provenance.currentWriteOwner === null
      && input.contextDraft.provenance.sourceContractVersion === null
      && input.contextDraft.provenance.sourceRefs.length === 0
      && input.contextDraft.provenance.sourceVersion === null;
  if (sha256(draftMaterial) !== draftHash
    || input.contextDraft.contractVersion !== RECORD_CONTEXT_DRAFT_VERSION
    || "contextContractVersion" in input.contextDraft
    || input.contextDraft.subjectType !== input.parsedRequest.subjectType
    || input.contextDraft.subjectId !== input.parsedRequest.subjectId
    || input.contextDraft.consumer.deploymentSha !== input.parsedRequest.consumerDeploymentSha
    || input.contextDraft.consumer.actorId !== input.actor.actorId
    || input.contextDraft.tenantId !== input.actor.tenantId
    || input.contextDraft.apiDeploymentSha !== input.pins.apiDeploymentSha
    || !isExactStage5ConsumerWorkload(input.actor, "sultan.canonical.readback.read")
    || !expectedSourceShape
    || input.contextDraft.persistence !== "UNPERSISTED_DRAFT"
    || input.contextDraft.admissionEligible !== false
    || input.contextDraft.grantsAuthority !== false
    || input.contextDraft.businessStateMutated !== false
    || "readbackReceiptId" in input.contextDraft) {
    throw new RecordContextReceiptPreparationError("CONTEXT_DRAFT_INTEGRITY_FAILED");
  }
}

function canonicalReceiptStatus(status: RecordContextDraft["status"]): CanonicalReadbackStatus | null {
  switch (status) {
    case "AVAILABLE":
    case "NOT_FOUND":
    case "SCHEMA_MISMATCH":
    case "SOURCE_UNAVAILABLE":
      return status;
    default:
      return null;
  }
}

function buildReceiptMaterial(
  draft: RecordContextDraft,
  idempotencyKey: string,
  status: CanonicalReadbackStatus,
): RecordContextReceiptMaterial {
  if (draft.subjectType !== "LEAD" && draft.subjectType !== "COMMERCIAL_CASE") {
    throw new RecordContextReceiptPreparationError("CONTEXT_DRAFT_INTEGRITY_FAILED");
  }
  return Object.freeze({
    apiDeploymentSha: draft.apiDeploymentSha,
    claims: draft.claims,
    consumer: Object.freeze({ ...draft.consumer }),
    freshUntil: draft.freshUntil,
    idempotencyKey,
    observedAt: draft.observedAt,
    provenance: Object.freeze({
      authority: status === "AVAILABLE" ? "CANONICAL_POSTGRES" : "NONE",
      sourceRefs: draft.provenance.sourceRefs,
      sourceVersion: draft.provenance.sourceVersion,
    }),
    status,
    subjectId: draft.subjectId,
    subjectType: draft.subjectType,
    tenantId: draft.tenantId,
  });
}
