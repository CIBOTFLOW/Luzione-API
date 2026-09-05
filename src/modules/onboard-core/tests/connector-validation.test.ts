import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { connectorSyncValidationEnabledForTenant } from "@/lib/api/config";
import { connectorBindingFixture } from "@/modules/luzione-core-contracts/fixtures";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  CONNECTOR_SANDBOX_DESTINATION,
  CONNECTOR_SYNC_VALIDATION_VERSION,
  connectorValidationPayloadDigest,
  connectorValidationReservation,
  issueSyncReceipt,
  parseConnectorSyncValidationRequest,
} from "../connectorContracts";
import { ONBOARD_CORE_API_VERSION, OnboardCoreContractError } from "../contracts";

const binding = {
  ...connectorBindingFixture,
  credentialReference: "secret-ref:connector-binding-customer-zero",
  status: "DRAFT" as const,
};
const validation = {
  changes: { created: 2, duplicates: 1, failed: 0, updated: 3 },
  cursorAfter: "sandbox-cursor:after-1",
  scenario: "matched" as const,
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    binding,
    contractVersion: ONBOARD_CORE_API_VERSION,
    operationKey: "customer-zero-connector-check-1",
    payloadDigest: connectorValidationPayloadDigest({ binding, validation }),
    validation,
    ...overrides,
  };
}

function expectCode(callback: () => unknown, code: string) {
  assert.throws(callback, (error: unknown) => error instanceof OnboardCoreContractError && error.code === code);
}

test("strict connector validation recomputes digest and preserves tenant/key reservation", () => {
  const parsed = parseConnectorSyncValidationRequest(request());
  assert.equal(parsed.binding.contractVersion, "ConnectorBinding/v1");
  assert.equal(parsed.validation.scenario, "matched");
  assert.equal(CONNECTOR_SANDBOX_DESTINATION, "sandbox.echo");
  const reservation = connectorValidationReservation(binding.tenantId, parsed);
  assert.match(reservation.idempotencyKey, /^connector-sync-validation:[a-f0-9]{64}$/);
  assert.equal(reservation, reservation);
  assert.equal(connectorValidationReservation(binding.tenantId, parsed).commandId, reservation.commandId);
});

test("connector boundary rejects surplus, wrong digest, live/revoked status, unapproved provider and secret-shaped input", () => {
  expectCode(() => parseConnectorSyncValidationRequest({ ...request(), actorId: "forged" }), "FIELD_SET_MISMATCH");
  expectCode(() => parseConnectorSyncValidationRequest({ ...request(), payloadDigest: sha256({ changed: true }) }), "PAYLOAD_DIGEST_MISMATCH");
  const bound = { ...binding, status: "BOUND" as const };
  expectCode(() => parseConnectorSyncValidationRequest({ ...request(), binding: bound, payloadDigest: connectorValidationPayloadDigest({ binding: bound, validation }) }), "CONNECTOR_STATUS_DENIED");
  const revoked = { ...binding, revocation: { revokedAt: "2026-09-05T00:00:00.000Z", revocationRef: "revocation:proof" }, status: "REVOKED" as const };
  expectCode(() => parseConnectorSyncValidationRequest({ ...request(), binding: revoked, payloadDigest: connectorValidationPayloadDigest({ binding: revoked, validation }) }), "CONNECTOR_STATUS_DENIED");
  const microsoft = { ...binding, provider: "MICROSOFT_365" as const };
  expectCode(() => parseConnectorSyncValidationRequest({ ...request(), binding: microsoft, payloadDigest: connectorValidationPayloadDigest({ binding: microsoft, validation }) }), "CONNECTOR_PROVIDER_DENIED");
  const credential = { ...binding, credentialReference: "secret-ref::bad" };
  expectCode(() => parseConnectorSyncValidationRequest({ ...request(), binding: credential, payloadDigest: connectorValidationPayloadDigest({ binding: credential, validation }) }), "CREDENTIAL_REFERENCE_INVALID");
});

