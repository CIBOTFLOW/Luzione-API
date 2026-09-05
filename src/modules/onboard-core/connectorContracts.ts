import {
  CORE_CONTRACT_VERSIONS,
  type ConnectorBindingV1,
  type SyncReceiptV1,
} from "@/modules/luzione-core-contracts/contracts";
import {
  parseConnectorBindingV1,
  parseSyncReceiptV1,
} from "@/modules/luzione-core-contracts/consumerSdk";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  ONBOARD_CORE_API_VERSION,
  OnboardCoreContractError,
  deterministicUuid,
} from "./contracts";

export const LEGACY_CONNECTOR_SYNC_VALIDATION_VERSION = "ConnectorSyncValidation/v1";
export const CONNECTOR_SYNC_VALIDATION_VERSION = "ConnectorSyncValidation/v2";
export const CONNECTOR_VALIDATION_OUTCOME_VERSION = "ConnectorValidationOutcome/v1";
export const CONNECTOR_SANDBOX_DESTINATION = "sandbox.echo";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SCENARIOS = ["ambiguous", "matched", "source_unavailable", "version_mismatch"] as const;

export type ConnectorSyncValidationRequest = {
  binding: ConnectorBindingV1;
  contractVersion: typeof ONBOARD_CORE_API_VERSION;
  expectedMandateObjectVersion: string;
  mandateId: string;
  operationKey: string;
  payloadDigest: string;
  sourceBindingDigest: string;
  validation: {
    changes: { created: number; duplicates: number; failed: number; updated: number };
    cursorAfter: string | null;
    scenario: typeof SCENARIOS[number];
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

function id(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200 || !ID.test(value.trim())) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a stable identifier.`);
  }
  return value.trim();
}

function count(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a bounded non-negative integer.`);
  }
  return Number(value);
}

export type ConnectorValidationOutcome = {
  contractVersion: typeof CONNECTOR_VALIDATION_OUTCOME_VERSION;
  evidenceCode: "ACK_WITHOUT_READBACK" | "BLOCKED" | "MATCHING_READBACK" | "PENDING_RECONCILIATION" | "VERSION_MISMATCH" | "AMBIGUITY_EXHAUSTED" | "TERMINAL_UNAVAILABLE";
  state: "ACKNOWLEDGED" | "BLOCKED" | "RECONCILING" | "SOURCE_CONFIRMED" | "VERSION_MISMATCH" | "AMBIGUITY_EXHAUSTED" | "TERMINAL_UNAVAILABLE";
  success: boolean;
  syncReceipt: SyncReceiptV1 | null;
};

export function connectorValidationPayloadDigest(input: Pick<ConnectorSyncValidationRequest, "binding" | "expectedMandateObjectVersion" | "mandateId" | "sourceBindingDigest" | "validation">) {
  return sha256({ binding: input.binding, expectedMandateObjectVersion: input.expectedMandateObjectVersion, mandateId: input.mandateId, sourceBindingDigest: input.sourceBindingDigest, validation: input.validation });
}

