import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  ACCEPTED_SGO_C04_HEAD,
  BUSINESS_EVENT_BOUNDARY_VERSION,
  createBusinessEventBoundaryState,
  createReleasedBusinessAction,
  evaluateBusinessEvent,
  type BusinessActionKind,
  type BusinessEvent,
  type ReleasedBusinessAction,
  type SourceVersionBinding,
} from "../sgoV03BusinessEvent";

const APPROVED_AT = "2026-09-11T20:10:00.000Z";
const FRESH_NOW = "2026-09-11T20:11:00.000Z";
const EXPIRES_AT = "2026-09-11T20:20:00.000Z";
const PAYLOAD_HASH = sha256({ exact: "payload-v7" });
const MANIFEST_HASH = sha256({ exact: "accepted-c04-manifest" });

function action(actionKind: BusinessActionKind = "COMMUNICATION_SEND", overrides: Partial<ReleasedBusinessAction> = {}) {
  const source = {
    objectId: `${actionKind.toLowerCase()}-1`,
    objectType: actionKind.toLowerCase(),
    owner: "CIBOTFLOW/Luzione-API:canonical-domain-owner",
    version: `${actionKind.toLowerCase()}:v7`,
  };
  const actionId = `released-${actionKind.toLowerCase()}-1`;
  const operationId = `operation-${actionKind.toLowerCase()}-1`;
  const policyVersion = "business-action-policy:v3";
  const tenantId = "tenant-a";
  return createReleasedBusinessAction({
    actionId,
    actionKind,
    approval: {
      actionId,
      approvalId: `approval-${actionKind.toLowerCase()}-1`,
      approvedAt: APPROVED_AT,
      decision: "APPROVE",
      expiresAt: EXPIRES_AT,
      operationId,
      payloadHash: PAYLOAD_HASH,
      policyVersion,
      receiptId: `approval-receipt-${actionKind.toLowerCase()}-1`,
      sourceVersion: source.version,
      tenantId,
    },
    authoritativeReadback: {
      ...source,
      expectedResultVersion: `${actionKind.toLowerCase()}:result-v1`,
      source: actionKind === "ORDER_CREATE" ? "canonical-postgres:orders" : "provider-source:business-effects",
    },
    capabilityDiscovery: actionKind === "COMMUNICATION_SEND" ? {
      acceptedC04Head: ACCEPTED_SGO_C04_HEAD,
      discoveryGrantsAuthority: false,
      manifestContractVersion: "luzione-sultan-tool-manifest/v1",
      manifestHash: MANIFEST_HASH,
      sourceOwner: "CIBOTFLOW/Luzione-API",
      toolId: "luzione.supplier_rfq_email.send",
      toolVersion: "v1",
    } : null,
    canonicalOwner: source.owner,
    operationId,
    payloadHash: PAYLOAD_HASH,
    policyVersion,
    releaseReceiptId: `release-receipt-${actionKind.toLowerCase()}-1`,
    releaseVersion: "release:v1",
    source,
    tenantId,
    ...overrides,
  });
}

function source(value: ReleasedBusinessAction, version = value.source.version) {
  return {
    ...value.source,
    observedAt: "2026-09-11T20:10:30.000Z",
    sourceRef: `postgres:${value.source.objectType}/${value.source.objectId}@${version}`,
    version,
  };
}

function event(
  value: ReleasedBusinessAction,
  eventType: BusinessEvent["eventType"],
  sequence: number,
  overrides: Partial<BusinessEvent> = {},
): BusinessEvent {
  return {
    actionId: value.actionId,
    approvalReceiptId: value.approval.receiptId,
    businessEventId: `business-event-${sequence}-${eventType.toLowerCase()}`,
    contractVersion: BUSINESS_EVENT_BOUNDARY_VERSION,
    eventId: `delivery-${sequence}-${eventType.toLowerCase()}`,
    eventType,
    occurredAt: `2026-09-11T20:${String(10 + sequence).padStart(2, "0")}:00.000Z`,
    operationId: value.operationId,
    payloadHash: value.payloadHash,
    releaseReceiptId: value.releaseReceiptId,
    sequence,
    sourceVersion: value.source.version,
    tenantId: value.tenantId,
    evidence: {
      attemptRef: eventType === "EFFECT_DISPATCH_STARTED" || eventType === "DELIVERY_AMBIGUOUS" ? "attempt-1" : null,
      providerAcknowledgementRef: eventType === "PROVIDER_ACKNOWLEDGED" ? "provider-ack-1" : null,
      readback: eventType === "SOURCE_CONFIRMED" ? {
        objectId: value.authoritativeReadback.objectId,
        objectType: value.authoritativeReadback.objectType,
        observedAt: "2026-09-11T20:19:30.000Z",
        owner: value.authoritativeReadback.owner,
        payloadHash: value.payloadHash,
        source: value.authoritativeReadback.source,
        sourceReadbackRef: `readback:${value.actionId}:result-v1`,
        version: value.authoritativeReadback.expectedResultVersion,
      } : null,
    },
    ...overrides,
  };
}

