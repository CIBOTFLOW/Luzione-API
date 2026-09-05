import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CORE_A02_PINS,
  LuzioneCoreCompatibilityError,
  type LuzioneCoreCompatibilityErrorCode,
  connectorBindingFixture,
  customerReplyFixture,
  featureFlagsFixture,
  importBatchFixture,
  importReceiptFixture,
  luzioneCorePositiveFixtures,
  parseConnectorBindingV1,
  parseCustomerReplyV1,
  parseImportBatchV1,
  parseImportReceiptV1,
  parseLuzioneCoreFeatureFlagsV1,
  parseLuzioneCoreReleaseManifestV1,
  parseSetupMandateV1,
  parseSultanOperationV1,
  parseSultanReadbackV1,
  parseSultanReceiptV1,
  parseSupportActionV1,
  parseSupportCaseV1,
  parseSyncReceiptV1,
  parseTenantBlueprintV1,
  releaseManifestFixture,
  setupMandateFixture,
  sultanOperationFixture,
  sultanReadbackFixture,
  sultanReceiptFixture,
  supportActionFixture,
  supportCaseFixture,
  syncReceiptFixture,
  tenantBlueprintFixture,
} from "..";

const manifestPath = "contracts/core/luzione-core-v1.manifest.json";
const schemaPath = "contracts/core/v1/luzione-core-contracts-v1.schema.json";
const runtimeMappingPath = "contracts/core/consumer-mappings/sultan-runtime-01-v1.json";

test("CORE-01 positive fixture chain preserves exact A02 versions and NO_EFFECT authority", () => {
  const operation = parseSultanOperationV1(sultanOperationFixture);
  const receipt = parseSultanReceiptV1(sultanReceiptFixture, operation);
  const readback = parseSultanReadbackV1(sultanReadbackFixture, operation, receipt);
  const blueprint = parseTenantBlueprintV1(tenantBlueprintFixture);
  const mandate = parseSetupMandateV1(setupMandateFixture, blueprint);
  const batch = parseImportBatchV1(importBatchFixture, mandate);
  parseImportReceiptV1(importReceiptFixture, batch);
  const binding = parseConnectorBindingV1(connectorBindingFixture);
  parseSyncReceiptV1(syncReceiptFixture, binding);
  const supportCase = parseSupportCaseV1(supportCaseFixture);
  const supportAction = parseSupportActionV1(supportActionFixture, supportCase);
  parseCustomerReplyV1(customerReplyFixture, supportCase, supportAction);
  parseLuzioneCoreFeatureFlagsV1(featureFlagsFixture);
  parseLuzioneCoreReleaseManifestV1(releaseManifestFixture);

  assert.deepEqual(operation.a02Pins, CORE_A02_PINS);
  assert.equal(operation.effectMode, "NO_EFFECT");
  assert.equal(receipt.effect.actual, "NO_EFFECT");
  assert.equal(readback.verification.finality, "SOURCE_CONFIRMED");
  assert.equal(releaseManifestFixture.productionReady, false);
  assert.equal(releaseManifestFixture.fepDependency, false);
});

test("every v1 boundary fails closed for surplus, missing and wrong-version fields", async (context) => {
  const fixtures = Object.entries(luzioneCorePositiveFixtures) as Array<[keyof typeof luzioneCorePositiveFixtures, unknown]>;
  assert.equal(fixtures.length, 14);
  for (const [name, fixture] of fixtures) {
    await context.test(`${name}:surplus`, () => {
      assertCoreError(() => validateByName(name, { ...structuredClone(fixture as object), surplus: true }), "CORE_FIELD_SET_MISMATCH");
    });
    await context.test(`${name}:missing`, () => {
      const missing = structuredClone(fixture) as Record<string, unknown>;
      delete missing[Object.keys(missing).find((key) => key !== "contractVersion") ?? "contractVersion"];
      assertCoreError(() => validateByName(name, missing), "CORE_FIELD_SET_MISMATCH");
    });
    await context.test(`${name}:wrong-version`, () => {
      const wrong = { ...(structuredClone(fixture) as object), contractVersion: "consumer-local/v0" };
      assertCoreError(() => validateByName(name, wrong), "CORE_WRONG_VERSION");
    });
  }
});

