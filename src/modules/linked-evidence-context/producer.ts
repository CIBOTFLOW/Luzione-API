import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { CanonicalClaim, Stage5Pins } from "@/modules/sultan-stage5/contracts";
import { isExactStage5ConsumerWorkload } from "@/modules/sultan-stage5/workload";

export const LINKED_EVIDENCE_CONTEXT_VERSION = "luzione-linked-evidence-context/v0.1-draft" as const;
export const linkedEvidenceSubjectTypes = [
  "TASK",
  "COMMERCIAL_CASE",
  "QUOTE",
  "PRODUCT",
  "SUPPLIER",
] as const;
export type LinkedEvidenceSubjectType = (typeof linkedEvidenceSubjectTypes)[number];

export type LinkedEvidenceReference = {
  expectedVersion: string | null;
  subjectId: string;
  subjectType: LinkedEvidenceSubjectType;
};

export type LinkedEvidenceContextRequest = {
  consumerDeploymentSha: string;
  contractVersion: typeof LINKED_EVIDENCE_CONTEXT_VERSION;
  records: readonly LinkedEvidenceReference[];
  requestedAt: string;
};

export type LinkedEvidenceSourceProfile = {
  allowedRefPrefixes: readonly string[];
  canonicalAuthority:
    | "CANONICAL_POSTGRES_TRANSFER_PENDING"
    | "PROVIDER_AUTHORITATIVE_PROJECTION"
    | "SEMANTIC_OWNER_UNRESOLVED";
  claimPrefix: string;
  currentWriteOwner: "CIBOTFLOW/Luzione-UI" | "external:shopify";
  evidencePinIds: readonly string[];
  profileId: string;
  readProducerOwner: "CIBOTFLOW/Luzione-API" | "CIBOTFLOW/Luzione-UI";
  recordRefPrefix: string;
  sourceContractVersion: string | null;
  sourceOfTruth: string;
  subjectType: LinkedEvidenceSubjectType;
};