function advance(value: ReleasedBusinessAction, events: readonly BusinessEvent[]) {
  let state = createBusinessEventBoundaryState(value);
  const results = events.map((item) => {
    const result = evaluateBusinessEvent({ action: value, currentSource: source(value), event: item, now: "2026-09-11T20:19:00.000Z", state });
    state = result.state;
    return result;
  });
  return { results, state };
}

test("send, order and other effect releases create one stable reservation and one dispatch observation", () => {
  for (const kind of ["COMMUNICATION_SEND", "ORDER_CREATE", "OTHER_EFFECT"] as const) {
    const released = action(kind);
    const releasedEvent = event(released, "ACTION_RELEASED", 1);
    const dispatchEvent = event(released, "EFFECT_DISPATCH_STARTED", 2);
    const { results, state } = advance(released, [releasedEvent, dispatchEvent]);
    assert.deepEqual(results.map((result) => result.effectReservationDelta), [1, 0]);
    assert.deepEqual(results.map((result) => result.dispatchObservationDelta), [0, 1]);
    assert.equal(state.effectReservationCount, 1);
    assert.equal(state.dispatchObservationCount, 1);
    assert.equal(state.businessFinal, false);
    assert.equal(results[0].receipt.grantsAuthority, false);
    assert.equal(results[0].receipt.boundaryEffectAuthority, "NO_EFFECT");
  }
});

test("machine matrix pins existing API/C04 semantics and keeps every runtime boundary held", () => {
  const matrix = JSON.parse(readFileSync("engineering/execution/SGO_V03_BUSINESS_EVENT_MATRIX_V1.json", "utf8")) as {
    accepted_api_base_sha: string;
    accepted_c04: { accepted_exact_head: string; consumer_integration: string; discovery_grants_authority: boolean };
    action_class_proof: Array<{ action_kind: string; proof_state: string }>;
    allowlist_count: number;
    build_program: string;
    effect_authority: string;
    grants_authority: boolean;
    source_pins: Array<{ path: string; raw_sha256: string }>;
    task_id: string;
    unexercised_boundaries: string[];
  };
  assert.deepEqual({
    allowlist: matrix.allowlist_count,
    base: matrix.accepted_api_base_sha,
    buildProgram: matrix.build_program,
    effectAuthority: matrix.effect_authority,
    grantsAuthority: matrix.grants_authority,
    task: matrix.task_id,
  }, {
    allowlist: 68,
    base: "055bdaf20536c27cb8c016cbcd33c6f1fba52785",
    buildProgram: "SGO-20260911-01",
    effectAuthority: "NO_EFFECT",
    grantsAuthority: false,
    task: "SGO-V03",
  });
  assert.deepEqual(matrix.action_class_proof.map((row) => row.action_kind), ["COMMUNICATION_SEND", "ORDER_CREATE", "OTHER_EFFECT"]);
  assert.ok(matrix.action_class_proof.every((row) => row.proof_state === "PROVIDER_FREE_FIXTURE_ONLY"));
  assert.deepEqual(matrix.accepted_c04, {
    ...matrix.accepted_c04,
    accepted_exact_head: ACCEPTED_SGO_C04_HEAD,
    consumer_integration: "G1_HOLD_NOT_EXERCISED_BY_V03",
    discovery_grants_authority: false,
  });
  assert.equal(matrix.source_pins.length, 9);
  for (const pin of matrix.source_pins) {
    assert.equal(crypto.createHash("sha256").update(readFileSync(pin.path)).digest("hex"), pin.raw_sha256, pin.path);
  }
  assert.ok(matrix.unexercised_boundaries.some((boundary) => boundary.includes("runtime mounting")));
  assert.ok(matrix.unexercised_boundaries.some((boundary) => boundary.includes("multi-worker concurrency")));
});

