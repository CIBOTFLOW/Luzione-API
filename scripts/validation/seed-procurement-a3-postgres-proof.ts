import assert from "node:assert/strict";
import { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";
import {
  ROOM_PLANNER_OWNER,
  SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
  canonicalProjectPackageHash,
  parseProjectCreationCommand,
  parseProjectPackageCommand,
  type ProjectPackagePayload,
} from "@/modules/seed-project-publication/contracts";
import { SeedProjectPublicationStore } from "@/modules/seed-project-publication/store";
import {
  SEED_PROCUREMENT_COMMAND_VERSION,
  parseSeedProcurementCommand,
  type EvidenceArtifactRegisterCommand,
  type ObjectiveFit,
  type ProductCandidateRecordCommand,
  type ProductSourceRecordCommand,
} from "@/modules/seed-procurement/contracts";
import { objectiveScore, productSourceIdFor } from "@/modules/seed-procurement/model";
import { createSeedProcurementReadModel, parseSeedProcurementReadModel } from "@/modules/seed-procurement/readModel";
import { SeedProcurementDomainError, SeedProcurementStore } from "@/modules/seed-procurement/store";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString });
const requestedAt = "2026-09-05T09:30:00.000Z";
const tenantA: ApiActor = { actorId: "operator-proof-a", actorType: "user", capabilities: ["procurement.command", "procurement.read"], source: "service-token", tenantId: "tenant-proof-a" };
const tenantB: ApiActor = { actorId: "operator-proof-b", actorType: "user", capabilities: ["procurement.command", "procurement.read"], source: "service-token", tenantId: "tenant-proof-b" };
const fit: ObjectiveFit = { inputs: { leadTime: 0.7, margin: 0.8, price: 0.9, sourceFreshness: 1, specificationMatch: 0.95, supplierReliability: 0.75 }, weights: { leadTime: 0.15, margin: 0.15, price: 0.2, sourceFreshness: 0.1, specificationMatch: 0.3, supplierReliability: 0.1 } };