export const linkedEvidenceSourceProfiles: Readonly<Record<LinkedEvidenceSubjectType, LinkedEvidenceSourceProfile>> =
  Object.freeze({
    TASK: Object.freeze({
      allowedRefPrefixes: Object.freeze(["postgres:public.team_coordination_tasks/"]),
      canonicalAuthority: "SEMANTIC_OWNER_UNRESOLVED" as const,
      claimPrefix: "task.",
      currentWriteOwner: "CIBOTFLOW/Luzione-UI" as const,
      evidencePinIds: Object.freeze(["ui-task-store", "ui-task-schema", "ui-task-tenant-boundary"]),
      profileId: "sgo-c03-task-source/v1",
      readProducerOwner: "CIBOTFLOW/Luzione-UI" as const,
      recordRefPrefix: "postgres:public.team_coordination_tasks/",
      sourceContractVersion: null,
      sourceOfTruth: "canonical-postgres:public.team_coordination_tasks",
      subjectType: "TASK" as const,
    }),
    COMMERCIAL_CASE: Object.freeze({
      allowedRefPrefixes: Object.freeze(["postgres:public.commercial_cases/"]),
      canonicalAuthority: "CANONICAL_POSTGRES_TRANSFER_PENDING" as const,
      claimPrefix: "commercialCase.",
      currentWriteOwner: "CIBOTFLOW/Luzione-UI" as const,
      evidencePinIds: Object.freeze(["api-commercial-case-store", "api-commercial-case-contract"]),
      profileId: "sgo-c03-commercial-case-source/v1",
      readProducerOwner: "CIBOTFLOW/Luzione-API" as const,
      recordRefPrefix: "postgres:public.commercial_cases/",
      sourceContractVersion: "luzione-lead-commercial-case/v0.1",
      sourceOfTruth: "canonical-postgres:public.commercial_cases",
      subjectType: "COMMERCIAL_CASE" as const,
    }),
    QUOTE: Object.freeze({
      allowedRefPrefixes: Object.freeze([
        "postgres:public.quotes/",
        "postgres:public.quote_economics_versions/",
        "postgres:public.quote_margin_approval_records/",
      ]),
      canonicalAuthority: "CANONICAL_POSTGRES_TRANSFER_PENDING" as const,
      claimPrefix: "quote.",
      currentWriteOwner: "CIBOTFLOW/Luzione-UI" as const,
      evidencePinIds: Object.freeze(["api-quote-store", "api-quote-contract"]),
      profileId: "sgo-c03-quote-source/v1",
      readProducerOwner: "CIBOTFLOW/Luzione-API" as const,
      recordRefPrefix: "postgres:public.quotes/",
      sourceContractVersion: "luzione-proposal-quote-approval/v0.1",
      sourceOfTruth: "canonical-postgres:public.quotes+public.quote_economics_versions",
      subjectType: "QUOTE" as const,
    }),
    PRODUCT: Object.freeze({
      allowedRefPrefixes: Object.freeze([
        "postgres:public.p113_catalog_search_projections/",
        "provider:shopify/",
      ]),
      canonicalAuthority: "PROVIDER_AUTHORITATIVE_PROJECTION" as const,
      claimPrefix: "product.",
      currentWriteOwner: "external:shopify" as const,
      evidencePinIds: Object.freeze(["api-catalog-runtime", "api-catalog-store", "api-truth-registry"]),
      profileId: "sgo-c03-product-source/v1",
      readProducerOwner: "CIBOTFLOW/Luzione-API" as const,
      recordRefPrefix: "postgres:public.p113_catalog_search_projections/",
      sourceContractVersion: "2026-08-19.p113.v1",
      sourceOfTruth: "external:shopify via rebuildable P113 projection",
      subjectType: "PRODUCT" as const,
    }),
    SUPPLIER: Object.freeze({
      allowedRefPrefixes: Object.freeze([
        "postgres:public.suppliers/",
        "postgres:public.supplier_products/",
      ]),
      canonicalAuthority: "SEMANTIC_OWNER_UNRESOLVED" as const,
      claimPrefix: "supplier.",
      currentWriteOwner: "CIBOTFLOW/Luzione-UI" as const,
      evidencePinIds: Object.freeze(["ui-supplier-store", "ui-supplier-schema", "ui-supplier-tenant-boundary"]),
      profileId: "sgo-c03-supplier-source/v1",
      readProducerOwner: "CIBOTFLOW/Luzione-UI" as const,
      recordRefPrefix: "postgres:public.suppliers/",
      sourceContractVersion: null,
      sourceOfTruth: "canonical-postgres:public.suppliers",
      subjectType: "SUPPLIER" as const,
    }),
  });

export type LinkedEvidenceSourceRead =
  | {
      claims: readonly CanonicalClaim[];
      freshness: "FRESH" | "STALE";
      observedAt: string;
      recordId: string;
      recordVersion: string;
      sourceProfileId: string;
      sourceRefs: readonly string[];
      state: "FOUND";
      subjectType: LinkedEvidenceSubjectType;
    }
  | {
      sourceProfileId: string;
      state: "DENIED" | "MISSING" | "SOURCE_UNAVAILABLE";
      subjectId: string;
      subjectType: LinkedEvidenceSubjectType;
    };

export type LinkedEvidenceSource = {
  read(actor: ApiActor, reference: LinkedEvidenceReference): Promise<LinkedEvidenceSourceRead>;
};

export type LinkedEvidenceEntryStatus =
  | "AVAILABLE"
  | "DENIED"
  | "MISSING"
  | "SOURCE_INVALID"
  | "SOURCE_UNAVAILABLE"
  | "STALE";

