import { canonicalJson, sha256 } from "@/modules/platform-guarantees/eventContract";
import type { ProjectPackagePayload } from "@/modules/seed-project-publication/contracts";
import type { SeedJsonValue } from "@/modules/luzione-core-contracts/seedProductContracts";

export type SpecificationSnapshot = {
  lines: Array<{
    approvalState: string;
    deliveryRisk: string;
    description: string;
    lineId: string;
    productCandidateIds: string[];
    quantity: number;
    selectedCandidateId: string | null;
    sourcingState: string;
    spaceId: string;
    unit: string;
  }>;
  spaceIds: string[];
  specificationId: string;
  title: string;
};

export type DeterministicDiffEntry = {
  after: SeedJsonValue | null;
  before: SeedJsonValue | null;
  fieldPath: string;
};

function stableId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(value).slice(0, 40)}`;
}

export function projectIdFor(tenantId: string, opportunityId: string) {
  return stableId("project", { opportunityId, tenantId });
}

export function packageIdFor(tenantId: string, projectId: string, pack: ProjectPackagePayload) {
  return stableId("project_package", {
    packageHash: pack.packageHash,
    plannerProjectId: pack.plannerProjectRef.objectId,
    plannerProjectVersion: pack.plannerProjectRef.version,
    projectId,
    tenantId,
  });
}

export function spaceIdFor(tenantId: string, projectId: string, plannerSpaceId: string) {
  return stableId("space", { plannerSpaceId, projectId, tenantId });
}

export function specificationIdFor(tenantId: string, projectId: string, plannerSpecificationId: string) {
  return stableId("specification", { plannerSpecificationId, projectId, tenantId });
}

export function specificationLineIdFor(tenantId: string, specificationId: string, plannerLineId: string) {
  return stableId("specification_line", { plannerLineId, specificationId, tenantId });
}

export function specificationRevisionIdFor(
  tenantId: string,
  specificationId: string,
  packageId: string,
  beforeVersion: string,
  after: SpecificationSnapshot,
) {
  return stableId("specification_revision", {
    after,
    beforeVersion,
    packageId,
    specificationId,
    tenantId,
  });
}

export function projectVersion(projectId: string, version: number) {
  return `project:${projectId}:v${version}`;
}

export function projectPackageVersion(packageId: string) {
  return `project-package:${packageId}:v1`;
}

export function spaceVersion(spaceId: string, version = 1) {
  return `space:${spaceId}:v${version}`;
}

export function specificationVersion(specificationId: string, version = 1) {
  return `specification:${specificationId}:v${version}`;
}

export function specificationLineVersion(lineId: string, version = 1) {
  return `specification-line:${lineId}:v${version}`;
}

export function proposedSpecificationVersion(specificationId: string, revisionId: string) {
  return `specification:${specificationId}:proposed:${revisionId}`;
}

function jsonValue(value: unknown): SeedJsonValue | null {
  if (value === undefined) return null;
  return JSON.parse(canonicalJson(value)) as SeedJsonValue;
}

function visitDiff(before: unknown, after: unknown, path: string, output: DeterministicDiffEntry[]) {
  if (canonicalJson(before) === canonicalJson(after)) return;
  const beforeObject = before && typeof before === "object" && !Array.isArray(before);
  const afterObject = after && typeof after === "object" && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const keys = [...new Set([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ])].sort();
    for (const key of keys) {
      visitDiff(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        output,
      );
    }
    return;
  }
  output.push({
    after: jsonValue(after),
    before: jsonValue(before),
    fieldPath: path,
  });
}

export function deterministicSpecificationDiff(before: SpecificationSnapshot, after: SpecificationSnapshot) {
  const output: DeterministicDiffEntry[] = [];
  visitDiff(before, after, "", output);
  return output.sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
}

export function projectPublicationInvariantDefects(input: {
  actualVersion: string;
  expectedVersion: string;
  query: string;
}) {
  const defects: string[] = [];
  if (!/(?:\b|\.)tenant_id\s*=\s*\$1\b/i.test(input.query)) defects.push("TENANT_PREDICATE_MISSING");
  if (input.expectedVersion !== input.actualVersion) defects.push("STALE_VERSION_ACCEPTED");
  return defects;
}