export function parseConnectorSyncValidationRequest(value: unknown): ConnectorSyncValidationRequest {
  const input = exact(object(value, "connectorSyncValidation"), [
    "binding", "contractVersion", "expectedMandateObjectVersion", "mandateId", "operationKey", "payloadDigest", "sourceBindingDigest", "validation",
  ], "connectorSyncValidation");
  if (input.contractVersion !== ONBOARD_CORE_API_VERSION) {
    throw new OnboardCoreContractError("WRONG_VERSION", `contractVersion must be ${ONBOARD_CORE_API_VERSION}.`);
  }
  const binding = parseConnectorBindingV1(input.binding);
  if (binding.status !== "DRAFT") {
    throw new OnboardCoreContractError("CONNECTOR_STATUS_DENIED", "Sandbox validation accepts only a DRAFT binding and never a live or revoked binding.", 403);
  }
  if (binding.provider !== "GOOGLE_WORKSPACE" && binding.provider !== "QUICKBOOKS_ONLINE") {
    throw new OnboardCoreContractError("CONNECTOR_PROVIDER_DENIED", "Only approved Google Workspace and QuickBooks sandbox mappings are admitted.", 403);
  }
  if (!/^secret-ref:[A-Za-z0-9][A-Za-z0-9._:-]{2,190}$/.test(binding.credentialReference)) {
    throw new OnboardCoreContractError("CREDENTIAL_REFERENCE_INVALID", "credentialReference must be an opaque secret-ref identifier; secret values are forbidden.", 403);
  }
  const validationInput = exact(object(input.validation, "validation"), ["changes", "cursorAfter", "scenario"], "validation");
  if (!(SCENARIOS as readonly unknown[]).includes(validationInput.scenario)) {
    throw new OnboardCoreContractError("INVALID_REQUEST", "validation.scenario is unsupported.");
  }
  const changesInput = exact(object(validationInput.changes, "validation.changes"), ["created", "duplicates", "failed", "updated"], "validation.changes");
  const validation: ConnectorSyncValidationRequest["validation"] = {
    changes: {
      created: count(changesInput.created, "validation.changes.created"),
      duplicates: count(changesInput.duplicates, "validation.changes.duplicates"),
      failed: count(changesInput.failed, "validation.changes.failed"),
      updated: count(changesInput.updated, "validation.changes.updated"),
    },
    cursorAfter: validationInput.cursorAfter === null ? null : id(validationInput.cursorAfter, "validation.cursorAfter"),
    scenario: validationInput.scenario as ConnectorSyncValidationRequest["validation"]["scenario"],
  };
  const payloadDigest = id(input.payloadDigest, "payloadDigest");
  const expectedMandateObjectVersion = typeof input.expectedMandateObjectVersion === "string" && input.expectedMandateObjectVersion.trim().length >= 3 && input.expectedMandateObjectVersion.length <= 300
    ? input.expectedMandateObjectVersion.trim()
    : (() => { throw new OnboardCoreContractError("INVALID_REQUEST", "expectedMandateObjectVersion must be bounded."); })();
  const mandateId = typeof input.mandateId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.mandateId)
    ? input.mandateId
    : (() => { throw new OnboardCoreContractError("INVALID_REQUEST", "mandateId must be a UUID."); })();
  const sourceBindingDigest = id(input.sourceBindingDigest, "sourceBindingDigest");
  if (!DIGEST.test(sourceBindingDigest)) throw new OnboardCoreContractError("INVALID_REQUEST", "sourceBindingDigest must be a lowercase SHA-256 digest.");
  if (!DIGEST.test(payloadDigest) || payloadDigest !== connectorValidationPayloadDigest({ binding, expectedMandateObjectVersion, mandateId, sourceBindingDigest, validation })) {
    throw new OnboardCoreContractError("PAYLOAD_DIGEST_MISMATCH", "payloadDigest must match the exact canonical Binding and validation payload.", 409);
  }
  return {
    binding,
    contractVersion: ONBOARD_CORE_API_VERSION,
    expectedMandateObjectVersion,
    mandateId,
    operationKey: id(input.operationKey, "operationKey"),
    payloadDigest,
    sourceBindingDigest,
    validation,
  };
}

