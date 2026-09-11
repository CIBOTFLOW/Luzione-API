import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { LUZIONE_SULTAN_TOOL_MANIFEST_V1 } from "@/modules/sultan-agent-gateway/contracts";

export const BUSINESS_EVENT_BOUNDARY_VERSION = "luzione-business-event-boundary/v0.1-draft" as const;
export const ACCEPTED_SGO_C04_HEAD = "22d09b9d06fc60c79a0bcfa0c49a2f6967574cb0" as const;

export const businessActionKinds = ["COMMUNICATION_SEND", "ORDER_CREATE", "OTHER_EFFECT"] as const;
export type BusinessActionKind = (typeof businessActionKinds)[number];

export const businessEventTypes = [
  "ACTION_RELEASED",
  "EFFECT_DISPATCH_STARTED",
  "PROVIDER_ACKNOWLEDGED",
  "DELIVERY_AMBIGUOUS",
  "SOURCE_CONFIRMED",
] as const;
export type BusinessEventType = (typeof businessEventTypes)[number];

export type SourceVersionBinding = {
  objectId: string;
  objectType: string;
  owner: string;
  version: string;
};

export type CapabilityDiscoveryEvidence = {
  acceptedC04Head: typeof ACCEPTED_SGO_C04_HEAD;
  discoveryGrantsAuthority: false;
  manifestContractVersion: typeof LUZIONE_SULTAN_TOOL_MANIFEST_V1;
  manifestHash: string;
  sourceOwner: "CIBOTFLOW/Luzione-API";
  toolId: string;
  toolVersion: string;
};

export type ReleasedBusinessAction = {
  actionId: string;
  actionKind: BusinessActionKind;
  approval: {
    actionId: string;
    approvalId: string;
    approvedAt: string;
    decision: "APPROVE";
    expiresAt: string;
    operationId: string;
    payloadHash: string;
    policyVersion: string;
    receiptId: string;
    sourceVersion: string;
    tenantId: string;
  };
  authoritativeReadback: SourceVersionBinding & {
    expectedResultVersion: string;
    source: string;
  };
  capabilityDiscovery: CapabilityDiscoveryEvidence | null;
  canonicalOwner: string;
  contractVersion: typeof BUSINESS_EVENT_BOUNDARY_VERSION;
  operationId: string;
  payloadHash: string;
  policyVersion: string;
  releaseReceiptId: string;
  releaseVersion: string;
  source: SourceVersionBinding;
  tenantId: string;
};

export type BusinessEvent = {
  actionId: string;
  approvalReceiptId: string;
  businessEventId: string;
  contractVersion: typeof BUSINESS_EVENT_BOUNDARY_VERSION;
  eventId: string;
  eventType: BusinessEventType;
  occurredAt: string;
  operationId: string;
  payloadHash: string;
  releaseReceiptId: string;
  sequence: number;
  sourceVersion: string;
  tenantId: string;
  evidence: {
    attemptRef: string | null;
    providerAcknowledgementRef: string | null;
    readback: (SourceVersionBinding & {
      observedAt: string;
      payloadHash: string;
      source: string;
      sourceReadbackRef: string;
    }) | null;
  };
};

export type BusinessEventReceipt = {
  accepted: boolean;
  actionId: string;
  boundaryEffectAuthority: "NO_EFFECT";
  businessEventId: string;
  businessFinal: boolean;
  contractVersion: typeof BUSINESS_EVENT_BOUNDARY_VERSION;
  eventId: string;
  eventType: BusinessEventType;
  finality: "NOT_FINAL" | "PROVIDER_ACKNOWLEDGED" | "RECONCILING" | "SOURCE_CONFIRMED";
  grantsAuthority: false;
  outcome:
    | "ACTION_RELEASE_RECORDED"
    | "EFFECT_DISPATCH_OBSERVED"
    | "PROVIDER_ACKNOWLEDGEMENT_RECORDED"
    | "RECONCILIATION_REQUIRED"
    | "SOURCE_CONFIRMATION_RECORDED"
    | "REJECTED";
  receiptHash: string;
  receiptId: string;
  rejectionCode: BoundaryRejectionCode | null;
  releaseReceiptId: string;
  sequence: number;
  sourceReadbackRef: string | null;
  stateVersion: number;
};