export type LinkedEvidenceContextEntry = {
  citation: Readonly<{
    actualRecordId: string | null;
    actualRecordVersion: string | null;
    expectedVersion: string | null;
    requestedRecordId: string;
    sourceRefs: readonly string[];
  }>;
  claims: readonly CanonicalClaim[];
  freshUntil: string | null;
  observedAt: string | null;
  reasonCode:
    | "AVAILABLE"
    | "EXPECTED_VERSION_MISMATCH"
    | "OBSERVATION_EXPIRED"
    | "RECORD_MISSING"
    | "SOURCE_ACCESS_DENIED"
    | "SOURCE_DECLARED_STALE"
    | "SOURCE_INVALID"
    | "SOURCE_UNAVAILABLE";
  sourceProfile: LinkedEvidenceSourceProfile;
  status: LinkedEvidenceEntryStatus;
  subjectId: string;
  subjectType: LinkedEvidenceSubjectType;
};

export type LinkedEvidenceContext = {
  admissionEligible: false;
  apiDeploymentSha: string;
  businessStateMutated: false;
  consumer: Readonly<{ actorId: string; deploymentSha: string }>;
  contextHash: string;
  contractOwner: "CIBOTFLOW/Luzione-API";
  contractVersion: typeof LINKED_EVIDENCE_CONTEXT_VERSION;
  effectAuthority: "NO_EFFECT";
  grantsAuthority: false;
  observedAt: string;
  persistence: "UNPERSISTED_DRAFT";
  records: readonly LinkedEvidenceContextEntry[];
  summary: Readonly<Record<LinkedEvidenceEntryStatus, number>>;
  tenantId: string;
};

export class LinkedEvidenceContextError extends Error {
  constructor(readonly code:
    | "INVALID_CONFIGURATION"
    | "INVALID_REQUEST"
    | "RELEASE_PIN_MISMATCH"
    | "REQUEST_STALE"
    | "WORKLOAD_IDENTITY_DENIED") {
    super(`Linked evidence context rejected: ${code}.`);
    this.name = "LinkedEvidenceContextError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;
const SHA = /^[a-f0-9]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const SOURCE_REF = /^(?:postgres|provider):[A-Za-z0-9][A-Za-z0-9._:@/+\-=]{1,2047}$/;
const CLAIM_ID = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/;

type Pins = Pick<Stage5Pins,
  "apiDeploymentSha" | "maximumEvidenceAgeMs" | "sultanDeploymentSha" | "uiDeploymentSha">;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object.");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error("Unexpected fields.");
  }
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid timestamp.");
  }
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) throw new Error("Invalid calendar timestamp.");
  return normalized;
}

function parseReference(value: unknown): LinkedEvidenceReference {
  const input = record(value);
  exactKeys(input, ["expectedVersion", "subjectId", "subjectType"]);
  if (typeof input.subjectId !== "string" || !ID.test(input.subjectId)
    || !linkedEvidenceSubjectTypes.includes(input.subjectType as LinkedEvidenceSubjectType)
    || (input.expectedVersion !== null && (typeof input.expectedVersion !== "string"
      || input.expectedVersion.length < 1 || input.expectedVersion.length > 1_024))) {
    throw new Error("Invalid reference.");
  }
  return Object.freeze({
    expectedVersion: input.expectedVersion as string | null,
    subjectId: input.subjectId,
    subjectType: input.subjectType as LinkedEvidenceSubjectType,
  });
}

export function parseLinkedEvidenceContextRequest(value: unknown): LinkedEvidenceContextRequest {
  try {
    const input = record(value);
    exactKeys(input, ["consumerDeploymentSha", "contractVersion", "records", "requestedAt"]);
    if (input.contractVersion !== LINKED_EVIDENCE_CONTEXT_VERSION
      || typeof input.consumerDeploymentSha !== "string" || !SHA.test(input.consumerDeploymentSha)
      || !Array.isArray(input.records) || input.records.length < 1 || input.records.length > 5) {
      throw new Error("Invalid request.");
    }
    const records = input.records.map(parseReference).sort((left, right) =>
      left.subjectType.localeCompare(right.subjectType) || left.subjectId.localeCompare(right.subjectId));
    const identities = records.map((item) => `${item.subjectType}:${item.subjectId}`);
    if (new Set(identities).size !== identities.length) throw new Error("Duplicate reference.");
    return Object.freeze({
      consumerDeploymentSha: input.consumerDeploymentSha,
      contractVersion: LINKED_EVIDENCE_CONTEXT_VERSION,
      records: Object.freeze(records),
      requestedAt: timestamp(input.requestedAt),
    });
  } catch {
    throw new LinkedEvidenceContextError("INVALID_REQUEST");
  }
}

