import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ROOM_PLANNER_OWNER,
  SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
  ProjectPublicationContractError,
  canonicalProjectPackageHash,
  parseProjectCreationCommand,
  parseProjectPackageCommand,
  type ProjectPackagePayload,
} from "@/modules/seed-project-publication/contracts";
import {
  projectListHttpResponsePositiveFixture,
  projectScheduleHttpResponsePositiveFixture,
  projectSpecificationSchedulePositiveFixture,
  projectSpecificationScheduleWithRevisionPositiveFixture,
  specificationRevisionHttpResponsePositiveFixture,
} from "@/modules/seed-project-publication/fixtures";
import {
  deterministicSpecificationDiff,
  packageIdFor,
  projectIdFor,
  projectPublicationInvariantDefects,
  specificationIdFor,
} from "@/modules/seed-project-publication/model";
import {
  PROJECT_SPECIFICATION_SCHEDULE_READ_MODEL_VERSION,
  SEED_PROJECT_PUBLICATION_HTTP_ROUTES,
  ProjectSpecificationScheduleContractError,
  parseProjectSpecificationScheduleReadModel,
} from "@/modules/seed-project-publication/readModel";

function projectCommand() {
  return {
    commandId: "command-project-001",
    commandType: "project.create_from_opportunity",
    contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
    expectedVersion: "ABSENT",
    idempotencyKey: "idempotency-project-001",
    opportunityRef: { objectId: "opportunity-001", version: "opportunity:opportunity-001:v4" },
    project: {
      accountId: "account-001",
      briefRefs: ["brief-001"],
      budget: { amountMinor: 50_000_000, currency: "USD" },
      decisionRefs: ["decision-001"],
      evidenceRefs: ["evidence-001"],
      name: "Pacific Residence",
      ownerId: "operator-001",
      spaceBriefs: [
        { floor: "1", kind: "ROOM", name: "Living Room", sequence: 1 },
        { floor: "1", kind: "ROOM", name: "Dining Room", sequence: 2 },
      ],
      stakeholderRefs: ["contact-001"],
      targetEndAt: "2027-06-30T00:00:00.000Z",
      targetStartAt: "2026-10-01T00:00:00.000Z",
      taskRefs: ["task-001"],
    },
  } as const;
}

function packagePayload(version = "planner-project-001:v7", lineDescription = "Three-seat sofa"): ProjectPackagePayload {
  const value: ProjectPackagePayload = {
    assetRefs: ["asset-floor-plan-001"],
    packageHash: "0".repeat(64),
    plannerProjectRef: { objectId: "planner-project-001", objectType: "PLANNER_PROJECT", ownerProject: ROOM_PLANNER_OWNER, version },
    provenanceRefs: ["evidence-planner-publication-001"],
    sourceVersionHash: "a".repeat(64),
    spaces: [
      { floor: "1", kind: "ROOM", name: "Living Room", plannerRef: { objectId: "planner-space-living", objectType: "PLANNER_SPACE", ownerProject: ROOM_PLANNER_OWNER, version: `${version}:space:living` }, sequence: 1 },
      { floor: "1", kind: "ROOM", name: "Dining Room", plannerRef: { objectId: "planner-space-dining", objectType: "PLANNER_SPACE", ownerProject: ROOM_PLANNER_OWNER, version: `${version}:space:dining` }, sequence: 2 },
    ],
    specifications: [{
      lines: [{
        approvalState: "PENDING",
        deliveryRisk: "MEDIUM",
        description: lineDescription,
        plannerRef: { objectId: "planner-line-sofa", objectType: "PLANNER_SPECIFICATION_LINE", ownerProject: ROOM_PLANNER_OWNER, version: `${version}:line:sofa` },
        productCandidateIds: ["product-candidate-001"],
        quantity: 1,
        selectedCandidateId: "product-candidate-001",
        sourcingState: "NOT_STARTED",
        spacePlannerObjectId: "planner-space-living",
        unit: "each",
      }],
      plannerRef: { objectId: "planner-spec-living", objectType: "PLANNER_SPECIFICATION", ownerProject: ROOM_PLANNER_OWNER, version: `${version}:spec:living` },
      spacePlannerObjectIds: ["planner-space-living"],
      title: "Living Room FF&E",
    }],
    uncertainty: [],
  };
  value.packageHash = canonicalProjectPackageHash(value);
  return value;
}

