import { createHash } from "node:crypto";

import type { ConnectorBindingV1 } from "@/modules/luzione-core-contracts/contracts";
import { parseConnectorBindingV1 } from "@/modules/luzione-core-contracts/consumerSdk";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import type { EffectKillState } from "@/modules/effect-admission/contracts";

export const CONNECTOR_REVOCATION_REQUEST_V2 = "ConnectorRevocationRequest/v2" as const;
export const CONNECTOR_REVOCATION_RECEIPT_V2 = "ConnectorRevocationReceipt/v2" as const;
export const CONNECTOR_CREDENTIAL_HANDLE_V2 = "ConnectorCredentialHandle/v2" as const;
export const CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1 = "CanonicalConnectorBindingResolution/v1" as const;
export const CONNECTOR_REVOCATION_POLICY_V2 = "CONNECTOR-REVOCATION-L1-CORRECTION-01/policy-v2" as const;
export const CONNECTOR_REVOCATION_V2_DESTINATION = "sandbox.connector-revocation" as const;
export const CONNECTOR_REVOCATION_V2_EMULATOR_PROVIDER = "luzione-connector-revocation-emulator" as const;
export const CONNECTOR_REVOCATION_V2_EMULATOR_BINDING = "credential-binding:none:connector-revocation-emulator/v1" as const;