test("operation, receipt and readback distinguish requested, committed and observed versions", () => {
  const operation = parseSultanOperationV1(sultanOperationFixture);
  const receipt = parseSultanReceiptV1(sultanReceiptFixture, operation);
  const readback = parseSultanReadbackV1(sultanReadbackFixture, operation, receipt);
  assert.equal(operation.versionIntent.preconditionVersion, "support-case:v7");
  assert.equal(operation.versionIntent.targetVersionAtRequest, "support-case:v7");
  assert.equal(receipt.versions.committedVersion, "support-case:v8");
  assert.equal(readback.versions.observedVersion, "support-case:v8");

  const providerOnly = structuredClone(sultanReadbackFixture);
  providerOnly.a02Readback.finality = "PROVIDER_ACKNOWLEDGED";
  providerOnly.a02Readback.businessFinal = true;
  providerOnly.verification.finality = "PROVIDER_ACKNOWLEDGED";
  assert.throws(() => parseSultanReadbackV1(providerOnly, operation, receipt));
});

test("tenant and reference relationships fail closed across all domain chains", () => {
  const wrongReceipt = structuredClone(sultanReceiptFixture);
  wrongReceipt.a02Receipt.tenantId = "tenant-other";
  assert.throws(() => parseSultanReceiptV1(wrongReceipt, sultanOperationFixture));

  const wrongMandate = structuredClone(setupMandateFixture);
  wrongMandate.tenantId = "tenant-other";
  assertCoreError(() => parseSetupMandateV1(wrongMandate, tenantBlueprintFixture), "CORE_TENANT_MISMATCH");

  const wrongImport = structuredClone(importBatchFixture);
  wrongImport.tenantId = "tenant-other";
  assertCoreError(() => parseImportBatchV1(wrongImport, setupMandateFixture), "CORE_TENANT_MISMATCH");

  const wrongSync = structuredClone(syncReceiptFixture);
  wrongSync.tenantId = "tenant-other";
  assertCoreError(() => parseSyncReceiptV1(wrongSync, connectorBindingFixture), "CORE_TENANT_MISMATCH");

  const wrongAction = structuredClone(supportActionFixture);
  wrongAction.tenantId = "tenant-other";
  assertCoreError(() => parseSupportActionV1(wrongAction, supportCaseFixture), "CORE_REFERENCE_MISMATCH");
});

test("onboarding, import and connector boundaries deny authority and false finality", () => {
  const activeExpired = structuredClone(setupMandateFixture);
  activeExpired.active = true;
  activeExpired.expiresAt = "2020-01-01T00:00:00.000Z";
  assertCoreError(() => parseSetupMandateV1(activeExpired, tenantBlueprintFixture), "CORE_EXPIRED");

  const missingProhibition = structuredClone(setupMandateFixture);
  missingProhibition.prohibitedActions = missingProhibition.prohibitedActions.slice(1);
  assertCoreError(() => parseSetupMandateV1(missingProhibition), "CORE_AUTHORITY_DENIED");

  const overflow = structuredClone(importBatchFixture);
  overflow.stagedCounts.records = setupMandateFixture.limits.maxImportRecords + 1;
  assertCoreError(() => parseImportBatchV1(overflow, setupMandateFixture), "CORE_AUTHORITY_DENIED");

  const badCounts = structuredClone(importReceiptFixture);
  badCounts.counts.total += 1;
  assertCoreError(() => parseImportReceiptV1(badCounts, importBatchFixture), "CORE_VALUE_INVALID");

  const secretLiteral = structuredClone(connectorBindingFixture);
  secretLiteral.credentialReference = "plaintext-token";
  assertCoreError(() => parseConnectorBindingV1(secretLiteral), "CORE_AUTHORITY_DENIED");

  const providerAck = structuredClone(syncReceiptFixture);
  providerAck.finality = "ACKNOWLEDGED";
  providerAck.providerAcknowledgementRef = "provider:ack-1";
  providerAck.sourceReadbackRef = null;
  assert.equal(parseSyncReceiptV1(providerAck, connectorBindingFixture).finality, "ACKNOWLEDGED");
  assert.notEqual(providerAck.finality, "SOURCE_CONFIRMED");
});