export async function buildLinkedEvidenceContext(input: {
  actor: ApiActor;
  now: string;
  pins: Pins;
  request: unknown;
  source: LinkedEvidenceSource;
}): Promise<LinkedEvidenceContext> {
  const request = parseLinkedEvidenceContextRequest(input.request);
  let now: string;
  try {
    now = timestamp(input.now);
  } catch {
    throw new LinkedEvidenceContextError("INVALID_CONFIGURATION");
  }
  if (!SHA.test(input.pins.apiDeploymentSha)
    || !SHA.test(input.pins.uiDeploymentSha)
    || !SHA.test(input.pins.sultanDeploymentSha)
    || !Number.isSafeInteger(input.pins.maximumEvidenceAgeMs)
    || input.pins.maximumEvidenceAgeMs < 1
    || input.pins.maximumEvidenceAgeMs > 86_400_000) {
    throw new LinkedEvidenceContextError("INVALID_CONFIGURATION");
  }
  const consumerPin = input.actor.actorId === "service:luzione-ui"
    ? input.pins.uiDeploymentSha
    : input.actor.actorId === "service:sultan-os"
      ? input.pins.sultanDeploymentSha
      : null;
  if (consumerPin === null) throw new LinkedEvidenceContextError("WORKLOAD_IDENTITY_DENIED");
  if (request.consumerDeploymentSha !== consumerPin) {
    throw new LinkedEvidenceContextError("RELEASE_PIN_MISMATCH");
  }
  const nowMillis = Date.parse(now);
  const requestedMillis = Date.parse(request.requestedAt);
  if (requestedMillis > nowMillis + 30_000
    || nowMillis - requestedMillis > input.pins.maximumEvidenceAgeMs) {
    throw new LinkedEvidenceContextError("REQUEST_STALE");
  }

  const workloadAllowed = isExactStage5ConsumerWorkload(
    input.actor,
    "sultan.canonical.readback.read",
  );
  const entries: LinkedEvidenceContextEntry[] = [];
  for (const reference of request.records) {
    entries.push(workloadAllowed
      ? await readEntry(input.actor, reference, input.source, now, input.pins.maximumEvidenceAgeMs)
      : emptyEntry(reference, "DENIED", "SOURCE_ACCESS_DENIED"));
  }
  const summary = summarize(entries);
  const withoutHash: Omit<LinkedEvidenceContext, "contextHash"> = {
    admissionEligible: false,
    apiDeploymentSha: input.pins.apiDeploymentSha,
    businessStateMutated: false,
    consumer: Object.freeze({ actorId: input.actor.actorId, deploymentSha: consumerPin }),
    contractOwner: "CIBOTFLOW/Luzione-API",
    contractVersion: LINKED_EVIDENCE_CONTEXT_VERSION,
    effectAuthority: "NO_EFFECT",
    grantsAuthority: false,
    observedAt: now,
    persistence: "UNPERSISTED_DRAFT",
    records: Object.freeze(entries),
    summary,
    tenantId: input.actor.tenantId,
  };
  return Object.freeze({ ...withoutHash, contextHash: sha256(withoutHash) });
}

