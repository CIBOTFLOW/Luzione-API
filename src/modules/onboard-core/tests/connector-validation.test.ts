import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { connectorBindingFixture } from "@/modules/luzione-core-contracts/fixtures";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  CONNECTOR_SANDBOX_DESTINATION, CONNECTOR_SYNC_VALIDATION_VERSION, CONNECTOR_VALIDATION_OUTCOME_VERSION,
  classifyConnectorOutcome, connectorValidationPayloadDigest, connectorValidationReservation, parseConnectorSyncValidationRequest,
} from "../connectorContracts";
import { ONBOARD_CORE_API_VERSION, OnboardCoreContractError } from "../contracts";

const binding = { ...connectorBindingFixture, credentialReference: "secret-ref:connector-binding-customer-zero", status: "DRAFT" as const };
const validation = { changes: { created: 2, duplicates: 1, failed: 0, updated: 3 }, cursorAfter: "sandbox-cursor:after-1", scenario: "matched" as const };
const requestBase = { binding, contractVersion: ONBOARD_CORE_API_VERSION, expectedMandateObjectVersion: "setup-mandate:proof@v2", mandateId: "55555555-5555-4555-8555-555555555555", operationKey: "customer-zero-connector-check-1", sourceBindingDigest: "9".repeat(64), validation };
function request(overrides: Record<string, unknown> = {}) {
  const merged = { ...requestBase, ...overrides };
  return { ...merged, payloadDigest: connectorValidationPayloadDigest(merged) };
}
function expectCode(callback: () => unknown, code: string) {
  assert.throws(callback, (error: unknown) => error instanceof OnboardCoreContractError && error.code === code);
}
function classify(overrides: Record<string, unknown> = {}) {
  return classifyConnectorOutcome({
    binding, changes: validation.changes, cursorAfter: validation.cursorAfter, lastErrorCode: null,
    providerAcknowledgementRef: "sandbox-ack:proof", reconciliationRef: "reconcile:proof",
    reconciliationResult: "MATCHED", sourceReadbackRef: "sandbox-readback:proof", state: "SOURCE_CONFIRMED",
    ...overrides,
  });
}

test("strict v2 connector request binds exact Mandate, L2 evidence and canonical payload digest", () => {
  const parsed = parseConnectorSyncValidationRequest(request());
  assert.equal(parsed.mandateId, requestBase.mandateId);
  assert.equal(parsed.sourceBindingDigest, requestBase.sourceBindingDigest);
  assert.equal(CONNECTOR_SYNC_VALIDATION_VERSION, "ConnectorSyncValidation/v2");
  assert.equal(CONNECTOR_SANDBOX_DESTINATION, "sandbox.echo");
  assert.deepEqual(connectorValidationReservation(binding.tenantId, parsed), connectorValidationReservation(binding.tenantId, parsed));
  expectCode(() => parseConnectorSyncValidationRequest({ ...request(), actorId: "forged" }), "FIELD_SET_MISMATCH");
  expectCode(() => parseConnectorSyncValidationRequest({ ...request(), payloadDigest: sha256({ forged: true }) }), "PAYLOAD_DIGEST_MISMATCH");
});

test("connector stable identifiers reject original-byte overflow, Unicode, whitespace and raw/canonical collisions", () => {
  for (const operationKey of ["o".repeat(201), "connector-é", " customer-zero-connector-check-1", "customer-zero-connector-check-1 "]) {
    expectCode(() => parseConnectorSyncValidationRequest(request({ operationKey })), "INVALID_REQUEST");
  }
  for (const expectedMandateObjectVersion of ["v".repeat(201), "setup-mandate:é@v2", " setup-mandate:proof@v2"]) {
    expectCode(() => parseConnectorSyncValidationRequest(request({ expectedMandateObjectVersion })), "INVALID_REQUEST");
  }
  const bindingCases = [
    { ...binding, tenantId: " tenant-luzione" },
    { ...binding, consentRef: "c".repeat(201) },
    { ...binding, credentialReference: "secret-ref:connector-é" },
    { ...binding, cursor: " cursor:after" },
    { ...binding, revocation: { revokedAt: "2026-09-05T00:00:00.000Z", revocationRef: " revocation:proof" }, status: "REVOKED" as const },
    { ...binding, scopes: ["contacts.réadonly"] },
  ];
  for (const invalidBinding of bindingCases) {
    expectCode(() => parseConnectorSyncValidationRequest(request({ binding: invalidBinding })), "INVALID_REQUEST");
  }
  expectCode(() => parseConnectorSyncValidationRequest(request({ validation: { ...validation, cursorAfter: " cursor:after" } })), "INVALID_REQUEST");
  expectCode(() => parseConnectorSyncValidationRequest(request({ sourceBindingDigest: ` ${requestBase.sourceBindingDigest}` })), "INVALID_REQUEST");
  const raw = " customer-zero-connector-check-1";
  assert.notEqual(sha256({ operationKey: raw }), sha256({ operationKey: raw.trim() }));
  expectCode(() => parseConnectorSyncValidationRequest(request({ operationKey: raw })), "INVALID_REQUEST");
});

