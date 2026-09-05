import {
  parseProjectPackageV1,
  parseProjectV1,
  parseSpaceV1,
  parseSpecificationLineV1,
  parseSpecificationV1,
  parseTimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import type {
  ProjectPackageV1,
  ProjectV1,
  SpaceV1,
  SpecificationLineV1,
  SpecificationV1,
  TimelineEventV1,
} from "@/modules/luzione-core-contracts/seedProductContracts";
import {
  releaseIdentityViolations,
  type ReleaseIdentity,
} from "@/modules/production-convergence/releaseIdentity";
import type { DeterministicDiffEntry } from "@/modules/seed-project-publication/model";

export const PROJECT_SPECIFICATION_SCHEDULE_READ_MODEL_VERSION = "ProjectSpecificationScheduleReadModel/v1";
export const SEED_PRODUCT_CONTRACT_PRODUCER_SHA = "e14b405d58a293c002f5676984a95e55372b3bd2";
export const PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA = "265724e528502b44a1250efea551539d74cb0bbd";
export const API_HTTP_RESPONSE_VERSION = "api-http-response/1.0";

export const SEED_PROJECT_PUBLICATION_HTTP_ROUTES = Object.freeze({
  projectCollection: "/api/v1/projects",
  projectRead: "/api/v1/projects/:projectId",
  projectPackageCollection: "/api/v1/projects/:projectId/project-packages",
  specificationRevisionCollection: "/api/v1/projects/:projectId/specification-revisions",
  specificationSchedule: "/api/v1/projects/:projectId/specification-schedule",
});

export type ProjectSpecificationScheduleData = {
  activeSpecifications: Array<{ lines: SpecificationLineV1[]; specification: SpecificationV1 }>;
  packages: ProjectPackageV1[];
  pendingRevisions: Array<{
    diff: DeterministicDiffEntry[];
    lines: SpecificationLineV1[];
    revisionId: string;
    specification: SpecificationV1;
    status: string;
  }>;
  project: ProjectV1;
  projectContext: {
    briefRefs: string[];
    decisionRefs: string[];
    evidenceRefs: string[];
    spaceBriefs: Array<{ floor: string | null; kind: string; name: string; sequence: number }>;
    stakeholderRefs: string[];
    taskRefs: string[];
  };
  spaces: SpaceV1[];
  timeline: TimelineEventV1[];
};

export type ProjectSpecificationScheduleReadModelV1 = ProjectSpecificationScheduleData & {
  contractVersion: typeof PROJECT_SPECIFICATION_SCHEDULE_READ_MODEL_VERSION;
  metadata: {
    apiResponseContractVersion: typeof API_HTTP_RESPONSE_VERSION;
    observedAt: string;
    producerRepository: "CIBOTFLOW/Luzione-API";
    releaseIdentity: ReleaseIdentity;
    scheduleContractProducerSha: typeof PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA;
    seedProductContractProducerSha: typeof SEED_PRODUCT_CONTRACT_PRODUCER_SHA;
    tenantId: string;
  };
};

type JsonObject = Record<string, unknown>;

export class ProjectSpecificationScheduleContractError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProjectSpecificationScheduleContractError";
  }
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_VALUE", `${path} must be an object.`);
  return value as JsonObject;
}

function exact(value: unknown, keys: readonly string[], path: string) {
  const result = object(value, path);
  const expected = [...keys].sort();
  const actual = Object.keys(result).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("FIELD_SET_MISMATCH", `${path} must contain exactly ${expected.join(", ")}.`);
  }
  return result;
}

function array(value: unknown, path: string) {
  if (!Array.isArray(value)) fail("INVALID_VALUE", `${path} must be an array.`);
  return value;
}

function bounded(value: unknown, path: string) {
  if (typeof value !== "string" || value.length < 2 || value.length > 512) fail("INVALID_VALUE", `${path} must be bounded text.`);
  return value;
}

function sameTenant(tenantId: string, candidate: { tenantId: string }, path: string) {
  if (candidate.tenantId !== tenantId) fail("TENANT_MISMATCH", `${path} crosses the authenticated schedule tenant.`);
}

function parseReleaseIdentity(value: unknown): ReleaseIdentity {
  const input = exact(value, [
    "buildTime", "contractComponents", "contractVersion", "deploymentId", "deploymentUrl",
    "environment", "evidenceState", "exactSha", "mutations", "releaseContractVersion",
    "repository", "schemaVersions", "service",
  ], "schedule.metadata.releaseIdentity") as unknown as ReleaseIdentity;
  const violations = releaseIdentityViolations(input);
  if (violations.length) fail("DEPLOYMENT_IDENTITY_INVALID", `Release identity is invalid: ${violations.join(", ")}.`);
  const deployed = input.environment === "preview" || input.environment === "production";
  if (deployed && input.exactSha === null && input.evidenceState !== "DEPLOYED_INCOMPLETE") {
    fail("DEPLOYMENT_IDENTITY_INVALID", "A deployed response without an exact SHA must remain DEPLOYED_INCOMPLETE.");
  }
  if (input.evidenceState === "EXACT_RELEASE_BOUND" && input.exactSha === null) {
    fail("DEPLOYMENT_IDENTITY_INVALID", "EXACT_RELEASE_BOUND requires an exact deployment SHA.");
  }
  return input;
}