async function readEntry(
  actor: ApiActor,
  reference: LinkedEvidenceReference,
  source: LinkedEvidenceSource,
  now: string,
  maximumAgeMs: number,
): Promise<LinkedEvidenceContextEntry> {
  let result: LinkedEvidenceSourceRead;
  try {
    result = await source.read(actor, reference);
  } catch (error) {
    return emptyEntry(reference, isDeniedError(error) ? "DENIED" : "SOURCE_UNAVAILABLE",
      isDeniedError(error) ? "SOURCE_ACCESS_DENIED" : "SOURCE_UNAVAILABLE");
  }
  const profile = linkedEvidenceSourceProfiles[reference.subjectType];
  if (result.sourceProfileId !== profile.profileId
    || result.subjectType !== reference.subjectType
    || (result.state !== "FOUND" && result.subjectId !== reference.subjectId)) {
    return emptyEntry(reference, "SOURCE_INVALID", "SOURCE_INVALID");
  }
  if (result.state === "MISSING") return emptyEntry(reference, "MISSING", "RECORD_MISSING");
  if (result.state === "DENIED") return emptyEntry(reference, "DENIED", "SOURCE_ACCESS_DENIED");
  if (result.state === "SOURCE_UNAVAILABLE") {
    return emptyEntry(reference, "SOURCE_UNAVAILABLE", "SOURCE_UNAVAILABLE");
  }
  if (result.state !== "FOUND") return emptyEntry(reference, "SOURCE_INVALID", "SOURCE_INVALID");
  try {
    const observedAt = timestamp(result.observedAt);
    validateFound(result, reference, profile);
    const freshUntilMillis = Date.parse(observedAt) + maximumAgeMs;
    const reasonCode = reference.expectedVersion !== null
      && reference.expectedVersion !== result.recordVersion
      ? "EXPECTED_VERSION_MISMATCH" as const
      : result.freshness === "STALE"
        ? "SOURCE_DECLARED_STALE" as const
        : Date.parse(observedAt) > Date.parse(now) + 30_000 || freshUntilMillis <= Date.parse(now)
          ? "OBSERVATION_EXPIRED" as const
          : "AVAILABLE" as const;
    const status = reasonCode === "AVAILABLE" ? "AVAILABLE" as const : "STALE" as const;
    return Object.freeze({
      citation: Object.freeze({
        actualRecordId: result.recordId,
        actualRecordVersion: result.recordVersion,
        expectedVersion: reference.expectedVersion,
        requestedRecordId: reference.subjectId,
        sourceRefs: Object.freeze([...result.sourceRefs]),
      }),
      claims: status === "AVAILABLE"
        ? Object.freeze([...result.claims].sort((a, b) => a.claimId.localeCompare(b.claimId)).map((claim) => Object.freeze({ ...claim })))
        : Object.freeze([]),
      freshUntil: status === "AVAILABLE" ? new Date(freshUntilMillis).toISOString() : null,
      observedAt,
      reasonCode,
      sourceProfile: profile,
      status,
      subjectId: reference.subjectId,
      subjectType: reference.subjectType,
    });
  } catch {
    return emptyEntry(reference, "SOURCE_INVALID", "SOURCE_INVALID");
  }
}

function validateFound(
  result: Extract<LinkedEvidenceSourceRead, { state: "FOUND" }>,
  reference: LinkedEvidenceReference,
  profile: LinkedEvidenceSourceProfile,
) {
  if (result.recordId !== reference.subjectId
    || !validVersion(reference.subjectType, reference.subjectId, result.recordVersion)
    || result.sourceRefs.length < 1 || result.sourceRefs.length > 4
    || new Set(result.sourceRefs).size !== result.sourceRefs.length
    || result.claims.length < 1 || result.claims.length > 24) {
    throw new Error("Invalid source record.");
  }
  const recordRef = `${profile.recordRefPrefix}${result.recordId}@${result.recordVersion}`;
  if (!result.sourceRefs.includes(recordRef)
    || result.sourceRefs.some((sourceRef) => !SOURCE_REF.test(sourceRef)
      || !profile.allowedRefPrefixes.some((prefix) => sourceRef.startsWith(prefix)))) {
    throw new Error("Invalid source citation.");
  }
  const claimIds = new Set<string>();
  for (const claim of result.claims) {
    if (!CLAIM_ID.test(claim.claimId) || !claim.claimId.startsWith(profile.claimPrefix)
      || claimIds.has(claim.claimId)) throw new Error("Invalid claim identity.");
    claimIds.add(claim.claimId);
    validateClaimValue(claim);
  }
}