function projectCommand() {
  return parseProjectCreationCommand({ commandId: "command-a3-project", commandType: "project.create_from_opportunity", contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION, expectedVersion: "ABSENT", idempotencyKey: "idempotency-a3-project", opportunityRef: { objectId: "opportunity-primary", version: "opportunity:opportunity-primary:v4" }, project: { accountId: "account-primary", briefRefs: ["brief:a3"], budget: { amountMinor: 9000000, currency: "USD" }, decisionRefs: [], evidenceRefs: ["evidence:a3-discovery"], name: "A3 Proof Project", ownerId: tenantA.actorId, spaceBriefs: [{ floor: "1", kind: "ROOM", name: "Living Room", sequence: 1 }], stakeholderRefs: [], targetEndAt: "2027-01-01T00:00:00.000Z", targetStartAt: "2026-10-01T00:00:00.000Z", taskRefs: [] } });
}
function packagePayload(): ProjectPackagePayload {
  const pack: ProjectPackagePayload = { assetRefs: [], packageHash: "0".repeat(64), plannerProjectRef: { objectId: "planner-project-a3", objectType: "PLANNER_PROJECT", ownerProject: ROOM_PLANNER_OWNER, version: "planner-project-a3:v1" }, provenanceRefs: ["evidence:a3-planner"], sourceVersionHash: "b".repeat(64), spaces: [{ floor: "1", kind: "ROOM", name: "Living Room", plannerRef: { objectId: "planner-space-a3", objectType: "PLANNER_SPACE", ownerProject: ROOM_PLANNER_OWNER, version: "planner-space-a3:v1" }, sequence: 1 }], specifications: [{ lines: [{ approvalState: "APPROVED", deliveryRisk: "MEDIUM", description: "Sofa", plannerRef: { objectId: "planner-line-a3", objectType: "PLANNER_SPECIFICATION_LINE", ownerProject: ROOM_PLANNER_OWNER, version: "planner-line-a3:v1" }, productCandidateIds: [], quantity: 1, selectedCandidateId: null, sourcingState: "NOT_STARTED", spacePlannerObjectId: "planner-space-a3", unit: "each" }], plannerRef: { objectId: "planner-spec-a3", objectType: "PLANNER_SPECIFICATION", ownerProject: ROOM_PLANNER_OWNER, version: "planner-spec-a3:v1" }, spacePlannerObjectIds: ["planner-space-a3"], title: "Living Room FF&E" }], uncertainty: [] };
  pack.packageHash = canonicalProjectPackageHash(pack);
  return pack;
}
function common(commandId: string, commandType: string) { return { commandId, commandType, contractVersion: SEED_PROCUREMENT_COMMAND_VERSION, expectedVersion: "ABSENT", idempotencyKey: `idempotency-${commandId}` }; }
function evidenceCommand(projectId: string, projectVersion: string, input: { commandId: string; digest: string; promptInjectionState?: "CLEAR" | "DETECTED" | "NOT_ASSESSED"; source: string }) {
  return parseSeedProcurementCommand({ ...common(input.commandId, "evidence_artifact.register"), projectRef: { projectId, projectVersion }, artifact: { capturedAt: requestedAt, confidence: 0.95, contentDigest: input.digest, kind: "UPLOAD", mimeType: "text/csv", promptInjectionState: input.promptInjectionState ?? "CLEAR", provider: "OPERATOR_UPLOAD", sourceRecordRef: input.source, storageRef: `private-object:${input.source}` } }) as EvidenceArtifactRegisterCommand;
}
function sourceCommand(projectId: string, projectVersion: string, input: { artifactId: string; artifactVersion: string; commandId: string; digest: string; locator: string }) {
  return parseSeedProcurementCommand({ ...common(input.commandId, "product_source.record"), artifactId: input.artifactId, artifactVersion: input.artifactVersion, conflictRefs: [], duplicateOfSourceId: null, extractionProvenance: ["fixture-parser:csv-v1"], ingestionFormat: "CSV", projectRef: { projectId, projectVersion }, source: { contentDigest: input.digest, kind: "XLSX", locator: input.locator, observedAt: requestedAt, validUntil: "2026-10-05T09:30:00.000Z" } }) as ProductSourceRecordCommand;
}
function candidateCommand(projectId: string, projectVersion: string, sourceId: string, sourceVersion: string, input: { commandId: string; identity: string; vendorId: string | null }) {
  return parseSeedProcurementCommand({ ...common(input.commandId, "product_candidate.record"), candidate: { attributes: { material: "oak" }, confidence: { score: 0.92, sourceFreshAt: requestedAt }, lane: "OUTSIDE_PRODUCT", leadTimeDays: 42, price: { amountMinor: 300000, currency: "USD" }, sku: input.identity, title: `Candidate ${input.identity}`, vendorId: input.vendorId }, conflictRefs: [], duplicateOfCandidateId: null, extractionProvenance: [`fixture-parser:${input.identity}`], fit, productIdentityRef: `product-identity:${input.identity}`, productSourceId: sourceId, productSourceVersion: sourceVersion, projectRef: { projectId, projectVersion } }) as ProductCandidateRecordCommand;
}
function input(actor: ApiActor, command: never, correlationId: string) { return { actor, command, correlationId, requestedAt }; }
async function tenantQuery<T>(tenantId: string, sql: string, values: unknown[] = []) {
  const client = await pool.connect();
  try { await client.query("begin read only"); await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]); const result = await client.query(sql, values); await client.query("commit"); return result.rows as T[]; }
  catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
function domainCode(error: unknown) { return error instanceof SeedProcurementDomainError ? error.code : String(error); }

