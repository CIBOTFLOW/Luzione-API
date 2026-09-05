import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const SEED_PROJECT_PUBLICATION_COMMAND_VERSION = "SeedProjectPublicationCommand/v1";
export const SEED_PROJECT_PUBLICATION_POLICY_VERSION = "2026-09-05.seed-project-publication.no-effect.v1";
export const SEED_PROJECT_OWNER = "LUZIONE_PROJECT";
export const ROOM_PLANNER_OWNER = "LUZIONE_ROOM_PLANNER";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;
const DIGEST = /^[a-f0-9]{64}$/;

export type PlannerSourceRef = {
  objectId: string;
  objectType: "PLANNER_PROJECT" | "PLANNER_SPACE" | "PLANNER_SPECIFICATION" | "PLANNER_SPECIFICATION_LINE";
  ownerProject: typeof ROOM_PLANNER_OWNER;
  version: string;
};

export type ProjectCreationCommand = {
  commandId: string;
  commandType: "project.create_from_opportunity";
  contractVersion: typeof SEED_PROJECT_PUBLICATION_COMMAND_VERSION;
  expectedVersion: "ABSENT";
  idempotencyKey: string;
  opportunityRef: { objectId: string; version: string };
  project: {
    accountId: string;
    briefRefs: string[];
    budget: { amountMinor: number; currency: string } | null;
    decisionRefs: string[];
    evidenceRefs: string[];
    name: string;
    ownerId: string;
    spaceBriefs: Array<{
      floor: string | null;
      kind: "AREA" | "EXTERIOR" | "ROOM" | "WHOLE_HOME";
      name: string;
      sequence: number;
    }>;
    stakeholderRefs: string[];
    targetEndAt: string | null;
    targetStartAt: string | null;
    taskRefs: string[];
  };
};

export type ProjectPackagePayload = {
  assetRefs: string[];
  packageHash: string;
  plannerProjectRef: PlannerSourceRef;
  provenanceRefs: string[];
  sourceVersionHash: string;
  spaces: Array<{
    floor: string | null;
    kind: "AREA" | "EXTERIOR" | "ROOM" | "WHOLE_HOME";
    name: string;
    plannerRef: PlannerSourceRef;
    sequence: number;
  }>;
  specifications: Array<{
    lines: Array<{
      approvalState: "APPROVED" | "PENDING" | "REJECTED";
      deliveryRisk: "HIGH" | "LOW" | "MEDIUM" | "UNKNOWN";
      description: string;
      plannerRef: PlannerSourceRef;
      productCandidateIds: string[];
      quantity: number;
      selectedCandidateId: string | null;
      sourcingState: "AWARDED" | "NOT_STARTED" | "QUOTED" | "RFQ_OPEN";
      spacePlannerObjectId: string;
      unit: string;
    }>;
    plannerRef: PlannerSourceRef;
    spacePlannerObjectIds: string[];
    title: string;
  }>;
  uncertainty: Array<{ fieldPath: string; reason: string; score: number }>;
};

export type ProjectPackagePublishCommand = {
  commandId: string;
  commandType: "project_package.publish";
  contractVersion: typeof SEED_PROJECT_PUBLICATION_COMMAND_VERSION;
  expectedVersion: "ABSENT";
  idempotencyKey: string;
  package: ProjectPackagePayload;
  projectId: string;
  projectVersion: string;
};

export type SpecificationRevisionCommand = {
  commandId: string;
  commandType: "specification.propose_revision";
  contractVersion: typeof SEED_PROJECT_PUBLICATION_COMMAND_VERSION;
  expectedVersion: string;
  idempotencyKey: string;
  package: ProjectPackagePayload;
  projectId: string;
  projectVersion: string;
  specificationId: string;
};

export type ProjectPublicationCommand = ProjectCreationCommand | ProjectPackagePublishCommand | SpecificationRevisionCommand;

