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
  type BidComparisonCreateCommand,
  type EvidenceArtifactRegisterCommand,
  type ObjectiveFit,
  type ProcurementSelectionRecordCommand,
  type ProductCandidateRecordCommand,
  type ProductSourceRecordCommand,
  type RFQDraftCreateCommand,
  type SupplierQuoteNormalizeCommand,
} from "@/modules/seed-procurement/contracts";
import { evidenceArtifactIdFor, objectiveScore, procurementVersions, productSourceIdFor, selectionDecisionIdFor } from "@/modules/seed-procurement/model";
import { createSeedProcurementReadModel, parseSeedProcurementReadModel } from "@/modules/seed-procurement/readModel";
import { SeedProcurementDomainError, SeedProcurementStore } from "@/modules/seed-procurement/store";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { parseSeedSupplierIdentityCommand, SUPPLIER_PROFILE_COMMAND_VERSION, type SupplierProfileFacts } from "@/modules/seed-supplier-identity/contracts";
import { SeedSupplierIdentityDomainError, SeedSupplierIdentityStore } from "@/modules/seed-supplier-identity/store";
import { HUMAN_APPROVAL_SUBJECT_VERSION, type HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString });
const requestedAt = "2026-09-05T09:35:00.000Z";
const capturedAt = "2026-09-05T09:30:00.000Z";
const tenantA: ApiActor = { actorId: "service:procurement-proof-a", actorType: "service", capabilities: ["procurement.command", "procurement.read", "supplier.profile.command"], source: "service-token", tenantId: "tenant-proof-a" };
const tenantB: ApiActor = { actorId: "service:procurement-proof-b", actorType: "service", capabilities: ["procurement.command", "procurement.read"], source: "service-token", tenantId: "tenant-proof-b" };
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
function evidenceCommand(projectId: string, projectVersion: string, input: { commandId: string; digest: string; kind?: "EMAIL" | "UPLOAD"; mimeType?: string; promptInjectionState?: "CLEAR" | "DETECTED" | "NOT_ASSESSED"; provider?: "GMAIL" | "OPERATOR_UPLOAD"; source: string }) {
  return parseSeedProcurementCommand({ ...common(input.commandId, "evidence_artifact.register"), projectRef: { projectId, projectVersion }, artifact: { capturedAt, confidence: 0.95, contentDigest: input.digest, kind: input.kind ?? "UPLOAD", mimeType: input.mimeType ?? "text/csv", promptInjectionState: input.promptInjectionState ?? "CLEAR", provider: input.provider ?? "OPERATOR_UPLOAD", sourceRecordRef: input.source, storageRef: `private-object:${input.source}` } }) as EvidenceArtifactRegisterCommand;
}
function sourceCommand(projectId: string, projectVersion: string, input: { artifactId: string; artifactVersion: string; commandId: string; digest: string; locator: string }) {
  return parseSeedProcurementCommand({ ...common(input.commandId, "product_source.record"), artifactId: input.artifactId, artifactVersion: input.artifactVersion, conflictRefs: [], duplicateOfSourceId: null, extractionProvenance: ["fixture-parser:csv-v2"], ingestionFormat: "CSV", projectRef: { projectId, projectVersion }, source: { contentDigest: input.digest, kind: "XLSX", locator: input.locator, observedAt: capturedAt, validUntil: "2026-10-05T09:30:00.000Z" }, upstreamArtifactRefs: [] }) as ProductSourceRecordCommand;
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
function domainCode(error: unknown) { return error instanceof SeedProcurementDomainError || error instanceof SeedSupplierIdentityDomainError ? error.code : String(error); }

function human(actorId: string, capability: string, at: string): HumanApprovalSubject { return { actorId, actorType: "user", authenticationRef: `supabase-session:${actorId}:${capability}`, authenticatedAt: at, capabilities: [capability], contractVersion: HUMAN_APPROVAL_SUBJECT_VERSION, source: "supabase-user-jwt", tenantId: tenantA.tenantId }; }

async function activateSupplier(store: SeedSupplierIdentityStore, accountId: string, evidence: EvidenceArtifactRegisterCommand, suffix: string, capabilities: SupplierProfileFacts["capabilities"] = ["CATALOG_SOURCE", "QUOTE_SUBMISSION", "RFQ_RESPONSE"]) {
  const proposer = human(`user-proposer-${suffix}`, "supplier.profile.propose", "2026-09-05T09:30:30.000Z");
  const approver = human(`user-approver-${suffix}`, "supplier.profile.activate", "2026-09-05T09:31:30.000Z");
  const facts: SupplierProfileFacts = { approvedCategories: ["FURNITURE"], approvedRegions: ["USA"], capabilities, contactRefs: [], evidenceRefs: [{ objectId: evidenceArtifactIdFor(tenantA.tenantId, evidence.artifact), objectType: "EVIDENCE_ARTIFACT", ownerProject: "LUZIONE_PROCUREMENT", version: procurementVersions.evidence(evidenceArtifactIdFor(tenantA.tenantId, evidence.artifact)) }], identityReview: { conflictRefs: [], duplicateAccountRefs: [] }, provenanceRefs: [`proof:${suffix}`], validFrom: "2026-09-05T09:00:00.000Z", validUntil: "2026-10-05T09:00:00.000Z" };
  const proposed = await store.execute({ actor: tenantA, command: parseSeedSupplierIdentityCommand({ accountId, accountVersion: `account:${accountId}:v1`, commandId: `supplier-propose-${suffix}`, commandType: "supplier_profile.propose", contractVersion: SUPPLIER_PROFILE_COMMAND_VERSION, expectedVersion: "ABSENT", idempotencyKey: `supplier-propose-${suffix}`, profile: facts }), correlationId: `correlation-supplier-propose-${suffix}`, human: proposer, requestedAt: "2026-09-05T09:31:00.000Z" });
  return store.execute({ actor: tenantA, command: parseSeedSupplierIdentityCommand({ action: "ACTIVATE", commandId: `supplier-activate-${suffix}`, commandType: "supplier_profile.transition", contractVersion: SUPPLIER_PROFILE_COMMAND_VERSION, evidenceRefs: facts.evidenceRefs, expectedVersion: proposed.readback.supplierProfile.resource.version, idempotencyKey: `supplier-activate-${suffix}`, reason: "A3C proof eligibility activation.", supplierProfileId: proposed.readback.supplierProfile.resource.id }), correlationId: `correlation-supplier-activate-${suffix}`, human: approver, requestedAt: "2026-09-05T09:32:00.000Z" });
}

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

    const urlEvidenceCommand = evidenceCommand(projectId, projectVersion, { commandId: "evidence-a3-url", digest: "6".repeat(64), mimeType: "text/html", source: "https-example.test-product" });
    const pdfEvidenceCommand = evidenceCommand(projectId, projectVersion, { commandId: "evidence-a3-url-pdf", digest: "7".repeat(64), mimeType: "application/pdf", source: "private-pdf-from-url" });
    const urlEvidence = await store.executeEvidence(input(tenantA, urlEvidenceCommand as never, "correlation-evidence-url"));
    const pdfEvidence = await store.executeEvidence(input(tenantA, pdfEvidenceCommand as never, "correlation-evidence-url-pdf"));
    const pdfSourceCommand = parseSeedProcurementCommand({
      ...common("source-a3-url-pdf", "product_source.record"),
      artifactId: pdfEvidence.readback.resource.id,
      artifactVersion: pdfEvidence.readback.resource.version,
      conflictRefs: [],
      duplicateOfSourceId: null,
      extractionProvenance: ["fixture-parser:url-resolved-pdf-v2"],
      ingestionFormat: "PDF",
      projectRef: { projectId, projectVersion },
      source: { contentDigest: "7".repeat(64), kind: "PDF", locator: "private-object:private-pdf-from-url", observedAt: capturedAt, validUntil: "2026-10-05T09:30:00.000Z" },
      upstreamArtifactRefs: [{ artifactId: urlEvidence.readback.resource.id, artifactVersion: urlEvidence.readback.resource.version }],
    }) as ProductSourceRecordCommand;
    const pdfSource = await store.executeProductSource(input(tenantA, pdfSourceCommand as never, "correlation-source-url-pdf"));
    assert.deepEqual(pdfSource.readback.upstreamArtifactRefs.map((ref) => ref.objectId), [urlEvidence.readback.resource.id]);
    assert.deepEqual(pdfSource.readback.resource.sourceRefs.map((ref) => ref.objectId), [pdfEvidence.readback.resource.id, urlEvidence.readback.resource.id]);

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
    const globalSource = parseSeedProcurementCommand({ ...common("source-a3-global", "product_source.record"), artifactId: registeredGlobal.readback.resource.id, artifactVersion: registeredGlobal.readback.resource.version, conflictRefs: [], duplicateOfSourceId: null, extractionProvenance: ["fixture-parser:global"], ingestionFormat: "CSV", projectRef: null, source: { contentDigest: "e".repeat(64), kind: "XLSX", locator: "private-object:global-source", observedAt: requestedAt, validUntil: "2026-10-05T09:30:00.000Z" }, upstreamArtifactRefs: [] }) as ProductSourceRecordCommand;
    const recordedGlobalSource = await store.executeProductSource(input(tenantA, globalSource as never, "correlation-source-global"));
    await assert.rejects(store.executeProductSource(input(tenantA, { ...globalSource, commandId: "source-global-to-project", idempotencyKey: "idempotency-source-global-to-project", projectRef: { projectId, projectVersion }, source: { ...globalSource.source, locator: "private-object:global-to-project" } } as never, "correlation-source-global-to-project")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");
    await assert.rejects(store.executeProductSource(input(tenantA, { ...source, commandId: "source-cross-scope-duplicate", duplicateOfSourceId: recordedGlobalSource.readback.resource.resource.id, idempotencyKey: "idempotency-source-cross-scope-duplicate", source: { ...source.source, locator: "private-object:cross-scope-duplicate" } } as never, "correlation-source-cross-scope-duplicate")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");

    const supplierStore = new SeedSupplierIdentityStore(pool);
    const supplierA = await activateSupplier(supplierStore, "supplier-account-a", evidence, "a");
    const supplierA2 = await activateSupplier(supplierStore, "supplier-account-a2", evidence, "a2");
    await activateSupplier(supplierStore, "supplier-account-a3", evidence, "a3-catalog-only", ["CATALOG_SOURCE"]);

    const eligible = await store.executeProductCandidate(input(tenantA, candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-a3-eligible", identity: "sofa-eligible", vendorId: "supplier-account-a" }) as never, "correlation-candidate-eligible"));
    assert.equal(eligible.readback.resource.resource.status, "ELIGIBLE");
    assert.equal(eligible.readback.resource.data.vendorId, "supplier-account-a");
    await assert.rejects(store.executeProductCandidate(input(tenantA, { ...candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-project-null", identity: "sofa-project-null", vendorId: null }), projectRef: null } as never, "correlation-candidate-project-null")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");
    await assert.rejects(store.executeProductCandidate(input(tenantA, candidateCommand(projectId, projectVersion, recordedGlobalSource.readback.resource.resource.id, recordedGlobalSource.readback.resource.resource.version, { commandId: "candidate-global-to-project", identity: "sofa-global-to-project", vendorId: null }) as never, "correlation-candidate-global-to-project")), (error: unknown) => domainCode(error) === "OBJECT_ISOLATION_DENIED");
    await assert.rejects(store.executeProductCandidate(input(tenantA, candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-a3-missing-vendor", identity: "sofa-missing", vendorId: "missing-account" }) as never, "correlation-candidate-missing")), (error: unknown) => domainCode(error) === "SUPPLIER_PROFILE_NOT_FOUND");
    const duplicateCandidate = parseSeedProcurementCommand({ ...candidateCommand(projectId, projectVersion, sourceId, sourceVersion, { commandId: "candidate-a3-duplicate", identity: "sofa-duplicate", vendorId: null }), duplicateOfCandidateId: eligible.readback.resource.resource.id }) as ProductCandidateRecordCommand;
    const recordedDuplicateCandidate = await store.executeProductCandidate(input(tenantA, duplicateCandidate as never, "correlation-candidate-duplicate"));
    assert.equal(recordedDuplicateCandidate.readback.resource.resource.status, "REVIEW_REQUIRED");

    const faultSource = sourceCommand(projectId, projectVersion, { artifactId: registered.readback.resource.id, artifactVersion: registered.readback.resource.version, commandId: "source-a3-fault", digest: "a".repeat(64), locator: "private-object:fault" });
    const faultStore = new SeedProcurementStore(pool, { afterOwnerWrites: async (point) => { if (point === "PRODUCT_SOURCE") throw new Error("PROOF_FAULT_AFTER_OWNER_WRITE"); } });
    await assert.rejects(faultStore.executeProductSource(input(tenantA, faultSource as never, "correlation-source-fault")), /PROOF_FAULT_AFTER_OWNER_WRITE/);
    const faultId = productSourceIdFor(tenantA.tenantId, { artifactId: registered.readback.resource.id, locator: "private-object:fault", observedAt: capturedAt });
    const faultCounts = await tenantQuery<{ owners: string; receipts: string }>(tenantA.tenantId, `select (select count(*)::text from public.seed_product_sources where product_source_id=$1) owners,(select count(*)::text from public.p110_command_receipts where command_id='source-a3-fault') receipts`, [faultId]);
    assert.deepEqual(faultCounts[0], { owners: "0", receipts: "0" });

    const concurrentEvidence = evidenceCommand(projectId, projectVersion, { commandId: "evidence-a3-concurrent", digest: "c".repeat(64), source: "upload-a3-concurrent" });
    const concurrent = await Promise.all([store.executeEvidence(input(tenantA, concurrentEvidence as never, "correlation-concurrent-1")), new SeedProcurementStore(pool).executeEvidence(input(tenantA, concurrentEvidence as never, "correlation-concurrent-2"))]);
    assert.equal(concurrent[0].receipt.receiptId, concurrent[1].receipt.receiptId);
    assert.equal(concurrent.filter((item) => item.receipt.idempotentReplay).length, 1);

    const rfqBase = { ...common("rfq-a3", "rfq.create_draft"), dueAt: "2026-09-12T00:00:00.000Z", evidenceRefs: ["evidence:a3-spec"], projectId, projectVersion, requestedFields: ["unit_price"], specificationId, specificationLines: [{ specificationLineId, specificationLineVersion }], specificationVersion, supplierId: "supplier-account-a" };
    await assert.rejects(store.execute(input(tenantA, parseSeedProcurementCommand({ ...rfqBase, specificationVersion: `${specificationId}:stale`, commandId: "rfq-a3-stale", idempotencyKey: "idempotency-rfq-a3-stale" }) as never, "correlation-rfq-stale")), (error: unknown) => domainCode(error) === "VERSION_CONFLICT");
    await assert.rejects(store.execute(input(tenantA, parseSeedProcurementCommand({ ...rfqBase, supplierId: "supplier-cross-tenant", commandId: "rfq-a3-cross", idempotencyKey: "idempotency-rfq-a3-cross" }) as never, "correlation-rfq-cross")), (error: unknown) => domainCode(error) === "SUPPLIER_PROFILE_NOT_FOUND");
    await assert.rejects(store.execute(input(tenantA, parseSeedProcurementCommand({ ...rfqBase, supplierId: "supplier-account-a3", commandId: "rfq-a3-capability", idempotencyKey: "idempotency-rfq-a3-capability" }) as never, "correlation-rfq-capability")), (error: unknown) => domainCode(error) === "SUPPLIER_NOT_ELIGIBLE");
    await assert.rejects(store.execute({ actor: tenantA, command: parseSeedProcurementCommand({ ...rfqBase, commandId: "rfq-a3-expired", dueAt: "2026-10-12T00:00:00.000Z", idempotencyKey: "idempotency-rfq-a3-expired" }), correlationId: "correlation-rfq-expired", requestedAt: "2026-10-06T09:35:00.000Z" }), (error: unknown) => domainCode(error) === "SUPPLIER_NOT_ELIGIBLE");

    const rfqACommand = parseSeedProcurementCommand(rfqBase) as RFQDraftCreateCommand;
    const concurrentRfqA = await Promise.all([
      store.executeRfq(input(tenantA, rfqACommand as RFQDraftCreateCommand & never, "correlation-rfq-a")),
      new SeedProcurementStore(pool).executeRfq(input(tenantA, rfqACommand as RFQDraftCreateCommand & never, "correlation-rfq-a-replay")),
    ]);
    assert.equal(concurrentRfqA[0].receipt.receiptId, concurrentRfqA[1].receipt.receiptId);
    assert.equal(concurrentRfqA.filter((item) => item.receipt.idempotentReplay).length, 1);
    const rfqA = concurrentRfqA[0];
    const rfqA2Command = parseSeedProcurementCommand({ ...rfqBase, commandId: "rfq-a3-a2", idempotencyKey: "idempotency-rfq-a3-a2", supplierId: "supplier-account-a2" }) as RFQDraftCreateCommand;
    const rfqA2 = await store.executeRfq(input(tenantA, rfqA2Command as RFQDraftCreateCommand & never, "correlation-rfq-a2"));
    assert.equal(rfqA.readback.resource.status, "DRAFT");
    assert.equal(rfqA2.readback.resource.status, "DRAFT");

    const emailEvidenceACommand = evidenceCommand(projectId, projectVersion, { commandId: "evidence-quote-a", digest: "1".repeat(64), kind: "EMAIL", mimeType: "message/rfc822", provider: "GMAIL", source: "gmail-quote-a" });
    const emailEvidenceA2Command = evidenceCommand(projectId, projectVersion, { commandId: "evidence-quote-a2", digest: "2".repeat(64), kind: "EMAIL", mimeType: "message/rfc822", provider: "GMAIL", source: "gmail-quote-a2" });
    const emailEvidenceA = await store.executeEvidence(input(tenantA, emailEvidenceACommand as never, "correlation-evidence-quote-a"));
    const emailEvidenceA2 = await store.executeEvidence(input(tenantA, emailEvidenceA2Command as never, "correlation-evidence-quote-a2"));
    const quoteLine = { clientUnitPriceMinor: 575000, dutyMinor: 12000, freightMinor: 28000, incoterm: "FOB", leadTimeDays: 42, objectiveFit: fit, packageFacts: null, paymentTerms: null, quantity: 1, reserveMinor: 10000, rfqLineId: specificationLineId, unitPrice: { amountMinor: 300000, currency: "USD" }, warranty: null };
    const quoteACommand = parseSeedProcurementCommand({ ...common("quote-a3-a", "supplier_quote.normalize"), evidenceArtifactId: emailEvidenceA.readback.resource.id, evidenceArtifactVersion: emailEvidenceA.readback.resource.version, lines: [quoteLine], projectId, projectVersion, responseSource: "EMAIL", reviewReasons: [], rfqId: rfqA.readback.resource.id, rfqVersion: rfqA.readback.resource.version, supplierId: "supplier-account-a", validUntil: "2026-10-01T00:00:00.000Z" }) as SupplierQuoteNormalizeCommand;
    const quoteA2Command = parseSeedProcurementCommand({ ...common("quote-a3-a2", "supplier_quote.normalize"), evidenceArtifactId: emailEvidenceA2.readback.resource.id, evidenceArtifactVersion: emailEvidenceA2.readback.resource.version, lines: [{ ...quoteLine, clientUnitPriceMinor: 560000, freightMinor: 35000, unitPrice: { amountMinor: 295000, currency: "USD" } }], projectId, projectVersion, responseSource: "EMAIL", reviewReasons: [], rfqId: rfqA2.readback.resource.id, rfqVersion: rfqA2.readback.resource.version, supplierId: "supplier-account-a2", validUntil: "2026-10-01T00:00:00.000Z" }) as SupplierQuoteNormalizeCommand;
    const [quoteA, quoteA2] = await Promise.all([store.executeSupplierQuote(input(tenantA, quoteACommand as SupplierQuoteNormalizeCommand & never, "correlation-quote-a")), store.executeSupplierQuote(input(tenantA, quoteA2Command as SupplierQuoteNormalizeCommand & never, "correlation-quote-a2"))]);
    assert.equal(quoteA.readback.resource.resource.status, "NORMALIZED");
    assert.equal(quoteA2.readback.resource.resource.status, "NORMALIZED");

    const bidCommand = parseSeedProcurementCommand({ ...common("bid-a3", "bid_comparison.create"), basisCurrency: "USD", criticDissent: null, projectId, projectVersion, recommendationEvidenceRefs: ["evidence:objective-fit"], recommendedSupplierQuoteId: quoteA2.readback.resource.resource.id, rfqs: [{ rfqId: rfqA.readback.resource.id, rfqVersion: rfqA.readback.resource.version }, { rfqId: rfqA2.readback.resource.id, rfqVersion: rfqA2.readback.resource.version }], specificationId, specificationVersion, supplierQuotes: [{ supplierQuoteId: quoteA.readback.resource.resource.id, supplierQuoteVersion: quoteA.readback.resource.resource.version }, { supplierQuoteId: quoteA2.readback.resource.resource.id, supplierQuoteVersion: quoteA2.readback.resource.resource.version }] }) as BidComparisonCreateCommand;
    const bid = await store.executeBidComparison(input(tenantA, bidCommand as BidComparisonCreateCommand & never, "correlation-bid"));
    assert.equal(bid.readback.resource.status, "DRAFT");
    const selectionCommand = parseSeedProcurementCommand({ ...common("selection-a3", "procurement_selection.record"), bidComparisonId: bid.readback.resource.id, decision: "SELECT", evidenceRefs: ["evidence:human-selection"], expectedVersion: bid.readback.resource.version, projectId, projectVersion, rationale: "Lower landed cost with equivalent objective fit.", selectedSupplierQuoteId: quoteA2.readback.resource.resource.id }) as ProcurementSelectionRecordCommand;
    const selectionHuman = human("user-procurement-selector", "procurement.selection.record", "2026-09-05T09:34:00.000Z");
    const faultSelectionCommand = parseSeedProcurementCommand({ ...selectionCommand, commandId: "selection-a3-fault", idempotencyKey: "idempotency-selection-a3-fault" }) as ProcurementSelectionRecordCommand;
    const selectionFaultStore = new SeedProcurementStore(pool, { afterOwnerWrites: async (point) => { if (point === "SELECTION") throw new Error("PROOF_FAULT_AFTER_SELECTION_AND_BID_APPROVAL"); } });
    await assert.rejects(selectionFaultStore.executeSelection({ actor: tenantA, command: faultSelectionCommand, correlationId: "correlation-selection-fault", human: selectionHuman, requestedAt }), /PROOF_FAULT_AFTER_SELECTION_AND_BID_APPROVAL/);
    const faultSelectionId = selectionDecisionIdFor(tenantA.tenantId, { actorId: selectionHuman.actorId, bidComparisonId: bid.readback.resource.id, selectedSupplierQuoteId: quoteA2.readback.resource.resource.id });
    const selectionFaultCounts = await tenantQuery<{ approved_bids: string; owners: string; receipts: string }>(tenantA.tenantId, `select
      (select count(*)::text from public.seed_procurement_selection_decisions where selection_decision_id=$1) owners,
      (select count(*)::text from public.seed_bid_comparisons where bid_comparison_id=$2 and version=2) approved_bids,
      (select count(*)::text from public.p110_command_receipts where command_id in ('selection-a3-fault','selection-a3-fault:bid-approval')) receipts`, [faultSelectionId, bid.readback.resource.id]);
    assert.deepEqual(selectionFaultCounts[0], { approved_bids: "0", owners: "0", receipts: "0" });
    const selection = await store.executeSelection({ actor: tenantA, command: selectionCommand, correlationId: "correlation-selection", human: selectionHuman, requestedAt });
    assert.equal(selection.readback.actor.actorId, selectionHuman.actorId);
    const selectionReplay = await new SeedProcurementStore(pool).executeSelection({ actor: tenantA, command: selectionCommand, correlationId: "correlation-selection-replay", human: selectionHuman, requestedAt });
    assert.equal(selectionReplay.receipt.idempotentReplay, true);
    const approvedBid = await store.readBidComparison(tenantA, bid.readback.resource.id);
    assert.equal(approvedBid?.resource.status, "APPROVED");
    assert.equal(approvedBid?.resource.version, procurementVersions.bidComparison(bid.readback.resource.id, 2));
    assert.equal(approvedBid?.data.selectedByHumanApprovalRef, selection.readback.resource.id);

    const revokeHuman = human("user-revoker-a2", "supplier.profile.revoke", "2026-09-05T09:36:00.000Z");
    await supplierStore.execute({ actor: tenantA, command: parseSeedSupplierIdentityCommand({ action: "REVOKE", commandId: "supplier-revoke-a2", commandType: "supplier_profile.transition", contractVersion: SUPPLIER_PROFILE_COMMAND_VERSION, evidenceRefs: supplierA2.readback.supplierProfile.data.evidenceRefs.map((ref) => ({ objectId: ref.objectId, objectType: ref.objectType, ownerProject: ref.ownerProject, version: ref.version })), expectedVersion: supplierA2.readback.supplierProfile.resource.version, idempotencyKey: "supplier-revoke-a2", reason: "Proof revocation closes future procurement admission.", supplierProfileId: supplierA2.readback.supplierProfile.resource.id }), correlationId: "correlation-supplier-revoke-a2", human: revokeHuman, requestedAt: "2026-09-05T09:36:30.000Z" });
    await assert.rejects(store.execute(input(tenantA, { ...rfqA2Command, commandId: "rfq-a3-revoked", idempotencyKey: "idempotency-rfq-a3-revoked" } as never, "correlation-rfq-revoked")), (error: unknown) => domainCode(error) === "SUPPLIER_NOT_ELIGIBLE");
    assert.equal(supplierA.readback.supplierProfile.resource.status, "ELIGIBLE");

    const po = parseSeedProcurementCommand({ ...common("po-a3", "purchase_order.create_draft"), bidComparisonId: "bid-a3", expectedVersion: "bid-comparison:bid-a3:v2", lineRefs: [{ objectId: specificationLineId, objectType: "SPECIFICATION_LINE", ownerProject: "LUZIONE_PROJECT", version: specificationLineVersion }], projectId, projectVersion, proposalVersion: "proposal:unverified:v1", proposalVersionId: "proposal-unverified", selectionDecisionId: "selection-a3", selectionDecisionVersion: "procurement-selection:selection-a3:v1" });
    await assert.rejects(store.execute(input(tenantA, po as never, "correlation-po-held")), (error: unknown) => domainCode(error) === "PROPOSAL_CANONICAL_READER_UNAVAILABLE");
    const ack = parseSeedProcurementCommand({ ...common("ack-a3", "purchase_order_acknowledgement.record"), acknowledgementState: "PROVIDER_ACKNOWLEDGED", evidenceArtifactId: registered.readback.resource.id, evidenceArtifactVersion: registered.readback.resource.version, expectedReadyAt: null, expectedVersion: "purchase-order:po-a3:v1", projectId, projectVersion, purchaseOrderId: "po-a3", supplierId: "supplier-account-a", variances: [] });
    await assert.rejects(store.execute(input(tenantA, ack as never, "correlation-ack-held")), (error: unknown) => domainCode(error) === "PURCHASE_ORDER_NOT_AVAILABLE");

    const client = await pool.connect();
    try { await client.query("begin"); await client.query("select set_config('app.tenant_id',$1,true)", [tenantA.tenantId]); await assert.rejects(client.query("insert into public.seed_rfq_drafts (tenant_id) values ($1)", [tenantB.tenantId]), /row-level security/); await client.query("rollback"); }
    finally { client.release(); }

    const graph = await new SeedProcurementStore(pool).readProjectProcurement(tenantA, projectId);
    assert.ok(graph);
    const parsedGraph = parseSeedProcurementReadModel(createSeedProcurementReadModel(graph, { observedAt: requestedAt, projectId, releaseIdentity: createReleaseIdentity({ environment: { LUZIONE_BUILD_TIME: requestedAt, VERCEL_GIT_COMMIT_SHA: "2222222222222222222222222222222222222222" }, mutationsEnabled: false }), tenantId: tenantA.tenantId }));
    assert.equal(parsedGraph.productSources.length, 4);
    assert.equal(parsedGraph.productSources.find((item) => item.resource.resource.id === pdfSource.readback.resource.resource.id)?.upstreamArtifactRefs[0]?.objectId, urlEvidence.readback.resource.id);
    assert.equal(parsedGraph.productCandidates.length, 2);
    assert.equal(parsedGraph.blockedDependencies.length, 1);
    assert.equal(parsedGraph.rfqs.length, 2);
    assert.equal(parsedGraph.supplierQuotes.length, 2);
    assert.equal(parsedGraph.bidComparisons.length, 2);
    assert.equal(parsedGraph.selectionDecisions.length, 1);
    assert.equal(parsedGraph.purchaseOrders.length + parsedGraph.acknowledgements.length, 0);
    assert.equal(parsedGraph.productCandidates.find((item) => item.resource.resource.status === "ELIGIBLE")?.fit.score, objectiveScore(fit));
    assert.equal(parsedGraph.timeline.every((item) => item.authority.serverDerivedIdentityRef !== "correlation:undefined"), true);
    assert.equal(parsedGraph.timeline.some((item) => item.authority.serverDerivedIdentityRef === "correlation:correlation-source-1"), true);
    assert.equal(await new SeedProcurementStore(pool).readProjectProcurement(tenantB, projectId), null);

    const ledger = await tenantQuery<{ bad_effects: string; events: string; outboxes: string; receipts: string }>(tenantA.tenantId, `select
      (select count(*)::text from public.p110_command_receipts where policy_version='2026-09-05.seed-procurement.no-effect.v2') receipts,
      (select count(*)::text from public.p110_event_envelopes where command_id in (select command_id from public.p110_command_receipts where policy_version='2026-09-05.seed-procurement.no-effect.v2')) events,
      (select count(*)::text from public.p110_outbox_messages where receipt_id in (select receipt_id from public.p110_command_receipts where policy_version='2026-09-05.seed-procurement.no-effect.v2')) outboxes,
      (select count(*)::text from public.p110_outbox_messages where effect_class <> 'NO_EFFECT') bad_effects`);
    assert.equal(ledger[0].receipts, ledger[0].events);
    assert.equal(ledger[0].receipts, ledger[0].outboxes);
    assert.equal(ledger[0].bad_effects, "0");
    assert.equal((await tenantQuery<{ count: string }>(tenantA.tenantId, "select count(*)::text count from public.p110_command_receipts where command_type in ('rfq.create_draft','supplier_quote.normalize','bid_comparison.create','bid_comparison.approve_from_selection','procurement_selection.record')"))[0].count, "7");
    assert.equal((await tenantQuery<{ count: string }>(tenantA.tenantId, "select count(*)::text count from public.p110_command_receipts where command_type in ('purchase_order.create_draft','purchase_order_acknowledgement.record')"))[0].count, "0");

    console.log(JSON.stringify({ atomicityFaultRollback: { productSource: faultCounts[0], selectionAndApproval: selectionFaultCounts[0] }, canonicalSupplierIdentity: "A2S_EXACT_PROFILE_VERSION_ENFORCED", concurrency: { evidenceReplay: "one receipt", rfqReplay: "one receipt", supplierQuotes: "two canonical owner commits" }, dependencyHeldRows: 0, duplicateReview: true, freshInstanceReadback: true, humanSelection: "IMMUTABLE_FACT_PLUS_APPROVED_BID_V2", inheritedProjectScope: true, ledger: ledger[0], objectiveScore: objectiveScore(fit), proposalDependency: "CANONICAL_READER_UNAVAILABLE", replayReadbackMismatchDenied: true, reviewEvidenceNotPromoted: true, supplierDenials: ["CAPABILITY", "EXPIRY", "REVOCATION", "TENANT"], tenantIsolation: true, urlResolvedPdfLineage: "DIRECT_PDF_PLUS_UPSTREAM_URL" }, null, 2));
  } finally { await pool.end(); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