const STRICT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RECEIPT_REF = /^connector-revocation-receipt:[a-f0-9]{64}$/;
const KILL_VERSION = /^kill:[a-f0-9]{64}$/;
const OPAQUE_CREDENTIAL = /^secret-ref:[A-Za-z0-9][A-Za-z0-9._:@/-]{2,178}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PROVIDERS = ["GOOGLE_WORKSPACE", "MICROSOFT_365", "QUICKBOOKS_ONLINE"] as const;
const SCENARIOS = ["ack_only", "ambiguous", "failed", "matched", "source_unavailable", "version_mismatch"] as const;
const REMOTE_FINALITIES = ["ACKNOWLEDGED", "AMBIGUITY_EXHAUSTED", "BLOCKED", "REMOTE_REVOKE_FAILED", "REQUESTED", "RECONCILING", "REVOKED", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"] as const;
const LOCAL_DISPOSITIONS = ["ERASURE_AUTHORIZED_NO_EFFECT", "RETAINED"] as const;
const RECOVERY_STATES = ["FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT", "NORMAL"] as const;
const RECONCILIATION_RESULTS = ["AMBIGUOUS", "MATCHED", "NOT_ATTEMPTED", "NOT_FOUND", "PENDING", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"] as const;

export type ConnectorProvider = typeof PROVIDERS[number];
export type ConnectorRevocationScenarioV2 = typeof SCENARIOS[number];
export type ConnectorRemoteFinalityV2 = typeof REMOTE_FINALITIES[number];
export type ConnectorLocalCredentialDispositionV2 = typeof LOCAL_DISPOSITIONS[number];
export type ConnectorRecoveryStateV2 = typeof RECOVERY_STATES[number];

export type ConnectorCredentialHandleV2 = {
  bindingId: string;
  contractVersion: typeof CONNECTOR_CREDENTIAL_HANDLE_V2;
  generation: number;
  handleDigest: string;
  provider: ConnectorProvider;
  providerAccountRef: string;
  reference: string;
  tenantId: string;
  version: string;
};

export type CanonicalConnectorBindingResolutionV1 = {
  binding: ConnectorBindingV1;
  bindingVersion: string;
  contractVersion: typeof CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1;
  credentialHandle: ConnectorCredentialHandleV2;
  current: true;
  destination: string;
  ownerReadbackRef: string;
  providerAccountRef: string;
  resolutionDigest: string;
  resolvedAt: string;
  tenantId: string;
};

export type ConnectorRevocationSelectorV2 = {
  bindingId: string;
  expectedBindingVersion: string;
  expectedCredentialGeneration: number;
  expectedCredentialVersion: string;
  expectedDestination: string;
  expectedProvider: ConnectorProvider;
  expectedProviderAccountRef: string;
};

export type ConnectorRevocationRequestV2 = {
  contractVersion: typeof CONNECTOR_REVOCATION_REQUEST_V2;
  expectedPriorReceiptId: string | null;
  operation: {
    kind: "AUTHORIZE_FORWARD_RECOVERY_ERASURE" | "REQUEST_REMOTE_REVOCATION";
    scenario: ConnectorRevocationScenarioV2;
  };
  operationKey: string;
  payloadDigest: string;
  selector: ConnectorRevocationSelectorV2;
};

export type RevocationKillPairV2 = {
  containmentKillVersion: string;
  normalKillVersion: string;
};

export type ConnectorRevocationReceiptV2 = {
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
  bindingResolution: CanonicalConnectorBindingResolutionV1;
  commandReceiptRef: string;
  contractVersion: typeof CONNECTOR_REVOCATION_RECEIPT_V2;
  killEvidence: {
    accepted: RevocationKillPairV2;
    beforeCredentialHold: RevocationKillPairV2 | null;
    beforeExecuteOrDisposition: RevocationKillPairV2 | null;
  };
  localCredentialDisposition: ConnectorLocalCredentialDispositionV2;
  operation: {
    key: string;
    kind: ConnectorRevocationRequestV2["operation"]["kind"];
    payloadDigest: string;
    selector: ConnectorRevocationSelectorV2;
  };
  priorReceiptId: string | null;
  receiptDigest: string;
  receiptId: string;
  reconciliation: {
    reconciliationRef: string | null;
    result: typeof RECONCILIATION_RESULTS[number];
  };
  recordedAt: string;
  recoveryState: ConnectorRecoveryStateV2;
  remoteFinality: ConnectorRemoteFinalityV2;
  tenantId: string;
  zeroEffect: true;
};

export class ConnectorRevocationV2Error extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ConnectorRevocationV2Error";
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectorRevocationV2Error("INVALID_PACKET", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[], field: string) {
  const row = record(value, field);
  if (Object.keys(row).sort().join("|") !== [...keys].sort().join("|")) {
    throw new ConnectorRevocationV2Error("FIELD_SET_MISMATCH", `${field} fields must match the exact v2 contract.`);
  }
  return row;
}

function rejectNormalizedStrings(value: unknown, field: string): void {
  if (typeof value === "string") {
    if (value !== value.trim()) {
      throw new ConnectorRevocationV2Error("RAW_CANONICAL_COLLISION", `${field} cannot contain leading or trailing whitespace.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectNormalizedStrings(item, `${field}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      rejectNormalizedStrings(child, `${field}.${key}`);
    }
  }
}

function token(value: unknown, field: string, pattern = STRICT_ID) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ConnectorRevocationV2Error("INVALID_PACKET", `${field} must be an exact bounded raw identifier.`);
  }
  return value;
}

function uuid(value: unknown, field: string) {
  return token(value, field, UUID);
}

function digest(value: unknown, field: string) {
  return token(value, field, DIGEST);
}

function timestamp(value: unknown, field: string) {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new ConnectorRevocationV2Error("INVALID_PACKET", `${field} must be an exact UTC millisecond timestamp.`);
  }
  return value;
}

function nullableToken(value: unknown, field: string) {
  return value === null ? null : token(value, field);
}

function enumeration<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ConnectorRevocationV2Error("INVALID_PACKET", `${field} is not admitted.`);
  }
  return value as T[number];
}

function generation(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2147483647) {
    throw new ConnectorRevocationV2Error("INVALID_PACKET", `${field} must be a positive 32-bit generation.`);
  }
  return Number(value);
}

function parseSelector(value: unknown, field = "selector"): ConnectorRevocationSelectorV2 {
  const row = exact(value, ["bindingId", "expectedBindingVersion", "expectedCredentialGeneration", "expectedCredentialVersion", "expectedDestination", "expectedProvider", "expectedProviderAccountRef"], field);
  rejectNormalizedStrings(row, field);
  return Object.freeze({
    bindingId: uuid(row.bindingId, `${field}.bindingId`),
    expectedBindingVersion: token(row.expectedBindingVersion, `${field}.expectedBindingVersion`),
    expectedCredentialGeneration: generation(row.expectedCredentialGeneration, `${field}.expectedCredentialGeneration`),
    expectedCredentialVersion: token(row.expectedCredentialVersion, `${field}.expectedCredentialVersion`),
    expectedDestination: token(row.expectedDestination, `${field}.expectedDestination`),
    expectedProvider: enumeration(row.expectedProvider, PROVIDERS, `${field}.expectedProvider`),
    expectedProviderAccountRef: token(row.expectedProviderAccountRef, `${field}.expectedProviderAccountRef`),
  });
}