function publicationCommand() {
  return {
    commandId: "command-package-001",
    commandType: "project_package.publish",
    contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
    expectedVersion: "ABSENT",
    idempotencyKey: "idempotency-package-001",
    package: packagePayload(),
    projectId: "project-001",
    projectVersion: "project:project-001:v1",
  };
}

test("strict commands preserve every Opportunity-to-Project source field and exact Planner package hash", () => {
  const project = parseProjectCreationCommand(projectCommand());
  assert.deepEqual(project.project.briefRefs, ["brief-001"]);
  assert.deepEqual(project.project.spaceBriefs.map((space) => space.name), ["Living Room", "Dining Room"]);
  assert.deepEqual(project.project.taskRefs, ["task-001"]);
  const publication = parseProjectPackageCommand(publicationCommand());
  assert.equal(publication.commandType, "project_package.publish");
  assert.equal(canonicalProjectPackageHash(publication.package), publication.package.packageHash);
});

test("caller authority, tenant, missing evidence, invalid package hash and stale create versions fail closed", () => {
  for (const forged of [
    { ...projectCommand(), tenantId: "tenant-forged" },
    { ...projectCommand(), actorId: "actor-forged" },
    { ...projectCommand(), authority: { decision: "ALLOW" } },
  ]) {
    assert.throws(() => parseProjectCreationCommand(forged), (error: unknown) =>
      error instanceof ProjectPublicationContractError && error.code === "FIELD_SET_MISMATCH");
  }
  assert.throws(
    () => parseProjectCreationCommand({ ...projectCommand(), expectedVersion: "project:existing:v1" }),
    (error: unknown) => error instanceof ProjectPublicationContractError && error.code === "VERSION_CONFLICT",
  );
  assert.throws(
    () => parseProjectCreationCommand({ ...projectCommand(), project: { ...projectCommand().project, evidenceRefs: [] } }),
    (error: unknown) => error instanceof ProjectPublicationContractError && error.code === "INVALID_COMMAND",
  );
  assert.throws(
    () => parseProjectPackageCommand({ ...publicationCommand(), package: { ...packagePayload(), packageHash: "b".repeat(64) } }),
    (error: unknown) => error instanceof ProjectPublicationContractError && error.code === "PACKAGE_HASH_MISMATCH",
  );
  const pendingCrossTenant = structuredClone(projectSpecificationScheduleWithRevisionPositiveFixture);
  pendingCrossTenant.pendingRevisions[0].lines[0].tenantId = "tenant-other";
  pendingCrossTenant.pendingRevisions[0].lines[0].sourceRefs.forEach((ref) => { ref.tenantId = "tenant-other"; });
  assert.throws(
    () => parseProjectSpecificationScheduleReadModel(pendingCrossTenant),
    (error: unknown) => error instanceof ProjectSpecificationScheduleContractError && error.code === "TENANT_MISMATCH",
  );
  const pendingWrongSpecification = structuredClone(projectSpecificationScheduleWithRevisionPositiveFixture);
  pendingWrongSpecification.pendingRevisions[0].lines[0].data.specificationId = "specification-other";
  assert.throws(
    () => parseProjectSpecificationScheduleReadModel(pendingWrongSpecification),
    (error: unknown) => error instanceof ProjectSpecificationScheduleContractError && error.code === "REFERENCE_MISMATCH",
  );
});

test("consumer fixtures pin established apiResponse envelopes, routes, and separate contract/deployment SHAs", () => {
  assert.deepEqual(Object.keys(projectListHttpResponsePositiveFixture).sort(), [
    "correlationId", "ok", "requestId", "requestIdentityContractVersion", "responseContractVersion", "result", "traceId",
  ]);
  assert.deepEqual(Object.keys(projectScheduleHttpResponsePositiveFixture).sort(), Object.keys(projectListHttpResponsePositiveFixture).sort());
  assert.deepEqual(Object.keys(specificationRevisionHttpResponsePositiveFixture).sort(), Object.keys(projectListHttpResponsePositiveFixture).sort());
  assert.equal(SEED_PROJECT_PUBLICATION_HTTP_ROUTES.projectCollection, "/api/v1/projects");
  assert.equal(SEED_PROJECT_PUBLICATION_HTTP_ROUTES.specificationSchedule, "/api/v1/projects/:projectId/specification-schedule");
  assert.equal(SEED_PROJECT_PUBLICATION_HTTP_ROUTES.specificationRevisionCollection, "/api/v1/projects/:projectId/specification-revisions");
  assert.notEqual(
    projectScheduleHttpResponsePositiveFixture.result.metadata.seedContractProducerSha,
    projectScheduleHttpResponsePositiveFixture.result.metadata.releaseIdentity.exactSha,
  );
});

