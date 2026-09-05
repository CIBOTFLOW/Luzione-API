import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SetupMandateV1 } from "@/modules/luzione-core-contracts/contracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  ONBOARD_CORE_API_VERSION,
  OnboardCoreContractError,
} from "../contracts";
import {
  ONBOARD_IMPORT_MAPPING_VERSION,
  assertImportStatusFinality,
  importReservation,
  importSourceDigest,
  issueImportEvidence,
  parseImportDryRunRequest,
} from "../importContracts";

const mandate: SetupMandateV1 = {
  active: true,
  allowedActions: ["DRY_RUN_IMPORT", "RECONCILE_IMPORT", "VALIDATE_CONNECTOR_READBACK"],
  approvalRef: "approval:import-proof",
  blueprintRef: { blueprintId: "44444444-4444-4444-8444-444444444444", version: "2.0.0" },
  contractVersion: "SetupMandate/v1",
  effectCeiling: "NO_EFFECT",
  expiresAt: "2099-09-05T00:00:00.000Z",
  limits: { maxImportRecords: 4, maxRuntimeMinutes: 30 },
  mandateId: "55555555-5555-4555-8555-555555555555",
  prohibitedActions: [
    "CHANGE_SHARED_CODE_OR_SCHEMA", "COMPLETE_OAUTH", "CREATE_OR_READ_CREDENTIAL", "CROSS_TENANT",
    "DESTRUCTIVE_DATA_CLEANUP", "EXPAND_AUTHORITY", "SEND_EXTERNAL_COMMUNICATION",
  ],
  rollbackPlanRef: "blueprint-rollback:proof",
  tenantId: "tenant-import-proof",
};

function request(rows: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  const source = {
    consentRef: "consent:import-proof",
    digest: "pending",
    kind: "CSV" as const,
    provenanceRef: "tenant-pack:synthetic-csv",
  };
  const digest = importSourceDigest({ mappingVersion: ONBOARD_IMPORT_MAPPING_VERSION, rows: rows as never, source });
  return {
    contractVersion: ONBOARD_CORE_API_VERSION,
    dedupeKey: "customer-zero-import-1",
    expectedMandateObjectVersion: "setup-mandate:proof@v1",
    mandateId: mandate.mandateId,
    mappingVersion: ONBOARD_IMPORT_MAPPING_VERSION,
    rows,
    source: { ...source, digest },
    ...overrides,
  };
}

const acceptedRows = [
  { outcome: "ACCEPTED", payloadDigest: sha256({ row: 1 }), reasonCode: null, sourceRowId: "row-1" },
  { outcome: "DUPLICATE", payloadDigest: sha256({ row: 2 }), reasonCode: null, sourceRowId: "row-2" },
];

function expectCode(callback: () => unknown, code: string) {
  assert.throws(callback, (error: unknown) => error instanceof OnboardCoreContractError && error.code === code);
}

test("validated dry run closes only as VALIDATED_NO_EFFECT and never CRM finality", () => {
  const parsed = parseImportDryRunRequest(request(acceptedRows));
  const evidence = issueImportEvidence({ mandate, request: parsed, tenantId: mandate.tenantId });
  assert.equal(evidence.batch.status, "VALIDATED");
  assert.equal(evidence.batch.effectMode, "NO_EFFECT");
  assert.equal(evidence.receipt.effectMode, evidence.batch.effectMode);
  assert.equal(evidence.receipt.finality, "VALIDATED_NO_EFFECT");
  assert.equal("crmCommitted" in evidence.receipt, false);
  assertImportStatusFinality(evidence.batch, evidence.receipt);
});

test("rejected and conflicted rows receive durable exception and reconciliation references", () => {
  const rows = [
    acceptedRows[0],
    { outcome: "REJECTED", payloadDigest: sha256({ row: 2 }), reasonCode: "INVALID_EMAIL", sourceRowId: "row-2" },
    { outcome: "CONFLICT", payloadDigest: sha256({ row: 3 }), reasonCode: "DUPLICATE_EXTERNAL_ID", sourceRowId: "row-3" },
  ];
  const parsed = parseImportDryRunRequest(request(rows));
  const evidence = issueImportEvidence({ mandate, request: parsed, tenantId: mandate.tenantId });
  assert.equal(evidence.batch.status, "RECONCILIATION_REQUIRED");
  assert.equal(evidence.receipt.finality, "RECONCILIATION_REQUIRED");
  assert.equal(evidence.receipt.exceptionRefs.length, 2);
  assert.ok(evidence.receipt.reconciliationRef);
  assert.ok(evidence.rows.find((row) => row.outcome === "CONFLICT")?.reconciliationRef);
  assert.ok(evidence.rows.find((row) => row.outcome === "REJECTED")?.exceptionRef);
});