export function parseProjectSpecificationScheduleReadModel(value: unknown): ProjectSpecificationScheduleReadModelV1 {
  const input = exact(value, [
    "activeSpecifications", "contractVersion", "metadata", "packages", "pendingRevisions",
    "project", "projectContext", "spaces", "timeline",
  ], "schedule");
  if (input.contractVersion !== PROJECT_SPECIFICATION_SCHEDULE_READ_MODEL_VERSION) {
    fail("UNSUPPORTED_CONTRACT_VERSION", `schedule.contractVersion must be ${PROJECT_SPECIFICATION_SCHEDULE_READ_MODEL_VERSION}.`);
  }
  const metadata = exact(input.metadata, [
    "apiResponseContractVersion", "observedAt", "producerRepository", "releaseIdentity",
    "scheduleContractProducerSha", "seedProductContractProducerSha", "tenantId",
  ], "schedule.metadata");
  if (metadata.apiResponseContractVersion !== API_HTTP_RESPONSE_VERSION) fail("RESPONSE_ENVELOPE_MISMATCH", "Unexpected API response envelope version.");
  if (metadata.producerRepository !== "CIBOTFLOW/Luzione-API") fail("PRODUCER_MISMATCH", "Schedule producer must be Luzione API.");
  if (metadata.seedProductContractProducerSha !== SEED_PRODUCT_CONTRACT_PRODUCER_SHA) fail("PRODUCER_MISMATCH", "Schedule does not pin the admitted seed-product resource contract producer SHA.");
  if (metadata.scheduleContractProducerSha !== PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA) fail("PRODUCER_MISMATCH", "Schedule does not pin the composed A2 schedule contract producer SHA.");
  const observedAt = bounded(metadata.observedAt, "schedule.metadata.observedAt");
  if (!Number.isFinite(Date.parse(observedAt))) fail("INVALID_VALUE", "schedule.metadata.observedAt must be an ISO timestamp.");
  const tenantId = bounded(metadata.tenantId, "schedule.metadata.tenantId");
  const releaseIdentity = parseReleaseIdentity(metadata.releaseIdentity);
  const project = parseProjectV1(input.project);
  sameTenant(tenantId, project, "schedule.project");
  const projectContext = exact(input.projectContext, ["briefRefs", "decisionRefs", "evidenceRefs", "spaceBriefs", "stakeholderRefs", "taskRefs"], "schedule.projectContext");
  const parsedProjectContext = {
    briefRefs: array(projectContext.briefRefs, "schedule.projectContext.briefRefs").map((item) => bounded(item, "briefRef")),
    decisionRefs: array(projectContext.decisionRefs, "schedule.projectContext.decisionRefs").map((item) => bounded(item, "decisionRef")),
    evidenceRefs: array(projectContext.evidenceRefs, "schedule.projectContext.evidenceRefs").map((item) => bounded(item, "evidenceRef")),
    spaceBriefs: array(projectContext.spaceBriefs, "schedule.projectContext.spaceBriefs").map((item, index) => {
      const brief = exact(item, ["floor", "kind", "name", "sequence"], `schedule.projectContext.spaceBriefs[${index}]`);
      if (brief.floor !== null && typeof brief.floor !== "string") fail("INVALID_VALUE", "Space brief floor must be text or null.");
      if (typeof brief.sequence !== "number" || !Number.isInteger(brief.sequence) || brief.sequence < 1) fail("INVALID_VALUE", "Space brief sequence must be positive.");
      return { floor: brief.floor as string | null, kind: bounded(brief.kind, "spaceBrief.kind"), name: bounded(brief.name, "spaceBrief.name"), sequence: brief.sequence };
    }),
    stakeholderRefs: array(projectContext.stakeholderRefs, "schedule.projectContext.stakeholderRefs").map((item) => bounded(item, "stakeholderRef")),
    taskRefs: array(projectContext.taskRefs, "schedule.projectContext.taskRefs").map((item) => bounded(item, "taskRef")),
  };
  const spaces = array(input.spaces, "schedule.spaces").map((item, index) => {
    const parsed = parseSpaceV1(item);
    sameTenant(tenantId, parsed, `schedule.spaces[${index}]`);
    if (parsed.data.projectId !== project.resource.id) fail("REFERENCE_MISMATCH", "Space must reference the exact Project.");
    return parsed;
  });
  const packages = array(input.packages, "schedule.packages").map((item, index) => {
    const parsed = parseProjectPackageV1(item);
    sameTenant(tenantId, parsed, `schedule.packages[${index}]`);
    if (parsed.data.canonicalProjectId !== project.resource.id) fail("REFERENCE_MISMATCH", "Project Package must reference the exact Project.");
    return parsed;
  });
  const activeSpecifications = array(input.activeSpecifications, "schedule.activeSpecifications").map((item, index) => {
    const record = exact(item, ["lines", "specification"], `schedule.activeSpecifications[${index}]`);
    const specification = parseSpecificationV1(record.specification);
    sameTenant(tenantId, specification, `schedule.activeSpecifications[${index}].specification`);
    if (specification.data.projectId !== project.resource.id || specification.resource.status === "REVISION_PROPOSED") {
      fail("REFERENCE_MISMATCH", "Active Specification must reference this Project and cannot be a proposal.");
    }
    const lines = array(record.lines, `schedule.activeSpecifications[${index}].lines`).map((line, lineIndex) => {
      const parsed = parseSpecificationLineV1(line);
      sameTenant(tenantId, parsed, `schedule.activeSpecifications[${index}].lines[${lineIndex}]`);
      if (parsed.data.specificationId !== specification.resource.id) fail("REFERENCE_MISMATCH", "Specification Line must reference its exact Specification.");
      return parsed;
    });
    return { lines, specification };
  });
  const pendingRevisions = array(input.pendingRevisions, "schedule.pendingRevisions").map((item, index) => {
    const record = exact(item, ["diff", "lines", "revisionId", "specification", "status"], `schedule.pendingRevisions[${index}]`);
    const specification = parseSpecificationV1(record.specification);
    sameTenant(tenantId, specification, `schedule.pendingRevisions[${index}].specification`);
    if (specification.resource.status !== "REVISION_PROPOSED" || specification.data.revisionOfVersion === null) {
      fail("REFERENCE_MISMATCH", "Pending revision must preserve its exact active Specification version.");
    }
    if (record.status !== "PENDING") fail("INVALID_VALUE", "Only pending revisions belong in pendingRevisions.");
    const lines = array(record.lines, `schedule.pendingRevisions[${index}].lines`).map((line, lineIndex) => {
      const parsed = parseSpecificationLineV1(line);
      sameTenant(tenantId, parsed, `schedule.pendingRevisions[${index}].lines[${lineIndex}]`);
      if (parsed.data.specificationId !== specification.resource.id) {
        fail("REFERENCE_MISMATCH", "Proposed Specification Line must reference its exact proposed Specification.");
      }
      return parsed;
    });
    const diff = array(record.diff, `schedule.pendingRevisions[${index}].diff`).map((entry, diffIndex) => {
      const parsed = exact(entry, ["after", "before", "fieldPath"], `schedule.pendingRevisions[${index}].diff[${diffIndex}]`);
      return { after: parsed.after, before: parsed.before, fieldPath: bounded(parsed.fieldPath, "diff.fieldPath") } as DeterministicDiffEntry;
    });
    if (diff.length === 0) fail("INVALID_VALUE", "Pending revision requires a deterministic non-empty diff.");
    return { diff, lines, revisionId: bounded(record.revisionId, "revisionId"), specification, status: "PENDING" };
  });
  const timeline = array(input.timeline, "schedule.timeline").map((item, index) => {
    const parsed = parseTimelineEventV1(item);
    sameTenant(tenantId, parsed, `schedule.timeline[${index}]`);
    return parsed;
  });
  return {
    activeSpecifications,
    contractVersion: PROJECT_SPECIFICATION_SCHEDULE_READ_MODEL_VERSION,
    metadata: {
      apiResponseContractVersion: API_HTTP_RESPONSE_VERSION,
      observedAt,
      producerRepository: "CIBOTFLOW/Luzione-API",
      releaseIdentity,
      scheduleContractProducerSha: PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA,
      seedProductContractProducerSha: SEED_PRODUCT_CONTRACT_PRODUCER_SHA,
      tenantId,
    },
    packages,
    pendingRevisions,
    project,
    projectContext: parsedProjectContext,
    spaces,
    timeline,
  };
}

export function createProjectSpecificationScheduleReadModel(
  schedule: ProjectSpecificationScheduleData,
  input: { observedAt: string; releaseIdentity: ReleaseIdentity; tenantId: string },
) {
  return parseProjectSpecificationScheduleReadModel({
    ...schedule,
    contractVersion: PROJECT_SPECIFICATION_SCHEDULE_READ_MODEL_VERSION,
    metadata: {
      apiResponseContractVersion: API_HTTP_RESPONSE_VERSION,
      observedAt: input.observedAt,
      producerRepository: "CIBOTFLOW/Luzione-API",
      releaseIdentity: input.releaseIdentity,
      scheduleContractProducerSha: PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA,
      seedProductContractProducerSha: SEED_PRODUCT_CONTRACT_PRODUCER_SHA,
      tenantId: input.tenantId,
    },
  });
}

function fail(code: string, message: string): never {
  throw new ProjectSpecificationScheduleContractError(code, message);
}
