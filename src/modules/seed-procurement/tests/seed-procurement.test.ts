import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { purchaseOrderAcknowledgementFixture } from "@/modules/luzione-core-contracts/seedProductFixtures";
import {
  SEED_PROCUREMENT_COMMAND_VERSION,
  SeedProcurementContractError,
  parseSeedProcurementCommand,
} from "@/modules/seed-procurement/contracts";
import {
  bidComparisonCommandFixture,
  evidenceRegisterCommandFixture,
  procurementSelectionCommandFixture,
  productCandidateCommandFixture,
  productSourceCommandFixture,
  purchaseOrderAcknowledgementCommandFixture,
  purchaseOrderDraftCommandFixture,
  rfqDraftCommandFixture,
  seedProcurementHttpResponsePositiveFixture,
  seedProcurementPositiveFixture,
  supplierQuoteCommandFixture,
} from "@/modules/seed-procurement/fixtures";
import {
  normalizeQuoteEconomics,
  objectiveScore,
  productCandidateReadbackDefects,
  productSourceReadbackDefects,
  procurementInvariantDefects,
  procurementVersions,
  timelineProjectVersion,
} from "@/modules/seed-procurement/model";
import {
  SEED_PROCUREMENT_HTTP_ROUTES,
  SeedProcurementReadModelError,
  parseSeedProcurementReadModel,
} from "@/modules/seed-procurement/readModel";

test("A3 strict parser covers artifact, product, RFQ, quote, bid, human selection, PO draft and acknowledgement commands", () => {
  const commands = [evidenceRegisterCommandFixture, productSourceCommandFixture, productCandidateCommandFixture, rfqDraftCommandFixture, supplierQuoteCommandFixture, bidComparisonCommandFixture, procurementSelectionCommandFixture, purchaseOrderDraftCommandFixture, purchaseOrderAcknowledgementCommandFixture];
  assert.deepEqual(commands.map((command) => parseSeedProcurementCommand(command).commandType), commands.map((command) => command.commandType));
  assert.equal(parseSeedProcurementCommand(productSourceCommandFixture).contractVersion, SEED_PROCUREMENT_COMMAND_VERSION);
  assert.equal(parseSeedProcurementCommand(productSourceCommandFixture).commandType, "product_source.record");
});

