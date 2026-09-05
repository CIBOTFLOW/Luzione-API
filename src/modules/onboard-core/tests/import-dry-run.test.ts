import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SetupMandateV1 } from "@/modules/luzione-core-contracts/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { ONBOARD_CORE_API_VERSION, OnboardCoreContractError } from "../contracts";
import {
  ONBOARD_IMPORT_MAPPING_VERSION_V2, assertImportStatusFinality, importReservation, importSourceDigest,
  issueImportEvidence, parseImportDryRunRequest,
} from "../importContracts";
import { assertRuntimeWithinMandate } from "../runtimeLimit";

const bindingDigest = "9".repeat(64);
const mandate: SetupMandateV1 = {
  active: true, allowedActions: ["DRY_RUN_IMPORT", "RECONCILE_IMPORT", "VALIDATE_CONNECTOR_READBACK"],
  approvalRef: "approval:import-proof", blueprintRef: { blueprintId: "44444444-4444-4444-8444-444444444444", version: "2.0.0" },
  contractVersion: "SetupMandate/v1", effectCeiling: "NO_EFFECT", expiresAt: "2099-09-05T00:00:00.000Z",
  limits: { maxImportRecords: 4, maxRuntimeMinutes: 30 }, mandateId: "55555555-5555-4555-8555-555555555555",
  prohibitedActions: ["CHANGE_SHARED_CODE_OR_SCHEMA", "COMPLETE_OAUTH", "CREATE_OR_READ_CREDENTIAL", "CROSS_TENANT", "DESTRUCTIVE_DATA_CLEANUP", "EXPAND_AUTHORITY", "SEND_EXTERNAL_COMMUNICATION"],
  rollbackPlanRef: "blueprint-rollback:proof", tenantId: "tenant-import-proof",
};

const rows = [
  { matchKeyDigest: sha256({ key: "a" }), payloadDigest: sha256({ value: 1 }), sourceRowId: "row-1" },
  { matchKeyDigest: sha256({ key: "a" }), payloadDigest: sha256({ value: 1 }), sourceRowId: "row-2" },
  { matchKeyDigest: sha256({ key: "b" }), payloadDigest: sha256({ value: 2 }), sourceRowId: "row-3" },
  { matchKeyDigest: sha256({ key: "b" }), payloadDigest: sha256({ value: 3 }), sourceRowId: "row-4" },
];

function request(inputRows: Array<Record<string, unknown>> = rows, overrides: Record<string, unknown> = {}) {
  const source = { consentRef: "consent:import-proof", digest: "pending", kind: "CSV" as const, provenanceRef: "tenant-pack:synthetic-csv" };
  const value = { contractVersion: ONBOARD_CORE_API_VERSION, dedupeKey: "customer-zero-import-1", expectedMandateObjectVersion: "setup-mandate:proof@v1", mandateId: mandate.mandateId, mappingVersion: ONBOARD_IMPORT_MAPPING_VERSION_V2, rows: inputRows, sourceBindingDigest: bindingDigest, source, ...overrides };
  return { ...value, source: { ...source, digest: importSourceDigest(value as never) } };
}
function expectCode(callback: () => unknown, code: string) {
  assert.throws(callback, (error: unknown) => error instanceof OnboardCoreContractError && error.code === code);
}

test("L1 derives duplicate/conflict truth and closed no-effect finality from digest manifest", () => {
  const parsed = parseImportDryRunRequest(request());
  const evidence = issueImportEvidence({ mandate, request: parsed, tenantId: mandate.tenantId });
  assert.deepEqual(evidence.rows.map((row) => row.outcome), ["ACCEPTED", "DUPLICATE", "CONFLICT", "CONFLICT"]);
  assert.equal(evidence.receipt.finality, "RECONCILIATION_REQUIRED");
  assert.equal(evidence.batch.effectMode, "NO_EFFECT");
  assert.equal(evidence.receipt.effectMode, evidence.batch.effectMode);
  assert.equal(evidence.receipt.exceptionRefs.length, 2);
  assertImportStatusFinality(evidence.batch, evidence.receipt);
});

test("missing match key is server-derived rejection and caller-declared outcome is forbidden", () => {
  const missing = [{ matchKeyDigest: null, payloadDigest: sha256({ value: 1 }), sourceRowId: "row-missing" }];
  const evidence = issueImportEvidence({ mandate, request: parseImportDryRunRequest(request(missing)), tenantId: mandate.tenantId });
  assert.equal(evidence.rows[0].outcome, "REJECTED");
  assert.equal(evidence.rows[0].reasonCode, "MATCH_KEY_MISSING");
  expectCode(() => parseImportDryRunRequest(request([{ ...missing[0], outcome: "ACCEPTED" }])), "FIELD_SET_MISMATCH");
});

test("mapping, source, binding and mandate limits fail closed", () => {
  expectCode(() => parseImportDryRunRequest({ ...request(), mappingVersion: "CRMImportDryRunMap/v1" }), "WRONG_MAPPING_VERSION");
  expectCode(() => parseImportDryRunRequest({ ...request(), sourceBindingDigest: "bad" }), "INVALID_REQUEST");
  const malformed = request();
  expectCode(() => parseImportDryRunRequest({ ...malformed, source: { ...malformed.source, digest: "a".repeat(64) } }), "SOURCE_DIGEST_MISMATCH");
  const overLimit = parseImportDryRunRequest(request([...rows, { matchKeyDigest: sha256({ key: "c" }), payloadDigest: sha256({ value: 4 }), sourceRowId: "row-5" }]));
  expectCode(() => issueImportEvidence({ mandate, request: overLimit, tenantId: mandate.tenantId }), "MANDATE_LIMIT_EXCEEDED");
});

test("reservation replay is tenant/key stable while changed digest conflicts at P110", () => {
  const first = parseImportDryRunRequest(request());
  const changed = parseImportDryRunRequest(request([{ ...rows[0], payloadDigest: sha256({ changed: true }) }, ...rows.slice(1)]));
  assert.deepEqual(importReservation(mandate.tenantId, first), importReservation(mandate.tenantId, changed));
  assert.notEqual(first.source.digest, changed.source.digest);
});

test("server monotonic runtime measurement accepts within-limit and rejects exact boundary", () => {
  const proof = assertRuntimeWithinMandate({ elapsedMs: 1_000, maxRuntimeMinutes: 1, startedAt: "2026-09-05T00:00:00.000Z" });
  assert.equal(proof.deadlineAt, "2026-09-05T00:01:00.000Z");
  assert.equal(proof.measuredBy, "server-monotonic-clock");
  assert.throws(() => assertRuntimeWithinMandate({ elapsedMs: 60_000, maxRuntimeMinutes: 1, startedAt: "2026-09-05T00:00:00.000Z" }), (error: unknown) => error instanceof OnboardCoreContractError && error.code === "MANDATE_RUNTIME_EXCEEDED");
});

test("routes and migration bind exact mapper evidence, revocation and job deadline without effects", () => {
  const store = readFileSync("src/modules/onboard-core/importStore.ts", "utf8");
  const route = readFileSync("src/app/api/v1/onboarding/imports/dry-runs/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260905050000_onboard_core_correction_01.sql", "utf8");
  assert.match(store, /source_binding_digest/);
  assert.match(store, /onboarding_setup_mandate_revocations/);
  assert.match(store, /statement_timeout/);
  assert.match(migration, /measured_runtime_ms/);
  assert.doesNotMatch(`${store}\n${route}`, /CRM_COMMITTED|attachment|DELETE|LIVE_EFFECT/);
});
