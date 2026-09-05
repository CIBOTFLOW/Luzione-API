import "server-only";

import type { Pool, PoolClient } from "pg";

import type { ApiActor } from "@/lib/api/actor";
import { databasePool } from "@/lib/db";
import {
  PostgresAtomicCommandStore,
  type CommandTransaction,
} from "@/lib/platform-guarantees/postgresCommandStore";
import {
  createLifecycleCommandRequest,
  IdempotencyConflictError,
  LifecycleCommandKernel,
} from "@/modules/platform-guarantees/commandKernel";
import {
  parseProjectPackageV1,
  parseProjectV1,
  parseSpaceV1,
  parseSpecificationLineV1,
  parseSpecificationV1,
  parseTimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import {
  SEED_PRODUCT_CONTRACT_VERSIONS,
  type ProjectPackageV1,
  type ProjectV1,
  type SeedAuthorityBoundaryV1,
  type SeedMutationBoundaryV1,
  type SeedReceiptReadbackV1,
  type SeedSourceRefV1,
  type SpaceV1,
  type SpecificationLineV1,
  type SpecificationV1,
  type TimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductContracts";
import {
  SEED_PROJECT_OWNER,
  SEED_PROJECT_PUBLICATION_POLICY_VERSION,
  type PlannerSourceRef,
  type ProjectCreationCommand,
  type ProjectPackagePayload,
  type ProjectPackagePublishCommand,
  type SpecificationRevisionCommand,
} from "@/modules/seed-project-publication/contracts";
import {
  deterministicSpecificationDiff,
  packageIdFor,
  projectIdFor,
  projectPackageVersion,
  projectVersion,
  proposedSpecificationVersion,
  spaceIdFor,
  spaceVersion,
  specificationIdFor,
  specificationLineIdFor,
  specificationLineVersion,
  specificationRevisionIdFor,
  specificationVersion,
  type DeterministicDiffEntry,
  type SpecificationSnapshot,
} from "@/modules/seed-project-publication/model";

export const PROJECT_ROW_SQL = `select p.*, r.receipt_id, r.idempotency_key, r.payload_hash,
       r.expected_object_version, r.policy_version, r.actor_id, r.actor_type,
       r.correlation_id, r.committed_at
  from public.seed_projects p
  join public.p110_command_receipts r
    on r.tenant_id = p.tenant_id and r.command_id = p.created_command_id
 where p.tenant_id = $1 and p.project_id = $2
 limit 1`;

const RECEIPT_COLUMNS = `r.receipt_id, r.idempotency_key, r.payload_hash,
  r.expected_object_version, r.policy_version, r.actor_id, r.actor_type,
  r.correlation_id, r.committed_at`;

type Row = Record<string, unknown>;
type Hooks = { afterOwnerWrites?: (point: "PROJECT" | "PUBLICATION" | "REVISION", client: PoolClient) => Promise<void> };

export class ProjectPublicationDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly recovery?: { committedObjectVersion: string; receiptId: string; retry: "RECONCILE_FIRST" },
  ) {
    super(message);
    this.name = "ProjectPublicationDomainError";
  }
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error("Canonical project row has an invalid timestamp.");
  return new Date(parsed).toISOString();
}

function actorType(value: unknown): SeedAuthorityBoundaryV1["actorType"] {
  if (value === "user") return "HUMAN";
  if (value === "agent") return "SULTAN_AGENT";
  return "SERVICE";
}

function sourceRef(tenantId: string, input: Omit<SeedSourceRefV1, "tenantId">): SeedSourceRefV1 {
  return { ...input, tenantId };
}

function plannerRef(tenantId: string, ref: PlannerSourceRef): SeedSourceRefV1 {
  return sourceRef(tenantId, ref);
}

function boundaries(row: Row, committedVersion: string, capability: string) {
  const mutation: SeedMutationBoundaryV1 = {
    expectedVersion: String(row.expected_object_version),
    idempotencyKey: String(row.idempotency_key),
    payloadHash: String(row.payload_hash),
  };
  const authority: SeedAuthorityBoundaryV1 = {
    actorId: String(row.actor_id),
    actorType: actorType(row.actor_type),
    approvalRef: null,
    capability,
    decision: "ALLOW",
    effectClass: "A1",
    policyVersion: String(row.policy_version),
    serverDerivedIdentityRef: `correlation:${String(row.correlation_id)}`,
  };
  const receipt: SeedReceiptReadbackV1 = {
    committedVersion,
    finality: "DOMAIN_COMMITTED",
    observedAt: null,
    observedVersion: null,
    providerAcknowledgementRef: null,
    receiptId: String(row.receipt_id),
    sourceReadbackRef: null,
  };
  return { authority, mutation, receipt };
}