function validVersion(subjectType: LinkedEvidenceSubjectType, subjectId: string, version: string) {
  if (version.length > 1_024) return false;
  const escaped = subjectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  switch (subjectType) {
    case "TASK": return new RegExp(`^task:${escaped}:v[1-9]\\d*$`).test(version);
    case "COMMERCIAL_CASE": return new RegExp(`^commercial-case:${escaped}:v[1-9]\\d*$`).test(version);
    case "QUOTE": return new RegExp(`^quote:${escaped}:e[1-9]\\d*:s[A-Za-z0-9_-]+$`).test(version);
    case "PRODUCT": return /^[a-f0-9]{64}$/.test(version);
    case "SUPPLIER": {
      const prefix = `supplier:${subjectId}@`;
      if (!version.startsWith(prefix)) return false;
      try { timestamp(version.slice(prefix.length)); return true; } catch { return false; }
    }
  }
}

function validateClaimValue(claim: CanonicalClaim) {
  if (!(["CALCULATION", "FACT"] as const).includes(claim.kind)) throw new Error("Invalid claim kind.");
  if (claim.unit !== null && (typeof claim.unit !== "string" || claim.unit.length > 64)) {
    throw new Error("Invalid claim unit.");
  }
  if (!(["BOOLEAN", "INTEGER", "MONEY_MINOR", "NUMBER", "STRING", "TIMESTAMP"] as const)
    .includes(claim.valueType)) throw new Error("Invalid claim value type.");
  if (claim.value === null) return;
  if (claim.valueType === "BOOLEAN" && typeof claim.value !== "boolean") throw new Error("Invalid boolean.");
  if (["INTEGER", "MONEY_MINOR"].includes(claim.valueType)
    && (typeof claim.value !== "number" || !Number.isSafeInteger(claim.value))) throw new Error("Invalid integer.");
  if (claim.valueType === "NUMBER"
    && (typeof claim.value !== "number" || !Number.isFinite(claim.value))) throw new Error("Invalid number.");
  if (claim.valueType === "STRING"
    && (typeof claim.value !== "string" || Buffer.byteLength(claim.value, "utf8") > 2_048)) {
    throw new Error("Invalid string.");
  }
  if (claim.valueType === "TIMESTAMP") timestamp(claim.value);
}

function emptyEntry(
  reference: LinkedEvidenceReference,
  status: Exclude<LinkedEvidenceEntryStatus, "AVAILABLE" | "STALE">,
  reasonCode: Extract<LinkedEvidenceContextEntry["reasonCode"],
    "RECORD_MISSING" | "SOURCE_ACCESS_DENIED" | "SOURCE_INVALID" | "SOURCE_UNAVAILABLE">,
): LinkedEvidenceContextEntry {
  return Object.freeze({
    citation: Object.freeze({
      actualRecordId: null,
      actualRecordVersion: null,
      expectedVersion: reference.expectedVersion,
      requestedRecordId: reference.subjectId,
      sourceRefs: Object.freeze([]),
    }),
    claims: Object.freeze([]),
    freshUntil: null,
    observedAt: null,
    reasonCode,
    sourceProfile: linkedEvidenceSourceProfiles[reference.subjectType],
    status,
    subjectId: reference.subjectId,
    subjectType: reference.subjectType,
  });
}

function isDeniedError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["42501", "PERMISSION_DENIED", "SOURCE_ACCESS_DENIED"].includes(String(error.code));
}

function summarize(entries: readonly LinkedEvidenceContextEntry[]) {
  const summary: Record<LinkedEvidenceEntryStatus, number> = {
    AVAILABLE: 0,
    DENIED: 0,
    MISSING: 0,
    SOURCE_INVALID: 0,
    SOURCE_UNAVAILABLE: 0,
    STALE: 0,
  };
  for (const entry of entries) summary[entry.status] += 1;
  return Object.freeze(summary);
}