test("exact replay returns the original receipt after approval expiry without another reservation or dispatch", () => {
  const released = action();
  const releasedEvent = event(released, "ACTION_RELEASED", 1);
  const first = evaluateBusinessEvent({ action: released, currentSource: source(released), event: releasedEvent, now: FRESH_NOW, state: createBusinessEventBoundaryState(released) });
  const replay = evaluateBusinessEvent({ action: released, currentSource: null, event: releasedEvent, now: "2026-09-11T20:30:00.000Z", state: first.state });
  assert.equal(replay.deliveryDisposition, "EXACT_REPLAY");
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(replay.state, first.state);
  assert.equal(replay.effectReservationDelta, 0);
  assert.equal(replay.dispatchObservationDelta, 0);
});

test("a second transport delivery of the same business event is deduplicated to the original receipt", () => {
  const released = action();
  const original = event(released, "ACTION_RELEASED", 1);
  const first = evaluateBusinessEvent({ action: released, currentSource: source(released), event: original, now: FRESH_NOW, state: createBusinessEventBoundaryState(released) });
  const duplicate = evaluateBusinessEvent({ action: released, currentSource: null, event: { ...original, eventId: "delivery-duplicate" }, now: "2026-09-11T20:30:00.000Z", state: first.state });
  assert.equal(duplicate.deliveryDisposition, "BUSINESS_DUPLICATE");
  assert.deepEqual(duplicate.receipt, first.receipt);
  assert.equal(duplicate.effectReservationDelta, 0);
  assert.equal(duplicate.state.effectReservationCount, 1);
});

test("same transport or business identity with changed contents fails closed", () => {
  const released = action();
  const original = event(released, "ACTION_RELEASED", 1);
  const first = evaluateBusinessEvent({ action: released, currentSource: source(released), event: original, now: FRESH_NOW, state: createBusinessEventBoundaryState(released) });
  const changedDelivery = evaluateBusinessEvent({ action: released, currentSource: source(released), event: { ...original, sourceVersion: "communication_send:v8" }, now: FRESH_NOW, state: first.state });
  assert.equal(changedDelivery.receipt.rejectionCode, "EVENT_ID_CONFLICT");
  const changedBusiness = evaluateBusinessEvent({ action: released, currentSource: source(released), event: { ...original, eventId: "delivery-other", sourceVersion: "communication_send:v8" }, now: FRESH_NOW, state: first.state });
  assert.equal(changedBusiness.receipt.rejectionCode, "BUSINESS_EVENT_CONFLICT");
  assert.equal(changedBusiness.state.effectReservationCount, 1);
});

test("out-of-order delivery is held without consuming sequence or creating effect evidence", () => {
  const released = action();
  const initial = createBusinessEventBoundaryState(released);
  const earlyDispatch = evaluateBusinessEvent({ action: released, currentSource: source(released), event: event(released, "EFFECT_DISPATCH_STARTED", 2), now: FRESH_NOW, state: initial });
  assert.equal(earlyDispatch.receipt.rejectionCode, "OUT_OF_ORDER");
  assert.equal(earlyDispatch.state, initial);
  assert.equal(earlyDispatch.state.effectReservationCount, 0);
  assert.equal(earlyDispatch.state.dispatchObservationCount, 0);

  const acceptedRelease = evaluateBusinessEvent({ action: released, currentSource: source(released), event: event(released, "ACTION_RELEASED", 1), now: FRESH_NOW, state: initial });
  const earlyAmbiguity = evaluateBusinessEvent({ action: released, currentSource: source(released), event: event(released, "DELIVERY_AMBIGUOUS", 3), now: FRESH_NOW, state: acceptedRelease.state });
  assert.equal(earlyAmbiguity.receipt.rejectionCode, "OUT_OF_ORDER");
  assert.equal(earlyAmbiguity.state.dispatchObservationCount, 0);
  assert.equal(earlyAmbiguity.state.nextSequence, 2);
});

