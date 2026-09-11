import type { ApiActor } from "@/lib/api/actor";
import type { LeadCommercialCaseStore } from "@/modules/lead-commercial-case/store";
import { LEAD_COMMERCIAL_CASE_CONTRACT_VERSION } from "@/modules/lead-commercial-case/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { CanonicalClaim, Stage5Pins } from "./contracts";
import { isExactStage5ConsumerWorkload } from "./workload";

export const RECORD_CONTEXT_DRAFT_VERSION = "luzione-sultan-record-context/v1-draft.1" as const;
export const recordContextSubjects = ["LEAD", "COMMERCIAL_CASE", "TASK", "PRODUCT", "SUPPLIER", "ACCOUNT"] as const;
export type RecordContextSubject = (typeof recordContextSubjects)[number];
export type RecordContextSource = Pick<LeadCommercialCaseStore, "readLead" | "readCommercialCase">;
type Pins = Pick<Stage5Pins, "apiDeploymentSha" | "uiDeploymentSha" | "sultanDeploymentSha" | "maximumEvidenceAgeMs">;
type Status = "AVAILABLE" | "NOT_FOUND" | "UNSUPPORTED_SOURCE" | "SOURCE_UNAVAILABLE" | "SCHEMA_MISMATCH" | "SOURCE_INVALID" | "VERSION_MISMATCH";
type Request = {
  contractVersion: typeof RECORD_CONTEXT_DRAFT_VERSION;
  consumerDeploymentSha: string;
  expectedSourceVersion: string | null;
  requestedAt: string;
  subjectId: string;
  subjectType: RecordContextSubject;
};

export type RecordContextDraft = {
  contractVersion: typeof RECORD_CONTEXT_DRAFT_VERSION;
  status: Status;
  subjectType: RecordContextSubject;
  subjectId: string;
  tenantId: string;
  consumer: { actorId: string; deploymentSha: string };
  apiDeploymentSha: string;
  observedAt: string;
  freshUntil: string | null;
  claims: readonly CanonicalClaim[];
  provenance: {
    sourceOwner: "CIBOTFLOW/Luzione-API";
    currentWriteOwner: "CIBOTFLOW/Luzione-UI" | null;
    sourceContractVersion: typeof LEAD_COMMERCIAL_CASE_CONTRACT_VERSION | null;
    sourceRefs: readonly string[];
    sourceVersion: string | null;
  };
  persistence: "UNPERSISTED_DRAFT";
  admissionEligible: false;
  grantsAuthority: false;
  businessStateMutated: false;
  draftHash: string;
};

export class RecordContextDraftError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "WORKLOAD_IDENTITY_DENIED" | "RELEASE_PIN_MISMATCH" | "REQUEST_STALE" | "INVALID_CONFIGURATION") {
    super(`Record context draft rejected: ${code}.`);
    this.name = "RecordContextDraftError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;
const SHA = /^[a-f0-9]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object.");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) throw new Error("Unexpected request fields.");
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp.");
  // Reject calendar overflow instead of accepting Date.parse normalization.
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) throw new Error("Invalid calendar timestamp.");
  return normalized;
}

export function parseRecordContextDraftRequest(value: unknown): Request {
  try {
    const envelope = object(value);
    exactKeys(envelope, ["context"]);
    const input = object(envelope.context);
    exactKeys(input, ["contractVersion", "consumerDeploymentSha", "expectedSourceVersion", "requestedAt", "subjectId", "subjectType"]);
    if (input.contractVersion !== RECORD_CONTEXT_DRAFT_VERSION
      || typeof input.consumerDeploymentSha !== "string" || !SHA.test(input.consumerDeploymentSha)
      || typeof input.subjectId !== "string" || !ID.test(input.subjectId)
      || !recordContextSubjects.includes(input.subjectType as RecordContextSubject)
      || (input.expectedSourceVersion !== null && (typeof input.expectedSourceVersion !== "string" || input.expectedSourceVersion.length === 0 || input.expectedSourceVersion.length > 1_024))) throw new Error("Invalid request.");
    return Object.freeze({
      contractVersion: RECORD_CONTEXT_DRAFT_VERSION,
      consumerDeploymentSha: input.consumerDeploymentSha,
      expectedSourceVersion: input.expectedSourceVersion as string | null,
      requestedAt: timestamp(input.requestedAt),
      subjectId: input.subjectId,
      subjectType: input.subjectType as RecordContextSubject,
    });
  } catch {
    throw new RecordContextDraftError("INVALID_REQUEST");
  }
}