export function verifyLinkedEvidenceContext(context: LinkedEvidenceContext) {
  try {
    const { contextHash, ...material } = context;
    if (sha256(material) !== contextHash
      || context.contractVersion !== LINKED_EVIDENCE_CONTEXT_VERSION
      || context.contractOwner !== "CIBOTFLOW/Luzione-API"
      || context.persistence !== "UNPERSISTED_DRAFT"
      || context.admissionEligible !== false
      || context.grantsAuthority !== false
      || context.businessStateMutated !== false
      || context.effectAuthority !== "NO_EFFECT"
      || context.records.length < 1 || context.records.length > 5) return false;
    timestamp(context.observedAt);
    const expectedSummary = summarize(context.records);
    if (JSON.stringify(expectedSummary) !== JSON.stringify(context.summary)) return false;
    const identities = context.records.map((entry) => `${entry.subjectType}:${entry.subjectId}`);
    if (new Set(identities).size !== identities.length
      || JSON.stringify(identities) !== JSON.stringify([...identities].sort())) return false;
    return context.records.every(validContextEntry);
  } catch {
    return false;
  }
}

function validContextEntry(entry: LinkedEvidenceContextEntry) {
  const profile = linkedEvidenceSourceProfiles[entry.subjectType];
  if (!profile
    || sha256(entry.sourceProfile) !== sha256(profile)
    || !ID.test(entry.subjectId)
    || entry.subjectId !== entry.citation.requestedRecordId) return false;
  const noActualCitation = entry.citation.actualRecordId === null
    && entry.citation.actualRecordVersion === null
    && entry.citation.sourceRefs.length === 0;
  if (entry.status !== "AVAILABLE" && entry.status !== "STALE") {
    const expectedReason = {
      DENIED: "SOURCE_ACCESS_DENIED",
      MISSING: "RECORD_MISSING",
      SOURCE_INVALID: "SOURCE_INVALID",
      SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
    }[entry.status];
    return noActualCitation
      && entry.claims.length === 0
      && entry.freshUntil === null
      && entry.observedAt === null
      && entry.reasonCode === expectedReason;
  }
  if (entry.citation.actualRecordId !== entry.subjectId
    || entry.citation.actualRecordVersion === null
    || !validVersion(entry.subjectType, entry.subjectId, entry.citation.actualRecordVersion)
    || entry.citation.sourceRefs.length < 1 || entry.citation.sourceRefs.length > 4
    || new Set(entry.citation.sourceRefs).size !== entry.citation.sourceRefs.length
    || !entry.citation.sourceRefs.includes(
      `${profile.recordRefPrefix}${entry.subjectId}@${entry.citation.actualRecordVersion}`,
    )
    || entry.citation.sourceRefs.some((sourceRef) => !SOURCE_REF.test(sourceRef)
      || !profile.allowedRefPrefixes.some((prefix) => sourceRef.startsWith(prefix)))
    || entry.observedAt === null) return false;
  timestamp(entry.observedAt);
  if (entry.status === "STALE") {
    return entry.claims.length === 0
      && entry.freshUntil === null
      && ["EXPECTED_VERSION_MISMATCH", "OBSERVATION_EXPIRED", "SOURCE_DECLARED_STALE"]
        .includes(entry.reasonCode);
  }
  if (entry.reasonCode !== "AVAILABLE" || entry.freshUntil === null
    || entry.claims.length < 1 || entry.claims.length > 24) return false;
  timestamp(entry.freshUntil);
  const claimIds = new Set<string>();
  for (const claim of entry.claims) {
    if (!CLAIM_ID.test(claim.claimId)
      || !claim.claimId.startsWith(profile.claimPrefix)
      || claimIds.has(claim.claimId)) return false;
    claimIds.add(claim.claimId);
    validateClaimValue(claim);
  }
  return true;
}