test("caller identity, authority, tenant, finality, changed field sets and stale create versions fail closed", () => {
  for (const forged of [
    { ...evidenceRegisterCommandFixture, tenantId: "tenant-forged" },
    { ...evidenceRegisterCommandFixture, actorId: "actor-forged" },
    { ...evidenceRegisterCommandFixture, authority: { decision: "ALLOW" } },
    { ...evidenceRegisterCommandFixture, effect: "RFQ_SEND" },
  ]) {
    assert.throws(() => parseSeedProcurementCommand(forged), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "FIELD_SET_MISMATCH");
  }
  assert.throws(() => parseSeedProcurementCommand({ ...evidenceRegisterCommandFixture, expectedVersion: "evidence:v1" }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "VERSION_CONFLICT");
  assert.throws(() => parseSeedProcurementCommand({ ...purchaseOrderAcknowledgementCommandFixture, acknowledgementState: "SOURCE_CONFIRMED" }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "INVALID_COMMAND");
  assert.throws(() => parseSeedProcurementCommand({ ...productSourceCommandFixture, ingestionFormat: "CSV", source: { ...productSourceCommandFixture.source, kind: "URL" } }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "SOURCE_KIND_MISMATCH");
  assert.throws(() => parseSeedProcurementCommand({ ...procurementSelectionCommandFixture, expectedVersion: "bid-comparison:bid-comparison-1:v2" }), (error: unknown) => error instanceof SeedProcurementContractError || error instanceof Error);
  assert.throws(() => parseSeedProcurementCommand({ ...purchaseOrderDraftCommandFixture, selectionDecisionVersion: "bid-comparison:bid-comparison-1:v2" }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "VERSION_CONFLICT");
  assert.throws(() => parseSeedProcurementCommand({ ...productCandidateCommandFixture, candidate: { ...productCandidateCommandFixture.candidate, lane: "APPROVED_VENDOR", vendorId: null } }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "INVALID_COMMAND");
});

test("objective score and quote landed economics reconcile from disclosed inputs and integer minor units", () => {
  const candidate = parseSeedProcurementCommand(productCandidateCommandFixture);
  assert.equal(candidate.commandType, "product_candidate.record");
  assert.equal(objectiveScore(candidate.fit), 0.865);
  const quote = parseSeedProcurementCommand(supplierQuoteCommandFixture);
  assert.equal(quote.commandType, "supplier_quote.normalize");
  const economics = normalizeQuoteEconomics(quote);
  assert.deepEqual({ supplier: economics.supplierCostTotalMinor, landed: economics.landedTotalMinor, client: economics.clientPriceTotalMinor, margin: economics.marginMinor }, { supplier: 300000, landed: 350000, client: 575000, margin: 225000 });
  assert.equal(economics.lines[0].landedTotalMinor, economics.lines[0].supplierCostTotalMinor + economics.lines[0].freightMinor + economics.lines[0].dutyMinor + economics.lines[0].reserveMinor);
});

test("A3 read model pins API producer layers, exact apiResponse envelope and explicit dependency holds", () => {
  const parsed = parseSeedProcurementReadModel(seedProcurementPositiveFixture);
  assert.equal(parsed.blockedDependencies.length, 2);
  assert.equal(parsed.purchaseOrders.length, 0);
  assert.deepEqual(Object.keys(seedProcurementHttpResponsePositiveFixture).sort(), ["correlationId", "ok", "requestId", "requestIdentityContractVersion", "responseContractVersion", "result", "traceId"]);
  assert.equal(SEED_PROCUREMENT_HTTP_ROUTES.commandCollection, "/api/v1/procurement/commands");
  assert.equal(SEED_PROCUREMENT_HTTP_ROUTES.projectProcurement, "/api/v1/projects/:projectId/procurement");
  assert.notEqual(parsed.metadata.seedProductContractProducerSha, parsed.metadata.scheduleContractProducerSha);
  assert.notEqual(parsed.metadata.procurementContractProducerSha, parsed.metadata.releaseIdentity.exactSha);
});

test("hostile cross-tenant, wrong producer, corrupt objective score and false source finality fail readback", () => {
  const tenant = structuredClone(seedProcurementPositiveFixture);
  tenant.productSources[0].resource.tenantId = "tenant-other";
  tenant.productSources[0].resource.sourceRefs.forEach((ref) => { ref.tenantId = "tenant-other"; });
  assert.throws(() => parseSeedProcurementReadModel(tenant), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "TENANT_MISMATCH");
  const producer = structuredClone(seedProcurementPositiveFixture);
  producer.metadata.procurementContractProducerSha = "f".repeat(40) as typeof producer.metadata.procurementContractProducerSha;
  assert.throws(() => parseSeedProcurementReadModel(producer), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "PRODUCER_MISMATCH");
  const score = structuredClone(seedProcurementPositiveFixture);
  score.productCandidates[0].fit.score = 0.1;
  assert.throws(() => parseSeedProcurementReadModel(score), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "OBJECTIVE_SCORE_MISMATCH");
  const finality = structuredClone(seedProcurementPositiveFixture);
  const acknowledgement = structuredClone(purchaseOrderAcknowledgementFixture);
  acknowledgement.tenantId = finality.metadata.tenantId;
  acknowledgement.sourceRefs.forEach((ref) => { ref.tenantId = finality.metadata.tenantId; });
  acknowledgement.resource.status = "SOURCE_CONFIRMED";
  acknowledgement.receipt.finality = "SOURCE_CONFIRMED";
  acknowledgement.receipt.observedAt = "2026-09-05T10:00:00.000Z";
  acknowledgement.receipt.observedVersion = acknowledgement.resource.version;
  acknowledgement.receipt.sourceReadbackRef = "source:purchase-order-ack";
  finality.acknowledgements.push(acknowledgement);
  assert.throws(() => parseSeedProcurementReadModel(finality), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "FALSE_FINALITY");
});

test("read model binds evidence, source, candidate, duplicate lineage and finite score inputs inside one Project", () => {
  const orphanSource = structuredClone(seedProcurementPositiveFixture);
  orphanSource.productSources[0].resource.data.sourceArtifactRef = "evidence-artifact-missing";
  assert.throws(() => parseSeedProcurementReadModel(orphanSource), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "REFERENCE_MISMATCH");

  const digestDrift = structuredClone(seedProcurementPositiveFixture);
  digestDrift.productSources[0].resource.data.contentDigest = "b".repeat(64);
  assert.throws(() => parseSeedProcurementReadModel(digestDrift), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "REFERENCE_MISMATCH");

  const orphanCandidate = structuredClone(seedProcurementPositiveFixture);
  orphanCandidate.productCandidates[0].resource.data.productSourceId = "product-source-missing";
  assert.throws(() => parseSeedProcurementReadModel(orphanCandidate), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "REFERENCE_MISMATCH");

  const projectLeak = structuredClone(seedProcurementPositiveFixture);
  projectLeak.productSources[0].projectId = "project-other";
  assert.throws(() => parseSeedProcurementReadModel(projectLeak), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "REFERENCE_MISMATCH");

  const stringScore = structuredClone(seedProcurementPositiveFixture) as unknown as Record<string, unknown>;
  ((stringScore.productCandidates as Array<Record<string, unknown>>)[0].fit as { inputs: Record<string, unknown> }).inputs.margin = "0.8";
  assert.throws(() => parseSeedProcurementReadModel(stringScore), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "INVALID_VALUE");

  const duplicateSource = structuredClone(seedProcurementPositiveFixture);
  const duplicateSourceRecord = structuredClone(duplicateSource.productSources[0]);
  duplicateSourceRecord.resource.resource.id = "product-source-duplicate";
  duplicateSourceRecord.resource.resource.version = "product-source-duplicate:v1";
  duplicateSourceRecord.resource.receipt.committedVersion = "product-source-duplicate:v1";
  duplicateSourceRecord.duplicateOfSourceId = duplicateSource.productSources[0].resource.resource.id;
  duplicateSource.productSources.push(duplicateSourceRecord);
  assert.throws(() => parseSeedProcurementReadModel(duplicateSource), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "FINALITY_MISMATCH");

  const duplicateCandidate = structuredClone(seedProcurementPositiveFixture);
  const duplicateCandidateRecord = structuredClone(duplicateCandidate.productCandidates[0]);
  duplicateCandidateRecord.resource.resource.id = "product-candidate-duplicate";
  duplicateCandidateRecord.resource.resource.version = "product-candidate-duplicate:v1";
  duplicateCandidateRecord.resource.receipt.committedVersion = "product-candidate-duplicate:v1";
  duplicateCandidateRecord.duplicateOfCandidateId = duplicateCandidate.productCandidates[0].resource.resource.id;
  duplicateCandidate.productCandidates.push(duplicateCandidateRecord);
  assert.throws(() => parseSeedProcurementReadModel(duplicateCandidate), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "FINALITY_MISMATCH");
});

test("TimelineEvent Project aggregate derives the actual canonical Project version", () => {
  assert.equal(timelineProjectVersion("project-1", 2), "project:project-1:v2");
  assert.throws(() => timelineProjectVersion("project-1", 0), /invalid/);
});

test("single-resource row reconstruction detects tampered relational lineage", () => {
  const artifactId = "evidence-artifact-1";
  const sourceId = "product-source-1";
  const digest = "a".repeat(64);
  const sourceInput = { artifactContentDigest: digest, artifactId, artifactProjectId: "project-1", artifactStatus: "ACTIVE", artifactVersion: procurementVersions.evidence(artifactId), payloadContentDigest: digest, payloadSourceArtifactRef: artifactId, rowContentDigest: digest, sourceProjectId: "project-1", sourceStatus: "ACTIVE" };
  assert.deepEqual(productSourceReadbackDefects(sourceInput), []);
  assert.deepEqual(productSourceReadbackDefects({ ...sourceInput, artifactProjectId: null, artifactStatus: "REVIEW_REQUIRED", artifactVersion: "evidence-artifact:stale:v0", payloadContentDigest: "b".repeat(64), payloadSourceArtifactRef: "evidence-other" }), ["SOURCE_ARTIFACT_ID_MISMATCH", "SOURCE_ARTIFACT_VERSION_MISMATCH", "SOURCE_CONTENT_DIGEST_MISMATCH", "SOURCE_PROJECT_SCOPE_MISMATCH", "SOURCE_EVIDENCE_STATUS_PROMOTION"]);

  const candidateInput = { candidateProjectId: "project-1", candidateStatus: "ELIGIBLE", payloadProductSourceId: sourceId, productSourceId: sourceId, productSourceProjectId: "project-1", productSourceStatus: "ACTIVE", productSourceVersion: procurementVersions.productSource(sourceId) };
  assert.deepEqual(productCandidateReadbackDefects(candidateInput), []);
  assert.deepEqual(productCandidateReadbackDefects({ ...candidateInput, payloadProductSourceId: "product-source-other", productSourceProjectId: null, productSourceStatus: "REVIEW_REQUIRED", productSourceVersion: "product-source:stale:v0" }), ["CANDIDATE_SOURCE_ID_MISMATCH", "CANDIDATE_SOURCE_VERSION_MISMATCH", "CANDIDATE_PROJECT_SCOPE_MISMATCH", "CANDIDATE_SOURCE_STATUS_PROMOTION"]);
});

test("known-bad tenant predicate, stale version and corrupt landed total controls are detected", () => {
  assert.deepEqual(procurementInvariantDefects({ actualVersion: "spec:v2", expectedVersion: "spec:v1", landedTotalMinor: 90, query: "select * from seed_supplier_quotes where supplier_quote_id=$2", supplierCostTotalMinor: 100 }), ["TENANT_PREDICATE_MISSING", "STALE_VERSION_ACCEPTED", "LANDED_TOTAL_CORRUPT"]);
  assert.deepEqual(procurementInvariantDefects({ actualVersion: "spec:v1", expectedVersion: "spec:v1", landedTotalMinor: 110, query: "select * from seed_supplier_quotes where tenant_id=$1 and supplier_quote_id=$2", supplierCostTotalMinor: 100 }), []);
});

test("migration and store enforce forced RLS, explicit runtime role, immutable rows, dependency holds and no effects", () => {
  const migration = readFileSync("supabase/migrations/20260905091246_seed_procurement_a3.sql", "utf8");
  const store = readFileSync("src/modules/seed-procurement/store.ts", "utf8");
  const route = readFileSync("src/app/api/v1/procurement/commands/route.ts", "utf8");
  assert.equal((migration.match(/force row level security/g) ?? []).length, 9);
  assert.equal((migration.match(/to luzione_api_runtime using/g) ?? []).length, 9);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.seed_procurement_a3_reject_mutation\(\) from public/);
  assert.match(migration, /seed_procurement_a3_hold_unresolved_dependencies/);
  assert.match(migration, /seed_procurement_a3_validate_product_lineage/);
  assert.match(migration, /grant select, insert on table/);
  assert.doesNotMatch(migration, /grant select, insert on table public\.seed_rfq_drafts/);
  assert.doesNotMatch(migration, /grant[^;]*\bupdate\b/i);
  assert.match(store, /SUPPLIER_ELIGIBILITY_UNVERIFIED/);
  assert.match(store, /PROPOSAL_CANONICAL_READER_UNAVAILABLE/);
  assert.match(store, /if \(!readback \|\| !readbackMatchesReceipt\)/);
  assert.match(store, /s\.project_id=\$2/);
  assert.match(store, /c\.project_id=\$2/);
  assert.match(store, /artifact_content_digest/);
  assert.match(store, /product_source_status/);
  assert.match(store, /r\.correlation_id/);
  assert.match(store, /where tenant_id=\$1 and id::text=\$2/);
  assert.match(route, /A1_NO_EFFECT/);
  assert.doesNotMatch(`${store}\n${route}`, /fetch\(|EXTERNAL_EFFECT|supplier_rfq_email|sendRfq|releasePurchaseOrder/);
});