function projectFromRow(row: Row): ProjectV1 {
  const id = String(row.project_id);
  const version = projectVersion(id, Number(row.version));
  return parseProjectV1({
    ...boundaries(row, version, "project.command"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.project,
    createdAt: iso(row.created_at),
    data: {
      accountId: String(row.account_id),
      budget: row.budget_amount_minor === null ? null : {
        amountMinor: Number(row.budget_amount_minor),
        currency: String(row.budget_currency),
      },
      name: String(row.name),
      opportunityId: String(row.source_opportunity_id),
      ownerId: String(row.owner_id),
      targetEndAt: row.target_end_at === null ? null : iso(row.target_end_at),
      targetStartAt: row.target_start_at === null ? null : iso(row.target_start_at),
    },
    resource: { archivedAt: null, id, status: row.status, type: "PROJECT", version },
    sourceRefs: [sourceRef(String(row.tenant_id), {
      objectId: String(row.source_opportunity_id),
      objectType: "OPPORTUNITY",
      ownerProject: "LUZIONE_CRM",
      version: String(row.source_opportunity_version),
    })],
    tenantId: String(row.tenant_id),
    updatedAt: iso(row.updated_at),
  });
}

function projectContextFromRow(row: Row) {
  return json<{
    briefRefs: string[];
    decisionRefs: string[];
    evidenceRefs: string[];
    spaceBriefs: ProjectCreationCommand["project"]["spaceBriefs"];
    stakeholderRefs: string[];
    taskRefs: string[];
  }>(row.source_context);
}

function packageFromRow(row: Row, related: { revision: Row | null; spaces: Row[]; specifications: Row[] }): ProjectPackageV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.package_id);
  const version = projectPackageVersion(id);
  const pack = json<ProjectPackagePayload>(row.canonical_payload);
  const canonicalSpaceRefs = pack.spaces.map((space) => {
    const spaceId = spaceIdFor(tenantId, String(row.project_id), space.plannerRef.objectId);
    return sourceRef(tenantId, { objectId: spaceId, objectType: "SPACE", ownerProject: SEED_PROJECT_OWNER, version: spaceVersion(spaceId) });
  });
  const canonicalSpecificationRefs = pack.specifications.map((specification) => {
    const specificationId = specificationIdFor(tenantId, String(row.project_id), specification.plannerRef.objectId);
    const proposed = related.revision && String(related.revision.specification_id) === specificationId
      ? String(related.revision.proposed_specification_version)
      : specificationVersion(specificationId);
    return sourceRef(tenantId, { objectId: specificationId, objectType: "SPECIFICATION", ownerProject: SEED_PROJECT_OWNER, version: proposed });
  });
  return parseProjectPackageV1({
    ...boundaries(row, version, row.publication_kind === "REVISION" ? "specification.revision.propose" : "project_package.publish"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.projectPackage,
    createdAt: iso(row.published_at),
    data: {
      assetRefs: pack.assetRefs,
      canonicalProjectId: String(row.project_id),
      plannerProjectRef: plannerRef(tenantId, pack.plannerProjectRef),
      provenanceRefs: pack.provenanceRefs,
      publishedAt: iso(row.published_at),
      sourceVersionHash: pack.sourceVersionHash,
      spaceRefs: canonicalSpaceRefs,
      specificationRefs: canonicalSpecificationRefs,
      uncertainty: pack.uncertainty,
    },
    resource: {
      archivedAt: null,
      id,
      status: row.superseded_by_package_id ? "SUPERSEDED" : "PUBLISHED",
      type: "PROJECT_PACKAGE",
      version,
    },
    sourceRefs: [plannerRef(tenantId, pack.plannerProjectRef)],
    tenantId,
    updatedAt: iso(row.published_at),
  });
}

function activeSpaceFromRow(row: Row, pack: ProjectPackagePayload): SpaceV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.space_id);
  const version = spaceVersion(id, Number(row.version));
  const source = pack.spaces.find((space) => space.plannerRef.objectId === row.planner_space_id);
  if (!source) throw new Error("Canonical Space is missing its immutable Planner source.");
  return parseSpaceV1({
    ...boundaries(row, version, "project_package.publish"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.space,
    createdAt: iso(row.created_at),
    data: {
      floor: row.floor === null ? null : String(row.floor),
      kind: row.kind,
      name: String(row.name),
      projectId: String(row.project_id),
      sequence: Number(row.sequence),
    },
    resource: { archivedAt: null, id, status: row.status, type: "SPACE", version },
    sourceRefs: [plannerRef(tenantId, source.plannerRef)],
    tenantId,
    updatedAt: iso(row.created_at),
  });
}

function activeSpecificationFromRow(row: Row, pack: ProjectPackagePayload): SpecificationV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.specification_id);
  const version = specificationVersion(id, Number(row.version));
  const source = pack.specifications.find((specification) => specification.plannerRef.objectId === row.planner_specification_id);
  if (!source) throw new Error("Canonical Specification is missing its immutable Planner source.");
  return parseSpecificationV1({
    ...boundaries(row, version, "project_package.publish"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.specification,
    createdAt: iso(row.created_at),
    data: {
      activatedAt: row.activated_at === null ? null : iso(row.activated_at),
      plannerPackageId: String(row.package_id),
      projectId: String(row.project_id),
      publishedPackageVersion: projectPackageVersion(String(row.package_id)),
      revisionOfVersion: null,
      spaceIds: json<string[]>(row.space_ids),
      title: String(row.title),
    },
    resource: { archivedAt: null, id, status: row.status, type: "SPECIFICATION", version },
    sourceRefs: [plannerRef(tenantId, source.plannerRef)],
    tenantId,
    updatedAt: iso(row.created_at),
  });
}

