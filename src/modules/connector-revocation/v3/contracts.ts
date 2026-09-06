import { createHash } from "node:crypto";

import { CONNECTOR_REVOCATION_RECEIPT_VERSION, parseConnectorRevocationReceipt, type ConnectorRevocationReceiptV1 } from "../contracts";
import {
  CONNECTOR_REVOCATION_RECEIPT_V2,
  parseConnectorRevocationReceiptV2,
  type ConnectorProvider,
  type ConnectorRevocationReceiptV2,
  type ConnectorRevocationScenarioV2,
  type ConnectorRemoteFinalityV2,
  type ConnectorLocalCredentialDispositionV2,
  type ConnectorRecoveryStateV2,
  type RevocationKillPairV2,
} from "../v2/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const CONNECTOR_BINDING_READBACK_V1 = "ConnectorBindingReadback/v1" as const;
export const CONNECTOR_REVOCATION_REQUEST_V3 = "ConnectorRevocationRequest/v3" as const;
export const CONNECTOR_REVOCATION_RECEIPT_V3 = "ConnectorRevocationReceipt/v3" as const;
export const CONNECTOR_REVOCATION_READBACK_V1 = "ConnectorRevocationReadback/v1" as const;
export const CONNECTOR_REVOCATION_POLICY_V3 = "CONNECTOR-LOCATOR-REDACTION-L1/policy-v3" as const;