async function main() {
  try {
    const projectStore = new SeedProjectPublicationStore(pool);
    const project = await projectStore.executeProjectCreate({ actor: tenantA, command: projectCommand(), correlationId: "correlation-a3-project", requestedAt });
    const projectId = project.readback.resource.id;
    const projectVersion = project.readback.resource.version;
    const publishCommand = parseProjectPackageCommand({ commandId: "command-a3-package", commandType: "project_package.publish", contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION, expectedVersion: "ABSENT", idempotencyKey: "idempotency-a3-package", package: packagePayload(), projectId, projectVersion });
    if (publishCommand.commandType !== "project_package.publish") throw new Error("Unexpected publication command type.");
    const published = await projectStore.executePackagePublish({ actor: tenantA, command: publishCommand, correlationId: "correlation-a3-package", requestedAt });
    const specificationId = published.canonicalIds.specificationIds[0];
    const specificationLineId = published.canonicalIds.specificationLineIds[0];
    const specificationVersion = `specification:${specificationId}:v1`;
    const specificationLineVersion = `specification-line:${specificationLineId}:v1`;

    const store = new SeedProcurementStore(pool);
    const evidence = evidenceCommand(projectId, projectVersion, { commandId: "evidence-a3-1", digest: "a".repeat(64), source: "upload-a3-1" });
    const registered = await store.executeEvidence(input(tenantA, evidence as never, "correlation-evidence-1"));
    assert.equal(registered.readbackMatchesReceipt, true);
    const replay = await new SeedProcurementStore(pool).executeEvidence(input(tenantA, evidence as never, "correlation-evidence-replay"));
    assert.equal(replay.receipt.receiptId, registered.receipt.receiptId);
    assert.equal(replay.receipt.idempotentReplay, true);
    const staleReplayStore = new SeedProcurementStore(pool);
    staleReplayStore.readEvidence = async () => ({ ...registered.readback, resource: { ...registered.readback.resource, version: "evidence-artifact:stale:v0" } });
    await assert.rejects(staleReplayStore.executeEvidence(input(tenantA, evidence as never, "correlation-evidence-stale-readback")), (error: unknown) => domainCode(error) === "READBACK_UNCONFIRMED");
    await assert.rejects(store.executeEvidence(input(tenantA, { ...evidence, artifact: { ...evidence.artifact, confidence: 0.5 } } as never, "correlation-evidence-conflict")), IdempotencyConflictError);
    assert.equal(await store.readEvidence(tenantB, registered.readback.resource.id), null);

    const source = sourceCommand(projectId, projectVersion, { artifactId: registered.readback.resource.id, artifactVersion: registered.readback.resource.version, commandId: "source-a3-1", digest: "a".repeat(64), locator: "private-object:upload-a3-1" });
    const recordedSource = await store.executeProductSource(input(tenantA, source as never, "correlation-source-1"));
    const sourceId = recordedSource.readback.resource.resource.id;
    const sourceVersion = recordedSource.readback.resource.resource.version;
    const sourceReplay = await new SeedProcurementStore(pool).executeProductSource(input(tenantA, source as never, "correlation-source-replay"));
    assert.equal(sourceReplay.receipt.receiptId, recordedSource.receipt.receiptId);
    await assert.rejects(store.executeProductSource(input(tenantA, { ...source, artifactVersion: "evidence:stale:v0", commandId: "source-stale", idempotencyKey: "idempotency-source-stale" } as never, "correlation-source-stale")), (error: unknown) => domainCode(error) === "VERSION_CONFLICT");
    await assert.rejects(store.executeProductSource(input(tenantA, { ...source, commandId: "source-project-null", idempotencyKey: "idempotency-source-project-null", projectRef: null, source: { ...source.source, locator: "private-object:project-null" } } as never, "correlation-source-project-null")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");

    const reviewEvidence = evidenceCommand(projectId, projectVersion, { commandId: "evidence-a3-review", digest: "d".repeat(64), promptInjectionState: "NOT_ASSESSED", source: "upload-a3-review" });
    const registeredReview = await store.executeEvidence(input(tenantA, reviewEvidence as never, "correlation-evidence-review"));
    const reviewSource = sourceCommand(projectId, projectVersion, { artifactId: registeredReview.readback.resource.id, artifactVersion: registeredReview.readback.resource.version, commandId: "source-a3-review", digest: "d".repeat(64), locator: "private-object:upload-a3-review" });
    const recordedReviewSource = await store.executeProductSource(input(tenantA, reviewSource as never, "correlation-source-review"));
    assert.equal(recordedReviewSource.readback.resource.resource.status, "REVIEW_REQUIRED");

    const duplicateSource = parseSeedProcurementCommand({ ...source, commandId: "source-a3-duplicate", duplicateOfSourceId: sourceId, idempotencyKey: "idempotency-source-a3-duplicate", source: { ...source.source, locator: "private-object:duplicate-source" } }) as ProductSourceRecordCommand;
    const recordedDuplicateSource = await store.executeProductSource(input(tenantA, duplicateSource as never, "correlation-source-duplicate"));
    assert.equal(recordedDuplicateSource.readback.resource.resource.status, "REVIEW_REQUIRED");

    const globalEvidence = parseSeedProcurementCommand({ ...common("evidence-a3-global", "evidence_artifact.register"), projectRef: null, artifact: { capturedAt: requestedAt, confidence: 0.95, contentDigest: "e".repeat(64), kind: "UPLOAD", mimeType: "text/csv", promptInjectionState: "CLEAR", provider: "OPERATOR_UPLOAD", sourceRecordRef: "upload-a3-global", storageRef: "private-object:upload-a3-global" } }) as EvidenceArtifactRegisterCommand;
    const registeredGlobal = await store.executeEvidence(input(tenantA, globalEvidence as never, "correlation-evidence-global"));
    const globalSource = parseSeedProcurementCommand({ ...common("source-a3-global", "product_source.record"), artifactId: registeredGlobal.readback.resource.id, artifactVersion: registeredGlobal.readback.resource.version, conflictRefs: [], duplicateOfSourceId: null, extractionProvenance: ["fixture-parser:global"], ingestionFormat: "CSV", projectRef: null, source: { contentDigest: "e".repeat(64), kind: "XLSX", locator: "private-object:global-source", observedAt: requestedAt, validUntil: "2026-10-05T09:30:00.000Z" } }) as ProductSourceRecordCommand;
    const recordedGlobalSource = await store.executeProductSource(input(tenantA, globalSource as never, "correlation-source-global"));
    await assert.rejects(store.executeProductSource(input(tenantA, { ...globalSource, commandId: "source-global-to-project", idempotencyKey: "idempotency-source-global-to-project", projectRef: { projectId, projectVersion }, source: { ...globalSource.source, locator: "private-object:global-to-project" } } as never, "correlation-source-global-to-project")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");
    await assert.rejects(store.executeProductSource(input(tenantA, { ...source, commandId: "source-cross-scope-duplicate", duplicateOfSourceId: recordedGlobalSource.readback.resource.resource.id, idempotencyKey: "idempotency-source-cross-scope-duplicate", source: { ...source.source, locator: "private-object:cross-scope-duplicate" } } as never, "correlation-source-cross-scope-duplicate")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");

    const eligible = await store.executeProductCandidate(input(tenantA, candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-a3-eligible", identity: "sofa-eligible", vendorId: null }) as never, "correlation-candidate-eligible"));
    assert.equal(eligible.readback.resource.resource.status, "ELIGIBLE");
    await assert.rejects(store.executeProductCandidate(input(tenantA, { ...candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-project-null", identity: "sofa-project-null", vendorId: null }), projectRef: null } as never, "correlation-candidate-project-null")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");
    await assert.rejects(store.executeProductCandidate(input(tenantA, candidateCommand(projectId, projectVersion, recordedGlobalSource.readback.resource.resource.id, recordedGlobalSource.readback.resource.resource.version, { commandId: "candidate-global-to-project", identity: "sofa-global-to-project", vendorId: null }) as never, "correlation-candidate-global-to-project")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");
    await assert.rejects(store.executeProductCandidate(input(tenantA, candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-a3-missing-vendor", identity: "sofa-missing", vendorId: "missing-account" }) as never, "correlation-candidate-missing")), (error: unknown) => domainCode(error) === "SUPPLIER_IDENTITY_NOT_FOUND");
    const unresolvedVendor = await store.executeProductCandidate(input(tenantA, candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-a3-vendor", identity: "sofa-vendor", vendorId: "supplier-account-a" }) as never, "correlation-candidate-vendor"));
    assert.equal(unresolvedVendor.readback.resource.resource.status, "REVIEW_REQUIRED");
    assert.deepEqual(unresolvedVendor.readback.conflictRefs, ["unresolved:supplier-eligibility:supplier-account-a"]);
    const duplicateCandidate = parseSeedProcurementCommand({ ...candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-a3-duplicate", identity: "sofa-duplicate", vendorId: null }), duplicateOfCandidateId: eligible.readback.resource.resource.id }) as ProductCandidateRecordCommand;
    const recordedDuplicateCandidate = await store.executeProductCandidate(input(tenantA, duplicateCandidate as never, "correlation-candidate-duplicate"));
    assert.equal(recordedDuplicateCandidate.readback.resource.resource.status, "REVIEW_REQUIRED");

    const faultSource = sourceCommand(projectId, projectVersion, { artifactId: registered.readback.resource.id, artifactVersion: registered.readback.resource.version, commandId: "source-a3-fault", digest: "a".repeat(64), locator: "private-object:fault" });
    const faultStore = new SeedProcurementStore(pool, { afterOwnerWrites: async (point) => { if (point === "PRODUCT_SOURCE") throw new Error("PROOF_FAULT_AFTER_OWNER_WRITE"); } });
    await assert.rejects(faultStore.executeProductSource(input(tenantA, faultSource as never, "correlation-source-fault")), /PROOF_FAULT_AFTER_OWNER_WRITE/);
    const faultId = productSourceIdFor(tenantA.tenantId, { artifactId: registered.readback.resource.id, locator: "private-object:fault", observedAt: requestedAt });
    const faultCounts = await tenantQuery<{ owners: string; receipts: string }>(tenantA.tenantId, `select (select count(*)::text from public.seed_product_sources where product_source_id=$1) owners,(select count(*)::text from public.p110_command_receipts where command_id='source-a3-fault') receipts`, [faultId]);
    assert.deepEqual(faultCounts[0], { owners: "0", receipts: "0" });

    const concurrentEvidence = evidenceCommand(projectId, projectVersion, { commandId: "evidence-a3-concurrent", digest: "c".repeat(64), source: "upload-a3-concurrent" });
    const concurrent = await Promise.all([store.executeEvidence(input(tenantA, concurrentEvidence as never, "correlation-concurrent-1")), new SeedProcurementStore(pool).executeEvidence(input(tenantA, concurrentEvidence as never, "correlation-concurrent-2"))]);
    assert.equal(concurrent[0].receipt.receiptId, concurrent[1].receipt.receiptId);
    assert.equal(concurrent.filter((item) => item.receipt.idempotentReplay).length, 1);

    const rfqBase = { ...common("rfq-a3", "rfq.create_draft"), dueAt: "2026-09-12T00:00:00.000Z", evidenceRefs: ["evidence:a3-spec"], projectId, projectVersion, requestedFields: ["unit_price"], specificationId, specificationLines: [{ specificationLineId, specificationLineVersion }], specificationVersion, supplierId: "supplier-account-a" };
    await assert.rejects(store.execute(input(tenantA, parseSeedProcurementCommand({ ...rfqBase, specificationVersion: `${specificationId}:stale`, commandId: "rfq-a3-stale", idempotencyKey: "idempotency-rfq-a3-stale" }) as never, "correlation-rfq-stale")), (error: unknown) => domainCode(error) === "VERSION_CONFLICT");
    await assert.rejects(store.execute(input(tenantA, parseSeedProcurementCommand({ ...rfqBase, supplierId: "supplier-cross-tenant", commandId: "rfq-a3-cross", idempotencyKey: "idempotency-rfq-a3-cross" }) as never, "correlation-rfq-cross")), (error: unknown) => domainCode(error) === "SUPPLIER_IDENTITY_NOT_FOUND");
    await assert.rejects(store.execute(input(tenantA, parseSeedProcurementCommand(rfqBase) as never, "correlation-rfq-held")), (error: unknown) => domainCode(error) === "SUPPLIER_ELIGIBILITY_UNVERIFIED");

    const quoteBase = parseSeedProcurementCommand({ ...common("quote-a3", "supplier_quote.normalize"), evidenceArtifactId: registered.readback.resource.id, evidenceArtifactVersion: registered.readback.resource.version, lines: [{ clientUnitPriceMinor: 575000, dutyMinor: 12000, freightMinor: 28000, incoterm: "FOB", leadTimeDays: 42, objectiveFit: fit, packageFacts: null, paymentTerms: null, quantity: 1, reserveMinor: 10000, rfqLineId: specificationLineId, unitPrice: { amountMinor: 300000, currency: "USD" }, warranty: null }], projectId, projectVersion, responseSource: "EMAIL", reviewReasons: [], rfqId: "rfq-unavailable", rfqVersion: "rfq:rfq-unavailable:v1", supplierId: "supplier-account-a", validUntil: null });
    const quoteAttempts = await Promise.allSettled([store.execute(input(tenantA, quoteBase as never, "correlation-quote-1")), store.execute(input(tenantA, { ...quoteBase, commandId: "quote-a3-2", idempotencyKey: "idempotency-quote-a3-2" } as never, "correlation-quote-2"))]);
    assert.equal(quoteAttempts.every((item) => item.status === "rejected" && domainCode(item.reason) === "SUPPLIER_ELIGIBILITY_UNVERIFIED"), true);

    const po = parseSeedProcurementCommand({ ...common("po-a3", "purchase_order.create_draft"), bidComparisonId: "bid-a3", expectedVersion: "bid-comparison:bid-a3:v2", lineRefs: [{ objectId: specificationLineId, objectType: "SPECIFICATION_LINE", ownerProject: "LUZIONE_PROJECT", version: specificationLineVersion }], projectId, projectVersion, proposalVersion: "proposal:unverified:v1", proposalVersionId: "proposal-unverified", selectionDecisionId: "selection-a3", selectionDecisionVersion: "procurement-selection:selection-a3:v1" });
    await assert.rejects(store.execute(input(tenantA, po as never, "correlation-po-held")), (error: unknown) => domainCode(error) === "PROPOSAL_CANONICAL_READER_UNAVAILABLE");
    const ack = parseSeedProcurementCommand({ ...common("ack-a3", "purchase_order_acknowledgement.record"), acknowledgementState: "PROVIDER_ACKNOWLEDGED", evidenceArtifactId: registered.readback.resource.id, evidenceArtifactVersion: registered.readback.resource.version, expectedReadyAt: null, expectedVersion: "purchase-order:po-a3:v1", projectId, projectVersion, purchaseOrderId: "po-a3", supplierId: "supplier-account-a", variances: [] });
    await assert.rejects(store.execute(input(tenantA, ack as never, "correlation-ack-held")), (error: unknown) => domainCode(error) === "PURCHASE_ORDER_NOT_AVAILABLE");

    const client = await pool.connect();
    try { await client.query("begin"); await client.query("select set_config('app.tenant_id',$1,true)", [tenantA.tenantId]); await assert.rejects(client.query("insert into public.seed_rfq_drafts (tenant_id) values ($1)", [tenantA.tenantId]), /downstream write held/); await client.query("rollback"); }
    finally { client.release(); }

    const graph = await new SeedProcurementStore(pool).readProjectProcurement(tenantA, projectId);
    assert.ok(graph);
    const parsedGraph = parseSeedProcurementReadModel(createSeedProcurementReadModel(graph, { observedAt: requestedAt, projectId, releaseIdentity: createReleaseIdentity({ environment: { LUZIONE_BUILD_TIME: requestedAt, VERCEL_GIT_COMMIT_SHA: "2222222222222222222222222222222222222222" }, mutationsEnabled: false }), tenantId: tenantA.tenantId }));
    assert.equal(parsedGraph.productSources.length, 3);
    assert.equal(parsedGraph.productCandidates.length, 3);
    assert.equal(parsedGraph.blockedDependencies.length, 2);
    assert.equal(parsedGraph.rfqs.length + parsedGraph.supplierQuotes.length + parsedGraph.bidComparisons.length + parsedGraph.purchaseOrders.length + parsedGraph.acknowledgements.length, 0);
    assert.equal(parsedGraph.productCandidates.find((item) => item.resource.resource.status === "ELIGIBLE")?.fit.score, objectiveScore(fit));
    assert.equal(await new SeedProcurementStore(pool).readProjectProcurement(tenantB, projectId), null);

    const ledger = await tenantQuery<{ bad_effects: string; events: string; outboxes: string; receipts: string }>(tenantA.tenantId, `select
      (select count(*)::text from public.p110_command_receipts where command_type in ('evidence_artifact.register','product_source.record','product_candidate.record')) receipts,
      (select count(*)::text from public.p110_event_envelopes where command_id in (select command_id from public.p110_command_receipts where command_type in ('evidence_artifact.register','product_source.record','product_candidate.record'))) events,
      (select count(*)::text from public.p110_outbox_messages where receipt_id in (select receipt_id from public.p110_command_receipts where command_type in ('evidence_artifact.register','product_source.record','product_candidate.record'))) outboxes,
      (select count(*)::text from public.p110_outbox_messages where effect_class <> 'NO_EFFECT') bad_effects`);
    assert.equal(ledger[0].receipts, ledger[0].events);
    assert.equal(ledger[0].receipts, ledger[0].outboxes);
    assert.equal(ledger[0].bad_effects, "0");
    assert.equal((await tenantQuery<{ count: string }>(tenantA.tenantId, "select count(*)::text count from public.p110_command_receipts where command_type in ('rfq.create_draft','supplier_quote.normalize','bid_comparison.create','procurement_selection.record','purchase_order.create_draft','purchase_order_acknowledgement.record')"))[0].count, "0");

    console.log(JSON.stringify({ atomicityFaultRollback: faultCounts[0], canonicalSupplierIdentity: "ACCOUNT_PRESENT_SUPPLIER_PROFILE_UNAVAILABLE", concurrency: { exactReplay: "one receipt", supplierQuotes: "both denied before write" }, dependencyHeldRows: 0, duplicateReview: true, freshInstanceReadback: true, inheritedProjectScope: true, ledger: ledger[0], objectiveScore: objectiveScore(fit), proposalDependency: "CANONICAL_READER_UNAVAILABLE", replayReadbackMismatchDenied: true, reviewEvidenceNotPromoted: true, tenantIsolation: true }, null, 2));
  } finally { await pool.end(); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