export function connectorCredentialHandleDigest(input: Omit<ConnectorCredentialHandleV2, "handleDigest">) {
  return sha256(input);
}

export function issueConnectorCredentialHandleV2(input: Omit<ConnectorCredentialHandleV2, "contractVersion" | "handleDigest">) {
  const unsigned = { ...input, contractVersion: CONNECTOR_CREDENTIAL_HANDLE_V2 } as const;
  return parseConnectorCredentialHandleV2({ ...unsigned, handleDigest: connectorCredentialHandleDigest(unsigned) });
}

export function parseConnectorCredentialHandleV2(value: unknown): ConnectorCredentialHandleV2 {
  const row = exact(value, ["bindingId", "contractVersion", "generation", "handleDigest", "provider", "providerAccountRef", "reference", "tenantId", "version"], "credentialHandle");
  rejectNormalizedStrings(row, "credentialHandle");
  if (row.contractVersion !== CONNECTOR_CREDENTIAL_HANDLE_V2) throw new ConnectorRevocationV2Error("WRONG_VERSION", `credentialHandle.contractVersion must be ${CONNECTOR_CREDENTIAL_HANDLE_V2}.`);
  const parsed = {
    bindingId: uuid(row.bindingId, "credentialHandle.bindingId"),
    contractVersion: CONNECTOR_CREDENTIAL_HANDLE_V2,
    generation: generation(row.generation, "credentialHandle.generation"),
    handleDigest: digest(row.handleDigest, "credentialHandle.handleDigest"),
    provider: enumeration(row.provider, PROVIDERS, "credentialHandle.provider"),
    providerAccountRef: token(row.providerAccountRef, "credentialHandle.providerAccountRef"),
    reference: token(row.reference, "credentialHandle.reference", OPAQUE_CREDENTIAL),
    tenantId: token(row.tenantId, "credentialHandle.tenantId"),
    version: token(row.version, "credentialHandle.version"),
  };
  const { handleDigest, ...unsigned } = parsed;
  if (handleDigest !== connectorCredentialHandleDigest(unsigned)) {
    throw new ConnectorRevocationV2Error("CREDENTIAL_HANDLE_DIGEST_MISMATCH", "Credential handle digest must bind the exact raw standalone handle.", 409);
  }
  return Object.freeze(parsed);
}

export function canonicalConnectorBindingResolutionDigest(input: Omit<CanonicalConnectorBindingResolutionV1, "resolutionDigest">) {
  return sha256(input);
}

export function issueCanonicalConnectorBindingResolutionV1(input: Omit<CanonicalConnectorBindingResolutionV1, "contractVersion" | "resolutionDigest">) {
  const unsigned = { ...input, contractVersion: CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1 } as const;
  return parseCanonicalConnectorBindingResolutionV1({ ...unsigned, resolutionDigest: canonicalConnectorBindingResolutionDigest(unsigned) });
}