test("expired, future, missing and version-drifted approval source evidence creates no reservation", () => {
  const released = action();
  const releaseEvent = event(released, "ACTION_RELEASED", 1);
  const cases: readonly { currentSource: ReturnType<typeof source> | null; event: BusinessEvent; now: string }[] = [
    { currentSource: source(released), event: releaseEvent, now: "2026-09-11T20:20:00.000Z" },
    { currentSource: source(released), event: { ...releaseEvent, occurredAt: "2026-09-11T20:09:59.000Z" }, now: FRESH_NOW },
    { currentSource: null, event: releaseEvent, now: FRESH_NOW },
    { currentSource: source(released, "communication_send:v8"), event: releaseEvent, now: FRESH_NOW },
  ];
  for (const item of cases) {
    const result = evaluateBusinessEvent({ action: released, state: createBusinessEventBoundaryState(released), ...item });
    assert.equal(result.receipt.rejectionCode, "STALE_APPROVAL");
    assert.equal(result.state.effectReservationCount, 0);
    assert.equal(result.state.nextSequence, 1);
  }
});

test("approval freshness is rechecked before first dispatch but not used to block exact replay", () => {
  const released = action();
  const releaseEvent = event(released, "ACTION_RELEASED", 1);
  const first = evaluateBusinessEvent({ action: released, currentSource: source(released), event: releaseEvent, now: FRESH_NOW, state: createBusinessEventBoundaryState(released) });
  const lateDispatch = evaluateBusinessEvent({ action: released, currentSource: source(released), event: event(released, "EFFECT_DISPATCH_STARTED", 2), now: "2026-09-11T20:21:00.000Z", state: first.state });
  assert.equal(lateDispatch.receipt.rejectionCode, "STALE_APPROVAL");
  assert.equal(lateDispatch.state.dispatchObservationCount, 0);
  const replay = evaluateBusinessEvent({ action: released, currentSource: null, event: releaseEvent, now: "2026-09-11T20:21:00.000Z", state: first.state });
  assert.equal(replay.deliveryDisposition, "EXACT_REPLAY");
});

test("source evidence observed after release or first dispatch cannot authorize either event", () => {
  const released = action();
  const initial = createBusinessEventBoundaryState(released);
  const releaseEvent = event(released, "ACTION_RELEASED", 1);
  const postReleaseSource = {
    ...source(released),
    observedAt: "2026-09-11T20:18:00.000Z",
  };
  const rejectedRelease = evaluateBusinessEvent({
    action: released,
    currentSource: postReleaseSource,
    event: releaseEvent,
    now: "2026-09-11T20:19:00.000Z",
    state: initial,
  });
  assert.equal(rejectedRelease.receipt.rejectionCode, "STALE_APPROVAL");
  assert.equal(rejectedRelease.state, initial);
  assert.equal(rejectedRelease.state.effectReservationCount, 0);
  assert.equal(rejectedRelease.state.dispatchObservationCount, 0);
  assert.equal(rejectedRelease.state.businessFinal, false);

  const acceptedRelease = evaluateBusinessEvent({
    action: released,
    currentSource: source(released),
    event: releaseEvent,
    now: FRESH_NOW,
    state: initial,
  });
  const dispatchEvent = event(released, "EFFECT_DISPATCH_STARTED", 2);
  const postDispatchSource = {
    ...source(released),
    observedAt: "2026-09-11T20:18:00.000Z",
  };
  const rejectedDispatch = evaluateBusinessEvent({
    action: released,
    currentSource: postDispatchSource,
    event: dispatchEvent,
    now: "2026-09-11T20:19:00.000Z",
    state: acceptedRelease.state,
  });
  assert.equal(rejectedDispatch.receipt.rejectionCode, "STALE_APPROVAL");
  assert.equal(rejectedDispatch.state, acceptedRelease.state);
  assert.equal(rejectedDispatch.state.effectReservationCount, 1);
  assert.equal(rejectedDispatch.state.dispatchObservationCount, 0);
  assert.equal(rejectedDispatch.state.businessFinal, false);
});