/** Unmounted G0 producer. Source must be the existing canonical domain store, never model or caller data. */
export async function buildRecordContextDraft(input: {
  actor: ApiActor;
  pins: Pins;
  now: string;
  request: unknown;
  source: RecordContextSource;
}): Promise<RecordContextDraft> {
  if (!isExactStage5ConsumerWorkload(input.actor, "sultan.canonical.readback.read")) {
    throw new RecordContextDraftError("WORKLOAD_IDENTITY_DENIED");
  }
  const request = parseRecordContextDraftRequest(input.request);
  const consumerPin = input.actor.actorId === "service:luzione-ui" ? input.pins.uiDeploymentSha : input.pins.sultanDeploymentSha;
  let now: string;
  try { now = timestamp(input.now); } catch { throw new RecordContextDraftError("INVALID_CONFIGURATION"); }
  if (!SHA.test(input.pins.apiDeploymentSha) || !consumerPin || !SHA.test(consumerPin)
    || !Number.isSafeInteger(input.pins.maximumEvidenceAgeMs) || input.pins.maximumEvidenceAgeMs <= 0
    || input.pins.maximumEvidenceAgeMs > 86_400_000) throw new RecordContextDraftError("INVALID_CONFIGURATION");
  if (request.consumerDeploymentSha !== consumerPin) throw new RecordContextDraftError("RELEASE_PIN_MISMATCH");
  const requestTime = Date.parse(request.requestedAt);
  if (requestTime > Date.parse(now) + 30_000 || Date.parse(now) - requestTime > input.pins.maximumEvidenceAgeMs) {
    throw new RecordContextDraftError("REQUEST_STALE");
  }
  const base = {
    contractVersion: RECORD_CONTEXT_DRAFT_VERSION,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    tenantId: input.actor.tenantId,
    consumer: Object.freeze({ actorId: input.actor.actorId, deploymentSha: consumerPin }),
    apiDeploymentSha: input.pins.apiDeploymentSha,
    observedAt: now,
    persistence: "UNPERSISTED_DRAFT" as const,
    admissionEligible: false as const,
    grantsAuthority: false as const,
    businessStateMutated: false as const,
  };
  function finish(status: Status, sourceVersion: string | null = null, sourceRef: string | null = null, claims: CanonicalClaim[] = []): RecordContextDraft {
    const result = {
      ...base, status,
      freshUntil: status === "AVAILABLE" ? new Date(Date.parse(now) + input.pins.maximumEvidenceAgeMs).toISOString() : null,
      claims: Object.freeze(claims.sort((a, b) => a.claimId.localeCompare(b.claimId)).map((claim) => Object.freeze(claim))),
      provenance: Object.freeze({
        sourceOwner: "CIBOTFLOW/Luzione-API" as const,
        currentWriteOwner: status === "AVAILABLE" ? "CIBOTFLOW/Luzione-UI" as const : null,
        sourceContractVersion: status === "AVAILABLE" ? LEAD_COMMERCIAL_CASE_CONTRACT_VERSION : null,
        sourceRefs: Object.freeze(sourceRef ? [sourceRef] : []), sourceVersion,
      }),
    };
    return Object.freeze({ ...result, draftHash: sha256(result) });
  }
  if (request.subjectType !== "LEAD" && request.subjectType !== "COMMERCIAL_CASE") return finish("UNSUPPORTED_SOURCE");
  let result: unknown;
  try {
    result = request.subjectType === "LEAD"
      ? await input.source.readLead(input.actor, request.subjectId)
      : await input.source.readCommercialCase(input.actor, request.subjectId);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    return finish(code === "42703" ? "SCHEMA_MISMATCH" : "SOURCE_UNAVAILABLE");
  }
  if (result === null) return finish("NOT_FOUND");
  try {
    const owner = object(result);
    const lead = request.subjectType === "LEAD";
    const table = lead ? "crm_leads" : "commercial_cases";
    const row = object(owner[lead ? "lead" : "commercialCase"]);
    if (owner.contractVersion !== LEAD_COMMERCIAL_CASE_CONTRACT_VERSION || owner.sourceOfTruth !== table
      || owner.transferState !== "UI_LEGACY_WRITER_API_DARK_PATH"
      || row[lead ? "leadId" : "caseId"] !== request.subjectId
      || !Number.isSafeInteger(row.version) || Number(row.version) < 1
      || typeof owner.objectVersion !== "string" || owner.objectVersion.length > 1_024
      || !(lead ? owner.objectVersion.startsWith(`crm-lead:${request.subjectId}@`) : owner.objectVersion === `commercial-case:${request.subjectId}:v${row.version}`)) {
      throw new Error("Canonical source mismatch.");
    }
    const prefix = lead ? "lead" : "commercialCase";
    const fields = lead
      ? ["accountId", "contactId", "assignedOwnerId", "leadSource", "recommendedNextAction", "stage", "status", "vertical"]
      : ["accountId", "primaryContactId", "sourceLeadId", "title", "stage", "status", "owner", "nextAction", "relationshipIntegrityState"];
    const claims = fields.map((field) => stringClaim(`${prefix}.${field}`, row[field]));
    const updatedAt = timestamp(row.updatedAt);
    if (Date.parse(updatedAt) > Date.parse(now) + 30_000) throw new Error("Future canonical source.");
    if (lead) {
      const sourceTimestamp = owner.objectVersion.slice(`crm-lead:${request.subjectId}@`.length);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(sourceTimestamp)
        || Date.parse(sourceTimestamp) !== Date.parse(updatedAt)
        || sourceTimestamp.slice(0, 19) !== updatedAt.slice(0, 19)) throw new Error("Invalid source version timestamp.");
    }
    if (request.expectedSourceVersion !== null && request.expectedSourceVersion !== owner.objectVersion) return finish("VERSION_MISMATCH");
    claims.push({ claimId: `${prefix}.updatedAt`, kind: "FACT", unit: null, value: updatedAt, valueType: "TIMESTAMP" });
    if (!lead) {
      claims.push({ claimId: "commercialCase.nextActionDueAt", kind: "FACT", unit: null, value: row.nextActionDueAt === null ? null : timestamp(row.nextActionDueAt), valueType: "TIMESTAMP" });
    }
    return finish("AVAILABLE", owner.objectVersion, `postgres:public.${table}`, claims);
  } catch {
    return finish("SOURCE_INVALID");
  }
}

function stringClaim(claimId: string, value: unknown): CanonicalClaim {
  if (value !== null && (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > 2_048)) throw new Error("Invalid bounded source string.");
  return { claimId, kind: "FACT", unit: null, value: value as string | null, valueType: "STRING" };
}