test("only L1 issues canonical sandbox SyncReceipt finality", () => {
  const receipt = issueSyncReceipt({
    binding,
    changes: validation.changes,
    cursorAfter: validation.cursorAfter,
    finality: "SOURCE_CONFIRMED",
    providerAcknowledgementRef: "sandbox-ack:proof",
    reconciliationRef: "reconcile:proof",
    sourceReadbackRef: "sandbox-readback:proof",
  });
  assert.equal(receipt.contractVersion, "SyncReceipt/v1");
  assert.equal(receipt.tenantId, binding.tenantId);
  assert.equal(receipt.bindingId, binding.bindingId);
  assert.equal(receipt.finality, "SOURCE_CONFIRMED");
  assert.deepEqual(receipt.changes, validation.changes);
});

test("connector gate requires global, feature, tenant and existing sandbox adapter admission", () => {
  const original = { ...process.env };
  try {
    process.env.DATABASE_URL = "postgres://configured.invalid/db";
    process.env.LUZIONE_API_SERVICE_TOKEN = "configured";
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "true";
    process.env.LUZIONE_API_CONNECTOR_SYNC_VALIDATIONS_ENABLED = "true";
    process.env.LUZIONE_API_CONNECTOR_SYNC_VALIDATION_TENANTS = binding.tenantId;
    process.env.LUZIONE_API_PROVIDER_SANDBOX_ENABLED = "true";
    process.env.LUZIONE_API_PROVIDER_SANDBOX_TENANTS = binding.tenantId;
    process.env.LUZIONE_API_PROVIDER_SANDBOX_DESTINATIONS = "sandbox.echo";
    assert.equal(connectorSyncValidationEnabledForTenant(binding.tenantId), true);
    process.env.LUZIONE_API_PROVIDER_SANDBOX_DESTINATIONS = "provider.other";
    assert.equal(connectorSyncValidationEnabledForTenant(binding.tenantId), false);
    process.env.LUZIONE_API_PROVIDER_SANDBOX_DESTINATIONS = "sandbox.echo";
    process.env.LUZIONE_API_MUTATIONS_ENABLED = "false";
    assert.equal(connectorSyncValidationEnabledForTenant(binding.tenantId), false);
  } finally {
    process.env = original;
  }
});

test("the sole endpoint is service-authenticated, default-off, P110/provider-runtime scoped and NO_EFFECT", () => {
  const route = readFileSync("src/app/api/v1/connectors/sync-validations/route.ts", "utf8");
  const service = readFileSync("src/modules/onboard-core/connectorService.ts", "utf8");
  const store = readFileSync("src/lib/platform-guarantees/postgresWorkflowDeliveryStore.ts", "utf8");
  assert.match(route, /requireServiceActor\(request\.headers, "connector\.sync_validation\.execute"\)/);
  assert.match(route, /connectorSyncValidationEnabledForTenant\(actor\.tenantId\)/);
  assert.match(service, /actor\.actorType !== "service"/);
  assert.match(service, /LifecycleCommandKernel/);
  assert.match(service, /SandboxEchoProviderAdapter/);
  assert.match(service, /effectClass: "NO_EFFECT"/);
  assert.match(service, /outboxMessageId: commandReceipt\.outboxMessageId/);
  assert.match(store, /\$4::text is null or outbox\.outbox_message_id = \$4/);
  assert.doesNotMatch(`${route}\n${service}`, /fetch\(|GmailRfqCanaryAdapter|MICROSOFT_365|credentialReference\s*\)|DATABASE_URL\s*=|LIVE/);
});

test("connector slice adds no schema, migration, OAuth, credential resolution, scheduler, or production adapter", () => {
  const paths = [
    "src/modules/onboard-core/connectorContracts.ts",
    "src/modules/onboard-core/connectorService.ts",
    "src/app/api/v1/connectors/sync-validations/route.ts",
  ];
  const source = paths.map((path) => readFileSync(path, "utf8")).join("\n");
  assert.equal(CONNECTOR_SYNC_VALIDATION_VERSION, "ConnectorSyncValidation/v1");
  assert.doesNotMatch(source, /create table|alter table|oauth|scheduler|cron|Gmail|QuickBooks.*Adapter|Google.*Adapter/i);
});