test("SOURCE_CONFIRMED requires matching readback and is the only successful outcome", () => {
  const matched = classify();
  assert.equal(matched.contractVersion, CONNECTOR_VALIDATION_OUTCOME_VERSION);
  assert.equal(matched.success, true);
  assert.equal(matched.syncReceipt?.finality, "SOURCE_CONFIRMED");
  const falseConfirmed = classify({ reconciliationResult: "SOURCE_UNAVAILABLE" });
  assert.equal(falseConfirmed.success, false);
  assert.equal(falseConfirmed.state, "TERMINAL_UNAVAILABLE");
  assert.equal(falseConfirmed.syncReceipt, null);
});

test("exact VERSION_MISMATCH, BLOCKED and ACK/no-readback probes never claim success", () => {
  const version = classify({ lastErrorCode: "SOURCE_VERSION_MISMATCH", reconciliationResult: "VERSION_MISMATCH", sourceReadbackRef: "sandbox-readback:different", state: "BLOCKED" });
  assert.deepEqual([version.state, version.evidenceCode, version.success, version.syncReceipt], ["VERSION_MISMATCH", "VERSION_MISMATCH", false, null]);
  const blocked = classify({ lastErrorCode: "EFFECT_KILL_ACTIVE", reconciliationRef: null, reconciliationResult: null, sourceReadbackRef: null, state: "BLOCKED" });
  assert.deepEqual([blocked.state, blocked.evidenceCode, blocked.success], ["BLOCKED", "BLOCKED", false]);
  const ack = classify({ reconciliationRef: null, reconciliationResult: null, sourceReadbackRef: null, state: "PROVIDER_ACKNOWLEDGED" });
  assert.equal(ack.state, "ACKNOWLEDGED");
  assert.equal(ack.evidenceCode, "ACK_WITHOUT_READBACK");
  assert.equal(ack.success, false);
  assert.equal(ack.syncReceipt?.finality, "ACKNOWLEDGED");
});

test("RECONCILING is pending only and exhausted ambiguity/terminal unavailable are typed non-success", () => {
  const pending = classify({ reconciliationResult: "PENDING", sourceReadbackRef: null, state: "RECONCILIATION_REQUIRED" });
  assert.equal(pending.state, "RECONCILING");
  assert.equal(pending.syncReceipt?.finality, "RECONCILING");
  const exhausted = classify({ lastErrorCode: "RECONCILIATION_BUDGET_EXHAUSTED", reconciliationResult: "SOURCE_UNAVAILABLE", sourceReadbackRef: null, state: "BLOCKED" });
  assert.equal(exhausted.state, "AMBIGUITY_EXHAUSTED");
  assert.equal(exhausted.syncReceipt, null);
  const unavailable = classify({ providerAcknowledgementRef: null, reconciliationRef: null, reconciliationResult: null, sourceReadbackRef: null, state: "DEAD_LETTERED" });
  assert.equal(unavailable.state, "TERMINAL_UNAVAILABLE");
});

test("service enforces exact active same-tenant Mandate, unsuperseded approval and deadline with NO_EFFECT sandbox only", () => {
  const route = readFileSync("src/app/api/v1/connectors/sync-validations/route.ts", "utf8");
  const service = readFileSync("src/modules/onboard-core/connectorService.ts", "utf8");
  assert.match(route, /connectorSyncValidationEnabledForTenant/);
  assert.match(service, /VALIDATE_CONNECTOR_READBACK/);
  assert.match(service, /onboarding_setup_mandate_revocations/);
  assert.match(service, /MANDATE_BLUEPRINT_SUPERSEDED/);
  assert.match(service, /MANDATE_RUNTIME_EXCEEDED/);
  assert.match(service, /effectClass: "NO_EFFECT"/);
  assert.match(service, /SandboxEchoProviderAdapter/);
  assert.doesNotMatch(`${route}\n${service}`, /GmailRfqCanaryAdapter|credentialReference\s*\)|LIVE_EFFECT/);
});
