import {
  CORE_CONTRACT_VERSIONS,
  type ImportBatchV1,
  type ImportReceiptV1,
  type SetupMandateV1,
} from "@/modules/luzione-core-contracts/contracts";
import {
  parseImportBatchV1,
  parseImportReceiptV1,
} from "@/modules/luzione-core-contracts/consumerSdk";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  ONBOARD_CORE_API_VERSION,
  OnboardCoreContractError,
  deterministicUuid,
} from "./contracts";

export const ONBOARD_IMPORT_MAPPING_VERSION = "CRMImportDryRunMap/v1";
export const ONBOARD_IMPORT_MAPPING_VERSION_V2 = "CRMImportDryRunMap/v2";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DIGEST = /^[a-f0-9]{64}$/;

export type ImportDryRunRow = {
  outcome: "ACCEPTED" | "CONFLICT" | "DUPLICATE" | "REJECTED";
  payloadDigest: string;
  reasonCode: string | null;
  sourceRowId: string;
};

export type ImportDryRunSourceRow = {
  matchKeyDigest: string | null;
  payloadDigest: string;
  sourceRowId: string;
};

export type ImportDryRunRequest = {
  contractVersion: typeof ONBOARD_CORE_API_VERSION;
  dedupeKey: string;
  expectedMandateObjectVersion: string;
  mandateId: string;
  mappingVersion: typeof ONBOARD_IMPORT_MAPPING_VERSION_V2;
  rows: readonly ImportDryRunSourceRow[];
  sourceBindingDigest: string;
  source: {
    consentRef: string;
    digest: string;
    kind: "CSV" | "DOCUMENT" | "XLSX";
    provenanceRef: string;
  };
};

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(input: Record<string, unknown>, keys: readonly string[], field: string) {
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new OnboardCoreContractError("FIELD_SET_MISMATCH", `${field} must contain exactly: ${expected.join(", ")}.`);
  }
  return input;
}

function text(value: unknown, field: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function id(value: unknown, field: string) {
  const parsed = text(value, field, 200);
  if (!ID.test(parsed)) throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a stable identifier.`);
  return parsed;
}

function uuid(value: unknown, field: string) {
  const parsed = text(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed)) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a UUID.`);
  }
  return parsed;
}

