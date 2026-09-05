import {
  CORE_CONTRACT_VERSIONS,
  type ConnectorBindingV1,
} from "@/modules/luzione-core-contracts/contracts";
import { parseConnectorBindingV1 } from "@/modules/luzione-core-contracts/consumerSdk";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const CONNECTOR_REVOCATION_REQUEST_VERSION = "ConnectorRevocationRequest/v1" as const;
export const CONNECTOR_REVOCATION_RECEIPT_VERSION = "ConnectorRevocationReceipt/v1" as const;
export const CONNECTOR_CREDENTIAL_HANDLE_VERSION = "ConnectorCredentialHandle/v1" as const;
export const CONNECTOR_REVOCATION_POLICY_VERSION = "CONNECTOR-REVOCATION-L1-G0/policy-v1" as const;
export const CONNECTOR_REVOCATION_DESTINATION = "sandbox.connector-revocation" as const;
export const CONNECTOR_REVOCATION_EMULATOR_PROVIDER = "luzione-connector-revocation-emulator" as const;
export const CONNECTOR_REVOCATION_EMULATOR_BINDING = "credential-binding:none:connector-revocation-emulator/v1" as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,511}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RECEIPT_REF = /^connector-revocation-receipt:[a-f0-9]{64}$/;
const KILL_VERSION = /^kill:[a-f0-9]{64}$/;
const OPAQUE_CREDENTIAL = /^secret-ref:[A-Za-z0-9][A-Za-z0-9._:@/-]{2,190}$/;
const SCENARIOS = ["ack_only", "ambiguous", "failed", "matched", "source_unavailable", "version_mismatch"] as const;
const REMOTE_FINALITIES = ["ACKNOWLEDGED", "AMBIGUITY_EXHAUSTED", "BLOCKED", "REMOTE_REVOKE_FAILED", "REQUESTED", "RECONCILING", "REVOKED", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"] as const;
const LOCAL_DISPOSITIONS = ["ERASURE_AUTHORIZED_NO_EFFECT", "RETAINED"] as const;
const RECOVERY_STATES = ["FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT", "NORMAL"] as const;

export type ConnectorRevocationScenario = typeof SCENARIOS[number];
export type ConnectorRemoteFinality = typeof REMOTE_FINALITIES[number];
export type ConnectorLocalCredentialDisposition = typeof LOCAL_DISPOSITIONS[number];
export type ConnectorRecoveryState = typeof RECOVERY_STATES[number];

export type ConnectorRevocationRequestV1 = {
  binding: ConnectorBindingV1;
  contractVersion: typeof CONNECTOR_REVOCATION_REQUEST_VERSION;
  credentialHandle: {
    contractVersion: typeof CONNECTOR_CREDENTIAL_HANDLE_VERSION;
    reference: string;
    version: string;
  };
  expectedPriorReceiptId: string | null;
  operation: {
    kind: "AUTHORIZE_FORWARD_RECOVERY_ERASURE" | "REQUEST_REMOTE_REVOCATION";
    scenario: ConnectorRevocationScenario;
  };
  operationKey: string;
  payloadDigest: string;
  providerAccountRef: string;
};

export type ConnectorRevocationReceiptV1 = {
  acknowledgement: {
    providerAcknowledgementRef: string | null;
    sourceReadbackRef: string | null;
  };
  actor: {
    humanActorId: string;
    humanAuthenticationRef: string;
    requestActorClass: "service";
    requestActorId: string;
  };
  binding: {
    bindingContractVersion: typeof CORE_CONTRACT_VERSIONS.connectorBinding;
    bindingId: string;
    connectorProvider: ConnectorBindingV1["provider"];
    credentialHandle: ConnectorRevocationRequestV1["credentialHandle"];
    providerAccountRef: string;
  };
  commandReceiptRef: string;
  containmentKillVersion: string;
  contractVersion: typeof CONNECTOR_REVOCATION_RECEIPT_VERSION;
  localCredentialDisposition: ConnectorLocalCredentialDisposition;
  normalKillVersion: string;
  operation: {
    kind: ConnectorRevocationRequestV1["operation"]["kind"];
    key: string;
    payloadDigest: string;
  };
  priorReceiptId: string | null;
  receiptDigest: string;
  receiptId: string;
  reconciliation: {
    reconciliationRef: string | null;
    result: "AMBIGUOUS" | "MATCHED" | "NOT_ATTEMPTED" | "NOT_FOUND" | "PENDING" | "SOURCE_UNAVAILABLE" | "VERSION_MISMATCH";
  };
  recordedAt: string;
  recoveryState: ConnectorRecoveryState;
  remoteFinality: ConnectorRemoteFinality;
  tenantId: string;
  zeroEffect: true;
};

export class ConnectorRevocationContractError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ConnectorRevocationContractError";
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectorRevocationContractError("INVALID_REQUEST", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[], field: string) {
  const row = object(value, field);
  if (Object.keys(row).sort().join("|") !== [...keys].sort().join("|")) {
    throw new ConnectorRevocationContractError("FIELD_SET_MISMATCH", `${field} fields must match the exact v1 contract.`);
  }
  return row;
}

function token(value: unknown, field: string, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || !ID.test(value.trim())) {
    throw new ConnectorRevocationContractError("INVALID_REQUEST", `${field} must be a bounded stable identifier.`);
  }
  return value.trim();
}