export class ProjectPublicationContractError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "ProjectPublicationContractError";
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} must be an object.`);
  return value as JsonObject;
}

function exact(value: unknown, keys: readonly string[], path: string) {
  const result = object(value, path);
  const expected = [...keys].sort();
  const actual = Object.keys(result).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ProjectPublicationContractError(
      "FIELD_SET_MISMATCH",
      `${path} fields must be exactly ${expected.join(", ")}; received ${actual.join(", ")}.`,
    );
  }
  return result;
}

function text(value: unknown, path: string, max = 1_000) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) invalid(`${path} must be a non-empty bounded string.`);
  return value.trim();
}

function id(value: unknown, path: string) {
  const parsed = text(value, path, 512);
  if (!ID.test(parsed)) invalid(`${path} must be a stable canonical identifier.`);
  return parsed;
}

function digest(value: unknown, path: string) {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(`${path} must be a lowercase SHA-256 digest.`);
  return value;
}

function timestampOrNull(value: unknown, path: string) {
  if (value === null) return null;
  const parsed = text(value, path, 100);
  if (!Number.isFinite(Date.parse(parsed))) invalid(`${path} must be an ISO timestamp or null.`);
  return new Date(parsed).toISOString();
}

function nullableText(value: unknown, path: string, max = 512) {
  if (value === null) return null;
  return text(value, path, max);
}

function positiveNumber(value: unknown, path: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) invalid(`${path} must be positive.`);
  return value;
}

function positiveInteger(value: unknown, path: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) invalid(`${path} must be a positive integer.`);
  return Number(value);
}

function score(value: unknown, path: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) invalid(`${path} must be between zero and one.`);
  return value;
}

function strings(value: unknown, path: string, requireOne = false) {
  if (!Array.isArray(value) || (requireOne && value.length === 0)) invalid(`${path} must be ${requireOne ? "a non-empty" : "an"} array.`);
  const result = value.map((item, index) => id(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) invalid(`${path} must not contain duplicate references.`);
  return result;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${path} is not an allowed value.`);
  return value as T;
}

function base(input: JsonObject) {
  if (input.contractVersion !== SEED_PROJECT_PUBLICATION_COMMAND_VERSION) {
    throw new ProjectPublicationContractError(
      "UNSUPPORTED_CONTRACT_VERSION",
      `contractVersion must be ${SEED_PROJECT_PUBLICATION_COMMAND_VERSION}.`,
    );
  }
  return {
    commandId: id(input.commandId, "command.commandId"),
    contractVersion: SEED_PROJECT_PUBLICATION_COMMAND_VERSION,
    idempotencyKey: id(input.idempotencyKey, "command.idempotencyKey"),
  } as const;
}

function parsePlannerRef(value: unknown, path: string, objectType: PlannerSourceRef["objectType"]): PlannerSourceRef {
  const ref = exact(value, ["objectId", "objectType", "ownerProject", "version"], path);
  if (ref.objectType !== objectType) invalid(`${path}.objectType must be ${objectType}.`);
  if (ref.ownerProject !== ROOM_PLANNER_OWNER) invalid(`${path}.ownerProject must be ${ROOM_PLANNER_OWNER}.`);
  return {
    objectId: id(ref.objectId, `${path}.objectId`),
    objectType,
    ownerProject: ROOM_PLANNER_OWNER,
    version: id(ref.version, `${path}.version`),
  };
}

function parseMoney(value: unknown, path: string) {
  if (value === null) return null;
  const money = exact(value, ["amountMinor", "currency"], path);
  if (!Number.isSafeInteger(money.amountMinor) || Number(money.amountMinor) < 0) invalid(`${path}.amountMinor must be a non-negative safe integer.`);
  const currency = text(money.currency, `${path}.currency`, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) invalid(`${path}.currency must be an ISO-style three-letter code.`);
  return { amountMinor: Number(money.amountMinor), currency };
}