function digest(value: unknown, field: string) {
  const parsed = text(value, field, 64);
  if (!DIGEST.test(parsed)) throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a lowercase SHA-256 digest.`);
  return parsed;
}

export function importSourceDigest(input: Pick<ImportDryRunRequest, "mappingVersion" | "rows" | "source" | "sourceBindingDigest">) {
  return sha256({
    mappingVersion: input.mappingVersion,
    rows: input.rows,
    sourceBindingDigest: input.sourceBindingDigest,
    source: {
      consentRef: input.source.consentRef,
      kind: input.source.kind,
      provenanceRef: input.source.provenanceRef,
    },
  });
}

export function parseImportDryRunRequest(value: unknown): ImportDryRunRequest {
  const input = exact(object(value, "importDryRun"), [
    "contractVersion", "dedupeKey", "expectedMandateObjectVersion", "mandateId",
    "mappingVersion", "rows", "source", "sourceBindingDigest",
  ], "importDryRun");
  if (input.contractVersion !== ONBOARD_CORE_API_VERSION) {
    throw new OnboardCoreContractError("WRONG_VERSION", `contractVersion must be ${ONBOARD_CORE_API_VERSION}.`);
  }
  if (input.mappingVersion !== ONBOARD_IMPORT_MAPPING_VERSION_V2) {
    throw new OnboardCoreContractError("WRONG_MAPPING_VERSION", `mappingVersion must be ${ONBOARD_IMPORT_MAPPING_VERSION_V2}.`, 409);
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > 10_000) {
    throw new OnboardCoreContractError("INVALID_REQUEST", "rows must be a non-empty bounded digest manifest.");
  }
  const rows = input.rows.map((value, index): ImportDryRunSourceRow => {
    const row = exact(object(value, `rows[${index}]`), ["matchKeyDigest", "payloadDigest", "sourceRowId"], `rows[${index}]`);
    return {
      matchKeyDigest: row.matchKeyDigest === null ? null : digest(row.matchKeyDigest, `rows[${index}].matchKeyDigest`),
      payloadDigest: digest(row.payloadDigest, `rows[${index}].payloadDigest`),
      sourceRowId: id(row.sourceRowId, `rows[${index}].sourceRowId`),
    };
  });
  if (new Set(rows.map((row) => row.sourceRowId)).size !== rows.length) {
    throw new OnboardCoreContractError("INVALID_REQUEST", "sourceRowId must be unique within a dry run.");
  }
  const sourceInput = exact(object(input.source, "source"), ["consentRef", "digest", "kind", "provenanceRef"], "source");
  if (!(["CSV", "DOCUMENT", "XLSX"] as unknown[]).includes(sourceInput.kind)) {
    throw new OnboardCoreContractError("INVALID_REQUEST", "source.kind is unsupported.");
  }
  const parsed: ImportDryRunRequest = {
    contractVersion: ONBOARD_CORE_API_VERSION,
    dedupeKey: id(input.dedupeKey, "dedupeKey"),
    expectedMandateObjectVersion: text(input.expectedMandateObjectVersion, "expectedMandateObjectVersion", 300),
    mandateId: uuid(input.mandateId, "mandateId"),
    mappingVersion: ONBOARD_IMPORT_MAPPING_VERSION_V2,
    rows,
    sourceBindingDigest: digest(input.sourceBindingDigest, "sourceBindingDigest"),
    source: {
      consentRef: id(sourceInput.consentRef, "source.consentRef"),
      digest: digest(sourceInput.digest, "source.digest"),
      kind: sourceInput.kind as ImportDryRunRequest["source"]["kind"],
      provenanceRef: id(sourceInput.provenanceRef, "source.provenanceRef"),
    },
  };
  if (importSourceDigest(parsed) !== parsed.source.digest) {
    throw new OnboardCoreContractError("SOURCE_DIGEST_MISMATCH", "source.digest must match the canonical row digest manifest.", 409);
  }
  return parsed;
}

export function importReservation(tenantId: string, request: ImportDryRunRequest) {
  return {
    batchId: deterministicUuid("import-dry-run-batch", { dedupeKey: request.dedupeKey, tenantId }),
    commandId: deterministicUuid("import-dry-run-command", { dedupeKey: request.dedupeKey, tenantId }),
    idempotencyKey: `onboard-import:${sha256({ dedupeKey: request.dedupeKey, tenantId })}`,
  };
}

export function issueImportEvidence(input: {
  mandate: SetupMandateV1;
  request: ImportDryRunRequest;
  tenantId: string;
}) {
  if (input.mandate.tenantId !== input.tenantId) {
    throw new OnboardCoreContractError("TENANT_MISMATCH", "Import tenant must match its Setup Mandate.", 403);
  }
  const grouped = new Map<string, ImportDryRunSourceRow[]>();
  for (const row of input.request.rows) {
    if (row.matchKeyDigest === null) continue;
    grouped.set(row.matchKeyDigest, [...(grouped.get(row.matchKeyDigest) ?? []), row]);
  }
  const rows: Array<ImportDryRunRow & { exceptionRef: string | null; matchKeyDigest: string | null; reconciliationRef: string | null }> = input.request.rows.map((row) => {
    const group = row.matchKeyDigest === null ? [] : grouped.get(row.matchKeyDigest) ?? [];
    const distinctPayloads = new Set(group.map((candidate) => candidate.payloadDigest));
    const outcome: ImportDryRunRow["outcome"] = row.matchKeyDigest === null
      ? "REJECTED"
      : distinctPayloads.size > 1
        ? "CONFLICT"
        : group[0]?.sourceRowId === row.sourceRowId
          ? "ACCEPTED"
          : "DUPLICATE";
    const reasonCode = outcome === "REJECTED" ? "MATCH_KEY_MISSING" : outcome === "CONFLICT" ? "MATCH_KEY_PAYLOAD_CONFLICT" : null;
    const reservation = importReservation(input.tenantId, input.request);
    return {
      outcome,
      matchKeyDigest: row.matchKeyDigest,
      payloadDigest: row.payloadDigest,
      reasonCode,
      sourceRowId: row.sourceRowId,
      exceptionRef: outcome === "REJECTED" || outcome === "CONFLICT"
        ? `import-exception:${deterministicUuid("import-row-exception", { batchId: reservation.batchId, reasonCode, sourceRowId: row.sourceRowId })}` : null,
      reconciliationRef: outcome === "CONFLICT"
        ? `import-reconciliation:${deterministicUuid("import-row-reconciliation", { batchId: reservation.batchId, sourceRowId: row.sourceRowId })}` : null,
    };
  });
  const failed = rows.filter((row) => row.outcome === "REJECTED" || row.outcome === "CONFLICT");
  const conflicts = rows.filter((row) => row.outcome === "CONFLICT");
  const accepted = rows.filter((row) => row.outcome === "ACCEPTED").length;
  const duplicates = rows.filter((row) => row.outcome === "DUPLICATE").length;
  const rejected = failed.length;
  const total = input.request.rows.length;
  if (total > input.mandate.limits.maxImportRecords) {
    throw new OnboardCoreContractError("MANDATE_LIMIT_EXCEEDED", "Import records plus rejected rows exceed the Setup Mandate limit.", 403);
  }
  const status: ImportBatchV1["status"] = conflicts.length
    ? "RECONCILIATION_REQUIRED"
    : failed.length
      ? "STAGED"
      : "VALIDATED";
  const finality: ImportReceiptV1["finality"] = status === "VALIDATED"
    ? "VALIDATED_NO_EFFECT"
    : status === "STAGED"
      ? "STAGED"
      : "RECONCILIATION_REQUIRED";
  const reservation = importReservation(input.tenantId, input.request);
  const reconciliationRef = conflicts.length
    ? `import-reconciliation:${deterministicUuid("import-batch-reconciliation", { batchId: reservation.batchId, sourceDigest: input.request.source.digest })}`
    : null;
  const batch = parseImportBatchV1({
    batchId: reservation.batchId,
    contractVersion: CORE_CONTRACT_VERSIONS.importBatch,
    dedupeKey: input.request.dedupeKey,
    effectMode: "NO_EFFECT",
    mandateRef: input.request.mandateId,
    mappingVersion: input.request.mappingVersion,
    source: input.request.source,
    stagedCounts: { records: accepted + duplicates, rejected },
    status,
    tenantId: input.tenantId,
  }, input.mandate);
  const receipt = parseImportReceiptV1({
    batchId: batch.batchId,
    contractVersion: CORE_CONTRACT_VERSIONS.importReceipt,
    counts: { accepted, duplicates, rejected, total },
    effectMode: batch.effectMode,
    exceptionRefs: rows.flatMap((row) => row.exceptionRef ? [row.exceptionRef] : []),
    finality,
    reconciliationRef,
    rollbackRef: `import-rollback:${batch.batchId}`,
    tenantId: input.tenantId,
  }, batch);
  return { batch, receipt, rows };
}

export function assertImportStatusFinality(batch: ImportBatchV1, receipt: ImportReceiptV1) {
  const pair = `${batch.status}:${receipt.finality}`;
  if (!new Set([
    "VALIDATED:VALIDATED_NO_EFFECT",
    "STAGED:STAGED",
    "RECONCILIATION_REQUIRED:RECONCILIATION_REQUIRED",
  ]).has(pair)) {
    throw new OnboardCoreContractError("IMPORT_FINALITY_INVALID", "Import Batch status and Receipt finality are not a closed allowed pair.", 409);
  }
  if (receipt.effectMode !== batch.effectMode) {
    throw new OnboardCoreContractError("IMPORT_EFFECT_MISMATCH", "Import Receipt effectMode must equal its Batch.", 409);
  }
  if (receipt.finality === "VALIDATED_NO_EFFECT" && receipt.effectMode !== "NO_EFFECT") {
    throw new OnboardCoreContractError("IMPORT_FINALITY_INVALID", "VALIDATED_NO_EFFECT never represents CRM commit finality.", 409);
  }
}