export function classifyConnectorOutcome(input: {
  binding: ConnectorBindingV1;
  changes: ConnectorSyncValidationRequest["validation"]["changes"];
  cursorAfter: string | null;
  lastErrorCode: string | null;
  providerAcknowledgementRef: string | null;
  reconciliationRef: string | null;
  reconciliationResult: string | null;
  sourceReadbackRef: string | null;
  state: string;
}): ConnectorValidationOutcome {
  const base = { contractVersion: CONNECTOR_VALIDATION_OUTCOME_VERSION } as const;
  if (input.state === "SOURCE_CONFIRMED" && input.reconciliationResult === "MATCHED" && input.sourceReadbackRef) {
    return { ...base, evidenceCode: "MATCHING_READBACK", state: "SOURCE_CONFIRMED", success: true, syncReceipt: issueSyncReceipt({ binding: input.binding, changes: input.changes, cursorAfter: input.cursorAfter, finality: "SOURCE_CONFIRMED", providerAcknowledgementRef: input.providerAcknowledgementRef, reconciliationRef: input.reconciliationRef, sourceReadbackRef: input.sourceReadbackRef }) };
  }
  if (input.reconciliationResult === "VERSION_MISMATCH" || input.lastErrorCode === "SOURCE_VERSION_MISMATCH") {
    return { ...base, evidenceCode: "VERSION_MISMATCH", state: "VERSION_MISMATCH", success: false, syncReceipt: null };
  }
  if (input.state === "BLOCKED" || input.lastErrorCode?.startsWith("EFFECT_") || input.lastErrorCode === "PROVIDER_EFFECT_DISABLED") {
    const exhausted = input.lastErrorCode === "RECONCILIATION_BUDGET_EXHAUSTED";
    return { ...base, evidenceCode: exhausted ? "AMBIGUITY_EXHAUSTED" : "BLOCKED", state: exhausted ? "AMBIGUITY_EXHAUSTED" : "BLOCKED", success: false, syncReceipt: null };
  }
  if (input.state === "PROVIDER_ACKNOWLEDGED" && input.providerAcknowledgementRef && !input.reconciliationRef) {
    return { ...base, evidenceCode: "ACK_WITHOUT_READBACK", state: "ACKNOWLEDGED", success: false, syncReceipt: issueSyncReceipt({ binding: input.binding, changes: input.changes, cursorAfter: input.cursorAfter, finality: "ACKNOWLEDGED", providerAcknowledgementRef: input.providerAcknowledgementRef, reconciliationRef: null, sourceReadbackRef: null }) };
  }
  if (input.reconciliationRef && input.reconciliationResult === "PENDING") {
    return { ...base, evidenceCode: "PENDING_RECONCILIATION", state: "RECONCILING", success: false, syncReceipt: issueSyncReceipt({ binding: input.binding, changes: input.changes, cursorAfter: input.cursorAfter, finality: "RECONCILING", providerAcknowledgementRef: input.providerAcknowledgementRef, reconciliationRef: input.reconciliationRef, sourceReadbackRef: null }) };
  }
  return { ...base, evidenceCode: "TERMINAL_UNAVAILABLE", state: "TERMINAL_UNAVAILABLE", success: false, syncReceipt: null };
}

export function connectorValidationReservation(tenantId: string, request: ConnectorSyncValidationRequest) {
  const identity = { operationKey: request.operationKey, tenantId };
  return {
    commandId: deterministicUuid("connector-sync-validation-command", identity),
    idempotencyKey: `connector-sync-validation:${sha256(identity)}`,
    objectVersion: `connector-sync-validation:${request.binding.bindingId}@${request.payloadDigest}`,
  };
}

export function issueSyncReceipt(input: {
  binding: ConnectorBindingV1;
  changes: ConnectorSyncValidationRequest["validation"]["changes"];
  cursorAfter: string | null;
  finality: SyncReceiptV1["finality"];
  providerAcknowledgementRef: string | null;
  reconciliationRef: string | null;
  sourceReadbackRef: string | null;
}) {
  return parseSyncReceiptV1({
    bindingId: input.binding.bindingId,
    changes: input.changes,
    contractVersion: CORE_CONTRACT_VERSIONS.syncReceipt,
    cursor: { after: input.cursorAfter, before: input.binding.cursor },
    finality: input.finality,
    providerAcknowledgementRef: input.providerAcknowledgementRef,
    reconciliationRef: input.reconciliationRef,
    sourceReadbackRef: input.sourceReadbackRef,
    tenantId: input.binding.tenantId,
  }, input.binding);
}