function parseProject(value: unknown): ProjectCreationCommand["project"] {
  const project = exact(value, [
    "accountId", "briefRefs", "budget", "decisionRefs", "evidenceRefs", "name", "ownerId",
    "spaceBriefs", "stakeholderRefs", "targetEndAt", "targetStartAt", "taskRefs",
  ], "command.project");
  if (!Array.isArray(project.spaceBriefs)) invalid("command.project.spaceBriefs must be an array.");
  const spaceBriefs = project.spaceBriefs.map((value, index) => {
    const item = exact(value, ["floor", "kind", "name", "sequence"], `command.project.spaceBriefs[${index}]`);
    return {
      floor: nullableText(item.floor, `command.project.spaceBriefs[${index}].floor`, 200),
      kind: enumValue(item.kind, ["AREA", "EXTERIOR", "ROOM", "WHOLE_HOME"], `command.project.spaceBriefs[${index}].kind`),
      name: text(item.name, `command.project.spaceBriefs[${index}].name`, 500),
      sequence: positiveInteger(item.sequence, `command.project.spaceBriefs[${index}].sequence`),
    };
  });
  const evidenceRefs = strings(project.evidenceRefs, "command.project.evidenceRefs", true);
  const targetStartAt = timestampOrNull(project.targetStartAt, "command.project.targetStartAt");
  const targetEndAt = timestampOrNull(project.targetEndAt, "command.project.targetEndAt");
  if (targetStartAt && targetEndAt && Date.parse(targetEndAt) < Date.parse(targetStartAt)) invalid("Project targetEndAt cannot precede targetStartAt.");
  return {
    accountId: id(project.accountId, "command.project.accountId"),
    briefRefs: strings(project.briefRefs, "command.project.briefRefs"),
    budget: parseMoney(project.budget, "command.project.budget"),
    decisionRefs: strings(project.decisionRefs, "command.project.decisionRefs"),
    evidenceRefs,
    name: text(project.name, "command.project.name", 500),
    ownerId: id(project.ownerId, "command.project.ownerId"),
    spaceBriefs,
    stakeholderRefs: strings(project.stakeholderRefs, "command.project.stakeholderRefs"),
    targetEndAt,
    targetStartAt,
    taskRefs: strings(project.taskRefs, "command.project.taskRefs"),
  };
}