export type BoundaryRejectionCode =
  | "ALREADY_FINAL"
  | "BUSINESS_EVENT_CONFLICT"
  | "EVENT_ID_CONFLICT"
  | "INVALID_TRANSITION"
  | "OUT_OF_ORDER"
  | "RELEASE_BINDING_MISMATCH"
  | "SOURCE_READBACK_INVALID"
  | "STALE_APPROVAL"
  | "STALE_SEQUENCE";

type JournalEntry = {
  businessEventId: string;
  eventHash: string;
  eventId: string;
  receipt: BusinessEventReceipt;
  semanticHash: string;
};

export type BusinessEventBoundaryState = {
  actionId: string;
  businessFinal: boolean;
  contractVersion: typeof BUSINESS_EVENT_BOUNDARY_VERSION;
  dispatchObservationCount: number;
  effectReservationCount: number;
  effectReservationKey: string | null;
  finality: BusinessEventReceipt["finality"];
  journal: readonly JournalEntry[];
  nextSequence: number;
  phase: "AWAITING_RELEASE" | "RELEASED" | "EFFECT_DISPATCH_STARTED" | "PROVIDER_ACKNOWLEDGED" | "RECONCILIATION_REQUIRED" | "SOURCE_CONFIRMED";
  releaseHash: string;
  stateHash: string;
  stateVersion: number;
  tenantId: string;
};