export function parseCanonicalConnectorBindingResolutionV1(value: unknown): CanonicalConnectorBindingResolutionV1 {
  const row = exact(value, ["binding", "bindingVersion", "contractVersion", "credentialHandle", "current", "destination", "ownerReadbackRef", "providerAccountRef", "resolutionDigest", "resolvedAt", "tenantId"], "bindingResolution");
  rejectNormalizedStrings(row, "bindingResolution");
  if (row.contractVersion !== CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1 || row.current !== true) {
    throw new ConnectorRevocationV2Error("BINDING_RESOLUTION_INVALID", "Resolution must be the exact current canonical contract.", 409);
  }
  const binding = parseConnectorBindingV1(row.binding);
  const credentialHandle = parseConnectorCredentialHandleV2(row.credentialHandle);
  const parsed = {
    binding,
    bindingVersion: token(row.bindingVersion, "bindingResolution.bindingVersion"),
    contractVersion: CANONICAL_CONNECTOR_BINDING_RESOLUTION_V1,
    credentialHandle,
    current: true as const,
    destination: token(row.destination, "bindingResolution.destination"),
    ownerReadbackRef: token(row.ownerReadbackRef, "bindingResolution.ownerReadbackRef"),
    providerAccountRef: token(row.providerAccountRef, "bindingResolution.providerAccountRef"),
    resolutionDigest: digest(row.resolutionDigest, "bindingResolution.resolutionDigest"),
    resolvedAt: timestamp(row.resolvedAt, "bindingResolution.resolvedAt"),
    tenantId: token(row.tenantId, "bindingResolution.tenantId"),
  };
  if (binding.status !== "BOUND" || binding.revocation.revocationRef !== null || binding.revocation.revokedAt !== null) {
    throw new ConnectorRevocationV2Error("BINDING_NOT_CURRENT_BOUND", "Canonical owner resolution must be current, BOUND and unrevoked.", 409);
  }
  if (binding.tenantId !== parsed.tenantId || binding.bindingId !== credentialHandle.bindingId
    || binding.credentialReference !== credentialHandle.reference || binding.provider !== credentialHandle.provider
    || credentialHandle.tenantId !== parsed.tenantId || credentialHandle.providerAccountRef !== parsed.providerAccountRef) {
    throw new ConnectorRevocationV2Error("BINDING_RESOLUTION_TUPLE_MISMATCH", "Canonical binding, account and standalone credential handle must resolve to one exact tuple.", 409);
  }
  const { resolutionDigest, ...unsigned } = parsed;
  if (resolutionDigest !== canonicalConnectorBindingResolutionDigest(unsigned)) {
    throw new ConnectorRevocationV2Error("BINDING_RESOLUTION_DIGEST_MISMATCH", "Resolution digest must bind exact server-owned connector truth.", 409);
  }
  return Object.freeze(parsed);
}

export function connectorRevocationPayloadDigestV2(input: Omit<ConnectorRevocationRequestV2, "payloadDigest">) {
  return sha256(input);
}

export function issueConnectorRevocationRequestV2(input: Omit<ConnectorRevocationRequestV2, "contractVersion" | "payloadDigest">) {
  const unsigned = { ...input, contractVersion: CONNECTOR_REVOCATION_REQUEST_V2 } as const;
  return parseConnectorRevocationRequestV2({ ...unsigned, payloadDigest: connectorRevocationPayloadDigestV2(unsigned) });
}