test("rejected-only dry run remains staged with closed counts", () => {
  const rows = [acceptedRows[0], { outcome: "REJECTED", payloadDigest: sha256({ row: 2 }), reasonCode: "INVALID_EMAIL", sourceRowId: "row-2" }];
  const evidence = issueImportEvidence({ mandate, request: parseImportDryRunRequest(request(rows)), tenantId: mandate.tenantId });
  assert.equal(evidence.batch.status, "STAGED");
  assert.equal(evidence.receipt.finality, "STAGED");
  assert.equal(evidence.receipt.counts.accepted + evidence.receipt.counts.duplicates + evidence.receipt.counts.rejected, evidence.receipt.counts.total);
  assert.equal(evidence.batch.stagedCounts.records + evidence.batch.stagedCounts.rejected, evidence.receipt.counts.total);
});

test("digest, field set, row evidence, mapping, tenant and mandate limits fail closed", () => {
  expectCode(() => parseImportDryRunRequest({ ...request(acceptedRows), actorId: "forged" }), "FIELD_SET_MISMATCH");
  expectCode(() => parseImportDryRunRequest({ ...request(acceptedRows), source: { ...request(acceptedRows).source, digest: "a".repeat(64) } }), "SOURCE_DIGEST_MISMATCH");
  expectCode(() => parseImportDryRunRequest(request([
    { outcome: "REJECTED", payloadDigest: sha256({ row: 1 }), reasonCode: null, sourceRowId: "row-1" },
  ])), "IMPORT_EVIDENCE_REQUIRED");
  expectCode(() => parseImportDryRunRequest({ ...request(acceptedRows), mappingVersion: "CRMImportDryRunMap/v2" }), "WRONG_MAPPING_VERSION");
  const parsed = parseImportDryRunRequest(request(acceptedRows));
  expectCode(() => issueImportEvidence({ mandate, request: parsed, tenantId: "tenant-other" }), "TENANT_MISMATCH");
  const overLimit = parseImportDryRunRequest(request([
    ...acceptedRows,
    { outcome: "ACCEPTED", payloadDigest: sha256({ row: 3 }), reasonCode: null, sourceRowId: "row-3" },
    { outcome: "REJECTED", payloadDigest: sha256({ row: 4 }), reasonCode: "INVALID", sourceRowId: "row-4" },
    { outcome: "REJECTED", payloadDigest: sha256({ row: 5 }), reasonCode: "INVALID", sourceRowId: "row-5" },
  ]));
  expectCode(() => issueImportEvidence({ mandate, request: overLimit, tenantId: mandate.tenantId }), "MANDATE_LIMIT_EXCEEDED");
});

test("same dedupe reservation is stable while changed digest changes payload and conflicts at P110", () => {
  const first = parseImportDryRunRequest(request(acceptedRows));
  const changedRows = [{ ...acceptedRows[0], payloadDigest: sha256({ changed: true }) }, acceptedRows[1]];
  const changed = parseImportDryRunRequest(request(changedRows));
  assert.deepEqual(importReservation(mandate.tenantId, first), importReservation(mandate.tenantId, changed));
  assert.notEqual(first.source.digest, changed.source.digest);
});

test("only the named POST/GET dry-run boundaries exist and they exclude effects", () => {
  const post = readFileSync("src/app/api/v1/onboarding/imports/dry-runs/route.ts", "utf8");
  const get = readFileSync("src/app/api/v1/onboarding/imports/[batchId]/route.ts", "utf8");
  assert.match(post, /requireServiceActor\(request\.headers, "onboarding\.import\.dry_run"\)/);
  assert.match(post, /onboardingCoreEnabledForTenant\(actor\.tenantId\)/);
  assert.match(get, /requireServiceActor\(request\.headers, "onboarding\.import\.read"\)/);
  assert.doesNotMatch(`${post}\n${get}`, /fetch\(|ProviderWorkerRuntime|DELETE|attachment|CRM_COMMITTED|BOUNDED_PROVIDER_EFFECT/);
});

test("import migration is tenant-RLS, append-only, pair-closed and reversible independently", () => {
  const migration = readFileSync("supabase/migrations/20260905041000_onboard_core_import_dry_runs.sql", "utf8");
  const rollback = readFileSync("scripts/validation/rollback-onboard-core-import-dry-runs.sql", "utf8");
  assert.equal((migration.match(/force row level security/g) ?? []).length, 3);
  assert.equal((migration.match(/append_only/g) ?? []).length, 3);
  assert.match(migration, /onboard_core_validate_import_pair/);
  assert.match(migration, /canonical_batch->>'effectMode' = 'NO_EFFECT'/);
  for (const relation of ["onboarding_import_receipts", "onboarding_import_rows", "onboarding_import_batches"]) {
    assert.match(rollback, new RegExp(`drop table if exists public\\.${relation}`));
  }
  assert.doesNotMatch(rollback, /onboarding_setup_mandates/);
});
