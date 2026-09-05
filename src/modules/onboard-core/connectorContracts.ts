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

export const CONNECTOR_SYNC_VALIDATION_VERSION = "ConnectorSyncValidation/v1";
export const CONNECTOR_SANDBOX_DESTINATION = "sandbox.echo";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SCENARIOS = ["ambiguous", "matched", "source_unavailable", "version_mismatch"] as const;

export type ConnectorSyncValidationRequest = {
  binding: ConnectorBindingV1;
  contractVersion: typeof ONBOARD_CORE_API_VERSION;
  operationKey: string;
  payloadDigest: string;
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

export function connectorValidationPayloadDigest(input: Pick<ConnectorSyncValidationRequest, "binding" | "validation">) {
  return sha256({ binding: input.binding, validation: input.validation });
}

export function parseConnectorSyncValidationRequest(value: unknown): ConnectorSyncValidationRequest {
  const input = exact(object(value, "connectorSyncValidation"), [
    "binding", "contractVersion", "operationKey", "payloadDigest", "validation",
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
  if (!DIGEST.test(payloadDigest) || payloadDigest !== connectorValidationPayloadDigest({ binding, validation })) {
    throw new OnboardCoreContractError("PAYLOAD_DIGEST_MISMATCH", "payloadDigest must match the exact canonical Binding and validation payload.", 409);
  }
  return {
    binding,
    contractVersion: ONBOARD_CORE_API_VERSION,
    operationKey: id(input.operationKey, "operationKey"),
    payloadDigest,
    validation,
  };
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