test("canonical IDs and before-after diffs are deterministic and source-derived", () => {
  const pack = packagePayload();
  assert.equal(projectIdFor("tenant-a", "opportunity-a"), projectIdFor("tenant-a", "opportunity-a"));
  assert.notEqual(projectIdFor("tenant-a", "opportunity-a"), projectIdFor("tenant-b", "opportunity-a"));
  assert.equal(packageIdFor("tenant-a", "project-a", pack), packageIdFor("tenant-a", "project-a", pack));
  const specificationId = specificationIdFor("tenant-a", "project-a", pack.specifications[0].plannerRef.objectId);
  const before = {
    lines: [{ approvalState: "PENDING", deliveryRisk: "MEDIUM", description: "Sofa", lineId: "line-a", productCandidateIds: [], quantity: 1, selectedCandidateId: null, sourcingState: "NOT_STARTED", spaceId: "space-a", unit: "each" }],
    spaceIds: ["space-a"], specificationId, title: "Living Room",
  };
  const after = { ...before, lines: [{ ...before.lines[0], description: "Long sofa", quantity: 2 }] };
  assert.deepEqual(deterministicSpecificationDiff(before, after).map((entry) => entry.fieldPath), ["lines"]);
  assert.deepEqual(deterministicSpecificationDiff(before, after), deterministicSpecificationDiff(before, after));
});

test("ProjectSpecificationScheduleReadModel/v1 binds exact fields, tenant graph and deployment SHA semantics", () => {
  const parsed = parseProjectSpecificationScheduleReadModel(projectSpecificationSchedulePositiveFixture);
  assert.equal(parsed.contractVersion, PROJECT_SPECIFICATION_SCHEDULE_READ_MODEL_VERSION);
  assert.equal(parsed.metadata.releaseIdentity.evidenceState, "EXACT_RELEASE_BOUND");
  assert.equal(parsed.activeSpecifications[0].lines[0].data.specificationId, parsed.activeSpecifications[0].specification.resource.id);
  assert.throws(
    () => parseProjectSpecificationScheduleReadModel({ ...structuredClone(projectSpecificationSchedulePositiveFixture), contractVersion: "future" }),
    (error: unknown) => error instanceof ProjectSpecificationScheduleContractError && error.code === "UNSUPPORTED_CONTRACT_VERSION",
  );
  const crossTenant = structuredClone(projectSpecificationSchedulePositiveFixture);
  crossTenant.spaces[0].tenantId = "tenant-other";
  assert.throws(
    () => parseProjectSpecificationScheduleReadModel(crossTenant),
    (error: unknown) => error instanceof Error,
  );
  const falseDeployment = structuredClone(projectSpecificationSchedulePositiveFixture);
  falseDeployment.metadata.releaseIdentity.environment = "production";
  falseDeployment.metadata.releaseIdentity.exactSha = null;
  falseDeployment.metadata.releaseIdentity.evidenceState = "EXACT_RELEASE_BOUND";
  assert.throws(
    () => parseProjectSpecificationScheduleReadModel(falseDeployment),
    (error: unknown) => error instanceof ProjectSpecificationScheduleContractError && error.code === "DEPLOYMENT_IDENTITY_INVALID",
  );
  const wrongProducerSha = {
    ...structuredClone(projectSpecificationSchedulePositiveFixture),
    metadata: { ...projectSpecificationSchedulePositiveFixture.metadata, seedContractProducerSha: "0000000000000000000000000000000000000000" },
  };
  assert.throws(
    () => parseProjectSpecificationScheduleReadModel(wrongProducerSha),
    (error: unknown) => error instanceof ProjectSpecificationScheduleContractError && error.code === "PRODUCER_MISMATCH",
  );
});

