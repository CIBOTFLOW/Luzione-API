import assert from "node:assert/strict";

import { Pool } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import {
  ROOM_PLANNER_OWNER,
  SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
  canonicalProjectPackageHash,
  parseProjectCreationCommand,
  parseProjectPackageCommand,
  type ProjectPackagePayload,
} from "@/modules/seed-project-publication/contracts";
import {
  createProjectSpecificationScheduleReadModel,
  parseProjectSpecificationScheduleReadModel,
} from "@/modules/seed-project-publication/readModel";
import {
  specificationIdFor,
  specificationVersion,
} from "@/modules/seed-project-publication/model";
import {
  ProjectPublicationDomainError,
  SeedProjectPublicationStore,
} from "@/modules/seed-project-publication/store";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { IdempotencyConflictError } from "@/modules/platform-guarantees/commandKernel";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
const requestedAt = "2026-09-05T09:00:00.000Z";
const tenantA: ApiActor = {
  actorId: "service:seed-project-proof",
  actorType: "service",
  capabilities: ["project.command", "project.read", "project_package.publish", "specification.revision.propose"],
  source: "service-token",
  tenantId: "tenant-proof-a",
};
const tenantB: ApiActor = { ...tenantA, tenantId: "tenant-proof-b" };

function projectCommand(input: { accountId: string; commandId: string; idempotencyKey: string; opportunityId: string; opportunityVersion: number; name?: string }) {
  return parseProjectCreationCommand({
    commandId: input.commandId,
    commandType: "project.create_from_opportunity",
    contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
    expectedVersion: "ABSENT",
    idempotencyKey: input.idempotencyKey,
    opportunityRef: { objectId: input.opportunityId, version: `opportunity:${input.opportunityId}:v${input.opportunityVersion}` },
    project: {
      accountId: input.accountId,
      briefRefs: [`brief:${input.opportunityId}`],
      budget: { amountMinor: 50_000_000, currency: "USD" },
      decisionRefs: [`decision:${input.opportunityId}`],
      evidenceRefs: [`evidence:${input.opportunityId}`],
      name: input.name ?? "Pacific Residence",
      ownerId: "operator-proof",
      spaceBriefs: [
        { floor: "1", kind: "ROOM", name: "Living Room", sequence: 1 },
        { floor: "1", kind: "ROOM", name: "Dining Room", sequence: 2 },
      ],
      stakeholderRefs: ["contact:proof"],
      targetEndAt: "2027-06-30T00:00:00.000Z",
      targetStartAt: "2026-10-01T00:00:00.000Z",
      taskRefs: ["task:proof"],
    },
  });
}

function packagePayload(plannerVersion: string, description: string, quantity = 1): ProjectPackagePayload {
  const pack: ProjectPackagePayload = {
    assetRefs: ["asset:floor-plan"],
    packageHash: "0".repeat(64),
    plannerProjectRef: {
      objectId: "planner-project-proof",
      objectType: "PLANNER_PROJECT",
      ownerProject: ROOM_PLANNER_OWNER,
      version: plannerVersion,
    },
    provenanceRefs: [`evidence:${plannerVersion}`],
    sourceVersionHash: "b".repeat(64),
    spaces: [
      { floor: "1", kind: "ROOM", name: "Living Room", plannerRef: { objectId: "planner-space-living", objectType: "PLANNER_SPACE", ownerProject: ROOM_PLANNER_OWNER, version: `${plannerVersion}:living` }, sequence: 1 },
      { floor: "1", kind: "ROOM", name: "Dining Room", plannerRef: { objectId: "planner-space-dining", objectType: "PLANNER_SPACE", ownerProject: ROOM_PLANNER_OWNER, version: `${plannerVersion}:dining` }, sequence: 2 },
    ],
    specifications: [{
      lines: [{
        approvalState: "PENDING",
        deliveryRisk: "MEDIUM",
        description,
        plannerRef: { objectId: "planner-line-sofa", objectType: "PLANNER_SPECIFICATION_LINE", ownerProject: ROOM_PLANNER_OWNER, version: `${plannerVersion}:sofa` },
        productCandidateIds: ["product-candidate-proof"],
        quantity,
        selectedCandidateId: "product-candidate-proof",
        sourcingState: "NOT_STARTED",
        spacePlannerObjectId: "planner-space-living",
        unit: "each",
      }],
      plannerRef: { objectId: "planner-spec-living", objectType: "PLANNER_SPECIFICATION", ownerProject: ROOM_PLANNER_OWNER, version: `${plannerVersion}:spec` },
      spacePlannerObjectIds: ["planner-space-living"],
      title: "Living Room FF&E",
    }],
    uncertainty: [],
  };
  pack.packageHash = canonicalProjectPackageHash(pack);
  return pack;
}