function activeLineFromRow(row: Row, pack: ProjectPackagePayload): SpecificationLineV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.specification_line_id);
  const version = specificationLineVersion(id, Number(row.version));
  const snapshot = json<SpecificationSnapshot["lines"][number]>(row.canonical_snapshot);
  const source = pack.specifications.flatMap((specification) => specification.lines)
    .find((line) => line.plannerRef.objectId === row.planner_line_id);
  if (!source) throw new Error("Canonical Specification Line is missing its immutable Planner source.");
  return parseSpecificationLineV1({
    ...boundaries(row, version, "project_package.publish"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.specificationLine,
    createdAt: iso(row.created_at),
    data: {
      approvalState: snapshot.approvalState,
      deliveryRisk: snapshot.deliveryRisk,
      description: snapshot.description,
      productCandidateIds: snapshot.productCandidateIds,
      quantity: snapshot.quantity,
      selectedCandidateId: snapshot.selectedCandidateId,
      sourcingState: snapshot.sourcingState,
      spaceId: snapshot.spaceId,
      specificationId: String(row.specification_id),
      unit: snapshot.unit,
    },
    resource: { archivedAt: null, id, status: row.status, type: "SPECIFICATION_LINE", version },
    sourceRefs: [plannerRef(tenantId, source.plannerRef)],
    tenantId,
    updatedAt: iso(row.created_at),
  });
}