test("ambiguous network outcome requires reconciliation and cannot admit a second effect attempt", () => {
  const released = action();
  const { state } = advance(released, [event(released, "ACTION_RELEASED", 1), event(released, "EFFECT_DISPATCH_STARTED", 2)]);
  const ambiguousEvent = event(released, "DELIVERY_AMBIGUOUS", 3);
  const ambiguous = evaluateBusinessEvent({ action: released, currentSource: null, event: ambiguousEvent, now: "2026-09-11T20:19:00.000Z", state });
  assert.equal(ambiguous.receipt.outcome, "RECONCILIATION_REQUIRED");
  assert.equal(ambiguous.receipt.finality, "RECONCILING");
  assert.equal(ambiguous.receipt.businessFinal, false);
  assert.equal(ambiguous.state.effectReservationCount, 1);
  assert.equal(ambiguous.state.dispatchObservationCount, 1);

  const retry = evaluateBusinessEvent({ action: released, currentSource: source(released), event: event(released, "EFFECT_DISPATCH_STARTED", 4, { businessEventId: "business-event-retry", eventId: "delivery-retry" }), now: "2026-09-11T20:19:00.000Z", state: ambiguous.state });
  assert.equal(retry.receipt.rejectionCode, "INVALID_TRANSITION");
  assert.equal(retry.dispatchObservationDelta, 0);
  assert.equal(retry.state.dispatchObservationCount, 1);

  const replay = evaluateBusinessEvent({ action: released, currentSource: null, event: ambiguousEvent, now: "2026-09-11T20:30:00.000Z", state: ambiguous.state });
  assert.equal(replay.deliveryDisposition, "EXACT_REPLAY");
  assert.deepEqual(replay.receipt, ambiguous.receipt);
});

test("provider acknowledgement remains non-final and requires exact authoritative source readback", () => {
  const released = action();
  const { state } = advance(released, [event(released, "ACTION_RELEASED", 1), event(released, "EFFECT_DISPATCH_STARTED", 2)]);
  const acknowledged = evaluateBusinessEvent({ action: released, currentSource: null, event: event(released, "PROVIDER_ACKNOWLEDGED", 3), now: "2026-09-11T20:19:00.000Z", state });
  assert.equal(acknowledged.receipt.finality, "PROVIDER_ACKNOWLEDGED");
  assert.equal(acknowledged.receipt.businessFinal, false);
  assert.equal(acknowledged.receipt.sourceReadbackRef, null);

  const sourceConfirmed = event(released, "SOURCE_CONFIRMED", 4);
  const driftedReadback = {
    ...sourceConfirmed,
    evidence: {
      ...sourceConfirmed.evidence,
      readback: { ...sourceConfirmed.evidence.readback!, version: "communication_send:result-v2" },
    },
  };
  const rejected = evaluateBusinessEvent({ action: released, currentSource: null, event: driftedReadback, now: "2026-09-11T20:19:45.000Z", state: acknowledged.state });
  assert.equal(rejected.receipt.rejectionCode, "SOURCE_READBACK_INVALID");
  assert.equal(rejected.receipt.businessFinal, false);
  assert.equal(rejected.state.phase, "PROVIDER_ACKNOWLEDGED");
});

test("exact source confirmation recovers an ambiguous outcome without a new reservation or dispatch", () => {
  const released = action();
  const { state } = advance(released, [event(released, "ACTION_RELEASED", 1), event(released, "EFFECT_DISPATCH_STARTED", 2)]);
  const ambiguous = evaluateBusinessEvent({ action: released, currentSource: null, event: event(released, "DELIVERY_AMBIGUOUS", 3), now: "2026-09-11T20:19:00.000Z", state });
  const recovered = evaluateBusinessEvent({ action: released, currentSource: null, event: event(released, "SOURCE_CONFIRMED", 4), now: "2026-09-11T20:19:45.000Z", state: ambiguous.state });
  assert.equal(recovered.deliveryDisposition, "ACCEPTED");
  assert.equal(recovered.receipt.finality, "SOURCE_CONFIRMED");
  assert.equal(recovered.receipt.businessFinal, true);
  assert.ok(recovered.receipt.sourceReadbackRef);
  assert.equal(recovered.effectReservationDelta, 0);
  assert.equal(recovered.dispatchObservationDelta, 0);
  assert.equal(recovered.state.effectReservationCount, 1);
  assert.equal(recovered.state.dispatchObservationCount, 1);
});

test("future-dated authoritative readback cannot create business finality", () => {
  const released = action();
  const { state } = advance(released, [event(released, "ACTION_RELEASED", 1), event(released, "EFFECT_DISPATCH_STARTED", 2)]);
  const ambiguous = evaluateBusinessEvent({ action: released, currentSource: null, event: event(released, "DELIVERY_AMBIGUOUS", 3), now: "2026-09-11T20:19:00.000Z", state });
  const sourceConfirmed = event(released, "SOURCE_CONFIRMED", 4);
  const futureReadback = {
    ...sourceConfirmed,
    evidence: {
      ...sourceConfirmed.evidence,
      readback: {
        ...sourceConfirmed.evidence.readback!,
        observedAt: "2026-09-11T21:00:00.000Z",
      },
    },
  };
  const rejected = evaluateBusinessEvent({
    action: released,
    currentSource: null,
    event: futureReadback,
    now: "2026-09-11T20:19:00.000Z",
    state: ambiguous.state,
  });
  assert.equal(rejected.receipt.rejectionCode, "SOURCE_READBACK_INVALID");
  assert.equal(rejected.receipt.businessFinal, false);
  assert.equal(rejected.state, ambiguous.state);
  assert.equal(rejected.state.effectReservationCount, 1);
  assert.equal(rejected.state.dispatchObservationCount, 1);
  assert.equal(rejected.state.finality, "RECONCILING");
  assert.equal(rejected.state.businessFinal, false);
});

