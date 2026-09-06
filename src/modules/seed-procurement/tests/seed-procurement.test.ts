import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { purchaseOrderAcknowledgementFixture } from "@/modules/luzione-core-contracts/seedProductFixtures";
import { sha256 } from "@/modules/platform-guarantees/eventContract";
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
import { seedProcurementA3V1KnownBadFixture, SEED_PROCUREMENT_A3_V1_KNOWN_BAD_DIGEST_SHA256 } from "@/modules/seed-procurement/fixtures/a3-v1-known-bad";

test("A3C v2 strict parser covers artifact, product, RFQ, quote, bid, human selection, PO draft and acknowledgement commands", () => {
  const commands = [evidenceRegisterCommandFixture, productSourceCommandFixture, productCandidateCommandFixture, rfqDraftCommandFixture, supplierQuoteCommandFixture, bidComparisonCommandFixture, procurementSelectionCommandFixture, purchaseOrderDraftCommandFixture, purchaseOrderAcknowledgementCommandFixture];
  assert.deepEqual(commands.map((command) => parseSeedProcurementCommand(command).commandType), commands.map((command) => command.commandType));
  assert.equal(parseSeedProcurementCommand(productSourceCommandFixture).contractVersion, SEED_PROCUREMENT_COMMAND_VERSION);
  assert.equal(parseSeedProcurementCommand(productSourceCommandFixture).commandType, "product_source.record");
});

