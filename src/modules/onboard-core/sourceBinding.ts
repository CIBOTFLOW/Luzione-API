import { canonicalJson, sha256 } from "@/modules/platform-guarantees/eventContract";

export const TENANT_PACK_SOURCE_BINDING_VERSION = "TenantPackSourceBinding/v1";
export const TENANT_PACK_SOURCE_REPOSITORY = "CIBOTFLOW/Luzione-UI";
export const TENANT_PACK_DRAFT_SCHEMA_PATH = "contracts/onboard-core/luzione-tenant-pack-draft-v1.schema.json";
export const TENANT_PACK_DRAFT_SCHEMA_DIGEST = "c94dd71d93d72b048ceaa77b1ba08cb84e1f610393f139060f49ead684d28eb4";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/@:+-]{2,499}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;

export type TenantPackSourceBindingV1 = {
  consumerEvidenceSha: string;
  consumerImplementationSha: string;
  consumerRepository: typeof TENANT_PACK_SOURCE_REPOSITORY;
  contractVersion: typeof TENANT_PACK_SOURCE_BINDING_VERSION;
  evidenceDigest: string;
  evidencePath: string;
  mapperDigest: string;
  mapperPath: string;
  sourceSchemaDigest: typeof TENANT_PACK_DRAFT_SCHEMA_DIGEST;
  sourceSchemaPath: string;
};

export type AdmittedTenantPackSourceBinding = TenantPackSourceBindingV1 & {
  sourcePackId: string;
  sourcePackVersion: string;
  tenantId: string;
};

export class OnboardCoreBindingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "OnboardCoreBindingError";
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OnboardCoreBindingError("INVALID_L2_BINDING", `${field} must be an object.`, 409);
  }
  return value as Record<string, unknown>;
}

function exact(input: Record<string, unknown>, keys: readonly string[], field: string) {
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new OnboardCoreBindingError("INVALID_L2_BINDING", `${field} must contain exactly: ${expected.join(", ")}.`, 409);
  }
  return input;
}

function matched(value: unknown, expression: RegExp, field: string) {
  if (typeof value !== "string" || !expression.test(value)) {
    throw new OnboardCoreBindingError("INVALID_L2_BINDING", `${field} is invalid.`, 409);
  }
  return value;
}

export function parseTenantPackSourceBinding(value: unknown): TenantPackSourceBindingV1 {
  const input = exact(object(value, "sourceBinding"), [
    "consumerEvidenceSha", "consumerImplementationSha", "consumerRepository", "contractVersion",
    "evidenceDigest", "evidencePath", "mapperDigest", "mapperPath", "sourceSchemaDigest", "sourceSchemaPath",
  ], "sourceBinding");
  if (input.contractVersion !== TENANT_PACK_SOURCE_BINDING_VERSION) {
    throw new OnboardCoreBindingError("WRONG_SOURCE_BINDING_VERSION", `sourceBinding.contractVersion must be ${TENANT_PACK_SOURCE_BINDING_VERSION}.`, 409);
  }
  if (input.consumerRepository !== TENANT_PACK_SOURCE_REPOSITORY) {
    throw new OnboardCoreBindingError("L2_REPOSITORY_MISMATCH", `consumerRepository must be ${TENANT_PACK_SOURCE_REPOSITORY}.`, 409);
  }
  if (input.sourceSchemaDigest !== TENANT_PACK_DRAFT_SCHEMA_DIGEST) {
    throw new OnboardCoreBindingError("SOURCE_SCHEMA_DIGEST_MISMATCH", "sourceSchemaDigest does not bind the admitted Tenant Pack schema bytes.", 409);
  }
  if (input.sourceSchemaPath !== TENANT_PACK_DRAFT_SCHEMA_PATH) {
    throw new OnboardCoreBindingError("SOURCE_SCHEMA_PATH_MISMATCH", `sourceSchemaPath must be ${TENANT_PACK_DRAFT_SCHEMA_PATH}.`, 409);
  }
  return {
    consumerEvidenceSha: matched(input.consumerEvidenceSha, SHA, "sourceBinding.consumerEvidenceSha"),
    consumerImplementationSha: matched(input.consumerImplementationSha, SHA, "sourceBinding.consumerImplementationSha"),
    consumerRepository: TENANT_PACK_SOURCE_REPOSITORY,
    contractVersion: TENANT_PACK_SOURCE_BINDING_VERSION,
    evidenceDigest: matched(input.evidenceDigest, DIGEST, "sourceBinding.evidenceDigest"),
    evidencePath: matched(input.evidencePath, PATH, "sourceBinding.evidencePath"),
    mapperDigest: matched(input.mapperDigest, DIGEST, "sourceBinding.mapperDigest"),
    mapperPath: matched(input.mapperPath, PATH, "sourceBinding.mapperPath"),
    sourceSchemaDigest: TENANT_PACK_DRAFT_SCHEMA_DIGEST,
    sourceSchemaPath: TENANT_PACK_DRAFT_SCHEMA_PATH,
  };
}