test("SUPPORT-01 denies revoked identity/entitlement, stale versions and illegal SLA/closure", () => {
  const revokedActor = structuredClone(supportCaseFixture);
  revokedActor.actor.membershipState = "REVOKED";
  assertCoreError(() => parseSupportCaseV1(revokedActor), "CORE_AUTHORITY_DENIED");

  const revokedEntitlement = structuredClone(supportCaseFixture);
  revokedEntitlement.entitlement.state = "REVOKED";
  assertCoreError(() => parseSupportCaseV1(revokedEntitlement), "CORE_AUTHORITY_DENIED");

  const stale = structuredClone(supportCaseFixture);
  stale.staleAfter = "2020-01-01T00:00:00.000Z";
  assertCoreError(() => parseSupportCaseV1(stale), "CORE_EXPIRED");

  const staleAction = structuredClone(supportActionFixture);
  staleAction.caseVersion.observed = "support-case:v6";
  assertCoreError(() => parseSupportActionV1(staleAction, supportCaseFixture), "CORE_EXPIRED");

  const illegalPause = structuredClone(supportCaseFixture);
  illegalPause.sla.state = "PAUSED";
  assertCoreError(() => parseSupportCaseV1(illegalPause), "CORE_AUTHORITY_DENIED");

  const autoClose = structuredClone(supportCaseFixture);
  autoClose.status = "CLOSED_VERIFIED";
  autoClose.evidenceRefs = [];
  assertCoreError(() => parseSupportCaseV1(autoClose), "CORE_FINALITY_INVALID");
});

test("SUPPORT-01 enforces exact replay, severity approval, ambiguity and readback finality", () => {
  assert.equal(parseSupportActionV1(structuredClone(supportActionFixture), supportCaseFixture, supportActionFixture).actionId, supportActionFixture.actionId);

  const changedPayload = structuredClone(supportActionFixture);
  changedPayload.replay.payloadHash = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  assertCoreError(() => parseSupportActionV1(changedPayload, supportCaseFixture, supportActionFixture), "CORE_REPLAY_CONFLICT");

  const severityDecrease = structuredClone(supportActionFixture);
  severityDecrease.severityChange = { approvalRef: null, from: "P1", to: "P2" };
  assertCoreError(() => parseSupportActionV1(severityDecrease, supportCaseFixture), "CORE_AUTHORITY_DENIED");

  const ambiguousFinal = structuredClone(supportActionFixture);
  ambiguousFinal.ambiguity = "INDETERMINATE";
  ambiguousFinal.finality = "OWNER_COMMITTED";
  assertCoreError(() => parseSupportActionV1(ambiguousFinal, supportCaseFixture), "CORE_FINALITY_INVALID");

  const missingReadback = structuredClone(supportActionFixture);
  missingReadback.status = "COMPLETED_VERIFIED";
  assertCoreError(() => parseSupportActionV1(missingReadback, supportCaseFixture), "CORE_FINALITY_INVALID");

  const disallowedReply = structuredClone(customerReplyFixture);
  disallowedReply.approval.decision = "DENY";
  disallowedReply.delivery.state = "SENT_VERIFIED";
  disallowedReply.delivery.deliveredAt = "2026-09-05T00:01:00.000Z";
  disallowedReply.delivery.providerReceiptRef = "provider:receipt-1";
  disallowedReply.delivery.readbackRef = "provider:readback-1";
  disallowedReply.reservation = { receiptRef: "reservation:reply-1", state: "RESERVED" };
  disallowedReply.finality = "SOURCE_CONFIRMED";
  assertCoreError(() => parseCustomerReplyV1(disallowedReply, supportCaseFixture, supportActionFixture), "CORE_AUTHORITY_DENIED");
});

test("support audit heads are append-only across case, action and reply", () => {
  const brokenAction = structuredClone(supportActionFixture);
  brokenAction.auditHead.previousEntryDigest = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  assertCoreError(() => parseSupportActionV1(brokenAction, supportCaseFixture), "CORE_REFERENCE_MISMATCH");

  const brokenReply = structuredClone(customerReplyFixture);
  brokenReply.auditHead.sequence = 4;
  assertCoreError(() => parseCustomerReplyV1(brokenReply, supportCaseFixture, supportActionFixture), "CORE_REFERENCE_MISMATCH");
});