test("CLI-generated migration is reversible, forced-RLS, explicitly role-scoped and least privilege", () => {
  const migration = readFileSync("supabase/migrations/20260905083212_seed_project_publication_a2.sql", "utf8");
  const rollback = readFileSync("scripts/validation/rollback-seed-project-publication-a2.sql", "utf8");
  for (const table of ["seed_projects", "seed_project_packages", "seed_spaces", "seed_specifications", "seed_specification_lines", "seed_specification_revisions"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
    assert.match(migration, new RegExp(`create policy ${table}_runtime_tenant[\\s\\S]*to luzione_api_runtime`));
    assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`));
  }
  assert.match(migration, /grant select, insert on table[\s\S]*to luzione_api_runtime/);
  assert.match(migration, /revoke all on function public\.seed_project_publication_reject_mutation\(\) from public/);
  assert.match(migration, /current_setting\(''app\.tenant_id'', true\)/);
  assert.match(migration, /seed_specification_revisions_one_pending_idx/);
  assert.equal((migration.match(/deferrable initially deferred/g) ?? []).length, 6);
  assert.match(migration, /status text not null check \(status = 'ACTIVE_PROCUREMENT'\)/);
  assert.match(migration, /status text not null check \(status = 'PENDING'\)/);
  assert.doesNotMatch(migration, /'ACCEPTED'|'REJECTED'|'SUPERSEDED'/);
  assert.match(rollback, /Refusing destructive A2 rollback/);
  assert.match(rollback, /project\.create_from_opportunity/);
  assert.doesNotMatch(migration, /auth\.role\(|user_metadata|security definer/i);
  assert.doesNotMatch(migration, /grant [^;]*(update|delete|truncate)[^;]*to luzione_api_runtime/i);
});

test("store reuses P110 atomic receipt/event/readback and never creates provider or live-effect paths", () => {
  const source = readFileSync("src/modules/seed-project-publication/store.ts", "utf8");
  assert.match(source, /LifecycleCommandKernel/);
  assert.match(source, /PostgresAtomicCommandStore/);
  assert.match(source, /public\.opportunities[\s\S]*where tenant_id = \$1 and id::text = \$2/);
  assert.match(source, /public\.seed_specification_revisions[\s\S]*status = 'PENDING'/);
  assert.match(source, /deterministicSpecificationDiff/);
  assert.match(source, /READBACK_UNCONFIRMED[\s\S]*RECONCILE_FIRST/);
  assert.doesNotMatch(source, /EXTERNAL_EFFECT|PROVIDER_ACKNOWLEDGED|SOURCE_CONFIRMED/);
});

test("known-bad tenant predicate removal and stale-version acceptance are detected", () => {
  const safe = "select version from public.seed_projects where tenant_id = $1 and project_id = $2";
  assert.deepEqual(projectPublicationInvariantDefects({ actualVersion: "project:a:v1", expectedVersion: "project:a:v1", query: safe }), []);
  assert.deepEqual(
    projectPublicationInvariantDefects({ actualVersion: "project:a:v1", expectedVersion: "project:a:v0", query: safe.replace("tenant_id = $1 and ", "") }),
    ["TENANT_PREDICATE_MISSING", "STALE_VERSION_ACCEPTED"],
  );
});

test("all project surfaces are protected, tenant-derived, default-off and expose no competing UI writer", () => {
  const paths = [
    "src/app/api/v1/projects/route.ts",
    "src/app/api/v1/projects/[projectId]/route.ts",
    "src/app/api/v1/projects/[projectId]/specification-schedule/route.ts",
    "src/app/api/v1/projects/[projectId]/project-packages/route.ts",
    "src/app/api/v1/projects/[projectId]/specification-revisions/route.ts",
  ];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /createRequestIdentity\(request\.headers\)/);
    assert.match(source, /requireServiceActor\(request\.headers/);
    assert.match(source, /requestIdentity:\s*identity/);
    assert.doesNotMatch(source, /tenantId\s*:\s*(command|body)\./);
  }
  for (const path of paths.filter((path) => path.endsWith("projects/route.ts") || /project-packages|specification-revisions/.test(path))) {
    assert.match(readFileSync(path, "utf8"), /seedProjectPublicationEnabledForTenant/);
  }
});