test("A3C source-kind matrix preserves URL-to-PDF two-artifact lineage and rejects semantic drift", () => {
  for (const [ingestionFormat, kind] of [["CSV", "XLSX"], ["MANUAL", "MANUAL"], ["PDF", "PDF"], ["ROOM_PLANNER", "ROOM_PLANNER"], ["SHOPIFY", "SHOPIFY"], ["URL", "URL"], ["XLSX", "XLSX"]] as const) {
    const command = parseSeedProcurementCommand({ ...productSourceCommandFixture, ingestionFormat, source: { ...productSourceCommandFixture.source, kind } });
    assert.equal(command.commandType, "product_source.record");
  }
  const urlArtifactId = "evidence-artifact-url";
  const pdf = parseSeedProcurementCommand({ ...productSourceCommandFixture, ingestionFormat: "PDF", source: { ...productSourceCommandFixture.source, kind: "PDF" }, upstreamArtifactRefs: [{ artifactId: urlArtifactId, artifactVersion: `evidence-artifact:${urlArtifactId}:v1` }] });
  assert.equal(pdf.commandType, "product_source.record");
  assert.deepEqual(pdf.upstreamArtifactRefs, [{ artifactId: urlArtifactId, artifactVersion: `evidence-artifact:${urlArtifactId}:v1` }]);
  assert.throws(() => parseSeedProcurementCommand({ ...productSourceCommandFixture, ingestionFormat: "URL", source: { ...productSourceCommandFixture.source, kind: "PDF" } }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "SOURCE_KIND_MISMATCH");
  assert.throws(() => parseSeedProcurementCommand({ ...productSourceCommandFixture, upstreamArtifactRefs: [{ artifactId: productSourceCommandFixture.artifactId, artifactVersion: productSourceCommandFixture.artifactVersion }] }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "INVALID_COMMAND");
  assert.throws(() => parseSeedProcurementCommand({ ...productSourceCommandFixture, artifactId: ` ${productSourceCommandFixture.artifactId}` }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "INVALID_COMMAND");
  assert.throws(() => parseSeedProcurementCommand({ ...productSourceCommandFixture, source: { ...productSourceCommandFixture.source, observedAt: "2026-02-30T09:30:00.000Z" } }), (error: unknown) => error instanceof SeedProcurementContractError && error.code === "INVALID_COMMAND");
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

test("A2P-compatible read model pins producers and retains only the PO effect-admission hold", () => {
  const parsed = parseSeedProcurementReadModel(seedProcurementPositiveFixture);
  assert.equal(parsed.blockedDependencies.length, 1);
  assert.equal(parsed.purchaseOrders.length, 0);
  assert.deepEqual(Object.keys(seedProcurementHttpResponsePositiveFixture).sort(), ["correlationId", "ok", "requestId", "requestIdentityContractVersion", "responseContractVersion", "result", "traceId"]);
  assert.equal(SEED_PROCUREMENT_HTTP_ROUTES.commandCollection, "/api/v1/procurement/commands");
  assert.equal(SEED_PROCUREMENT_HTTP_ROUTES.projectProcurement, "/api/v1/projects/:projectId/procurement");
  assert.notEqual(parsed.metadata.seedProductContractProducerSha, parsed.metadata.scheduleContractProducerSha);
  assert.notEqual(parsed.metadata.procurementContractProducerSha, parsed.metadata.releaseIdentity.exactSha);
  assert.notEqual(parsed.metadata.procurementCorrectionContractProducerSha, parsed.metadata.procurementContractProducerSha);
  assert.notEqual(parsed.metadata.supplierIdentityContractProducerSha, parsed.metadata.procurementCorrectionContractProducerSha);
});

test("published A3 v1 known-bad input keeps its exact digest and remains rejected", () => {
  assert.equal(sha256(seedProcurementA3V1KnownBadFixture), SEED_PROCUREMENT_A3_V1_KNOWN_BAD_DIGEST_SHA256);
  assert.throws(() => parseSeedProcurementReadModel(seedProcurementA3V1KnownBadFixture.result), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "UNSUPPORTED_CONTRACT_VERSION");
  const lineage = structuredClone(seedProcurementA3V1KnownBadFixture.result) as unknown as Record<string, unknown>;
  lineage.contractVersion = "SeedProcurementReadModel/v2";
  const metadata = lineage.metadata as Record<string, unknown>;
  metadata.procurementCorrectionContractProducerSha = seedProcurementPositiveFixture.metadata.procurementCorrectionContractProducerSha;
  metadata.supplierIdentityContractProducerSha = seedProcurementPositiveFixture.metadata.supplierIdentityContractProducerSha;
  (metadata.releaseIdentity as { contractComponents: string[] }).contractComponents = [...seedProcurementPositiveFixture.metadata.releaseIdentity.contractComponents];
  const sources = lineage.productSources as Array<Record<string, unknown>>;
  sources[0].upstreamArtifactRefs = [];
  assert.throws(() => parseSeedProcurementReadModel(lineage), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "SOURCE_KIND_MISMATCH");
  sources[0].ingestionFormat = "PDF";
  assert.throws(() => parseSeedProcurementReadModel(lineage), (error: unknown) => error instanceof SeedProcurementReadModelError && error.code === "REFERENCE_MISMATCH");
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

test("A3C migration admits exactly four owner writes while preserving RLS, append-only rows, PO holds and no effects", () => {
  const migration = readFileSync("supabase/migrations/20260905091246_seed_procurement_a3.sql", "utf8");
  const correction = readFileSync("supabase/migrations/20260906003727_seed_procurement_a3_correction_01.sql", "utf8");
  const rollback = readFileSync("scripts/validation/rollback-seed-procurement-a3-correction-01.sql", "utf8");
  const store = readFileSync("src/modules/seed-procurement/store.ts", "utf8");
  const route = readFileSync("src/app/api/v1/procurement/commands/route.ts", "utf8");
  const routeSupport = readFileSync("src/modules/seed-procurement/routeSupport.ts", "utf8");
  const topology = JSON.parse(readFileSync("engineering/execution/seed-procurement-a3-correction-01/SEED_PROCUREMENT_A3_CORRECTION_01_TOPOLOGY_DELTA_V1.json", "utf8")) as {
    database_posture: { browser_role_grants: number; new_runtime_insert_relations: number; preserved_dependency_holds: string[] };
    effect_authority: string;
    procurement_correction_contract_producer_sha: string;
    prohibited_effects: string[];
  };
  assert.equal((migration.match(/force row level security/g) ?? []).length, 9);
  assert.equal((migration.match(/to luzione_api_runtime using/g) ?? []).length, 9);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.seed_procurement_a3_reject_mutation\(\) from public/);
  assert.match(migration, /seed_procurement_a3_hold_unresolved_dependencies/);
  assert.match(migration, /seed_procurement_a3_validate_product_lineage/);
  assert.match(migration, /grant select, insert on table/);
  assert.doesNotMatch(migration, /grant select, insert on table public\.seed_rfq_drafts/);
  assert.doesNotMatch(migration, /grant[^;]*\bupdate\b/i);
  assert.equal((correction.match(/drop trigger seed_(?:rfq|supplier_quote|bid_comparison|selection_decision)_dependency_hold/g) ?? []).length, 4);
  assert.doesNotMatch(correction, /drop trigger seed_purchase_order_(?:dependency_hold|ack_dependency_hold)/);
  assert.match(correction, /grant select,insert on table public\.seed_rfq_drafts,public\.seed_supplier_quotes,public\.seed_bid_comparisons,public\.seed_procurement_selection_decisions/);
  assert.match(correction, /create constraint trigger seed_rfq_a3c_integrity[\s\S]*deferrable initially deferred/);
  assert.match(correction, /roles @> array\['luzione_api_runtime'\]::name\[\]/);
  assert.match(correction, /capabilities \? 'QUOTE_SUBMISSION'/);
  assert.match(correction, /capabilities \? case when tg_table_name='seed_rfq_drafts' then 'RFQ_RESPONSE' else 'QUOTE_SUBMISSION' end/);
  assert.match(rollback, /rollback refused/);
  assert.doesNotMatch(rollback, /drop trigger seed_purchase_order_(?:dependency_hold|ack_dependency_hold)/);
  assert.match(store, /requireEligibleSupplier/);
  assert.match(store, /bid_comparison\.approve_from_selection/);
  assert.match(store, /write\.receipt\.state = "DOMAIN_COMMITTED"/);
  assert.match(store, /PROPOSAL_CANONICAL_READER_UNAVAILABLE/);
  assert.match(store, /if \(!readback \|\| !readbackMatchesReceipt\)/);
  assert.match(store, /s\.project_id=\$2/);
  assert.match(store, /c\.project_id=\$2/);
  assert.match(store, /artifact_content_digest/);
  assert.match(store, /product_source_status/);
  assert.match(store, /r\.correlation_id/);
  assert.match(route, /A1_NO_EFFECT/);
  assert.match(route, /A2_HUMAN_APPROVAL_NO_EFFECT/);
  assert.match(routeSupport, /SeedSupplierIdentityDomainError/);
  assert.match(routeSupport, /status: error\.status/);
  assert.doesNotMatch(`${store}\n${route}`, /fetch\(|EXTERNAL_EFFECT|supplier_rfq_email|sendRfq|releasePurchaseOrder/);
  assert.equal(topology.procurement_correction_contract_producer_sha, "a98d70e75baac9c25c3aa8af96615fbf3eba4575");
  assert.equal(topology.effect_authority, "NO_EFFECT");
  assert.equal(topology.database_posture.new_runtime_insert_relations, 4);
  assert.equal(topology.database_posture.browser_role_grants, 0);
  assert.deepEqual(topology.database_posture.preserved_dependency_holds, ["PURCHASE_ORDER", "PURCHASE_ORDER_ACKNOWLEDGEMENT"]);
  assert.ok(topology.prohibited_effects.includes("deployment"));
});

test("A3C proof and handoff bind every artifact to the immutable exact candidate", () => {
  const exactCandidateSha = "656c537dbf801aa22eece51514040e6e56ba5460";
  const manifest = JSON.parse(readFileSync("engineering/execution/seed-procurement-a3-correction-01/SEED_PROCUREMENT_A3_CORRECTION_01_ARTIFACT_DIGESTS_V1.json", "utf8")) as {
    artifacts: Array<{ path: string; sha256: string }>;
    exact_candidate_sha: string;
    implementation_sha: string;
  };
  const proof = JSON.parse(readFileSync("engineering/execution/seed-procurement-a3-correction-01/SEED_PROCUREMENT_A3_CORRECTION_01_PROOF_V1.json", "utf8")) as {
    checks: Record<string, string>;
    database_observations: { anon_authenticated_grants: number; non_no_effect_outbox_rows: number; preserved_purchase_order_hold_triggers: number };
    deployment_sha: string | null;
    exact_candidate_sha: string;
    external_effects: string;
    managed_migration: string;
  };
  const handoff = JSON.parse(readFileSync("engineering/execution/handoffs/SEED_PROCUREMENT_A3_CORRECTION_01_CONSUMER_HANDOFF.json", "utf8")) as {
    contracts: { command: string; read_model: string };
    deployment_sha: string | null;
    exact_candidate_sha: string;
    managed_migration: string;
    procurement_correction_contract_producer_sha: string;
    remaining_dependency_holds: Array<{ commands: string[] }>;
  };
  assert.equal(manifest.exact_candidate_sha, exactCandidateSha);
  assert.equal(manifest.implementation_sha, "a98d70e75baac9c25c3aa8af96615fbf3eba4575");
  for (const artifact of manifest.artifacts) {
    const bytes = execFileSync("git", ["show", `${exactCandidateSha}:${artifact.path}`]);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, artifact.path);
  }
  assert.equal(proof.exact_candidate_sha, exactCandidateSha);
  assert.equal(proof.checks.full_tests, "PASS_546_OF_546");
  assert.equal(proof.database_observations.non_no_effect_outbox_rows, 0);
  assert.equal(proof.database_observations.anon_authenticated_grants, 0);
  assert.equal(proof.database_observations.preserved_purchase_order_hold_triggers, 2);
  assert.equal(proof.external_effects, "NOT_AUTHORIZED_NOT_EXECUTED");
  assert.equal(proof.managed_migration, "NOT_RUN");
  assert.equal(proof.deployment_sha, null);
  assert.equal(handoff.exact_candidate_sha, exactCandidateSha);
  assert.equal(handoff.contracts.command, "SeedProcurementCommand/v2");
  assert.equal(handoff.contracts.read_model, "SeedProcurementReadModel/v2");
  assert.equal(handoff.procurement_correction_contract_producer_sha, "a98d70e75baac9c25c3aa8af96615fbf3eba4575");
  assert.equal(handoff.remaining_dependency_holds.length, 2);
  assert.equal(handoff.managed_migration, "NOT_RUN");
  assert.equal(handoff.deployment_sha, null);
});