export type BoundaryEvaluation = {
  deliveryDisposition: "ACCEPTED" | "BUSINESS_DUPLICATE" | "EXACT_REPLAY" | "REJECTED";
  dispatchObservationDelta: 0 | 1;
  effectReservationDelta: 0 | 1;
  receipt: BusinessEventReceipt;
  state: BusinessEventBoundaryState;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;
const HASH = /^[a-f0-9]{64}$/;
const APPROVAL_WINDOW_MS = 15 * 60_000;

export function createReleasedBusinessAction(
  input: Omit<ReleasedBusinessAction, "contractVersion">,
): ReleasedBusinessAction {
  const action: ReleasedBusinessAction = {
    ...input,
    approval: { ...input.approval },
    authoritativeReadback: { ...input.authoritativeReadback },
    capabilityDiscovery: input.capabilityDiscovery ? { ...input.capabilityDiscovery } : null,
    contractVersion: BUSINESS_EVENT_BOUNDARY_VERSION,
    source: { ...input.source },
  };
  assertReleasedAction(action);
  return Object.freeze(action);
}

export function createBusinessEventBoundaryState(action: ReleasedBusinessAction): BusinessEventBoundaryState {
  assertReleasedAction(action);
  return finalizeState({
    actionId: action.actionId,
    businessFinal: false,
    contractVersion: BUSINESS_EVENT_BOUNDARY_VERSION,
    dispatchObservationCount: 0,
    effectReservationCount: 0,
    effectReservationKey: null,
    finality: "NOT_FINAL",
    journal: [],
    nextSequence: 1,
    phase: "AWAITING_RELEASE",
    releaseHash: sha256(action),
    stateVersion: 0,
    tenantId: action.tenantId,
  });
}

export function evaluateBusinessEvent(input: {
  action: ReleasedBusinessAction;
  currentSource: (SourceVersionBinding & { observedAt: string; sourceRef: string }) | null;
  event: BusinessEvent;
  now: string;
  state: BusinessEventBoundaryState;
}): BoundaryEvaluation {
  assertReleasedAction(input.action);
  assertState(input.state);
  assertEvent(input.event);
  const now = iso(input.now, "now");
  const eventHash = sha256(input.event);
  const { eventId: _transportDeliveryId, ...semanticEvent } = input.event;
  void _transportDeliveryId;
  const semanticHash = sha256(semanticEvent);

  const eventReplay = input.state.journal.find((entry) => entry.eventId === input.event.eventId);
  if (eventReplay) {
    if (eventReplay.eventHash !== eventHash) return reject(input, "EVENT_ID_CONFLICT");
    return unchanged(input.state, eventReplay.receipt, "EXACT_REPLAY");
  }
  const businessDuplicate = input.state.journal.find((entry) => entry.businessEventId === input.event.businessEventId);
  if (businessDuplicate) {
    if (businessDuplicate.semanticHash !== semanticHash) return reject(input, "BUSINESS_EVENT_CONFLICT");
    return unchanged(input.state, businessDuplicate.receipt, "BUSINESS_DUPLICATE");
  }

  if (!eventBindsRelease(input.action, input.event) || input.state.releaseHash !== sha256(input.action)
    || input.state.actionId !== input.action.actionId || input.state.tenantId !== input.action.tenantId) {
    return reject(input, "RELEASE_BINDING_MISMATCH");
  }
  if (input.event.sequence > input.state.nextSequence) return reject(input, "OUT_OF_ORDER");
  if (input.event.sequence < input.state.nextSequence) return reject(input, "STALE_SEQUENCE");
  if (input.state.phase === "SOURCE_CONFIRMED") return reject(input, "ALREADY_FINAL");

  if (["ACTION_RELEASED", "EFFECT_DISPATCH_STARTED"].includes(input.event.eventType)
    && !approvalIsCurrent(input.action, input.currentSource, input.event.occurredAt, now)) {
    return reject(input, "STALE_APPROVAL");
  }
  const transition = transitionFor(input.state.phase, input.event.eventType);
  if (!transition) return reject(input, "INVALID_TRANSITION");
  if (input.event.eventType === "SOURCE_CONFIRMED" && !readbackIsExact(input.action, input.event, now)) {
    return reject(input, "SOURCE_READBACK_INVALID");
  }
  if (input.event.eventType === "EFFECT_DISPATCH_STARTED" && !input.event.evidence.attemptRef) {
    return reject(input, "INVALID_TRANSITION");
  }
  if (input.event.eventType === "DELIVERY_AMBIGUOUS" && !input.event.evidence.attemptRef) {
    return reject(input, "INVALID_TRANSITION");
  }
  if (input.event.eventType === "PROVIDER_ACKNOWLEDGED" && !input.event.evidence.providerAcknowledgementRef) {
    return reject(input, "INVALID_TRANSITION");
  }
  if ((input.event.eventType !== "SOURCE_CONFIRMED" && input.event.evidence.readback)
    || (input.event.eventType !== "PROVIDER_ACKNOWLEDGED" && input.event.evidence.providerAcknowledgementRef)
    || (!["EFFECT_DISPATCH_STARTED", "DELIVERY_AMBIGUOUS"].includes(input.event.eventType)
      && input.event.evidence.attemptRef)) {
    return reject(input, "INVALID_TRANSITION");
  }

  const effectReservationDelta = input.event.eventType === "ACTION_RELEASED" ? 1 : 0;
  const dispatchObservationDelta = input.event.eventType === "EFFECT_DISPATCH_STARTED" ? 1 : 0;
  if (input.state.effectReservationCount + effectReservationDelta > 1
    || input.state.dispatchObservationCount + dispatchObservationDelta > 1) {
    return reject(input, "INVALID_TRANSITION");
  }
  const stateVersion = input.state.stateVersion + 1;
  const finality = finalityFor(input.event.eventType);
  const receipt = makeReceipt({
    accepted: true,
    action: input.action,
    event: input.event,
    finality,
    outcome: transition.outcome,
    rejectionCode: null,
    stateVersion,
  });
  const state = finalizeState({
    ...input.state,
    businessFinal: finality === "SOURCE_CONFIRMED",
    dispatchObservationCount: input.state.dispatchObservationCount + dispatchObservationDelta,
    effectReservationCount: input.state.effectReservationCount + effectReservationDelta,
    effectReservationKey: input.state.effectReservationKey
      ?? `effect-reservation:${sha256([input.action.tenantId, input.action.actionId, input.action.releaseReceiptId])}`,
    finality,
    journal: [...input.state.journal, {
      businessEventId: input.event.businessEventId,
      eventHash,
      eventId: input.event.eventId,
      receipt,
      semanticHash,
    }],
    nextSequence: input.state.nextSequence + 1,
    phase: transition.phase,
    stateVersion,
  });
  return { deliveryDisposition: "ACCEPTED", dispatchObservationDelta, effectReservationDelta, receipt, state };
}

function eventBindsRelease(action: ReleasedBusinessAction, event: BusinessEvent) {
  return event.contractVersion === BUSINESS_EVENT_BOUNDARY_VERSION
    && event.actionId === action.actionId
    && event.approvalReceiptId === action.approval.receiptId
    && event.operationId === action.operationId
    && event.payloadHash === action.payloadHash
    && event.releaseReceiptId === action.releaseReceiptId
    && event.sourceVersion === action.source.version
    && event.tenantId === action.tenantId;
}

function approvalIsCurrent(
  action: ReleasedBusinessAction,
  currentSource: (SourceVersionBinding & { observedAt: string; sourceRef: string }) | null,
  occurredAt: string,
  now: string,
) {
  if (!currentSource || !currentSource.sourceRef.trim()) return false;
  const observedAt = Date.parse(currentSource.observedAt);
  const occurred = Date.parse(occurredAt);
  const processing = Date.parse(now);
  const approved = Date.parse(action.approval.approvedAt);
  const expires = Date.parse(action.approval.expiresAt);
  return sourceBindingEquals(currentSource, action.source)
    && Number.isFinite(observedAt)
    && observedAt <= occurred
    && observedAt <= processing
    && approved <= occurred
    && occurred <= processing
    && processing < expires;
}

function readbackIsExact(action: ReleasedBusinessAction, event: BusinessEvent, now: string) {
  const readback = event.evidence.readback;
  return Boolean(readback
    && readback.sourceReadbackRef.trim()
    && readback.source === action.authoritativeReadback.source
    && readback.objectId === action.authoritativeReadback.objectId
    && readback.objectType === action.authoritativeReadback.objectType
    && readback.owner === action.authoritativeReadback.owner
    && readback.version === action.authoritativeReadback.expectedResultVersion
    && readback.payloadHash === action.payloadHash
    && Number.isFinite(Date.parse(readback.observedAt))
    && Date.parse(readback.observedAt) >= Date.parse(event.occurredAt)
    && Date.parse(readback.observedAt) <= Date.parse(now));
}

function sourceBindingEquals(left: SourceVersionBinding, right: SourceVersionBinding) {
  return left.objectId === right.objectId
    && left.objectType === right.objectType
    && left.owner === right.owner
    && left.version === right.version;
}

function transitionFor(phase: BusinessEventBoundaryState["phase"], eventType: BusinessEventType) {
  if (phase === "AWAITING_RELEASE" && eventType === "ACTION_RELEASED") {
    return { outcome: "ACTION_RELEASE_RECORDED" as const, phase: "RELEASED" as const };
  }
  if (phase === "RELEASED" && eventType === "EFFECT_DISPATCH_STARTED") {
    return { outcome: "EFFECT_DISPATCH_OBSERVED" as const, phase: "EFFECT_DISPATCH_STARTED" as const };
  }
  if (["EFFECT_DISPATCH_STARTED", "PROVIDER_ACKNOWLEDGED"].includes(phase) && eventType === "DELIVERY_AMBIGUOUS") {
    return { outcome: "RECONCILIATION_REQUIRED" as const, phase: "RECONCILIATION_REQUIRED" as const };
  }
  if (phase === "EFFECT_DISPATCH_STARTED" && eventType === "PROVIDER_ACKNOWLEDGED") {
    return { outcome: "PROVIDER_ACKNOWLEDGEMENT_RECORDED" as const, phase: "PROVIDER_ACKNOWLEDGED" as const };
  }
  if (["EFFECT_DISPATCH_STARTED", "PROVIDER_ACKNOWLEDGED", "RECONCILIATION_REQUIRED"].includes(phase)
    && eventType === "SOURCE_CONFIRMED") {
    return { outcome: "SOURCE_CONFIRMATION_RECORDED" as const, phase: "SOURCE_CONFIRMED" as const };
  }
  return null;
}

function finalityFor(eventType: BusinessEventType): BusinessEventReceipt["finality"] {
  if (eventType === "PROVIDER_ACKNOWLEDGED") return "PROVIDER_ACKNOWLEDGED";
  if (eventType === "DELIVERY_AMBIGUOUS") return "RECONCILING";
  if (eventType === "SOURCE_CONFIRMED") return "SOURCE_CONFIRMED";
  return "NOT_FINAL";
}

function reject(
  input: { action: ReleasedBusinessAction; event: BusinessEvent; state: BusinessEventBoundaryState },
  rejectionCode: BoundaryRejectionCode,
): BoundaryEvaluation {
  const receipt = makeReceipt({
    accepted: false,
    action: input.action,
    event: input.event,
    finality: input.state.finality,
    outcome: "REJECTED",
    rejectionCode,
    stateVersion: input.state.stateVersion,
  });
  return unchanged(input.state, receipt, "REJECTED");
}

function unchanged(
  state: BusinessEventBoundaryState,
  receipt: BusinessEventReceipt,
  deliveryDisposition: BoundaryEvaluation["deliveryDisposition"],
): BoundaryEvaluation {
  return { deliveryDisposition, dispatchObservationDelta: 0, effectReservationDelta: 0, receipt, state };
}

function makeReceipt(input: {
  accepted: boolean;
  action: ReleasedBusinessAction;
  event: BusinessEvent;
  finality: BusinessEventReceipt["finality"];
  outcome: BusinessEventReceipt["outcome"];
  rejectionCode: BoundaryRejectionCode | null;
  stateVersion: number;
}): BusinessEventReceipt {
  const unsigned = {
    accepted: input.accepted,
    actionId: input.action.actionId,
    boundaryEffectAuthority: "NO_EFFECT" as const,
    businessEventId: input.event.businessEventId,
    businessFinal: input.accepted && input.finality === "SOURCE_CONFIRMED",
    contractVersion: BUSINESS_EVENT_BOUNDARY_VERSION,
    eventId: input.event.eventId,
    eventType: input.event.eventType,
    finality: input.finality,
    grantsAuthority: false as const,
    outcome: input.outcome,
    receiptId: `business-event-receipt:${sha256([
      input.action.tenantId,
      input.action.actionId,
      input.event.businessEventId,
      input.event.sequence,
      input.event.eventType,
      input.accepted,
      input.rejectionCode,
    ])}`,
    rejectionCode: input.rejectionCode,
    releaseReceiptId: input.action.releaseReceiptId,
    sequence: input.event.sequence,
    sourceReadbackRef: input.accepted && input.event.eventType === "SOURCE_CONFIRMED"
      ? input.event.evidence.readback?.sourceReadbackRef ?? null
      : null,
    stateVersion: input.stateVersion,
  };
  return Object.freeze({ ...unsigned, receiptHash: sha256(unsigned) });
}

function finalizeState(input: Omit<BusinessEventBoundaryState, "stateHash"> | BusinessEventBoundaryState): BusinessEventBoundaryState {
  const { stateHash: _priorStateHash, ...withoutStateHash } = input as BusinessEventBoundaryState;
  void _priorStateHash;
  const unsigned = { ...withoutStateHash, journal: Object.freeze([...withoutStateHash.journal]) };
  return Object.freeze({ ...unsigned, stateHash: sha256(unsigned) });
}

function assertState(state: BusinessEventBoundaryState) {
  const { stateHash, ...unsigned } = state;
  if (state.contractVersion !== BUSINESS_EVENT_BOUNDARY_VERSION || stateHash !== sha256(unsigned)) {
    throw new Error("Business-event boundary state integrity is invalid.");
  }
  if (state.effectReservationCount < 0 || state.effectReservationCount > 1
    || state.dispatchObservationCount < 0 || state.dispatchObservationCount > 1
    || !Number.isInteger(state.nextSequence) || state.nextSequence < 1
    || !Number.isInteger(state.stateVersion) || state.stateVersion < 0) {
    throw new Error("Business-event boundary state counters are invalid.");
  }
}

function assertReleasedAction(action: ReleasedBusinessAction) {
  if (action.contractVersion !== BUSINESS_EVENT_BOUNDARY_VERSION) throw new Error("Released action contractVersion is invalid.");
  [action.actionId, action.operationId, action.releaseReceiptId, action.releaseVersion, action.policyVersion,
    action.canonicalOwner, action.tenantId].forEach((value, index) => identifier(value, `releasedAction[${index}]`));
  if (!businessActionKinds.includes(action.actionKind)) throw new Error("Released action kind is invalid.");
  hash(action.payloadHash, "payloadHash");
  assertSource(action.source, "source");
  assertSource(action.authoritativeReadback, "authoritativeReadback");
  if (action.canonicalOwner !== action.source.owner || action.authoritativeReadback.owner !== action.canonicalOwner
    || action.authoritativeReadback.objectId !== action.source.objectId
    || action.authoritativeReadback.objectType !== action.source.objectType) {
    throw new Error("Released action source and readback must retain one canonical record owner and identity.");
  }
  identifier(action.authoritativeReadback.expectedResultVersion, "authoritativeReadback.expectedResultVersion");
  identifier(action.authoritativeReadback.source, "authoritativeReadback.source");
  const approval = action.approval;
  [approval.actionId, approval.approvalId, approval.operationId, approval.policyVersion, approval.receiptId,
    approval.sourceVersion, approval.tenantId].forEach((value, index) => identifier(value, `approval[${index}]`));
  hash(approval.payloadHash, "approval.payloadHash");
  const approvedAt = Date.parse(iso(approval.approvedAt, "approval.approvedAt"));
  const expiresAt = Date.parse(iso(approval.expiresAt, "approval.expiresAt"));
  if (approval.decision !== "APPROVE" || expiresAt <= approvedAt || expiresAt - approvedAt > APPROVAL_WINDOW_MS
    || approval.actionId !== action.actionId || approval.operationId !== action.operationId
    || approval.payloadHash !== action.payloadHash || approval.policyVersion !== action.policyVersion
    || approval.sourceVersion !== action.source.version || approval.tenantId !== action.tenantId) {
    throw new Error("Approval does not bind the exact released action, policy, source version, and tenant.");
  }
  if (action.capabilityDiscovery) {
    const discovery = action.capabilityDiscovery;
    if (discovery.acceptedC04Head !== ACCEPTED_SGO_C04_HEAD
      || discovery.discoveryGrantsAuthority !== false
      || discovery.manifestContractVersion !== LUZIONE_SULTAN_TOOL_MANIFEST_V1
      || discovery.sourceOwner !== "CIBOTFLOW/Luzione-API") {
      throw new Error("C04 capability discovery evidence is invalid or attempts to grant authority.");
    }
    hash(discovery.manifestHash, "capabilityDiscovery.manifestHash");
    identifier(discovery.toolId, "capabilityDiscovery.toolId");
    identifier(discovery.toolVersion, "capabilityDiscovery.toolVersion");
  }
}

function assertEvent(event: BusinessEvent) {
  if (event.contractVersion !== BUSINESS_EVENT_BOUNDARY_VERSION || !businessEventTypes.includes(event.eventType)) {
    throw new Error("Business event contract is invalid.");
  }
  [event.actionId, event.approvalReceiptId, event.businessEventId, event.eventId, event.operationId,
    event.releaseReceiptId, event.sourceVersion, event.tenantId].forEach((value, index) => identifier(value, `event[${index}]`));
  hash(event.payloadHash, "event.payloadHash");
  iso(event.occurredAt, "event.occurredAt");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error("event.sequence must be a positive safe integer.");
  if (event.evidence.attemptRef !== null) identifier(event.evidence.attemptRef, "event.evidence.attemptRef");
  if (event.evidence.providerAcknowledgementRef !== null) identifier(event.evidence.providerAcknowledgementRef, "event.evidence.providerAcknowledgementRef");
  if (event.evidence.readback) {
    assertSource(event.evidence.readback, "event.evidence.readback");
    hash(event.evidence.readback.payloadHash, "event.evidence.readback.payloadHash");
    iso(event.evidence.readback.observedAt, "event.evidence.readback.observedAt");
    identifier(event.evidence.readback.source, "event.evidence.readback.source");
    identifier(event.evidence.readback.sourceReadbackRef, "event.evidence.readback.sourceReadbackRef");
  }
}

function assertSource(source: SourceVersionBinding, field: string) {
  identifier(source.objectId, `${field}.objectId`);
  identifier(source.objectType, `${field}.objectType`);
  identifier(source.owner, `${field}.owner`);
  identifier(source.version, `${field}.version`);
}

function identifier(value: string, field: string) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${field} must be a bounded canonical identifier.`);
}

function hash(value: string, field: string) {
  if (!HASH.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest.`);
}

function iso(value: string, field: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}