function nullableToken(value: unknown, field: string) {
  return value === null ? null : token(value, field);
}

function digest(value: unknown, field: string) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new ConnectorRevocationContractError("INVALID_REQUEST", `${field} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function timestamp(value: unknown, field: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ConnectorRevocationContractError("INVALID_RECEIPT", `${field} must be an ISO timestamp.`);
  }
  return new Date(value).toISOString();
}

export function connectorRevocationPayloadDigest(input: Omit<ConnectorRevocationRequestV1, "payloadDigest">) {
  return sha256(input);
}

export function parseConnectorRevocationRequest(value: unknown): ConnectorRevocationRequestV1 {
  const row = exact(value, ["binding", "contractVersion", "credentialHandle", "expectedPriorReceiptId", "operation", "operationKey", "payloadDigest", "providerAccountRef"], "request");
  if (row.contractVersion !== CONNECTOR_REVOCATION_REQUEST_VERSION) {
    throw new ConnectorRevocationContractError("WRONG_VERSION", `contractVersion must be ${CONNECTOR_REVOCATION_REQUEST_VERSION}.`);
  }
  const binding = parseConnectorBindingV1(row.binding);
  if (binding.status !== "BOUND") {
    throw new ConnectorRevocationContractError("BINDING_STATE_DENIED", "Revocation accepts only an exact BOUND ConnectorBinding/v1.", 409);
  }
  const credential = exact(row.credentialHandle, ["contractVersion", "reference", "version"], "credentialHandle");
  if (credential.contractVersion !== CONNECTOR_CREDENTIAL_HANDLE_VERSION) {
    throw new ConnectorRevocationContractError("WRONG_VERSION", `credentialHandle.contractVersion must be ${CONNECTOR_CREDENTIAL_HANDLE_VERSION}.`);
  }
  const reference = token(credential.reference, "credentialHandle.reference", 200);
  if (!OPAQUE_CREDENTIAL.test(reference) || reference !== binding.credentialReference) {
    throw new ConnectorRevocationContractError("CREDENTIAL_HANDLE_MISMATCH", "The versioned opaque credential handle must exactly match ConnectorBinding/v1; secret values are forbidden.", 409);
  }
  const credentialHandle = {
    contractVersion: CONNECTOR_CREDENTIAL_HANDLE_VERSION,
    reference,
    version: token(credential.version, "credentialHandle.version", 200),
  };
  const operationRow = exact(row.operation, ["kind", "scenario"], "operation");
  if (operationRow.kind !== "REQUEST_REMOTE_REVOCATION" && operationRow.kind !== "AUTHORIZE_FORWARD_RECOVERY_ERASURE") {
    throw new ConnectorRevocationContractError("OPERATION_DENIED", "operation.kind is not admitted.");
  }
  if (!(SCENARIOS as readonly unknown[]).includes(operationRow.scenario)) {
    throw new ConnectorRevocationContractError("SCENARIO_DENIED", "Only deterministic emulator scenarios are admitted.");
  }
  if (operationRow.kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE" && row.expectedPriorReceiptId === null) {
    throw new ConnectorRevocationContractError("PRIOR_RECEIPT_REQUIRED", "Forward recovery requires an exact prior receipt.", 409);
  }
  if (operationRow.kind === "REQUEST_REMOTE_REVOCATION" && row.expectedPriorReceiptId !== null) {
    throw new ConnectorRevocationContractError("PRIOR_RECEIPT_DENIED", "The initial remote revocation request cannot select a prior receipt.", 409);
  }
  const expectedPriorReceiptId = row.expectedPriorReceiptId === null ? null : token(row.expectedPriorReceiptId, "expectedPriorReceiptId");
  if (expectedPriorReceiptId !== null && !RECEIPT_REF.test(expectedPriorReceiptId)) {
    throw new ConnectorRevocationContractError("PRIOR_RECEIPT_INVALID", "expectedPriorReceiptId is invalid.");
  }
  const parsedWithoutDigest = {
    binding,
    contractVersion: CONNECTOR_REVOCATION_REQUEST_VERSION,
    credentialHandle,
    expectedPriorReceiptId,
    operation: {
      kind: operationRow.kind as ConnectorRevocationRequestV1["operation"]["kind"],
      scenario: operationRow.scenario as ConnectorRevocationScenario,
    },
    operationKey: token(row.operationKey, "operationKey"),
    providerAccountRef: token(row.providerAccountRef, "providerAccountRef"),
  };
  const payloadDigest = digest(row.payloadDigest, "payloadDigest");
  if (payloadDigest !== connectorRevocationPayloadDigest(parsedWithoutDigest)) {
    throw new ConnectorRevocationContractError("PAYLOAD_DIGEST_MISMATCH", "payloadDigest must bind the exact revocation request.", 409);
  }
  return Object.freeze({ ...parsedWithoutDigest, payloadDigest });
}

export function connectorRevocationReceiptDigest(receipt: Omit<ConnectorRevocationReceiptV1, "receiptDigest" | "receiptId">) {
  return sha256(receipt);
}

export function issueConnectorRevocationReceipt(input: Omit<ConnectorRevocationReceiptV1, "contractVersion" | "receiptDigest" | "receiptId" | "zeroEffect">) {
  const {
    contractVersion: _contractVersion,
    receiptDigest: _receiptDigest,
    receiptId: _receiptId,
    zeroEffect: _zeroEffect,
    ...payload
  } = input as Omit<ConnectorRevocationReceiptV1, "contractVersion" | "receiptDigest" | "receiptId" | "zeroEffect">
    & Partial<Pick<ConnectorRevocationReceiptV1, "contractVersion" | "receiptDigest" | "receiptId" | "zeroEffect">>;
  void _contractVersion;
  void _receiptDigest;
  void _receiptId;
  void _zeroEffect;
  const unsigned = {
    ...payload,
    contractVersion: CONNECTOR_REVOCATION_RECEIPT_VERSION,
    zeroEffect: true as const,
  };
  const receiptDigest = connectorRevocationReceiptDigest(unsigned);
  return parseConnectorRevocationReceipt({ ...unsigned, receiptDigest, receiptId: `connector-revocation-receipt:${receiptDigest}` });
}

export function parseConnectorRevocationReceipt(value: unknown): ConnectorRevocationReceiptV1 {
  const row = exact(value, ["acknowledgement", "actor", "binding", "commandReceiptRef", "containmentKillVersion", "contractVersion", "localCredentialDisposition", "normalKillVersion", "operation", "priorReceiptId", "receiptDigest", "receiptId", "reconciliation", "recordedAt", "recoveryState", "remoteFinality", "tenantId", "zeroEffect"], "receipt");
  if (row.contractVersion !== CONNECTOR_REVOCATION_RECEIPT_VERSION || row.zeroEffect !== true) {
    throw new ConnectorRevocationContractError("WRONG_VERSION", "Receipt version or zero-effect marker is invalid.");
  }
  const acknowledgement = exact(row.acknowledgement, ["providerAcknowledgementRef", "sourceReadbackRef"], "receipt.acknowledgement");
  const actor = exact(row.actor, ["humanActorId", "humanAuthenticationRef", "requestActorClass", "requestActorId"], "receipt.actor");
  const binding = exact(row.binding, ["bindingContractVersion", "bindingId", "connectorProvider", "credentialHandle", "providerAccountRef"], "receipt.binding");
  const credential = exact(binding.credentialHandle, ["contractVersion", "reference", "version"], "receipt.binding.credentialHandle");
  const operation = exact(row.operation, ["key", "kind", "payloadDigest"], "receipt.operation");
  const reconciliation = exact(row.reconciliation, ["reconciliationRef", "result"], "receipt.reconciliation");
  if (actor.requestActorClass !== "service" || binding.bindingContractVersion !== CORE_CONTRACT_VERSIONS.connectorBinding
    || credential.contractVersion !== CONNECTOR_CREDENTIAL_HANDLE_VERSION
    || !["GOOGLE_WORKSPACE", "MICROSOFT_365", "QUICKBOOKS_ONLINE"].includes(String(binding.connectorProvider))
    || !(REMOTE_FINALITIES as readonly unknown[]).includes(row.remoteFinality)
    || !(LOCAL_DISPOSITIONS as readonly unknown[]).includes(row.localCredentialDisposition)
    || !(RECOVERY_STATES as readonly unknown[]).includes(row.recoveryState)
    || (operation.kind !== "REQUEST_REMOTE_REVOCATION" && operation.kind !== "AUTHORIZE_FORWARD_RECOVERY_ERASURE")
    || !["AMBIGUOUS", "MATCHED", "NOT_ATTEMPTED", "NOT_FOUND", "PENDING", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"].includes(String(reconciliation.result))) {
    throw new ConnectorRevocationContractError("INVALID_RECEIPT", "Receipt enums or versions are invalid.");
  }
  const parsed = {
    acknowledgement: {
      providerAcknowledgementRef: nullableToken(acknowledgement.providerAcknowledgementRef, "providerAcknowledgementRef"),
      sourceReadbackRef: nullableToken(acknowledgement.sourceReadbackRef, "sourceReadbackRef"),
    },
    actor: {
      humanActorId: token(actor.humanActorId, "humanActorId"),
      humanAuthenticationRef: token(actor.humanAuthenticationRef, "humanAuthenticationRef"),
      requestActorClass: "service" as const,
      requestActorId: token(actor.requestActorId, "requestActorId"),
    },
    binding: {
      bindingContractVersion: CORE_CONTRACT_VERSIONS.connectorBinding,
      bindingId: token(binding.bindingId, "bindingId"),
      connectorProvider: binding.connectorProvider as ConnectorBindingV1["provider"],
      credentialHandle: {
        contractVersion: CONNECTOR_CREDENTIAL_HANDLE_VERSION,
        reference: token(credential.reference, "credentialHandle.reference", 200),
        version: token(credential.version, "credentialHandle.version", 200),
      },
      providerAccountRef: token(binding.providerAccountRef, "providerAccountRef"),
    },
    commandReceiptRef: token(row.commandReceiptRef, "commandReceiptRef"),
    containmentKillVersion: token(row.containmentKillVersion, "containmentKillVersion"),
    contractVersion: CONNECTOR_REVOCATION_RECEIPT_VERSION,
    localCredentialDisposition: row.localCredentialDisposition as ConnectorLocalCredentialDisposition,
    normalKillVersion: token(row.normalKillVersion, "normalKillVersion"),
    operation: {
      kind: operation.kind as ConnectorRevocationRequestV1["operation"]["kind"],
      key: token(operation.key, "operation.key"),
      payloadDigest: digest(operation.payloadDigest, "operation.payloadDigest"),
    },
    priorReceiptId: nullableToken(row.priorReceiptId, "priorReceiptId"),
    receiptDigest: digest(row.receiptDigest, "receiptDigest"),
    receiptId: token(row.receiptId, "receiptId"),
    reconciliation: {
      reconciliationRef: nullableToken(reconciliation.reconciliationRef, "reconciliationRef"),
      result: reconciliation.result as ConnectorRevocationReceiptV1["reconciliation"]["result"],
    },
    recordedAt: timestamp(row.recordedAt, "recordedAt"),
    recoveryState: row.recoveryState as ConnectorRecoveryState,
    remoteFinality: row.remoteFinality as ConnectorRemoteFinality,
    tenantId: token(row.tenantId, "tenantId"),
    zeroEffect: true as const,
  };
  if (!OPAQUE_CREDENTIAL.test(parsed.binding.credentialHandle.reference)
    || !KILL_VERSION.test(parsed.containmentKillVersion) || !KILL_VERSION.test(parsed.normalKillVersion)
    || !RECEIPT_REF.test(parsed.receiptId)
    || (parsed.priorReceiptId !== null && !RECEIPT_REF.test(parsed.priorReceiptId))) {
    throw new ConnectorRevocationContractError("INVALID_RECEIPT", "Receipt references are invalid.");
  }
  if (parsed.remoteFinality === "REVOKED" && (!parsed.acknowledgement.sourceReadbackRef || parsed.reconciliation.result !== "MATCHED")) {
    throw new ConnectorRevocationContractError("REMOTE_FINALITY_UNPROVEN", "REVOKED requires matching exact source readback.", 409);
  }
  if (parsed.remoteFinality === "ACKNOWLEDGED" && (!parsed.acknowledgement.providerAcknowledgementRef || parsed.acknowledgement.sourceReadbackRef)) {
    throw new ConnectorRevocationContractError("ACK_FINALITY_INVALID", "ACKNOWLEDGED is pre-readback only.", 409);
  }
  if (parsed.localCredentialDisposition === "ERASURE_AUTHORIZED_NO_EFFECT"
    && parsed.remoteFinality !== "REVOKED"
    && parsed.recoveryState !== "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT") {
    throw new ConnectorRevocationContractError("ERASURE_AUTHORITY_MISSING", "Local erasure authorization requires remote confirmation or genuine-human forward recovery.", 409);
  }
  if (parsed.recoveryState === "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT"
    && (parsed.operation.kind !== "AUTHORIZE_FORWARD_RECOVERY_ERASURE" || parsed.priorReceiptId === null)) {
    throw new ConnectorRevocationContractError("FORWARD_RECOVERY_INVALID", "Forward recovery must append to an exact prior receipt.", 409);
  }
  const { receiptDigest, receiptId, ...unsigned } = parsed;
  const expectedDigest = connectorRevocationReceiptDigest(unsigned);
  if (receiptDigest !== expectedDigest || receiptId !== `connector-revocation-receipt:${expectedDigest}`) {
    throw new ConnectorRevocationContractError("RECEIPT_DIGEST_MISMATCH", "Receipt digest does not content-bind the exact packet.", 409);
  }
  return Object.freeze(parsed);
}

export function revocationReservation(tenantId: string, request: ConnectorRevocationRequestV1) {
  const reservation = { operationKey: request.operationKey, tenantId };
  return {
    commandId: `connector-revocation-command:${sha256(reservation)}`,
    idempotencyKey: `connector-revocation:${sha256(reservation)}`,
    objectVersion: `connector-revocation:${request.binding.bindingId}@${request.payloadDigest}`,
  };
}

export function assertRevocationTupleMatches(prior: ConnectorRevocationReceiptV1, tenantId: string, request: ConnectorRevocationRequestV1) {
  if (prior.tenantId !== tenantId
    || prior.binding.bindingId !== request.binding.bindingId
    || prior.binding.connectorProvider !== request.binding.provider
    || prior.binding.providerAccountRef !== request.providerAccountRef
    || prior.binding.credentialHandle.reference !== request.credentialHandle.reference
    || prior.binding.credentialHandle.version !== request.credentialHandle.version) {
    throw new ConnectorRevocationContractError("REVOCATION_TUPLE_MISMATCH", "Forward recovery cannot change tenant, binding, provider account, or credential-handle version.", 409);
  }
}

export function classifyRevocationOutcome(input: {
  lastErrorCode: string | null;
  providerAcknowledgementRef: string | null;
  reconciliationRef: string | null;
  reconciliationResult: string | null;
  sourceReadbackRef: string | null;
  state: string;
}): Pick<ConnectorRevocationReceiptV1, "acknowledgement" | "localCredentialDisposition" | "reconciliation" | "recoveryState" | "remoteFinality"> {
  const common = { localCredentialDisposition: "RETAINED" as const, recoveryState: "NORMAL" as const };
  if (input.state === "SOURCE_CONFIRMED" && input.reconciliationResult === "MATCHED" && input.sourceReadbackRef) {
    return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: input.sourceReadbackRef }, reconciliation: { reconciliationRef: input.reconciliationRef, result: "MATCHED" }, remoteFinality: "REVOKED" };
  }
  if (input.reconciliationResult === "VERSION_MISMATCH" || input.lastErrorCode === "SOURCE_VERSION_MISMATCH") {
    return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: input.sourceReadbackRef }, reconciliation: { reconciliationRef: input.reconciliationRef, result: "VERSION_MISMATCH" }, remoteFinality: "VERSION_MISMATCH" };
  }
  if (input.state === "BLOCKED") {
    const exhausted = input.lastErrorCode === "RECONCILIATION_BUDGET_EXHAUSTED";
    return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: exhausted ? "AMBIGUOUS" : "PENDING" }, remoteFinality: exhausted ? "AMBIGUITY_EXHAUSTED" : "BLOCKED" };
  }
  if (input.state === "PROVIDER_ACKNOWLEDGED" && input.providerAcknowledgementRef) {
    return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: input.reconciliationRef ? "PENDING" : "NOT_ATTEMPTED" }, remoteFinality: input.reconciliationRef ? "RECONCILING" : "ACKNOWLEDGED" };
  }
  if (input.reconciliationRef && input.reconciliationResult === "PENDING") {
    return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: "PENDING" }, remoteFinality: "RECONCILING" };
  }
  if (input.lastErrorCode === "CONNECTOR_REVOCATION_SOURCE_UNAVAILABLE") {
    return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: "SOURCE_UNAVAILABLE" }, remoteFinality: "SOURCE_UNAVAILABLE" };
  }
  return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: input.reconciliationResult === "NOT_FOUND" ? "NOT_FOUND" : "NOT_ATTEMPTED" }, remoteFinality: "REMOTE_REVOKE_FAILED" };
}