function parsePackage(value: unknown): ProjectPackagePayload {
  const pack = exact(value, [
    "assetRefs", "packageHash", "plannerProjectRef", "provenanceRefs", "sourceVersionHash",
    "spaces", "specifications", "uncertainty",
  ], "command.package");
  if (!Array.isArray(pack.spaces) || pack.spaces.length === 0) invalid("command.package.spaces must contain at least one space.");
  const spaces = pack.spaces.map((value, index) => {
    const item = exact(value, ["floor", "kind", "name", "plannerRef", "sequence"], `command.package.spaces[${index}]`);
    return {
      floor: nullableText(item.floor, `command.package.spaces[${index}].floor`, 200),
      kind: enumValue(item.kind, ["AREA", "EXTERIOR", "ROOM", "WHOLE_HOME"], `command.package.spaces[${index}].kind`),
      name: text(item.name, `command.package.spaces[${index}].name`, 500),
      plannerRef: parsePlannerRef(item.plannerRef, `command.package.spaces[${index}].plannerRef`, "PLANNER_SPACE"),
      sequence: positiveInteger(item.sequence, `command.package.spaces[${index}].sequence`),
    };
  });
  const plannerSpaceIds = spaces.map((space) => space.plannerRef.objectId);
  if (new Set(plannerSpaceIds).size !== plannerSpaceIds.length) invalid("Planner space identities must be unique inside a package.");
  if (!Array.isArray(pack.specifications) || pack.specifications.length === 0) invalid("command.package.specifications must contain at least one specification.");
  const specifications = pack.specifications.map((value, index) => {
    const item = exact(value, ["lines", "plannerRef", "spacePlannerObjectIds", "title"], `command.package.specifications[${index}]`);
    const spacePlannerObjectIds = strings(item.spacePlannerObjectIds, `command.package.specifications[${index}].spacePlannerObjectIds`, true);
    if (spacePlannerObjectIds.some((spaceId) => !plannerSpaceIds.includes(spaceId))) invalid("Specifications may reference only package spaces.");
    if (!Array.isArray(item.lines) || item.lines.length === 0) invalid(`command.package.specifications[${index}].lines must contain at least one line.`);
    const lines = item.lines.map((value, lineIndex) => {
      const path = `command.package.specifications[${index}].lines[${lineIndex}]`;
      const line = exact(value, [
        "approvalState", "deliveryRisk", "description", "plannerRef", "productCandidateIds", "quantity",
        "selectedCandidateId", "sourcingState", "spacePlannerObjectId", "unit",
      ], path);
      const productCandidateIds = strings(line.productCandidateIds, `${path}.productCandidateIds`);
      const selectedCandidateId = line.selectedCandidateId === null ? null : id(line.selectedCandidateId, `${path}.selectedCandidateId`);
      if (selectedCandidateId && !productCandidateIds.includes(selectedCandidateId)) invalid(`${path}.selectedCandidateId must be present in productCandidateIds.`);
      const spacePlannerObjectId = id(line.spacePlannerObjectId, `${path}.spacePlannerObjectId`);
      if (!spacePlannerObjectIds.includes(spacePlannerObjectId)) invalid(`${path}.spacePlannerObjectId must belong to the specification.`);
      return {
        approvalState: enumValue(line.approvalState, ["APPROVED", "PENDING", "REJECTED"], `${path}.approvalState`),
        deliveryRisk: enumValue(line.deliveryRisk, ["HIGH", "LOW", "MEDIUM", "UNKNOWN"], `${path}.deliveryRisk`),
        description: text(line.description, `${path}.description`, 2_000),
        plannerRef: parsePlannerRef(line.plannerRef, `${path}.plannerRef`, "PLANNER_SPECIFICATION_LINE"),
        productCandidateIds,
        quantity: positiveNumber(line.quantity, `${path}.quantity`),
        selectedCandidateId,
        sourcingState: enumValue(line.sourcingState, ["AWARDED", "NOT_STARTED", "QUOTED", "RFQ_OPEN"], `${path}.sourcingState`),
        spacePlannerObjectId,
        unit: text(line.unit, `${path}.unit`, 100),
      };
    });
    const lineIds = lines.map((line) => line.plannerRef.objectId);
    if (new Set(lineIds).size !== lineIds.length) invalid("Planner specification-line identities must be unique within a specification.");
    return {
      lines,
      plannerRef: parsePlannerRef(item.plannerRef, `command.package.specifications[${index}].plannerRef`, "PLANNER_SPECIFICATION"),
      spacePlannerObjectIds,
      title: text(item.title, `command.package.specifications[${index}].title`, 500),
    };
  });
  const specificationIds = specifications.map((item) => item.plannerRef.objectId);
  if (new Set(specificationIds).size !== specificationIds.length) invalid("Planner specification identities must be unique inside a package.");
  if (!Array.isArray(pack.uncertainty)) invalid("command.package.uncertainty must be an array.");
  const uncertainty = pack.uncertainty.map((value, index) => {
    const item = exact(value, ["fieldPath", "reason", "score"], `command.package.uncertainty[${index}]`);
    return {
      fieldPath: text(item.fieldPath, `command.package.uncertainty[${index}].fieldPath`, 500),
      reason: text(item.reason, `command.package.uncertainty[${index}].reason`, 1_000),
      score: score(item.score, `command.package.uncertainty[${index}].score`),
    };
  });
  const result: ProjectPackagePayload = {
    assetRefs: strings(pack.assetRefs, "command.package.assetRefs"),
    packageHash: digest(pack.packageHash, "command.package.packageHash"),
    plannerProjectRef: parsePlannerRef(pack.plannerProjectRef, "command.package.plannerProjectRef", "PLANNER_PROJECT"),
    provenanceRefs: strings(pack.provenanceRefs, "command.package.provenanceRefs", true),
    sourceVersionHash: digest(pack.sourceVersionHash, "command.package.sourceVersionHash"),
    spaces,
    specifications,
    uncertainty,
  };
  if (canonicalProjectPackageHash(result) !== result.packageHash) {
    throw new ProjectPublicationContractError("PACKAGE_HASH_MISMATCH", "packageHash does not match the canonical package payload.", 409);
  }
  return result;
}