test("state integrity corruption fails before delivery evaluation", () => {
  const released = action();
  const state = createBusinessEventBoundaryState(released);
  assert.throws(() => evaluateBusinessEvent({
    action: released,
    currentSource: source(released),
    event: event(released, "ACTION_RELEASED", 1),
    now: FRESH_NOW,
    state: { ...state, effectReservationCount: 1 },
  }), /state integrity is invalid/);
});

test("C04 capability discovery cannot replace a release receipt or exact approval binding", () => {
  const released = action();
  const { contractVersion: _contractVersion, ...releasedInput } = released;
  void _contractVersion;
  assert.equal(released.capabilityDiscovery?.discoveryGrantsAuthority, false);
  assert.throws(() => createReleasedBusinessAction({
    ...releasedInput,
    capabilityDiscovery: { ...released.capabilityDiscovery!, discoveryGrantsAuthority: true as false },
  }), /attempts to grant authority/);
  assert.throws(() => createReleasedBusinessAction({
    ...releasedInput,
    approval: { ...released.approval, sourceVersion: "communication_send:v6" },
  }), /does not bind the exact released action/);
});

test("wrong action, tenant, operation, release, approval, payload or source binding is rejected", () => {
  const released = action();
  const baseEvent = event(released, "ACTION_RELEASED", 1);
  const drifts: Partial<BusinessEvent>[] = [
    { actionId: "released-other" },
    { tenantId: "tenant-b" },
    { operationId: "operation-other" },
    { releaseReceiptId: "release-receipt-other" },
    { approvalReceiptId: "approval-receipt-other" },
    { payloadHash: sha256({ changed: true }) },
    { sourceVersion: "communication_send:v6" },
  ];
  for (const drift of drifts) {
    const result = evaluateBusinessEvent({ action: released, currentSource: source(released), event: { ...baseEvent, ...drift, eventId: `delivery-${Object.keys(drift)[0]}`, businessEventId: `business-${Object.keys(drift)[0]}` }, now: FRESH_NOW, state: createBusinessEventBoundaryState(released) });
    assert.equal(result.receipt.rejectionCode, "RELEASE_BINDING_MISMATCH");
    assert.equal(result.effectReservationDelta, 0);
  }
});

test("source observations are exact record/version citations", () => {
  const released = action("ORDER_CREATE");
  const baseSource = source(released);
  const drifts: Partial<SourceVersionBinding>[] = [
    { objectId: "order-other" },
    { objectType: "quote" },
    { owner: "CIBOTFLOW/Luzione-UI" },
    { version: "order_create:v8" },
  ];
  for (const drift of drifts) {
    const result = evaluateBusinessEvent({ action: released, currentSource: { ...baseSource, ...drift }, event: event(released, "ACTION_RELEASED", 1), now: FRESH_NOW, state: createBusinessEventBoundaryState(released) });
    assert.equal(result.receipt.rejectionCode, "STALE_APPROVAL");
    assert.equal(result.state.effectReservationCount, 0);
  }
});

test("event types cannot smuggle acknowledgement or readback evidence into an earlier phase", () => {
  const released = action();
  const releaseEvent = event(released, "ACTION_RELEASED", 1);
  const withForgedReadback = {
    ...releaseEvent,
    evidence: { ...event(released, "SOURCE_CONFIRMED", 1).evidence },
  };
  const result = evaluateBusinessEvent({ action: released, currentSource: source(released), event: withForgedReadback, now: FRESH_NOW, state: createBusinessEventBoundaryState(released) });
  assert.equal(result.receipt.rejectionCode, "INVALID_TRANSITION");
  assert.equal(result.receipt.businessFinal, false);
  assert.equal(result.state.effectReservationCount, 0);
});