const STRICT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,189}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const RECEIPT_REF = /^connector-revocation-receipt:[a-f0-9]{64}$/;
const READBACK_REF = /^connector-revocation-readback:[a-f0-9]{64}$/;
const BINDING_READBACK_REF = /^connector-binding-readback:[a-f0-9]{64}$/;
const KILL_VERSION = /^kill:[a-f0-9]{64}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PROVIDERS = ["GOOGLE_WORKSPACE", "MICROSOFT_365", "QUICKBOOKS_ONLINE"] as const;
const SCENARIOS = ["ack_only", "ambiguous", "failed", "matched", "source_unavailable", "version_mismatch"] as const;
const REMOTE_FINALITIES = ["ACKNOWLEDGED", "AMBIGUITY_EXHAUSTED", "BLOCKED", "REMOTE_REVOKE_FAILED", "REQUESTED", "RECONCILING", "REVOKED", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"] as const;
const LOCAL_DISPOSITIONS = ["ERASURE_AUTHORIZED_NO_EFFECT", "RETAINED"] as const;
const RECOVERY_STATES = ["FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT", "NORMAL"] as const;
const RECONCILIATION_RESULTS = ["AMBIGUOUS", "MATCHED", "NOT_ATTEMPTED", "NOT_FOUND", "PENDING", "SOURCE_UNAVAILABLE", "VERSION_MISMATCH"] as const;
const SOURCE_RECEIPT_VERSIONS = [CONNECTOR_REVOCATION_RECEIPT_VERSION, CONNECTOR_REVOCATION_RECEIPT_V2, CONNECTOR_REVOCATION_RECEIPT_V3] as const;
const FORBIDDEN_LOCATOR_KEYS = new Set([
  "reference", "credentialreference", "credentialhandle", "credentialhandleref", "ciphertext",
  "token", "secret", "vaultpath", "providerresponse",
]);
const FORBIDDEN_LOCATOR_PREFIX = /^(?:secret-ref:|token-ref:|credential-ref:|vault:|kms:|oauth-token:|env:|Bearer )/i;

export type ConnectorBindingReadbackV1 = {
  bindingHeadDigest: string;
  bindingId: string;
  bindingVersion: string;
  contractVersion: typeof CONNECTOR_BINDING_READBACK_V1;
  credential: {
    contentBindingDigest: string;
    generation: number;
    version: string;
  };
  destination: string;
  observedAt: string;
  ownerReadbackId: string;
  provider: ConnectorProvider;
  providerAccountRef: string;
  revocation: { revokedAt: null; revocationReadbackId: null };
  status: "BOUND";
  tenantId: string;
};

export type ConnectorRevocationSelectorV3 = {
  bindingId: string;
  expectedBindingHeadDigest: string;
  expectedCredentialGeneration: number;
};

export type ConnectorRevocationRequestV3 = {
  contractVersion: typeof CONNECTOR_REVOCATION_REQUEST_V3;
  expectedPriorReadbackId: string | null;
  operation: {
    kind: "AUTHORIZE_FORWARD_RECOVERY_ERASURE" | "REQUEST_REMOTE_REVOCATION";
    scenario: ConnectorRevocationScenarioV2;
  };
  operationKey: string;
  payloadDigest: string;
  selector: ConnectorRevocationSelectorV3;
};

export type ConnectorRevocationReceiptV3 = {
  acknowledgement: { providerAcknowledgementRef: string | null; sourceReadbackRef: string | null };
  actor: { humanActorId: string; humanAuthenticationRef: string; requestActorClass: "service"; requestActorId: string };
  bindingReadback: ConnectorBindingReadbackV1;
  commandReceiptRef: string;
  contractVersion: typeof CONNECTOR_REVOCATION_RECEIPT_V3;
  killEvidence: {
    accepted: RevocationKillPairV2;
    beforeCredentialHold: RevocationKillPairV2 | null;
    beforeExecuteOrDisposition: RevocationKillPairV2 | null;
  };
  localCredentialDisposition: ConnectorLocalCredentialDispositionV2;
  operation: { key: string; kind: ConnectorRevocationRequestV3["operation"]["kind"]; payloadDigest: string; selector: ConnectorRevocationSelectorV3 };
  priorReadbackId: string | null;
  receiptDigest: string;
  receiptId: string;
  reconciliation: { reconciliationRef: string | null; result: typeof RECONCILIATION_RESULTS[number] };
  recordedAt: string;
  recoveryState: ConnectorRecoveryStateV2;
  remoteFinality: ConnectorRemoteFinalityV2;
  tenantId: string;
  zeroEffect: true;
};

export type ConnectorRevocationReadbackV1 = {
  binding: {
    bindingHeadDigest: string;
    bindingId: string;
    bindingVersion: string;
    credentialGeneration: number;
    destination: string;
    provider: ConnectorProvider;
    providerAccountRef: string;
  };
  contractVersion: typeof CONNECTOR_REVOCATION_READBACK_V1;
  localCredentialDisposition: ConnectorLocalCredentialDispositionV2;
  operationKey: string;
  operationKind: ConnectorRevocationRequestV3["operation"]["kind"];
  projectionDigest: string;
  providerAcknowledged: boolean;
  readbackId: string;
  reconciliationResult: typeof RECONCILIATION_RESULTS[number];
  recordedAt: string;
  recoveryState: ConnectorRecoveryStateV2;
  remoteFinality: ConnectorRemoteFinalityV2;
  sourceConfirmed: boolean;
  sourceReceiptVersion: typeof SOURCE_RECEIPT_VERSIONS[number];
  tenantId: string;
  zeroEffect: true;
};

export class ConnectorRevocationV3Error extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ConnectorRevocationV3Error";
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectorRevocationV3Error("INVALID_PACKET", `${field} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[], field: string) {
  const row = record(value, field);
  if (Object.keys(row).sort().join("|") !== [...keys].sort().join("|")) throw new ConnectorRevocationV3Error("FIELD_SET_MISMATCH", `${field} fields must match the exact contract.`);
  return row;
}

function normalizedKey(key: string) {
  return key.toLowerCase().replace(/[-_]/g, "");
}

export function assertLocatorFree(value: unknown, field = "packet"): void {
  if (typeof value === "string") {
    if (value !== value.trim()) throw new ConnectorRevocationV3Error("RAW_CANONICAL_COLLISION", `${field} cannot contain leading or trailing whitespace.`);
    if (FORBIDDEN_LOCATOR_PREFIX.test(value)) throw new ConnectorRevocationV3Error("LOCATOR_VALUE_FORBIDDEN", `${field} contains a forbidden locator value.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLocatorFree(item, `${field}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_LOCATOR_KEYS.has(normalizedKey(key))) throw new ConnectorRevocationV3Error("LOCATOR_KEY_FORBIDDEN", `${field} contains a forbidden locator field.`);
      assertLocatorFree(child, `${field}.${key}`);
    }
  }
}

function token(value: unknown, field: string, pattern = STRICT_ID) {
  if (typeof value !== "string" || !pattern.test(value)) throw new ConnectorRevocationV3Error("INVALID_PACKET", `${field} must be an exact bounded raw identifier.`);
  return value;
}

function digest(value: unknown, field: string) { return token(value, field, DIGEST); }
function uuid(value: unknown, field: string) { return token(value, field, UUID); }
function generation(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2147483647) throw new ConnectorRevocationV3Error("INVALID_PACKET", `${field} must be a positive 32-bit generation.`);
  return Number(value);
}
function timestamp(value: unknown, field: string) {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new ConnectorRevocationV3Error("INVALID_PACKET", `${field} must be an exact UTC millisecond timestamp.`);
  return value;
}
function nullableToken(value: unknown, field: string) { return value === null ? null : token(value, field); }
function enumeration<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new ConnectorRevocationV3Error("INVALID_PACKET", `${field} is not admitted.`);
  return value as T[number];
}

function bindingHeadDigest(input: Omit<ConnectorBindingReadbackV1, "bindingHeadDigest" | "ownerReadbackId">) {
  return sha256({ domain: "luzione.connector-binding-readback/v1", tenantId: input.tenantId, value: input });
}

export function issueConnectorBindingReadbackV1(input: Omit<ConnectorBindingReadbackV1, "bindingHeadDigest" | "contractVersion" | "ownerReadbackId">) {
  const unsigned = { ...input, contractVersion: CONNECTOR_BINDING_READBACK_V1 } as const;
  const head = bindingHeadDigest(unsigned);
  return parseConnectorBindingReadbackV1({ ...unsigned, bindingHeadDigest: head, ownerReadbackId: `connector-binding-readback:${head}` });
}

export function parseConnectorBindingReadbackV1(value: unknown): ConnectorBindingReadbackV1 {
  assertLocatorFree(value, "bindingReadback");
  const row = exact(value, ["bindingHeadDigest", "bindingId", "bindingVersion", "contractVersion", "credential", "destination", "observedAt", "ownerReadbackId", "provider", "providerAccountRef", "revocation", "status", "tenantId"], "bindingReadback");
  if (row.contractVersion !== CONNECTOR_BINDING_READBACK_V1 || row.status !== "BOUND") throw new ConnectorRevocationV3Error("BINDING_READBACK_INVALID", "Binding readback must be exact, current and BOUND.", 409);
  const credential = exact(row.credential, ["contentBindingDigest", "generation", "version"], "bindingReadback.credential");
  const revocation = exact(row.revocation, ["revokedAt", "revocationReadbackId"], "bindingReadback.revocation");
  if (revocation.revokedAt !== null || revocation.revocationReadbackId !== null) throw new ConnectorRevocationV3Error("BINDING_REVOKED", "Binding readback must be unrevoked.", 409);
  const parsed = {
    bindingHeadDigest: digest(row.bindingHeadDigest, "bindingReadback.bindingHeadDigest"),
    bindingId: uuid(row.bindingId, "bindingReadback.bindingId"),
    bindingVersion: token(row.bindingVersion, "bindingReadback.bindingVersion"),
    contractVersion: CONNECTOR_BINDING_READBACK_V1,
    credential: { contentBindingDigest: digest(credential.contentBindingDigest, "bindingReadback.credential.contentBindingDigest"), generation: generation(credential.generation, "bindingReadback.credential.generation"), version: token(credential.version, "bindingReadback.credential.version") },
    destination: token(row.destination, "bindingReadback.destination"),
    observedAt: timestamp(row.observedAt, "bindingReadback.observedAt"),
    ownerReadbackId: token(row.ownerReadbackId, "bindingReadback.ownerReadbackId", BINDING_READBACK_REF),
    provider: enumeration(row.provider, PROVIDERS, "bindingReadback.provider"),
    providerAccountRef: token(row.providerAccountRef, "bindingReadback.providerAccountRef"),
    revocation: { revokedAt: null, revocationReadbackId: null },
    status: "BOUND" as const,
    tenantId: token(row.tenantId, "bindingReadback.tenantId"),
  };
  const { bindingHeadDigest: received, ownerReadbackId, ...unsigned } = parsed;
  const expected = bindingHeadDigest(unsigned);
  if (received !== expected || ownerReadbackId !== `connector-binding-readback:${expected}`) throw new ConnectorRevocationV3Error("BINDING_HEAD_DIGEST_MISMATCH", "Binding head must content-bind exact locator-free owner readback.", 409);
  return Object.freeze(parsed);
}

function parseSelector(value: unknown, field = "selector"): ConnectorRevocationSelectorV3 {
  const row = exact(value, ["bindingId", "expectedBindingHeadDigest", "expectedCredentialGeneration"], field);
  assertLocatorFree(row, field);
  return Object.freeze({ bindingId: uuid(row.bindingId, `${field}.bindingId`), expectedBindingHeadDigest: digest(row.expectedBindingHeadDigest, `${field}.expectedBindingHeadDigest`), expectedCredentialGeneration: generation(row.expectedCredentialGeneration, `${field}.expectedCredentialGeneration`) });
}

export function connectorRevocationPayloadDigestV3(input: Omit<ConnectorRevocationRequestV3, "payloadDigest">) {
  return sha256({ domain: "luzione.connector-revocation-request/v3", tenantId: null, value: input });
}

export function issueConnectorRevocationRequestV3(input: Omit<ConnectorRevocationRequestV3, "contractVersion" | "payloadDigest">) {
  const unsigned = { ...input, contractVersion: CONNECTOR_REVOCATION_REQUEST_V3 } as const;
  return parseConnectorRevocationRequestV3({ ...unsigned, payloadDigest: connectorRevocationPayloadDigestV3(unsigned) });
}

export function parseConnectorRevocationRequestV3(value: unknown): ConnectorRevocationRequestV3 {
  assertLocatorFree(value, "request");
  const row = exact(value, ["contractVersion", "expectedPriorReadbackId", "operation", "operationKey", "payloadDigest", "selector"], "request");
  if (row.contractVersion !== CONNECTOR_REVOCATION_REQUEST_V3) throw new ConnectorRevocationV3Error("WRONG_VERSION", `contractVersion must be ${CONNECTOR_REVOCATION_REQUEST_V3}.`);
  const operation = exact(row.operation, ["kind", "scenario"], "request.operation");
  const kind = enumeration(operation.kind, ["AUTHORIZE_FORWARD_RECOVERY_ERASURE", "REQUEST_REMOTE_REVOCATION"] as const, "request.operation.kind");
  const expectedPriorReadbackId = row.expectedPriorReadbackId === null ? null : token(row.expectedPriorReadbackId, "request.expectedPriorReadbackId", READBACK_REF);
  if (kind === "AUTHORIZE_FORWARD_RECOVERY_ERASURE" && expectedPriorReadbackId === null) throw new ConnectorRevocationV3Error("PRIOR_READBACK_REQUIRED", "Forward recovery requires an exact prior readback.", 409);
  if (kind === "REQUEST_REMOTE_REVOCATION" && expectedPriorReadbackId !== null) throw new ConnectorRevocationV3Error("PRIOR_READBACK_DENIED", "Initial revocation cannot select a prior readback.", 409);
  const unsigned = {
    contractVersion: CONNECTOR_REVOCATION_REQUEST_V3,
    expectedPriorReadbackId,
    operation: { kind, scenario: enumeration(operation.scenario, SCENARIOS, "request.operation.scenario") },
    operationKey: token(row.operationKey, "request.operationKey"),
    selector: parseSelector(row.selector),
  };
  const payloadDigest = digest(row.payloadDigest, "request.payloadDigest");
  if (payloadDigest !== connectorRevocationPayloadDigestV3(unsigned)) throw new ConnectorRevocationV3Error("PAYLOAD_DIGEST_MISMATCH", "payloadDigest must bind the exact locator-free v3 request.", 409);
  return Object.freeze({ ...unsigned, payloadDigest });
}

export function connectorRevocationRawBodyDigestV3(rawBody: string) { return createHash("sha256").update(rawBody, "utf8").digest("hex"); }

export function decodeConnectorRevocationRawBody(rawBody: string) {
  if (!rawBody || rawBody !== rawBody.trim()) throw new ConnectorRevocationV3Error("RAW_CANONICAL_COLLISION", "Request JSON cannot have leading or trailing transport whitespace.");
  let decoded: unknown;
  try { decoded = JSON.parse(rawBody); } catch { throw new ConnectorRevocationV3Error("INVALID_JSON", "Request body must be valid JSON."); }
  const version = record(decoded, "request").contractVersion;
  if (typeof version !== "string") throw new ConnectorRevocationV3Error("WRONG_VERSION", "Request contractVersion is not admitted.");
  return { decoded, rawBodyDigest: connectorRevocationRawBodyDigestV3(rawBody), version };
}

export function parseConnectorRevocationRawBodyV3(rawBody: string) {
  const decoded = decodeConnectorRevocationRawBody(rawBody);
  return { rawBodyDigest: decoded.rawBodyDigest, request: parseConnectorRevocationRequestV3(decoded.decoded) };
}

function parseKillPair(value: unknown, field: string): RevocationKillPairV2 {
  const row = exact(value, ["containmentKillVersion", "normalKillVersion"], field);
  return Object.freeze({ containmentKillVersion: token(row.containmentKillVersion, `${field}.containmentKillVersion`, KILL_VERSION), normalKillVersion: token(row.normalKillVersion, `${field}.normalKillVersion`, KILL_VERSION) });
}

export function connectorRevocationReceiptDigestV3(input: Omit<ConnectorRevocationReceiptV3, "receiptDigest" | "receiptId">) {
  return sha256({ domain: "luzione.connector-revocation-receipt/v3", tenantId: input.tenantId, value: input });
}

export function issueConnectorRevocationReceiptV3(input: Omit<ConnectorRevocationReceiptV3, "contractVersion" | "receiptDigest" | "receiptId" | "zeroEffect">) {
  const { contractVersion: _contractVersion, receiptDigest: _receiptDigest, receiptId: _receiptId, zeroEffect: _zeroEffect, ...payload } = input as typeof input & Partial<Pick<ConnectorRevocationReceiptV3, "contractVersion" | "receiptDigest" | "receiptId" | "zeroEffect">>;
  void _contractVersion;
  void _receiptDigest;
  void _receiptId;
  void _zeroEffect;
  const unsigned = { ...payload, contractVersion: CONNECTOR_REVOCATION_RECEIPT_V3, zeroEffect: true as const };
  const receiptDigest = connectorRevocationReceiptDigestV3(unsigned);
  return parseConnectorRevocationReceiptV3({ ...unsigned, receiptDigest, receiptId: `connector-revocation-receipt:${receiptDigest}` });
}

export function parseConnectorRevocationReceiptV3(value: unknown): ConnectorRevocationReceiptV3 {
  assertLocatorFree(value, "receipt");
  const row = exact(value, ["acknowledgement", "actor", "bindingReadback", "commandReceiptRef", "contractVersion", "killEvidence", "localCredentialDisposition", "operation", "priorReadbackId", "receiptDigest", "receiptId", "reconciliation", "recordedAt", "recoveryState", "remoteFinality", "tenantId", "zeroEffect"], "receipt");
  if (row.contractVersion !== CONNECTOR_REVOCATION_RECEIPT_V3 || row.zeroEffect !== true) throw new ConnectorRevocationV3Error("WRONG_VERSION", "Receipt version or zero-effect marker is invalid.");
  const acknowledgement = exact(row.acknowledgement, ["providerAcknowledgementRef", "sourceReadbackRef"], "receipt.acknowledgement");
  const actor = exact(row.actor, ["humanActorId", "humanAuthenticationRef", "requestActorClass", "requestActorId"], "receipt.actor");
  if (actor.requestActorClass !== "service") throw new ConnectorRevocationV3Error("INVALID_RECEIPT", "Receipt actor class must be service.");
  const kill = exact(row.killEvidence, ["accepted", "beforeCredentialHold", "beforeExecuteOrDisposition"], "receipt.killEvidence");
  const operation = exact(row.operation, ["key", "kind", "payloadDigest", "selector"], "receipt.operation");
  const reconciliation = exact(row.reconciliation, ["reconciliationRef", "result"], "receipt.reconciliation");
  const parsed = {
    acknowledgement: { providerAcknowledgementRef: nullableToken(acknowledgement.providerAcknowledgementRef, "receipt.acknowledgement.providerAcknowledgementRef"), sourceReadbackRef: nullableToken(acknowledgement.sourceReadbackRef, "receipt.acknowledgement.sourceReadbackRef") },
    actor: { humanActorId: token(actor.humanActorId, "receipt.actor.humanActorId"), humanAuthenticationRef: token(actor.humanAuthenticationRef, "receipt.actor.humanAuthenticationRef"), requestActorClass: "service" as const, requestActorId: token(actor.requestActorId, "receipt.actor.requestActorId") },
    bindingReadback: parseConnectorBindingReadbackV1(row.bindingReadback),
    commandReceiptRef: token(row.commandReceiptRef, "receipt.commandReceiptRef"),
    contractVersion: CONNECTOR_REVOCATION_RECEIPT_V3,
    killEvidence: { accepted: parseKillPair(kill.accepted, "receipt.killEvidence.accepted"), beforeCredentialHold: kill.beforeCredentialHold === null ? null : parseKillPair(kill.beforeCredentialHold, "receipt.killEvidence.beforeCredentialHold"), beforeExecuteOrDisposition: kill.beforeExecuteOrDisposition === null ? null : parseKillPair(kill.beforeExecuteOrDisposition, "receipt.killEvidence.beforeExecuteOrDisposition") },
    localCredentialDisposition: enumeration(row.localCredentialDisposition, LOCAL_DISPOSITIONS, "receipt.localCredentialDisposition"),
    operation: { key: token(operation.key, "receipt.operation.key"), kind: enumeration(operation.kind, ["AUTHORIZE_FORWARD_RECOVERY_ERASURE", "REQUEST_REMOTE_REVOCATION"] as const, "receipt.operation.kind"), payloadDigest: digest(operation.payloadDigest, "receipt.operation.payloadDigest"), selector: parseSelector(operation.selector, "receipt.operation.selector") },
    priorReadbackId: row.priorReadbackId === null ? null : token(row.priorReadbackId, "receipt.priorReadbackId", READBACK_REF),
    receiptDigest: digest(row.receiptDigest, "receipt.receiptDigest"),
    receiptId: token(row.receiptId, "receipt.receiptId", RECEIPT_REF),
    reconciliation: { reconciliationRef: nullableToken(reconciliation.reconciliationRef, "receipt.reconciliation.reconciliationRef"), result: enumeration(reconciliation.result, RECONCILIATION_RESULTS, "receipt.reconciliation.result") },
    recordedAt: timestamp(row.recordedAt, "receipt.recordedAt"),
    recoveryState: enumeration(row.recoveryState, RECOVERY_STATES, "receipt.recoveryState"),
    remoteFinality: enumeration(row.remoteFinality, REMOTE_FINALITIES, "receipt.remoteFinality"),
    tenantId: token(row.tenantId, "receipt.tenantId"),
    zeroEffect: true as const,
  };
  if (parsed.tenantId !== parsed.bindingReadback.tenantId || parsed.operation.selector.bindingId !== parsed.bindingReadback.bindingId || parsed.operation.selector.expectedBindingHeadDigest !== parsed.bindingReadback.bindingHeadDigest || parsed.operation.selector.expectedCredentialGeneration !== parsed.bindingReadback.credential.generation) throw new ConnectorRevocationV3Error("RECEIPT_OWNER_TUPLE_MISMATCH", "Receipt selector must match exact same-tenant owner readback.", 409);
  if (parsed.remoteFinality === "REVOKED" && (!parsed.acknowledgement.sourceReadbackRef || parsed.reconciliation.result !== "MATCHED")) throw new ConnectorRevocationV3Error("REMOTE_FINALITY_UNPROVEN", "REVOKED requires exact matching source readback.", 409);
  if (parsed.remoteFinality === "ACKNOWLEDGED" && (!parsed.acknowledgement.providerAcknowledgementRef || parsed.acknowledgement.sourceReadbackRef)) throw new ConnectorRevocationV3Error("ACK_FINALITY_INVALID", "ACKNOWLEDGED is pre-readback only.", 409);
  if (parsed.localCredentialDisposition === "ERASURE_AUTHORIZED_NO_EFFECT" && parsed.remoteFinality !== "REVOKED" && parsed.recoveryState !== "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT") throw new ConnectorRevocationV3Error("ERASURE_AUTHORITY_MISSING", "Credential disposition requires source confirmation or human forward recovery.", 409);
  if (parsed.recoveryState === "FORWARD_RECOVERY_AUTHORIZED_NO_EFFECT" && (parsed.operation.kind !== "AUTHORIZE_FORWARD_RECOVERY_ERASURE" || parsed.priorReadbackId === null || parsed.killEvidence.beforeExecuteOrDisposition === null)) throw new ConnectorRevocationV3Error("FORWARD_RECOVERY_INVALID", "Forward recovery must append to an exact readback and include a fresh kill check.", 409);
  const { receiptDigest, receiptId, ...unsigned } = parsed;
  const expected = connectorRevocationReceiptDigestV3(unsigned);
  if (receiptDigest !== expected || receiptId !== `connector-revocation-receipt:${expected}`) throw new ConnectorRevocationV3Error("RECEIPT_DIGEST_MISMATCH", "Receipt digest must bind the exact locator-free packet.", 409);
  return Object.freeze(parsed);
}

function readbackUnsigned(receipt: ConnectorRevocationReceiptV3 | ConnectorRevocationReceiptV2 | ConnectorRevocationReceiptV1) {
  const v3 = receipt.contractVersion === CONNECTOR_REVOCATION_RECEIPT_V3 ? receipt : null;
  const v2 = receipt.contractVersion === CONNECTOR_REVOCATION_RECEIPT_V2 ? receipt : null;
  const v1 = receipt.contractVersion === CONNECTOR_REVOCATION_RECEIPT_VERSION ? receipt : null;
  const binding = v3 ? {
    bindingHeadDigest: v3.bindingReadback.bindingHeadDigest, bindingId: v3.bindingReadback.bindingId, bindingVersion: v3.bindingReadback.bindingVersion,
    credentialGeneration: v3.bindingReadback.credential.generation, destination: v3.bindingReadback.destination, provider: v3.bindingReadback.provider, providerAccountRef: v3.bindingReadback.providerAccountRef,
  } : v2 ? {
    bindingHeadDigest: v2.bindingResolution.resolutionDigest, bindingId: v2.bindingResolution.binding.bindingId, bindingVersion: v2.bindingResolution.bindingVersion,
    credentialGeneration: v2.bindingResolution.credentialHandle.generation, destination: v2.bindingResolution.destination, provider: v2.bindingResolution.binding.provider, providerAccountRef: v2.bindingResolution.providerAccountRef,
  } : {
    bindingHeadDigest: sha256({ domain: "luzione.connector-revocation-legacy-redaction/v1", tenantId: v1!.tenantId, receiptDigest: v1!.receiptDigest }),
    bindingId: v1!.binding.bindingId, bindingVersion: v1!.binding.bindingContractVersion, credentialGeneration: 1,
    destination: "sandbox.connector-revocation", provider: v1!.binding.connectorProvider, providerAccountRef: v1!.binding.providerAccountRef,
  };
  return {
    binding,
    contractVersion: CONNECTOR_REVOCATION_READBACK_V1,
    localCredentialDisposition: receipt.localCredentialDisposition,
    operationKey: v3 ? v3.operation.key : v2 ? v2.operation.key : v1!.operation.key,
    operationKind: v3 ? v3.operation.kind : v2 ? v2.operation.kind : v1!.operation.kind,
    providerAcknowledged: receipt.acknowledgement.providerAcknowledgementRef !== null,
    reconciliationResult: receipt.reconciliation.result,
    recordedAt: receipt.recordedAt,
    recoveryState: receipt.recoveryState,
    remoteFinality: receipt.remoteFinality,
    sourceConfirmed: receipt.remoteFinality === "REVOKED" && receipt.acknowledgement.sourceReadbackRef !== null && receipt.reconciliation.result === "MATCHED",
    sourceReceiptVersion: receipt.contractVersion,
    tenantId: receipt.tenantId,
    zeroEffect: true as const,
  };
}

function projectionDigest(input: ReturnType<typeof readbackUnsigned>) {
  return sha256({ domain: "luzione.connector-revocation-readback/v1", tenantId: input.tenantId, value: input });
}

export function projectConnectorRevocationReadbackV1(value: unknown): ConnectorRevocationReadbackV1 {
  const row = record(value, "receipt");
  const receipt = row.contractVersion === CONNECTOR_REVOCATION_RECEIPT_V3 ? parseConnectorRevocationReceiptV3(value)
    : row.contractVersion === CONNECTOR_REVOCATION_RECEIPT_V2 ? parseConnectorRevocationReceiptV2(value)
      : row.contractVersion === CONNECTOR_REVOCATION_RECEIPT_VERSION ? parseConnectorRevocationReceipt(value)
        : (() => { throw new ConnectorRevocationV3Error("READBACK_WRONG_VERSION", "Stored receipt version is not admitted.", 503); })();
  const unsigned = readbackUnsigned(receipt);
  const digestValue = projectionDigest(unsigned);
  return parseConnectorRevocationReadbackV1({ ...unsigned, projectionDigest: digestValue, readbackId: `connector-revocation-readback:${digestValue}` });
}

export function parseConnectorRevocationReadbackV1(value: unknown): ConnectorRevocationReadbackV1 {
  assertLocatorFree(value, "readback");
  const row = exact(value, ["binding", "contractVersion", "localCredentialDisposition", "operationKey", "operationKind", "projectionDigest", "providerAcknowledged", "readbackId", "reconciliationResult", "recordedAt", "recoveryState", "remoteFinality", "sourceConfirmed", "sourceReceiptVersion", "tenantId", "zeroEffect"], "readback");
  if (row.contractVersion !== CONNECTOR_REVOCATION_READBACK_V1 || row.zeroEffect !== true) throw new ConnectorRevocationV3Error("WRONG_VERSION", "Readback version or zero-effect marker is invalid.");
  const binding = exact(row.binding, ["bindingHeadDigest", "bindingId", "bindingVersion", "credentialGeneration", "destination", "provider", "providerAccountRef"], "readback.binding");
  const parsed = {
    binding: { bindingHeadDigest: digest(binding.bindingHeadDigest, "readback.binding.bindingHeadDigest"), bindingId: uuid(binding.bindingId, "readback.binding.bindingId"), bindingVersion: token(binding.bindingVersion, "readback.binding.bindingVersion"), credentialGeneration: generation(binding.credentialGeneration, "readback.binding.credentialGeneration"), destination: token(binding.destination, "readback.binding.destination"), provider: enumeration(binding.provider, PROVIDERS, "readback.binding.provider"), providerAccountRef: token(binding.providerAccountRef, "readback.binding.providerAccountRef") },
    contractVersion: CONNECTOR_REVOCATION_READBACK_V1,
    localCredentialDisposition: enumeration(row.localCredentialDisposition, LOCAL_DISPOSITIONS, "readback.localCredentialDisposition"),
    operationKey: token(row.operationKey, "readback.operationKey"),
    operationKind: enumeration(row.operationKind, ["AUTHORIZE_FORWARD_RECOVERY_ERASURE", "REQUEST_REMOTE_REVOCATION"] as const, "readback.operationKind"),
    projectionDigest: digest(row.projectionDigest, "readback.projectionDigest"),
    providerAcknowledged: row.providerAcknowledged === true,
    readbackId: token(row.readbackId, "readback.readbackId", READBACK_REF),
    reconciliationResult: enumeration(row.reconciliationResult, RECONCILIATION_RESULTS, "readback.reconciliationResult"),
    recordedAt: timestamp(row.recordedAt, "readback.recordedAt"),
    recoveryState: enumeration(row.recoveryState, RECOVERY_STATES, "readback.recoveryState"),
    remoteFinality: enumeration(row.remoteFinality, REMOTE_FINALITIES, "readback.remoteFinality"),
    sourceConfirmed: row.sourceConfirmed === true,
    sourceReceiptVersion: enumeration(row.sourceReceiptVersion, SOURCE_RECEIPT_VERSIONS, "readback.sourceReceiptVersion"),
    tenantId: token(row.tenantId, "readback.tenantId"),
    zeroEffect: true as const,
  };
  if (typeof row.providerAcknowledged !== "boolean" || typeof row.sourceConfirmed !== "boolean") throw new ConnectorRevocationV3Error("INVALID_PACKET", "Readback evidence booleans must be explicit.");
  if (parsed.sourceConfirmed !== (parsed.remoteFinality === "REVOKED" && parsed.reconciliationResult === "MATCHED")) throw new ConnectorRevocationV3Error("READBACK_FINALITY_MISMATCH", "Readback source-confirmation and finality are inconsistent.", 409);
  const { projectionDigest: received, readbackId, ...unsigned } = parsed;
  const expected = projectionDigest(unsigned);
  if (received !== expected || readbackId !== `connector-revocation-readback:${expected}`) throw new ConnectorRevocationV3Error("READBACK_DIGEST_MISMATCH", "Readback digest must bind the exact public projection.", 409);
  return Object.freeze(parsed);
}

export function assertSelectorMatchesBindingReadbackV1(selector: ConnectorRevocationSelectorV3, readback: ConnectorBindingReadbackV1, tenantId: string) {
  if (readback.tenantId !== tenantId) throw new ConnectorRevocationV3Error("CANONICAL_TENANT_MISMATCH", "Canonical binding readback is foreign to the authenticated tenant.", 403);
  if (selector.bindingId !== readback.bindingId) throw new ConnectorRevocationV3Error("BINDING_ID_DRIFT", "Proposed binding ID does not match current canonical truth.", 409);
  if (selector.expectedBindingHeadDigest !== readback.bindingHeadDigest) throw new ConnectorRevocationV3Error("BINDING_HEAD_DRIFT", "Proposed binding head is stale.", 409);
  if (selector.expectedCredentialGeneration !== readback.credential.generation) throw new ConnectorRevocationV3Error("CREDENTIAL_GENERATION_DRIFT", "Proposed credential generation is stale.", 409);
}

export function revocationReservationV3(tenantId: string, request: ConnectorRevocationRequestV3, readback: ConnectorBindingReadbackV1) {
  const reservation = { operationKey: request.operationKey, tenantId };
  return {
    commandId: `connector-revocation-command:${sha256(reservation)}`,
    idempotencyKey: `connector-revocation:${sha256(reservation)}`,
    objectVersion: `connector-revocation:${readback.bindingId}@${sha256({ bindingHeadDigest: readback.bindingHeadDigest, payloadDigest: request.payloadDigest })}`,
  };
}

export const CONNECTOR_REVOCATION_V3_SCHEMA_RULES = Object.freeze({
  bindingReadbackRequired: ["bindingHeadDigest", "bindingId", "bindingVersion", "contractVersion", "credential", "destination", "observedAt", "ownerReadbackId", "provider", "providerAccountRef", "revocation", "status", "tenantId"].sort(),
  readbackRequired: ["binding", "contractVersion", "localCredentialDisposition", "operationKey", "operationKind", "projectionDigest", "providerAcknowledged", "readbackId", "reconciliationResult", "recordedAt", "recoveryState", "remoteFinality", "sourceConfirmed", "sourceReceiptVersion", "tenantId", "zeroEffect"].sort(),
  receiptRequired: ["acknowledgement", "actor", "bindingReadback", "commandReceiptRef", "contractVersion", "killEvidence", "localCredentialDisposition", "operation", "priorReadbackId", "receiptDigest", "receiptId", "reconciliation", "recordedAt", "recoveryState", "remoteFinality", "tenantId", "zeroEffect"].sort(),
  requestRequired: ["contractVersion", "expectedPriorReadbackId", "operation", "operationKey", "payloadDigest", "selector"].sort(),
  strictIdMaxLength: 190,
  strictRawWhitespace: true,
});