function proposedSpecificationFromRow(row: Row, pack: ProjectPackagePayload): SpecificationV1 {
  const tenantId = String(row.tenant_id);
  const snapshot = json<SpecificationSnapshot>(row.after_snapshot);
  const source = pack.specifications[0];
  return parseSpecificationV1({
    ...boundaries(row, String(row.proposed_specification_version), "specification.revision.propose"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.specification,
    createdAt: iso(row.created_at),
    data: {
      activatedAt: null,
      plannerPackageId: String(row.package_id),
      projectId: String(row.project_id),
      publishedPackageVersion: projectPackageVersion(String(row.package_id)),
      revisionOfVersion: String(row.expected_specification_version),
      spaceIds: snapshot.spaceIds,
      title: snapshot.title,
    },
    resource: {
      archivedAt: null,
      id: String(row.specification_id),
      status: "REVISION_PROPOSED",
      type: "SPECIFICATION",
      version: String(row.proposed_specification_version),
    },
    sourceRefs: [plannerRef(tenantId, source.plannerRef)],
    tenantId,
    updatedAt: iso(row.created_at),
  });
}

function proposedLineFromSnapshot(row: Row, line: SpecificationSnapshot["lines"][number], source: PlannerSourceRef): SpecificationLineV1 {
  const tenantId = String(row.tenant_id);
  const version = `specification-line:${line.lineId}:proposed:${String(row.revision_id)}`;
  return parseSpecificationLineV1({
    ...boundaries(row, version, "specification.revision.propose"),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.specificationLine,
    createdAt: iso(row.created_at),
    data: {
      approvalState: line.approvalState,
      deliveryRisk: line.deliveryRisk,
      description: line.description,
      productCandidateIds: line.productCandidateIds,
      quantity: line.quantity,
      selectedCandidateId: line.selectedCandidateId,
      sourcingState: line.sourcingState,
      spaceId: line.spaceId,
      specificationId: String(row.specification_id),
      unit: line.unit,
    },
    resource: { archivedAt: null, id: line.lineId, status: "DRAFT", type: "SPECIFICATION_LINE", version },
    sourceRefs: [plannerRef(tenantId, source)],
    tenantId,
    updatedAt: iso(row.created_at),
  });
}

async function bindRead(client: PoolClient, tenantId: string) {
  await client.query("begin read only");
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function advisory(client: PoolClient, tenantId: string, key: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [tenantId, key]);
}

function opportunityVersion(row: Row) {
  return `opportunity:${String(row.id)}:v${Number(row.version)}`;
}

function snapshotFor(
  tenantId: string,
  projectId: string,
  specification: ProjectPackagePayload["specifications"][number],
): SpecificationSnapshot {
  const specificationId = specificationIdFor(tenantId, projectId, specification.plannerRef.objectId);
  const spaceIds = specification.spacePlannerObjectIds.map((id) => spaceIdFor(tenantId, projectId, id));
  return {
    lines: specification.lines.map((line) => ({
      approvalState: line.approvalState,
      deliveryRisk: line.deliveryRisk,
      description: line.description,
      lineId: specificationLineIdFor(tenantId, specificationId, line.plannerRef.objectId),
      productCandidateIds: line.productCandidateIds,
      quantity: line.quantity,
      selectedCandidateId: line.selectedCandidateId,
      sourcingState: line.sourcingState,
      spaceId: spaceIdFor(tenantId, projectId, line.spacePlannerObjectId),
      unit: line.unit,
    })),
    spaceIds,
    specificationId,
    title: specification.title,
  };
}

export class SeedProjectPublicationStore {
  private readonly kernel: LifecycleCommandKernel<CommandTransaction>;

  constructor(private readonly pool: Pool = databasePool(), private readonly hooks: Hooks = {}) {
    this.kernel = new LifecycleCommandKernel(new PostgresAtomicCommandStore(pool));
  }

  async listProjects(actor: ApiActor, limit = 50) {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(
        `select p.*, ${RECEIPT_COLUMNS}
           from public.seed_projects p
           join public.p110_command_receipts r
             on r.tenant_id = p.tenant_id and r.command_id = p.created_command_id
          where p.tenant_id = $1
          order by p.updated_at desc, p.project_id
          limit $2`,
        [actor.tenantId, boundedLimit],
      );
      return result.rows.map((row) => projectFromRow(row as Row));
    });
  }

  async readProject(actor: ApiActor, projectId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const result = await client.query(PROJECT_ROW_SQL, [actor.tenantId, projectId]);
      return result.rows[0] ? projectFromRow(result.rows[0] as Row) : null;
    });
  }

  async readProjectPackage(actor: ApiActor, projectId: string, packageId?: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const values: unknown[] = [actor.tenantId, projectId];
      const packagePredicate = packageId ? "and p.package_id = $3" : "";
      if (packageId) values.push(packageId);
      const result = await client.query(
        `select p.*, ${RECEIPT_COLUMNS},
                (select later.package_id from public.seed_project_packages later
                  where later.tenant_id = $1 and later.supersedes_package_id = p.package_id
                  order by later.published_at desc limit 1) as superseded_by_package_id
           from public.seed_project_packages p
           join public.p110_command_receipts r
             on r.tenant_id = p.tenant_id and r.command_id = p.created_command_id
          where p.tenant_id = $1 and p.project_id = $2 ${packagePredicate}
          order by p.published_at desc, p.package_id desc
          limit 1`,
        values,
      );
      const row = result.rows[0] as Row | undefined;
      if (!row) return null;
      const spaces = await client.query("select * from public.seed_spaces where tenant_id = $1 and package_id = $2", [actor.tenantId, row.package_id]);
      const specifications = await client.query("select * from public.seed_specifications where tenant_id = $1 and package_id = $2", [actor.tenantId, row.package_id]);
      const revision = await client.query("select * from public.seed_specification_revisions where tenant_id = $1 and package_id = $2 limit 1", [actor.tenantId, row.package_id]);
      return packageFromRow(row, {
        revision: revision.rows[0] as Row | undefined ?? null,
        spaces: spaces.rows as Row[],
        specifications: specifications.rows as Row[],
      });
    });
  }

  async readSpecificationSchedule(actor: ApiActor, projectId: string) {
    return this.readTransaction(actor.tenantId, async (client) => {
      const projectResult = await client.query(PROJECT_ROW_SQL, [actor.tenantId, projectId]);
      const projectRow = projectResult.rows[0] as Row | undefined;
      if (!projectRow) return null;
      const packageResult = await client.query(
        `select p.*, ${RECEIPT_COLUMNS},
                (select later.package_id from public.seed_project_packages later
                  where later.tenant_id = $1 and later.supersedes_package_id = p.package_id
                  order by later.published_at desc limit 1) as superseded_by_package_id
           from public.seed_project_packages p
           join public.p110_command_receipts r
             on r.tenant_id = p.tenant_id and r.command_id = p.created_command_id
          where p.tenant_id = $1 and p.project_id = $2
          order by p.published_at desc, p.package_id desc`,
        [actor.tenantId, projectId],
      );
      // node-postgres clients serialize commands; explicit awaits avoid unsupported concurrent
      // queries on one transaction-bound client while preserving one tenant snapshot.
      const spaceResult = await client.query(
          `select s.*, ${RECEIPT_COLUMNS}, p.canonical_payload
             from public.seed_spaces s
             join public.seed_project_packages p on p.tenant_id = s.tenant_id and p.package_id = s.package_id
             join public.p110_command_receipts r on r.tenant_id = p.tenant_id and r.command_id = p.created_command_id
            where s.tenant_id = $1 and s.project_id = $2 order by s.sequence, s.space_id`,
          [actor.tenantId, projectId],
        );
      const specificationResult = await client.query(
          `select s.*, ${RECEIPT_COLUMNS}, p.canonical_payload
             from public.seed_specifications s
             join public.seed_project_packages p on p.tenant_id = s.tenant_id and p.package_id = s.package_id
             join public.p110_command_receipts r on r.tenant_id = p.tenant_id and r.command_id = p.created_command_id
            where s.tenant_id = $1 and s.project_id = $2 order by s.specification_id`,
          [actor.tenantId, projectId],
        );
      const lineResult = await client.query(
          `select l.*, ${RECEIPT_COLUMNS}, p.canonical_payload
             from public.seed_specification_lines l
             join public.seed_project_packages p on p.tenant_id = l.tenant_id and p.package_id = l.package_id
             join public.p110_command_receipts r on r.tenant_id = p.tenant_id and r.command_id = p.created_command_id
            where l.tenant_id = $1 and l.project_id = $2 order by l.specification_id, l.specification_line_id`,
          [actor.tenantId, projectId],
        );
      const revisionResult = await client.query(
          `select v.*, ${RECEIPT_COLUMNS}, p.canonical_payload
             from public.seed_specification_revisions v
             join public.seed_project_packages p on p.tenant_id = v.tenant_id and p.package_id = v.package_id
             join public.p110_command_receipts r on r.tenant_id = p.tenant_id and r.command_id = p.created_command_id
            where v.tenant_id = $1 and v.project_id = $2 and v.status = 'PENDING'
            order by v.created_at, v.revision_id`,
          [actor.tenantId, projectId],
        );
      const timelineResult = await client.query(
          `select e.*, r.receipt_id, r.expected_object_version, r.committed_object_version,
                  r.policy_version, r.actor_id, r.actor_type, r.idempotency_key,
                  r.payload_hash, r.command_type
             from public.p110_event_envelopes e
             join public.p110_command_receipts r on r.tenant_id = e.tenant_id and r.event_id = e.event_id
            where e.tenant_id = $1 and r.tenant_id = $1
              and (e.subject_object_id = $2
                or e.subject_object_id in (select p.package_id from public.seed_project_packages p where p.tenant_id = $1 and p.project_id = $2)
                or e.subject_object_id in (select v.revision_id from public.seed_specification_revisions v where v.tenant_id = $1 and v.project_id = $2))
            order by e.recorded_at, e.event_id`,
          [actor.tenantId, projectId],
        );
      const spaces = spaceResult.rows.map((row) => activeSpaceFromRow(row as Row, json<ProjectPackagePayload>(row.canonical_payload)));
      const specifications = specificationResult.rows.map((row) => activeSpecificationFromRow(row as Row, json<ProjectPackagePayload>(row.canonical_payload)));
      const lines = lineResult.rows.map((row) => activeLineFromRow(row as Row, json<ProjectPackagePayload>(row.canonical_payload)));
      const pendingRevisions = revisionResult.rows.map((value) => {
        const row = value as Row;
        const pack = json<ProjectPackagePayload>(row.canonical_payload);
        const snapshot = json<SpecificationSnapshot>(row.after_snapshot);
        return {
          diff: json<DeterministicDiffEntry[]>(row.deterministic_diff),
          lines: snapshot.lines.map((line, index) => proposedLineFromSnapshot(row, line, pack.specifications[0].lines[index].plannerRef)),
          revisionId: String(row.revision_id),
          specification: proposedSpecificationFromRow(row, pack),
          status: String(row.status),
        };
      });
      const packages = packageResult.rows.map((row) => packageFromRow(row as Row, {
        revision: revisionResult.rows.find((revision) => revision.package_id === row.package_id) as Row | undefined ?? null,
        spaces: spaceResult.rows.filter((space) => space.package_id === row.package_id) as Row[],
        specifications: specificationResult.rows.filter((specification) => specification.package_id === row.package_id) as Row[],
      }));
      const timeline = timelineResult.rows.map((row) => timelineFromRow(row as Row, projectId));
      return {
        activeSpecifications: specifications.map((specification) => ({
          lines: lines.filter((line) => line.data.specificationId === specification.resource.id),
          specification,
        })),
        packages,
        pendingRevisions,
        project: projectFromRow(projectRow),
        projectContext: projectContextFromRow(projectRow),
        spaces,
        timeline,
      };
    });
  }

  async executeProjectCreate(input: { actor: ApiActor; command: ProjectCreationCommand; correlationId: string; requestedAt: string }) {
    const projectId = projectIdFor(input.actor.tenantId, input.command.opportunityRef.objectId);
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId: input.command.commandId,
      commandType: input.command.commandType,
      correlationId: input.correlationId,
      expectedObjectVersion: input.command.expectedVersion,
      idempotencyKey: input.command.idempotencyKey,
      payload: input.command,
      policyVersion: SEED_PROJECT_PUBLICATION_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: projectId,
        objectType: "project",
        objectVersion: input.command.expectedVersion,
        ownerProject: SEED_PROJECT_OWNER,
        sourceRefs: [`postgres:public.opportunities/${input.command.opportunityRef.objectId}@${input.command.opportunityRef.version}`],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction) => {
      await advisory(transaction.client, input.actor.tenantId, `project:${projectId}`);
      const opportunity = await transaction.client.query(
        `select id::text, account_id::text, version
           from public.opportunities
          where tenant_id = $1 and id::text = $2
          limit 1`,
        [input.actor.tenantId, input.command.opportunityRef.objectId],
      );
      const source = opportunity.rows[0] as Row | undefined;
      if (!source) throw new ProjectPublicationDomainError("OPPORTUNITY_NOT_FOUND", "Source Opportunity not found for this tenant.", 404);
      if (opportunityVersion(source) !== input.command.opportunityRef.version) {
        throw new ProjectPublicationDomainError("VERSION_CONFLICT", "Source Opportunity version is stale.", 409);
      }
      if (String(source.account_id) !== input.command.project.accountId) {
        throw new ProjectPublicationDomainError("SOURCE_REFERENCE_CONFLICT", "Project account does not match the canonical Opportunity account.", 409);
      }
      const existing = await transaction.client.query(
        "select project_id from public.seed_projects where tenant_id = $1 and source_opportunity_id = $2 limit 1",
        [input.actor.tenantId, input.command.opportunityRef.objectId],
      );
      if (existing.rows[0]) throw new ProjectPublicationDomainError("PROJECT_ALREADY_EXISTS", "Opportunity already has a canonical Project.", 409);
      const result = await transaction.client.query(
        `insert into public.seed_projects (
           tenant_id, project_id, source_opportunity_id, source_opportunity_version,
           account_id, name, owner_id, budget_amount_minor, budget_currency,
           target_start_at, target_end_at, source_context, status, version,
           created_command_id, created_by, created_by_type, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'ACTIVE',1,$13,$14,$15,$16,$16)
         returning project_id, version`,
        [
          input.actor.tenantId,
          projectId,
          input.command.opportunityRef.objectId,
          input.command.opportunityRef.version,
          input.command.project.accountId,
          input.command.project.name,
          input.command.project.ownerId,
          input.command.project.budget?.amountMinor ?? null,
          input.command.project.budget?.currency ?? null,
          input.command.project.targetStartAt,
          input.command.project.targetEndAt,
          JSON.stringify({
            briefRefs: input.command.project.briefRefs,
            decisionRefs: input.command.project.decisionRefs,
            evidenceRefs: input.command.project.evidenceRefs,
            spaceBriefs: input.command.project.spaceBriefs,
            stakeholderRefs: input.command.project.stakeholderRefs,
            taskRefs: input.command.project.taskRefs,
          }),
          input.command.commandId,
          input.actor.actorId,
          input.actor.actorType,
          input.requestedAt,
        ],
      );
      await this.hooks.afterOwnerWrites?.("PROJECT", transaction.client);
      return {
        evidenceRefs: [
          `postgres:public.opportunities/${input.command.opportunityRef.objectId}`,
          ...input.command.project.evidenceRefs,
        ],
        objectVersion: projectVersion(projectId, Number(result.rows[0].version)),
      };
    });
    const readback = await this.readProject(input.actor, projectId);
    return this.confirmReadback(receipt, readback);
  }

  async executePackagePublish(input: { actor: ApiActor; command: ProjectPackagePublishCommand; correlationId: string; requestedAt: string }) {
    const canonicalIds = this.idsForPackage(input.actor.tenantId, input.command.projectId, input.command.package);
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId: input.command.commandId,
      commandType: input.command.commandType,
      correlationId: input.correlationId,
      expectedObjectVersion: input.command.expectedVersion,
      idempotencyKey: input.command.idempotencyKey,
      payload: input.command,
      policyVersion: SEED_PROJECT_PUBLICATION_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: canonicalIds.packageId,
        objectType: "project_package",
        objectVersion: input.command.expectedVersion,
        ownerProject: SEED_PROJECT_OWNER,
        sourceRefs: [`room-planner:${input.command.package.plannerProjectRef.objectId}@${input.command.package.plannerProjectRef.version}`],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction) => {
      await advisory(transaction.client, input.actor.tenantId, `project:${input.command.projectId}`);
      await this.requireProjectVersion(transaction.client, input.actor.tenantId, input.command.projectId, input.command.projectVersion);
      const prior = await transaction.client.query(
        "select package_id from public.seed_project_packages where tenant_id = $1 and project_id = $2 and publication_kind = 'INITIAL' limit 1",
        [input.actor.tenantId, input.command.projectId],
      );
      if (prior.rows[0]) throw new ProjectPublicationDomainError("PACKAGE_ALREADY_PUBLISHED", "The initial Project Package is already published; submit an exact Specification revision.", 409);
      await transaction.client.query(
        `insert into public.seed_project_packages (
           tenant_id, package_id, project_id, publication_kind, planner_project_id,
           planner_project_version, source_version_hash, package_hash, canonical_payload,
           supersedes_package_id, object_version, created_command_id, created_by,
           created_by_type, published_at
         ) values ($1,$2,$3,'INITIAL',$4,$5,$6,$7,$8::jsonb,null,$9,$10,$11,$12,$13)`,
        [
          input.actor.tenantId, canonicalIds.packageId, input.command.projectId,
          input.command.package.plannerProjectRef.objectId, input.command.package.plannerProjectRef.version,
          input.command.package.sourceVersionHash, input.command.package.packageHash,
          JSON.stringify(input.command.package), projectPackageVersion(canonicalIds.packageId), input.command.commandId,
          input.actor.actorId, input.actor.actorType, input.requestedAt,
        ],
      );
      for (const space of input.command.package.spaces) {
        const spaceId = spaceIdFor(input.actor.tenantId, input.command.projectId, space.plannerRef.objectId);
        await transaction.client.query(
          `insert into public.seed_spaces (
             tenant_id, space_id, project_id, package_id, planner_space_id, planner_space_version,
             name, kind, floor, sequence, status, version, created_command_id, created_by,
             created_by_type, created_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',1,$11,$12,$13,$14)`,
          [
            input.actor.tenantId, spaceId, input.command.projectId, canonicalIds.packageId,
            space.plannerRef.objectId, space.plannerRef.version, space.name, space.kind,
            space.floor, space.sequence, input.command.commandId, input.actor.actorId,
            input.actor.actorType, input.requestedAt,
          ],
        );
      }
      for (const specification of input.command.package.specifications) {
        const snapshot = snapshotFor(input.actor.tenantId, input.command.projectId, specification);
        await transaction.client.query(
          `insert into public.seed_specifications (
             tenant_id, specification_id, project_id, package_id, planner_specification_id,
             planner_specification_version, title, space_ids, canonical_snapshot, status,
             version, activated_at, created_command_id, created_by, created_by_type, created_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'ACTIVE_PROCUREMENT',1,$10,$11,$12,$13,$10)`,
          [
            input.actor.tenantId, snapshot.specificationId, input.command.projectId, canonicalIds.packageId,
            specification.plannerRef.objectId, specification.plannerRef.version, snapshot.title,
            JSON.stringify(snapshot.spaceIds), JSON.stringify(snapshot), input.requestedAt,
            input.command.commandId, input.actor.actorId, input.actor.actorType,
          ],
        );
        for (const [index, line] of specification.lines.entries()) {
          const lineSnapshot = snapshot.lines[index];
          await transaction.client.query(
            `insert into public.seed_specification_lines (
               tenant_id, specification_line_id, specification_id, project_id, package_id,
               planner_line_id, planner_line_version, space_id, canonical_snapshot, status,
               version, created_command_id, created_by, created_by_type, created_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'SOURCING',1,$10,$11,$12,$13)`,
            [
              input.actor.tenantId, lineSnapshot.lineId, snapshot.specificationId, input.command.projectId,
              canonicalIds.packageId, line.plannerRef.objectId, line.plannerRef.version,
              lineSnapshot.spaceId, JSON.stringify(lineSnapshot), input.command.commandId,
              input.actor.actorId, input.actor.actorType, input.requestedAt,
            ],
          );
        }
      }
      await this.hooks.afterOwnerWrites?.("PUBLICATION", transaction.client);
      return {
        evidenceRefs: input.command.package.provenanceRefs,
        objectVersion: projectPackageVersion(canonicalIds.packageId),
      };
    });
    const readback = await this.readProjectPackage(input.actor, input.command.projectId, canonicalIds.packageId);
    const confirmed = this.confirmReadback(receipt, readback);
    return { ...confirmed, canonicalIds };
  }

  async executeSpecificationRevision(input: { actor: ApiActor; command: SpecificationRevisionCommand; correlationId: string; requestedAt: string }) {
    const canonicalIds = this.idsForPackage(input.actor.tenantId, input.command.projectId, input.command.package);
    const specification = input.command.package.specifications[0];
    const expectedSpecificationId = specificationIdFor(input.actor.tenantId, input.command.projectId, specification.plannerRef.objectId);
    if (expectedSpecificationId !== input.command.specificationId) {
      throw new ProjectPublicationDomainError("SOURCE_REFERENCE_CONFLICT", "Specification ID does not match the Planner source identity.", 409);
    }
    const after = snapshotFor(input.actor.tenantId, input.command.projectId, specification);
    const revisionId = specificationRevisionIdFor(
      input.actor.tenantId, input.command.specificationId, canonicalIds.packageId, input.command.expectedVersion, after,
    );
    const proposedVersion = proposedSpecificationVersion(input.command.specificationId, revisionId);
    const request = createLifecycleCommandRequest({
      actor: { actorId: input.actor.actorId, actorType: input.actor.actorType, roles: [] },
      causationId: null,
      commandId: input.command.commandId,
      commandType: input.command.commandType,
      correlationId: input.correlationId,
      expectedObjectVersion: input.command.expectedVersion,
      idempotencyKey: input.command.idempotencyKey,
      payload: input.command,
      policyVersion: SEED_PROJECT_PUBLICATION_POLICY_VERSION,
      requestedAt: input.requestedAt,
      stepId: null,
      target: {
        objectId: revisionId,
        objectType: "specification_revision",
        objectVersion: input.command.expectedVersion,
        ownerProject: SEED_PROJECT_OWNER,
        sourceRefs: [
          `postgres:public.seed_specifications/${input.command.specificationId}@${input.command.expectedVersion}`,
          `room-planner:${specification.plannerRef.objectId}@${specification.plannerRef.version}`,
        ],
      },
      tenantId: input.actor.tenantId,
      workflowId: null,
    });
    const receipt = await this.kernel.execute(request, async (transaction) => {
      await advisory(transaction.client, input.actor.tenantId, `specification:${input.command.specificationId}`);
      await this.requireProjectVersion(transaction.client, input.actor.tenantId, input.command.projectId, input.command.projectVersion);
      const current = await transaction.client.query(
        `select canonical_snapshot, version
           from public.seed_specifications
          where tenant_id = $1 and project_id = $2 and specification_id = $3
          limit 1`,
        [input.actor.tenantId, input.command.projectId, input.command.specificationId],
      );
      const active = current.rows[0] as Row | undefined;
      if (!active) throw new ProjectPublicationDomainError("SPECIFICATION_NOT_FOUND", "Active procurement Specification not found.", 404);
      const actualVersion = specificationVersion(input.command.specificationId, Number(active.version));
      if (actualVersion !== input.command.expectedVersion) {
        throw new ProjectPublicationDomainError("VERSION_CONFLICT", "Active Specification version is stale.", 409);
      }
      const pending = await transaction.client.query(
        "select revision_id from public.seed_specification_revisions where tenant_id = $1 and specification_id = $2 and status = 'PENDING' limit 1",
        [input.actor.tenantId, input.command.specificationId],
      );
      if (pending.rows[0]) throw new ProjectPublicationDomainError("REVISION_PENDING", "An exact pending revision already exists for this Specification.", 409);
      const before = json<SpecificationSnapshot>(active.canonical_snapshot);
      const diff = deterministicSpecificationDiff(before, after);
      if (diff.length === 0) throw new ProjectPublicationDomainError("NO_REVISION_CHANGE", "Planner revision contains no change from the active Specification.", 409);
      const priorPackage = await transaction.client.query(
        "select package_id from public.seed_project_packages where tenant_id = $1 and project_id = $2 order by published_at desc, package_id desc limit 1",
        [input.actor.tenantId, input.command.projectId],
      );
      await transaction.client.query(
        `insert into public.seed_project_packages (
           tenant_id, package_id, project_id, publication_kind, planner_project_id,
           planner_project_version, source_version_hash, package_hash, canonical_payload,
           supersedes_package_id, object_version, created_command_id, created_by,
           created_by_type, published_at
         ) values ($1,$2,$3,'REVISION',$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
        [
          input.actor.tenantId, canonicalIds.packageId, input.command.projectId,
          input.command.package.plannerProjectRef.objectId, input.command.package.plannerProjectRef.version,
          input.command.package.sourceVersionHash, input.command.package.packageHash,
          JSON.stringify(input.command.package), priorPackage.rows[0]?.package_id ?? null,
          projectPackageVersion(canonicalIds.packageId), input.command.commandId,
          input.actor.actorId, input.actor.actorType, input.requestedAt,
        ],
      );
      await transaction.client.query(
        `insert into public.seed_specification_revisions (
           tenant_id, revision_id, specification_id, project_id, package_id,
           expected_specification_version, proposed_specification_version,
           before_snapshot, after_snapshot, deterministic_diff, status,
           created_command_id, created_by, created_by_type, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'PENDING',$11,$12,$13,$14)`,
        [
          input.actor.tenantId, revisionId, input.command.specificationId, input.command.projectId,
          canonicalIds.packageId, input.command.expectedVersion, proposedVersion,
          JSON.stringify(before), JSON.stringify(after), JSON.stringify(diff), input.command.commandId,
          input.actor.actorId, input.actor.actorType, input.requestedAt,
        ],
      );
      await this.hooks.afterOwnerWrites?.("REVISION", transaction.client);
      return { evidenceRefs: input.command.package.provenanceRefs, objectVersion: proposedVersion };
    });
    const schedule = await this.readSpecificationSchedule(input.actor, input.command.projectId);
    const revision = schedule?.pendingRevisions.find((item) => item.revisionId === revisionId) ?? null;
    if (!revision || (!receipt.idempotentReplay && revision.specification.resource.version !== receipt.objectVersion)) {
      throw new ProjectPublicationDomainError(
        "READBACK_UNCONFIRMED",
        "Specification revision commit readback could not be confirmed; reconcile the durable receipt before retrying.",
        503,
        { committedObjectVersion: receipt.objectVersion, receiptId: receipt.receiptId, retry: "RECONCILE_FIRST" },
      );
    }
    return { canonicalIds: { ...canonicalIds, revisionId }, readback: revision, readbackMatchesReceipt: revision.specification.resource.version === receipt.objectVersion, receipt };
  }

  private idsForPackage(tenantId: string, projectId: string, pack: ProjectPackagePayload) {
    return {
      packageId: packageIdFor(tenantId, projectId, pack),
      spaceIds: pack.spaces.map((space) => spaceIdFor(tenantId, projectId, space.plannerRef.objectId)),
      specificationIds: pack.specifications.map((specification) => specificationIdFor(tenantId, projectId, specification.plannerRef.objectId)),
      specificationLineIds: pack.specifications.flatMap((specification) => {
        const specificationId = specificationIdFor(tenantId, projectId, specification.plannerRef.objectId);
        return specification.lines.map((line) => specificationLineIdFor(tenantId, specificationId, line.plannerRef.objectId));
      }),
    };
  }

  private async requireProjectVersion(client: PoolClient, tenantId: string, projectId: string, expectedVersion: string) {
    const result = await client.query(
      "select version from public.seed_projects where tenant_id = $1 and project_id = $2 limit 1",
      [tenantId, projectId],
    );
    if (!result.rows[0]) throw new ProjectPublicationDomainError("PROJECT_NOT_FOUND", "Canonical Project not found.", 404);
    if (projectVersion(projectId, Number(result.rows[0].version)) !== expectedVersion) {
      throw new ProjectPublicationDomainError("VERSION_CONFLICT", "Canonical Project version is stale.", 409);
    }
  }

  private confirmReadback<T extends { resource: { version: string } }>(
    receipt: Awaited<ReturnType<LifecycleCommandKernel<CommandTransaction>["execute"]>>,
    readback: T | null,
  ) {
    const readbackMatchesReceipt = readback?.resource.version === receipt.objectVersion;
    if (!readback || (!receipt.idempotentReplay && !readbackMatchesReceipt)) {
      throw new ProjectPublicationDomainError(
        "READBACK_UNCONFIRMED",
        "Owner commit readback could not be confirmed; reconcile the durable receipt before retrying.",
        503,
        { committedObjectVersion: receipt.objectVersion, receiptId: receipt.receiptId, retry: "RECONCILE_FIRST" },
      );
    }
    return { readback, readbackMatchesReceipt, receipt };
  }

  private async readTransaction<T>(tenantId: string, operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await bindRead(client, tenantId);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function timelineFromRow(row: Row, projectId: string): TimelineEventV1 {
  const tenantId = String(row.tenant_id);
  const id = String(row.event_id);
  const version = `timeline-event:${id}:v1`;
  const subject = sourceRef(tenantId, {
    objectId: String(row.subject_object_id),
    objectType: String(row.subject_object_type).toUpperCase(),
    ownerProject: String(row.subject_owner_project),
    version: String(row.subject_object_version),
  });
  const projectReference = sourceRef(tenantId, {
    objectId: projectId,
    objectType: "PROJECT",
    ownerProject: SEED_PROJECT_OWNER,
    version: projectVersion(projectId, 1),
  });
  return parseTimelineEventV1({
    ...boundaries(row, version, String(row.command_type)),
    contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent,
    createdAt: iso(row.recorded_at),
    data: {
      actorId: String(row.actor_id),
      aggregateRefs: subject.objectId === projectId ? [projectReference] : [projectReference, subject],
      eventType: String(row.command_type).toUpperCase().replaceAll(".", "_"),
      evidenceRefs: json<string[]>(row.evidence_refs),
      occurredAt: iso(row.occurred_at),
      recordedAt: iso(row.recorded_at),
      summary: `Accepted ${String(row.command_type)} with durable owner commit ${String(row.committed_object_version)}.`,
      visibility: "INTERNAL",
    },
    resource: { archivedAt: null, id, status: "ACTIVE", type: "TIMELINE_EVENT", version },
    sourceRefs: [subject],
    tenantId,
    updatedAt: iso(row.recorded_at),
  });
}

export { IdempotencyConflictError };