export function tenantPackSourceBindingDigest(binding: TenantPackSourceBindingV1) {
  return sha256(binding);
}

function parseAdmission(value: unknown): AdmittedTenantPackSourceBinding {
  const input = exact(object(value, "admittedBinding"), [
    "consumerEvidenceSha", "consumerImplementationSha", "consumerRepository", "contractVersion",
    "evidenceDigest", "evidencePath", "mapperDigest", "mapperPath", "sourcePackId", "sourcePackVersion",
    "sourceSchemaDigest", "sourceSchemaPath", "tenantId",
  ], "admittedBinding");
  const binding = parseTenantPackSourceBinding({
    consumerEvidenceSha: input.consumerEvidenceSha,
    consumerImplementationSha: input.consumerImplementationSha,
    consumerRepository: input.consumerRepository,
    contractVersion: input.contractVersion,
    evidenceDigest: input.evidenceDigest,
    evidencePath: input.evidencePath,
    mapperDigest: input.mapperDigest,
    mapperPath: input.mapperPath,
    sourceSchemaDigest: input.sourceSchemaDigest,
    sourceSchemaPath: input.sourceSchemaPath,
  });
  return {
    ...binding,
    sourcePackId: matched(input.sourcePackId, ID, "admittedBinding.sourcePackId"),
    sourcePackVersion: matched(input.sourcePackVersion, ID, "admittedBinding.sourcePackVersion"),
    tenantId: matched(input.tenantId, ID, "admittedBinding.tenantId"),
  };
}

export function configuredTenantPackSourceBindings(): readonly AdmittedTenantPackSourceBinding[] {
  const raw = process.env.LUZIONE_API_ONBOARDING_L2_BINDINGS?.trim() ?? "";
  if (!raw) return [];
  if (raw.length > 65_536) throw new OnboardCoreBindingError("L2_BINDING_CONFIG_INVALID", "L2 binding configuration exceeds its safe bound.", 503);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 100) throw new Error("not a bounded array");
    return Object.freeze(parsed.map(parseAdmission));
  } catch (error) {
    if (error instanceof OnboardCoreBindingError) throw error;
    throw new OnboardCoreBindingError("L2_BINDING_CONFIG_INVALID", "L2 binding configuration is unavailable or malformed.", 503);
  }
}

export function assertTenantPackSourceBindingAdmitted(input: {
  binding: TenantPackSourceBindingV1;
  sourcePackId: string;
  sourcePackVersion: string;
  tenantId: string;
}, admitted: readonly AdmittedTenantPackSourceBinding[] = configuredTenantPackSourceBindings()) {
  const expected = admitted.find((candidate) => candidate.tenantId === input.tenantId
    && candidate.sourcePackId === input.sourcePackId
    && candidate.sourcePackVersion === input.sourcePackVersion);
  if (!expected) {
    throw new OnboardCoreBindingError("L2_BINDING_UNADMITTED", "No exact L2 mapper/evidence binding is admitted for this tenant and source pack version.", 403);
  }
  const expectedBinding: TenantPackSourceBindingV1 = {
    consumerEvidenceSha: expected.consumerEvidenceSha,
    consumerImplementationSha: expected.consumerImplementationSha,
    consumerRepository: expected.consumerRepository,
    contractVersion: expected.contractVersion,
    evidenceDigest: expected.evidenceDigest,
    evidencePath: expected.evidencePath,
    mapperDigest: expected.mapperDigest,
    mapperPath: expected.mapperPath,
    sourceSchemaDigest: expected.sourceSchemaDigest,
    sourceSchemaPath: expected.sourceSchemaPath,
  };
  if (canonicalJson(expectedBinding) !== canonicalJson(input.binding)) {
    throw new OnboardCoreBindingError("L2_BINDING_MISMATCH", "The L2 implementation, schema, mapper or evidence binding differs from the admitted exact record.", 409);
  }
  return Object.freeze({ binding: expectedBinding, digest: tenantPackSourceBindingDigest(expectedBinding) });
}