function publishCommand(projectId: string, projectVersion: string, input: { commandId: string; idempotencyKey: string; pack: ProjectPackagePayload }) {
  return parseProjectPackageCommand({
    commandId: input.commandId,
    commandType: "project_package.publish",
    contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
    expectedVersion: "ABSENT",
    idempotencyKey: input.idempotencyKey,
    package: input.pack,
    projectId,
    projectVersion,
  });
}

function revisionCommand(projectId: string, projectVersion: string, specificationId: string, input: { commandId: string; expectedVersion: string; idempotencyKey: string; pack: ProjectPackagePayload }) {
  return parseProjectPackageCommand({
    commandId: input.commandId,
    commandType: "specification.propose_revision",
    contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    package: input.pack,
    projectId,
    projectVersion,
    specificationId,
  });
}

function executeInput(actor: ApiActor, command: never, correlationId: string) {
  return { actor, command, correlationId, requestedAt };
}

async function tenantQuery<T>(tenantId: string, sql: string, values: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query(sql, values);
    await client.query("commit");
    return result.rows as T[];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function domainCode(result: PromiseRejectedResult) {
  return result.reason instanceof ProjectPublicationDomainError ? result.reason.code : String(result.reason);
}

async function main() {
try {
  const store = new SeedProjectPublicationStore(pool);
  const create = projectCommand({ accountId: "account-primary", commandId: "command-project-primary", idempotencyKey: "idempotency-project-primary", opportunityId: "opportunity-primary", opportunityVersion: 4 });
  const created = await store.executeProjectCreate(executeInput(tenantA, create as never, "correlation-project-primary"));
  assert.equal(created.readbackMatchesReceipt, true);
  assert.equal(created.readback.receipt.finality, "DOMAIN_COMMITTED");
  const projectId = created.readback.resource.id;
  const projectVersion = created.readback.resource.version;

  const replayedCreate = await new SeedProjectPublicationStore(pool).executeProjectCreate(executeInput(tenantA, create as never, "correlation-project-replay"));
  assert.equal(replayedCreate.receipt.receiptId, created.receipt.receiptId);
  assert.equal(replayedCreate.receipt.idempotentReplay, true);
  await assert.rejects(
    store.executeProjectCreate(executeInput(tenantA, projectCommand({ ...create, accountId: "account-primary", commandId: create.commandId, idempotencyKey: create.idempotencyKey, name: "Changed payload", opportunityId: "opportunity-primary", opportunityVersion: 4 }) as never, "correlation-project-conflict")),
    IdempotencyConflictError,
  );
  assert.equal(await store.readProject(tenantB, projectId), null);
  await assert.rejects(
    store.executeProjectCreate(executeInput(tenantB, projectCommand({ accountId: "account-primary", commandId: "command-cross-tenant", idempotencyKey: "idempotency-cross-tenant", opportunityId: "opportunity-primary", opportunityVersion: 4 }) as never, "correlation-cross-tenant")),
    (error: unknown) => error instanceof ProjectPublicationDomainError && error.code === "VERSION_CONFLICT",
  );

  const faultCommand = projectCommand({ accountId: "account-fault", commandId: "command-project-fault", idempotencyKey: "idempotency-project-fault", opportunityId: "opportunity-fault", opportunityVersion: 1 });
  const faultStore = new SeedProjectPublicationStore(pool, { afterOwnerWrites: async (point) => { if (point === "PROJECT") throw new Error("PROOF_FAULT_AFTER_OWNER_WRITE"); } });
  await assert.rejects(faultStore.executeProjectCreate(executeInput(tenantA, faultCommand as never, "correlation-fault")), /PROOF_FAULT_AFTER_OWNER_WRITE/);
  const faultCounts = await tenantQuery<{ owners: string; receipts: string }>(tenantA.tenantId, `select
    (select count(*)::text from public.seed_projects where source_opportunity_id='opportunity-fault') owners,
    (select count(*)::text from public.p110_command_receipts where command_id='command-project-fault') receipts`);
  assert.deepEqual(faultCounts[0], { owners: "0", receipts: "0" });

  const concurrentCreateCommands = ["a", "b"].map((suffix) => projectCommand({ accountId: "account-concurrent", commandId: `command-concurrent-${suffix}`, idempotencyKey: `idempotency-concurrent-${suffix}`, opportunityId: "opportunity-concurrent", opportunityVersion: 2 }));
  const concurrentCreates = await Promise.allSettled(concurrentCreateCommands.map((command, index) => store.executeProjectCreate(executeInput(tenantA, command as never, `correlation-concurrent-${index}`))));
  assert.equal(concurrentCreates.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(domainCode(concurrentCreates.find((result): result is PromiseRejectedResult => result.status === "rejected")!), "PROJECT_ALREADY_EXISTS");

  const stalePublish = publishCommand(projectId, projectVersion.replace(":v1", ":v0"), { commandId: "command-publish-stale", idempotencyKey: "idempotency-publish-stale", pack: packagePayload("planner-project:v6", "Stale") });
  await assert.rejects(store.executePackagePublish(executeInput(tenantA, stalePublish as never, "correlation-publish-stale")), (error: unknown) => error instanceof ProjectPublicationDomainError && error.code === "VERSION_CONFLICT");

  const publishCommands = [
    publishCommand(projectId, projectVersion, { commandId: "command-publish-a", idempotencyKey: "idempotency-publish-a", pack: packagePayload("planner-project:v7a", "Three-seat sofa") }),
    publishCommand(projectId, projectVersion, { commandId: "command-publish-b", idempotencyKey: "idempotency-publish-b", pack: packagePayload("planner-project:v7b", "Alternate sofa") }),
  ];
  const publishResults = await Promise.allSettled(publishCommands.map((command, index) => store.executePackagePublish(executeInput(tenantA, command as never, `correlation-publish-${index}`))));
  assert.equal(publishResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(domainCode(publishResults.find((result): result is PromiseRejectedResult => result.status === "rejected")!), "PACKAGE_ALREADY_PUBLISHED");
  const winningPublishIndex = publishResults.findIndex((result) => result.status === "fulfilled");
  const winningPublish = (publishResults[winningPublishIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof store.executePackagePublish>>>).value;
  const winningPublishCommand = publishCommands[winningPublishIndex];
  const replayedPublish = await new SeedProjectPublicationStore(pool).executePackagePublish(executeInput(tenantA, winningPublishCommand as never, "correlation-publish-replay"));
  assert.equal(replayedPublish.receipt.receiptId, winningPublish.receipt.receiptId);
  assert.equal(replayedPublish.receipt.idempotentReplay, true);

  const freshSchedule = await new SeedProjectPublicationStore(pool).readSpecificationSchedule(tenantA, projectId);
  assert.ok(freshSchedule);
  const parsedSchedule = parseProjectSpecificationScheduleReadModel(createProjectSpecificationScheduleReadModel(freshSchedule, {
    observedAt: "2026-09-05T09:05:00.000Z",
    releaseIdentity: createReleaseIdentity({ environment: { LUZIONE_BUILD_TIME: "2026-09-05T09:04:00.000Z", VERCEL_GIT_COMMIT_SHA: "2222222222222222222222222222222222222222" }, mutationsEnabled: false }),
    tenantId: tenantA.tenantId,
  }));
  assert.equal(parsedSchedule.spaces.length, 2);
  assert.equal(parsedSchedule.activeSpecifications.length, 1);
  assert.equal(parsedSchedule.activeSpecifications[0].lines.reduce((sum, line) => sum + line.data.quantity, 0), 1);
  assert.equal(parsedSchedule.timeline.length, 2);
  assert.equal(parsedSchedule.timeline.every((event) => event.receipt.finality === "DOMAIN_COMMITTED" && event.receipt.providerAcknowledgementRef === null), true);

  const specificationId = specificationIdFor(tenantA.tenantId, projectId, "planner-spec-living");
  const activeVersion = specificationVersion(specificationId, 1);
  const revisionCommands = [
    revisionCommand(projectId, projectVersion, specificationId, { commandId: "command-revision-a", expectedVersion: activeVersion, idempotencyKey: "idempotency-revision-a", pack: packagePayload("planner-project:v8a", "Long three-seat sofa", 2) }),
    revisionCommand(projectId, projectVersion, specificationId, { commandId: "command-revision-b", expectedVersion: activeVersion, idempotencyKey: "idempotency-revision-b", pack: packagePayload("planner-project:v8b", "Compact three-seat sofa", 3) }),
  ];
  const revisionResults = await Promise.allSettled(revisionCommands.map((command, index) => store.executeSpecificationRevision(executeInput(tenantA, command as never, `correlation-revision-${index}`))));
  assert.equal(revisionResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(domainCode(revisionResults.find((result): result is PromiseRejectedResult => result.status === "rejected")!), "REVISION_PENDING");
  const winningRevisionIndex = revisionResults.findIndex((result) => result.status === "fulfilled");
  const winningRevision = (revisionResults[winningRevisionIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof store.executeSpecificationRevision>>>).value;
  const winningRevisionCommand = revisionCommands[winningRevisionIndex];
  const replayedRevision = await new SeedProjectPublicationStore(pool).executeSpecificationRevision(executeInput(tenantA, winningRevisionCommand as never, "correlation-revision-replay"));
  assert.equal(replayedRevision.receipt.receiptId, winningRevision.receipt.receiptId);
  assert.equal(replayedRevision.receipt.idempotentReplay, true);
  await assert.rejects(
    store.executeSpecificationRevision(executeInput(tenantA, { ...winningRevisionCommand, package: packagePayload(winningRevisionCommand.package.plannerProjectRef.version, "Changed replay payload", 4) } as never, "correlation-revision-conflict")),
    IdempotencyConflictError,
  );
  const staleRevision = revisionCommand(projectId, projectVersion, specificationId, { commandId: "command-revision-stale", expectedVersion: specificationVersion(specificationId, 2), idempotencyKey: "idempotency-revision-stale", pack: packagePayload("planner-project:v9", "Stale version", 4) });
  await assert.rejects(store.executeSpecificationRevision(executeInput(tenantA, staleRevision as never, "correlation-revision-stale")), (error: unknown) => error instanceof ProjectPublicationDomainError && error.code === "VERSION_CONFLICT");

  const finalSchedule = await new SeedProjectPublicationStore(pool).readSpecificationSchedule(tenantA, projectId);
  assert.ok(finalSchedule);
  assert.equal(finalSchedule.activeSpecifications[0].lines[0].data.quantity, 1);
  assert.equal(finalSchedule.pendingRevisions.length, 1);
  assert.equal(finalSchedule.pendingRevisions[0].lines[0].data.quantity, winningRevisionCommand.package.specifications[0].lines[0].quantity);
  assert.ok(finalSchedule.pendingRevisions[0].diff.length > 0);
  assert.equal(await new SeedProjectPublicationStore(pool).readSpecificationSchedule(tenantB, projectId), null);

  const ledger = await tenantQuery<{ bad_effects: string; events: string; outboxes: string; receipts: string }>(tenantA.tenantId, `select
    (select count(*)::text from public.p110_command_receipts where command_type in ('project.create_from_opportunity','project_package.publish','specification.propose_revision')) receipts,
    (select count(*)::text from public.p110_event_envelopes where command_id in (select command_id from public.p110_command_receipts where command_type in ('project.create_from_opportunity','project_package.publish','specification.propose_revision'))) events,
    (select count(*)::text from public.p110_outbox_messages where receipt_id in (select receipt_id from public.p110_command_receipts where command_type in ('project.create_from_opportunity','project_package.publish','specification.propose_revision'))) outboxes,
    (select count(*)::text from public.p110_outbox_messages where effect_class <> 'NO_EFFECT') bad_effects`);
  assert.equal(ledger[0].receipts, ledger[0].events);
  assert.equal(ledger[0].receipts, ledger[0].outboxes);
  assert.equal(ledger[0].bad_effects, "0");
  const isolatedRows = await tenantQuery<{ count: string }>(tenantB.tenantId, "select count(*)::text count from public.seed_projects where project_id=$1", [projectId]);
  assert.equal(isolatedRows[0].count, "0");

  console.log(JSON.stringify({
    atomicityFaultRollback: faultCounts[0],
    concurrency: { project: "1 winner", publication: "1 winner", revision: "1 winner" },
    freshInstanceReadback: true,
    graphTotals: { activeQuantity: 1, packages: finalSchedule.packages.length, pendingRevisions: finalSchedule.pendingRevisions.length, spaces: finalSchedule.spaces.length },
    ledger: ledger[0],
    replayReceiptsStable: true,
    tenantIsolation: true,
  }, null, 2));
} finally {
  await pool.end();
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