export function canonicalProjectPackageHash(pack: ProjectPackagePayload) {
  const { packageHash, ...hashable } = pack;
  void packageHash;
  return sha256(hashable);
}

export function parseProjectCreationCommand(value: unknown): ProjectCreationCommand {
  const input = exact(value, ["commandId", "commandType", "contractVersion", "expectedVersion", "idempotencyKey", "opportunityRef", "project"], "command");
  const common = base(input);
  if (input.commandType !== "project.create_from_opportunity") unsupported("commandType must be project.create_from_opportunity.");
  if (input.expectedVersion !== "ABSENT") throw new ProjectPublicationContractError("VERSION_CONFLICT", "Project creation requires expectedVersion ABSENT.", 409);
  const opportunityRef = exact(input.opportunityRef, ["objectId", "version"], "command.opportunityRef");
  return {
    ...common,
    commandType: "project.create_from_opportunity",
    expectedVersion: "ABSENT",
    opportunityRef: {
      objectId: id(opportunityRef.objectId, "command.opportunityRef.objectId"),
      version: id(opportunityRef.version, "command.opportunityRef.version"),
    },
    project: parseProject(input.project),
  };
}

export function parseProjectPackageCommand(value: unknown): ProjectPackagePublishCommand | SpecificationRevisionCommand {
  const raw = object(value, "command");
  if (raw.commandType === "project_package.publish") {
    const input = exact(raw, ["commandId", "commandType", "contractVersion", "expectedVersion", "idempotencyKey", "package", "projectId", "projectVersion"], "command");
    const common = base(input);
    if (input.expectedVersion !== "ABSENT") throw new ProjectPublicationContractError("VERSION_CONFLICT", "Initial package publication requires expectedVersion ABSENT.", 409);
    return {
      ...common,
      commandType: "project_package.publish",
      expectedVersion: "ABSENT",
      package: parsePackage(input.package),
      projectId: id(input.projectId, "command.projectId"),
      projectVersion: id(input.projectVersion, "command.projectVersion"),
    };
  }
  if (raw.commandType === "specification.propose_revision") {
    const input = exact(raw, ["commandId", "commandType", "contractVersion", "expectedVersion", "idempotencyKey", "package", "projectId", "projectVersion", "specificationId"], "command");
    const common = base(input);
    const expectedVersion = id(input.expectedVersion, "command.expectedVersion");
    if (expectedVersion === "ABSENT") throw new ProjectPublicationContractError("VERSION_CONFLICT", "Specification revision requires the exact active specification version.", 409);
    const pack = parsePackage(input.package);
    if (pack.specifications.length !== 1) invalid("A specification revision package must contain exactly one specification.");
    return {
      ...common,
      commandType: "specification.propose_revision",
      expectedVersion,
      package: pack,
      projectId: id(input.projectId, "command.projectId"),
      projectVersion: id(input.projectVersion, "command.projectVersion"),
      specificationId: id(input.specificationId, "command.specificationId"),
    };
  }
  unsupported("Unsupported seed project publication command.");
}

function invalid(message: string): never {
  throw new ProjectPublicationContractError("INVALID_COMMAND", message);
}

function unsupported(message: string): never {
  throw new ProjectPublicationContractError("UNSUPPORTED_COMMAND", message);
}