export function parseConnectorRevocationRequestV2(value: unknown): ConnectorRevocationRequestV2 {
  const row = exact(value, ["contractVersion", "expectedPriorReceiptId", "operation", "operationKey", "payloadDigest", "selector"], "request");
  rejectNormalizedStrings(row, "request");
  if (row.contractVersion !== CONNECTOR_REVOCATION_REQUEST_V2) throw new ConnectorRevocationV2Error("WRONG_VERSION", `contractVersion must be ${CONNECTOR_REVOCATION_REQUEST_V2}.`);
  const operation = exact(row.operation, ["kind", "scenario"], "request.operation");
  const kind = enumeration(operation.kind, ["AUTHORIZE_FORWARD_RECOVERY_ERASURE", "REQUEST_REMOTE_REVOCATION"] as const, "request.operation.kind");
  const expectedPriorReceiptId = row.expectedPriorReceiptId === null ? null : token(row.expectedPriorReceiptId, "request.expectedPriorReceiptId", RECEIPT_REF);
  if (kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE" && expectedPriorReceiptId === null) throw new ConnectorRevocationV2Error("PRIOR_RECEIPT_REQUIRED", "Forward recovery requires an exact prior receipt.", 409);
  if (kind === "REQUEST_REMOTE_REVOCATION" && expectedPriorReceiptId !== null) throw new ConnectorRevocationV2Error("PRIOR_RECEIPT_DENIED", "Initial revocation cannot select a prior receipt.", 409);
  const parsedWithoutDigest = {
    contractVersion: CONNECTOR_REVOCATION_REQUEST_V2,
    expectedPriorReceiptId,
    operation: { kind, scenario: enumeration(operation.scenario, SCENARIOS, "request.operation.scenario") },
    operationKey: token(row.operationKey, "request.operationKey"),
    selector: parseSelector(row.selector),
  };
  const payloadDigest = digest(row.payloadDigest, "request.payloadDigest");
  if (payloadDigest !== connectorRevocationPayloadDigestV2(parsedWithoutDigest)) {
    throw new ConnectorRevocationV2Error("PAYLOAD_DIGEST_MISMATCH", "payloadDigest must bind the exact unnormalized v2 request.", 409);
  }
  return Object.freeze({ ...parsedWithoutDigest, payloadDigest });
}

export function parseConnectorRevocationRawBodyV2(rawBody: string) {
  if (!rawBody || rawBody !== rawBody.trim()) {
    throw new ConnectorRevocationV2Error("RAW_CANONICAL_COLLISION", "Request JSON cannot have leading or trailing transport whitespace.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch {
    throw new ConnectorRevocationV2Error("INVALID_JSON", "Request body must be valid JSON.");
  }
  return { rawBodyDigest: connectorRevocationRawBodyDigestV2(rawBody), request: parseConnectorRevocationRequestV2(decoded) };
}

export function connectorRevocationRawBodyDigestV2(rawBody: string) {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function parseKillPair(value: unknown, field: string): RevocationKillPairV2 {
  const row = exact(value, ["containmentKillVersion", "normalKillVersion"], field);
  return Object.freeze({
    containmentKillVersion: token(row.containmentKillVersion, `${field}.containmentKillVersion`, KILL_VERSION),
    normalKillVersion: token(row.normalKillVersion, `${field}.normalKillVersion`, KILL_VERSION),
  });
}

export function connectorRevocationReceiptDigestV2(receipt: Omit<ConnectorRevocationReceiptV2, "receiptDigest" | "receiptId">) {
  return sha256(receipt);
}

export function issueConnectorRevocationReceiptV2(input: Omit<ConnectorRevocationReceiptV2, "contractVersion" | "receiptDigest" | "receiptId" | "zeroEffect">) {
  const unsigned = { ...input, contractVersion: CONNECTOR_REVOCATION_RECEIPT_V2, zeroEffect: true as const };
  const receiptDigest = connectorRevocationReceiptDigestV2(unsigned);
  return parseConnectorRevocationReceiptV2({ ...unsigned, receiptDigest, receiptId: `connector-revocation-receipt:${receiptDigest}` });
}

export function parseConnectorRevocationReceiptV2(value: unknown): ConnectorRevocationReceiptV2 {
  const row = exact(value, ["acknowledgement", "actor", "bindingResolution", "commandReceiptRef", "contractVersion", "killEvidence", "localCredentialDisposition", "operation", "priorReceiptId", "receiptDigest", "receiptId", "reconciliation", "recordedAt", "recoveryState", "remoteFinality", "tenantId", "zeroEffect"], "receipt");
  rejectNormalizedStrings(row, "receipt");
  if (row.contractVersion !== CONNECTOR_REVOCATION_RECEIPT_V2 || row.zeroEffect !== true) throw new ConnectorRevocationV2Error("WRONG_VERSION", "Receipt version or zero-effect marker is invalid.");
  const acknowledgement = exact(row.acknowledgement, ["providerAcknowledgementRef", "sourceReadbackRef"], "receipt.acknowledgement");
  const actor = exact(row.actor, ["humanActorId", "humanAuthenticationRef", "requestActorClass", "requestActorId"], "receipt.actor");
  if (actor.requestActorClass !== "service") throw new ConnectorRevocationV2Error("INVALID_RECEIPT", "Receipt actor class must be service.");
  const killEvidence = exact(row.killEvidence, ["accepted", "beforeCredentialHold", "beforeExecuteOrDisposition"], "receipt.killEvidence");
  const operation = exact(row.operation, ["key", "kind", "payloadDigest", "selector"], "receipt.operation");
  const reconciliation = exact(row.reconciliation, ["reconciliationRef", "result"], "receipt.reconciliation");
  const parsed = {
    acknowledgement: {
      providerAcknowledgementRef: nullableToken(acknowledgement.providerAcknowledgementRef, "receipt.acknowledgement.providerAcknowledgementRef"),
      sourceReadbackRef: nullableToken(acknowledgement.sourceReadbackRef, "receipt.acknowledgement.sourceReadbackRef"),
    },
    actor: {
      humanActorId: token(actor.humanActorId, "receipt.actor.humanActorId"),
      humanAuthenticationRef: token(actor.humanAuthenticationRef, "receipt.actor.humanAuthenticationRef"),
      requestActorClass: "service" as const,
      requestActorId: token(actor.requestActorId, "receipt.actor.requestActorId"),
    },
    bindingResolution: parseCanonicalConnectorBindingResolutionV1(row.bindingResolution),
    commandReceiptRef: token(row.commandReceiptRef, "receipt.commandReceiptRef"),
    contractVersion: CONNECTOR_REVOCATION_RECEIPT_V2,
    killEvidence: {
      accepted: parseKillPair(killEvidence.accepted, "receipt.killEvidence.accepted"),
      beforeCredentialHold: killEvidence.beforeCredentialHold === null ? null : parseKillPair(killEvidence.beforeCredentialHold, "receipt.killEvidence.beforeCredentialHold"),
      beforeExecuteOrDisposition: killEvidence.beforeExecuteOrDisposition === null ? null : parseKillPair(killEvidence.beforeExecuteOrDisposition, "receipt.killEvidence.beforeExecuteOrDisposition"),
    },
    localCredentialDisposition: enumeration(row.localCredentialDisposition, LOCAL_DISPOSITIONS, "receipt.localCredentialDisposition"),
    operation: {
      key: token(operation.key, "receipt.operation.key"),
      kind: enumeration(operation.kind, ["AUTHORIZE_FORWARD_RECOVERY_ERASURE", "REQUEST_REMOTE_REVOCATION"] as const, "receipt.operation.kind"),
      payloadDigest: digest(operation.payloadDigest, "receipt.operation.payloadDigest"),
      selector: parseSelector(operation.selector, "receipt.operation.selector"),
    },
    priorReceiptId: row.priorReceiptId === null ? null : token(row.priorReceiptId, "receipt.priorReceiptId", RECEIPT_REF),
    receiptDigest: digest(row.receiptDigest, "receipt.receiptDigest"),
    receiptId: token(row.receiptId, "receipt.receiptId", RECEIPT_REF),
    reconciliation: {
      reconciliationRef: nullableToken(reconciliation.reconciliationRef, "receipt.reconciliation.reconciliationRef"),
      result: enumeration(reconciliation.result, RECONCILIATION_RESULTS, "receipt.reconciliation.result"),
    },
    recordedAt: timestamp(row.recordedAt, "receipt.recordedAt"),
    recoveryState: enumeration(row.recoveryState, RECOVERY_STATES, "receipt.recoveryState"),
    remoteFinality: enumeration(row.remoteFinality, REMOTE_FINALITIES, "receipt.remoteFinality"),
    tenantId: token(row.tenantId, "receipt.tenantId"),
    zeroEffect: true as const,
  };
  if (parsed.tenantId !== parsed.bindingResolution.tenantId || parsed.operation.selector.bindingId !== parsed.bindingResolution.binding.bindingId) {
    throw new ConnectorRevocationV2Error("RECEIPT_OWNER_TUPLE_MISMATCH", "Receipt tenant and selector must match server-resolved owner truth.", 409);
  }
  if (parsed.remoteFinality === "REVOKED" && (!parsed.acknowledgement.sourceReadbackRef || parsed.reconciliation.result !== "MATCHED")) {
    throw new ConnectorRevocationV2Error("REMOTE_FINALITY_UNPROVEN", "REVOKED requires exact matching source readback.", 409);
  }
  if (parsed.remoteFinality === "ACKNOWLEDGED" && (!parsed.acknowledgement.providerAcknowledgementRef || parsed.acknowledgement.sourceReadbackRef)) {
    throw new ConnectorRevocationV2Error("ACK_FINALITY_INVALID", "ACKNOWLEDGED is pre-readback only.", 409);
  }
  if (parsed.localCredentialDisposition === "ERASURE_AUTHORIZED_NO_EFFECT" && parsed.remoteFinality !== "REVOKED" && parsed.recoveryState !== "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT") {
    throw new ConnectorRevocationV2Error("ERASURE_AUTHORITY_MISSING", "Credential disposition requires source confirmation or human forward recovery.", 409);
  }
  if (parsed.recoveryState === "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT" && (parsed.operation.kind !== "AUTHORIZE_FORWARD_RECOVERY_ERASURE" || parsed.priorReceiptId === null || parsed.killEvidence.beforeExecuteOrDisposition === null)) {
    throw new ConnectorRevocationV2Error("FORWARD_RECOVERY_INVALID", "Forward recovery must append and include the fresh pre-disposition kill pair.", 409);
  }
  const { receiptDigest, receiptId, ...unsigned } = parsed;
  const expected = connectorRevocationReceiptDigestV2(unsigned);
  if (receiptDigest !== expected || receiptId !== `connector-revocation-receipt:${expected}`) {
    throw new ConnectorRevocationV2Error("RECEIPT_DIGEST_MISMATCH", "Receipt digest must bind the exact raw v2 packet.", 409);
  }
  return Object.freeze(parsed);
}

export function assertSelectorMatchesCanonicalResolution(selector: ConnectorRevocationSelectorV2, resolution: CanonicalConnectorBindingResolutionV1, tenantId: string) {
  if (resolution.tenantId !== tenantId) throw new ConnectorRevocationV2Error("CANONICAL_TENANT_MISMATCH", "Canonical binding resolution is foreign to the authenticated tenant.", 403);
  if (selector.bindingId !== resolution.binding.bindingId) throw new ConnectorRevocationV2Error("BINDING_ID_DRIFT", "Proposed binding ID does not match current canonical truth.", 409);
  if (selector.expectedBindingVersion !== resolution.bindingVersion) throw new ConnectorRevocationV2Error("BINDING_VERSION_DRIFT", "Proposed binding version is stale.", 409);
  if (selector.expectedProvider !== resolution.binding.provider) throw new ConnectorRevocationV2Error("PROVIDER_DRIFT", "Proposed provider does not match current canonical truth.", 409);
  if (selector.expectedProviderAccountRef !== resolution.providerAccountRef) throw new ConnectorRevocationV2Error("PROVIDER_ACCOUNT_DRIFT", "Proposed provider account does not match current canonical truth.", 409);
  if (selector.expectedDestination !== resolution.destination) throw new ConnectorRevocationV2Error("DESTINATION_DRIFT", "Proposed destination does not match current canonical truth.", 409);
  if (selector.expectedCredentialGeneration !== resolution.credentialHandle.generation) throw new ConnectorRevocationV2Error("CREDENTIAL_GENERATION_DRIFT", "Proposed credential generation is stale.", 409);
  if (selector.expectedCredentialVersion !== resolution.credentialHandle.version) throw new ConnectorRevocationV2Error("CREDENTIAL_VERSION_DRIFT", "Proposed credential version is stale.", 409);
}

export function assertRevocationTupleMatchesV2(prior: ConnectorRevocationReceiptV2, tenantId: string, request: ConnectorRevocationRequestV2, resolution: CanonicalConnectorBindingResolutionV1) {
  if (prior.tenantId !== tenantId || prior.bindingResolution.resolutionDigest !== resolution.resolutionDigest
    || prior.bindingResolution.credentialHandle.handleDigest !== resolution.credentialHandle.handleDigest
    || prior.operation.selector.bindingId !== request.selector.bindingId) {
    throw new ConnectorRevocationV2Error("REVOCATION_TUPLE_MISMATCH", "Forward recovery cannot change tenant or canonical binding/account/credential generation truth.", 409);
  }
}

export function revocationReservationV2(tenantId: string, request: ConnectorRevocationRequestV2, resolution: CanonicalConnectorBindingResolutionV1) {
  const reservation = { operationKey: request.operationKey, tenantId };
  return {
    commandId: `connector-revocation-command:${sha256(reservation)}`,
    idempotencyKey: `connector-revocation:${sha256(reservation)}`,
    objectVersion: `connector-revocation:${resolution.binding.bindingId}@${sha256({ payloadDigest: request.payloadDigest, resolutionDigest: resolution.resolutionDigest })}`,
  };
}

export function assertKillStateOpenV2(state: EffectKillState, boundary: string) {
  if (!state.stateAvailable) throw new ConnectorRevocationV2Error("KILL_STATE_UNAVAILABLE", `${boundary} kill state is unavailable; revocation fails closed.`, 503);
  if (state.activeKillRefs.length) throw new ConnectorRevocationV2Error("ACTIVE_KILL_SWITCH", `${boundary} kill state blocks revocation.`, 409);
  return token(state.killVersion, `${boundary}.killVersion`, KILL_VERSION);
}

export function classifyRevocationOutcomeV2(input: {
  lastErrorCode: string | null;
  providerAcknowledgementRef: string | null;
  reconciliationRef: string | null;
  reconciliationResult: string | null;
  sourceReadbackRef: string | null;
  state: string;
}): Pick<ConnectorRevocationReceiptV2, "acknowledgement" | "localCredentialDisposition" | "reconciliation" | "recoveryState" | "remoteFinality"> {
  const common = { localCredentialDisposition: "RETAINED" as const, recoveryState: "NORMAL" as const };
  if (input.state === "SOURCE_CONFIRMED" && input.reconciliationResult === "MATCHED" && input.sourceReadbackRef) return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: input.sourceReadbackRef }, reconciliation: { reconciliationRef: input.reconciliationRef, result: "MATCHED" }, remoteFinality: "REVOKED" };
  if (input.reconciliationResult === "VERSION_MISMATCH" || input.lastErrorCode === "SOURCE_VERSION_MISMATCH") return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: input.sourceReadbackRef }, reconciliation: { reconciliationRef: input.reconciliationRef, result: "VERSION_MISMATCH" }, remoteFinality: "VERSION_MISMATCH" };
  if (input.state === "BLOCKED") {
    const exhausted = input.lastErrorCode === "RECONCILIATION_BUDGET_EXHAUSTED";
    return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: exhausted ? "AMBIGUOUS" : "PENDING" }, remoteFinality: exhausted ? "AMBIGUITY_EXHAUSTED" : "BLOCKED" };
  }
  if (input.state === "PROVIDER_ACKNOWLEDGED" && input.providerAcknowledgementRef) return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: input.reconciliationRef ? "PENDING" : "NOT_ATTEMPTED" }, remoteFinality: input.reconciliationRef ? "RECONCILING" : "ACKNOWLEDGED" };
  if (input.reconciliationRef && input.reconciliationResult === "PENDING") return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: "PENDING" }, remoteFinality: "RECONCILING" };
  if (input.lastErrorCode === "CONNECTOR_REVOCATION_SOURCE_UNAVAILABLE") return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: "SOURCE_UNAVAILABLE" }, remoteFinality: "SOURCE_UNAVAILABLE" };
  return { ...common, acknowledgement: { providerAcknowledgementRef: input.providerAcknowledgementRef, sourceReadbackRef: null }, reconciliation: { reconciliationRef: input.reconciliationRef, result: input.reconciliationResult === "NOT_FOUND" ? "NOT_FOUND" : "NOT_ATTEMPTED" }, remoteFinality: "REMOTE_REVOKE_FAILED" };
}

export const CONNECTOR_REVOCATION_V2_SCHEMA_RULES = Object.freeze({
  credentialHandleRequired: ["bindingId", "contractVersion", "generation", "handleDigest", "provider", "providerAccountRef", "reference", "tenantId", "version"].sort(),
  requestRequired: ["contractVersion", "expectedPriorReceiptId", "operation", "operationKey", "payloadDigest", "selector"].sort(),
  receiptRequired: ["acknowledgement", "actor", "bindingResolution", "commandReceiptRef", "contractVersion", "killEvidence", "localCredentialDisposition", "operation", "priorReceiptId", "receiptDigest", "receiptId", "reconciliation", "recordedAt", "recoveryState", "remoteFinality", "tenantId", "zeroEffect"].sort(),
  strictIdMaxLength: 190,
  strictRawWhitespace: true,
});