test("feature flags and release manifest remain dark, NO_EFFECT and FEP-independent", () => {
  const enabled = structuredClone(featureFlagsFixture);
  enabled.flags.operationEffects = true as false;
  assertCoreError(() => parseLuzioneCoreFeatureFlagsV1(enabled), "CORE_DARK_FLAG_REQUIRED");

  const promoted = structuredClone(releaseManifestFixture);
  promoted.productionReady = true as false;
  assertCoreError(() => parseLuzioneCoreReleaseManifestV1(promoted), "CORE_DARK_FLAG_REQUIRED");
});

test("schema, manifest and six-capability Sultan mapping are mechanically complete", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { $defs: Record<string, unknown>; oneOf: unknown[] };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    contracts: Record<string, string>; fepDependency: boolean; preservedA02: { versions: Record<string, string> };
  };
  const mapping = JSON.parse(readFileSync(runtimeMappingPath, "utf8")) as {
    bindingState: string; capabilityMappings: Array<{ capabilityId: string; requiredContracts: string[] }>;
    consumerFinalSha: string; effectAuthority: string;
  };
  assert.equal(schema.oneOf.length, 14);
  assert.equal(Object.keys(manifest.contracts).length, 40);
  assert.deepEqual(manifest.preservedA02.versions, CORE_A02_PINS);
  assert.equal(manifest.fepDependency, false);
  assert.equal(mapping.consumerFinalSha, "e2b95ab71e5a604dcdd8ff6ab75b50a32ba4d838");
  assert.equal(mapping.bindingState, "FROZEN_L1_G0_IMPLEMENTATION");
  assert.equal(mapping.effectAuthority, "NO_EFFECT");
  assert.deepEqual(mapping.capabilityMappings.map(({ capabilityId }) => capabilityId), [
    "crm.growth-research", "crm.opportunity-assistance", "crm.proposal-preparation",
    "crm.procurement-coordination", "crm.onboarding-assistance", "crm.support_investigation",
  ]);
  for (const capability of mapping.capabilityMappings) {
    assert.deepEqual(capability.requiredContracts.slice(0, 3), [
      "SultanOperation/v1", "SultanReceipt/v1", "SultanReadback/v1",
    ]);
    for (const contract of capability.requiredContracts) assert.ok(contract in manifest.contracts, contract);
  }
  assert.ok("SupportCase" in schema.$defs && "SupportAction" in schema.$defs && "CustomerReply" in schema.$defs);
});

function validateByName(name: keyof typeof luzioneCorePositiveFixtures, value: unknown) {
  switch (name) {
    case "connectorBinding": return parseConnectorBindingV1(value);
    case "customerReply": return parseCustomerReplyV1(value, supportCaseFixture, supportActionFixture);
    case "featureFlags": return parseLuzioneCoreFeatureFlagsV1(value);
    case "importBatch": return parseImportBatchV1(value, setupMandateFixture);
    case "importReceipt": return parseImportReceiptV1(value, importBatchFixture);
    case "releaseManifest": return parseLuzioneCoreReleaseManifestV1(value);
    case "setupMandate": return parseSetupMandateV1(value, tenantBlueprintFixture);
    case "sultanOperation": return parseSultanOperationV1(value);
    case "sultanReadback": return parseSultanReadbackV1(value, sultanOperationFixture, sultanReceiptFixture);
    case "sultanReceipt": return parseSultanReceiptV1(value, sultanOperationFixture);
    case "supportAction": return parseSupportActionV1(value, supportCaseFixture);
    case "supportCase": return parseSupportCaseV1(value);
    case "syncReceipt": return parseSyncReceiptV1(value, connectorBindingFixture);
    case "tenantBlueprint": return parseTenantBlueprintV1(value);
  }
}

function assertCoreError(run: () => unknown, code: LuzioneCoreCompatibilityErrorCode) {
  assert.throws(run, (error) => error instanceof LuzioneCoreCompatibilityError && error.code === code);
}
