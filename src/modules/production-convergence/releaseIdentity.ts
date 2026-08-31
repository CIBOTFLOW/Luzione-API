export const RELEASE_IDENTITY_CONTRACT_VERSION = "luzione-release-identity/v0.1";
export const API_CONTRACT_RELEASE_VERSION = "luzione-api-contract/v0.1";

export const API_CONTRACT_RELEASE_COMPONENTS = Object.freeze([
  "api-http-response/1.0",
  "luzione-request-identity/v1",
  "luzione-table-object-registry/v1",
  "luzione-platform-failure/v1",
  "luzione-readiness-evidence/v1",
  "luzione-release-identity/v0.1",
  "luzione-receipt-reference/v0.1",
]);

export const API_SCHEMA_VERSIONS = Object.freeze([
  "20260828210000_tenant_ai_governance_and_workflow_packs",
  "20260828213000_workflow_pack_foreign_key_indexes",
]);

const SHA = /^[a-f0-9]{40}$/;

export type ReleaseIdentity = {
  buildTime: string | null;
  contractComponents: readonly string[];
  contractVersion: typeof RELEASE_IDENTITY_CONTRACT_VERSION;
  deploymentId: string | null;
  deploymentUrl: string | null;
  environment: "development" | "local" | "preview" | "production";
  evidenceState: "DEPLOYED_INCOMPLETE" | "EXACT_RELEASE_BOUND" | "LOCAL_UNBOUND";
  exactSha: string | null;
  mutations: "DISABLED_FAIL_CLOSED" | "ENABLED_BY_EXPLICIT_RUNTIME_POLICY";
  releaseContractVersion: typeof API_CONTRACT_RELEASE_VERSION;
  repository: "CIBOTFLOW/Luzione-API";
  schemaVersions: readonly string[];
  service: "luzione-api";
};

type ReleaseEnvironment = Readonly<Record<string, string | undefined>>;

function isoOrNull(value: string | undefined) {
  if (!value?.trim() || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function bounded(value: string | undefined, max = 500) {
  const normalized = value?.trim() ?? "";
  return normalized && normalized.length <= max ? normalized : null;
}

function releaseEnvironment(environment: ReleaseEnvironment): ReleaseIdentity["environment"] {
  if (environment.VERCEL_ENV === "production" || environment.APP_ENV === "production") return "production";
  if (environment.VERCEL_ENV === "preview" || environment.APP_ENV === "staging") return "preview";
  if (environment.VERCEL_ENV === "development") return "development";
  return "local";
}

export function createReleaseIdentity(input: {
  environment?: ReleaseEnvironment;
  mutationsEnabled: boolean;
}): ReleaseIdentity {
  const environment = input.environment ?? process.env;
  const runtimeEnvironment = releaseEnvironment(environment);
  const exactShaCandidate = bounded(environment.VERCEL_GIT_COMMIT_SHA, 40);
  const exactSha = exactShaCandidate && SHA.test(exactShaCandidate) ? exactShaCandidate : null;
  const buildTime = isoOrNull(environment.LUZIONE_BUILD_TIME);
  const deploymentId = bounded(environment.VERCEL_DEPLOYMENT_ID);
  const deploymentHost = bounded(environment.VERCEL_URL);
  const deploymentUrl = deploymentHost ? `https://${deploymentHost.replace(/^https?:\/\//, "")}` : null;
  const deployed = runtimeEnvironment === "preview" || runtimeEnvironment === "production";
  const evidenceState = exactSha && buildTime && (!deployed || deploymentId || deploymentUrl)
    ? "EXACT_RELEASE_BOUND" as const
    : deployed
      ? "DEPLOYED_INCOMPLETE" as const
      : "LOCAL_UNBOUND" as const;

  return {
    buildTime,
    contractComponents: API_CONTRACT_RELEASE_COMPONENTS,
    contractVersion: RELEASE_IDENTITY_CONTRACT_VERSION,
    deploymentId,
    deploymentUrl,
    environment: runtimeEnvironment,
    evidenceState,
    exactSha,
    mutations: input.mutationsEnabled
      ? "ENABLED_BY_EXPLICIT_RUNTIME_POLICY"
      : "DISABLED_FAIL_CLOSED",
    releaseContractVersion: API_CONTRACT_RELEASE_VERSION,
    repository: "CIBOTFLOW/Luzione-API",
    schemaVersions: API_SCHEMA_VERSIONS,
    service: "luzione-api",
  };
}

export function releaseIdentityViolations(identity: ReleaseIdentity) {
  const violations: string[] = [];
  const deployed = identity.environment === "preview" || identity.environment === "production";
  if (identity.exactSha !== null && !SHA.test(identity.exactSha)) violations.push("invalid-exact-sha");
  if (identity.buildTime !== null && !Number.isFinite(Date.parse(identity.buildTime))) violations.push("invalid-build-time");
  if (new Set(identity.contractComponents).size !== identity.contractComponents.length) violations.push("duplicate-contract-component");
  if (new Set(identity.schemaVersions).size !== identity.schemaVersions.length) violations.push("duplicate-schema-version");
  if (identity.evidenceState === "EXACT_RELEASE_BOUND" && (!identity.exactSha || !identity.buildTime)) {
    violations.push("exact-release-missing-provenance");
  }
  if (deployed && identity.evidenceState === "EXACT_RELEASE_BOUND" && !identity.deploymentId && !identity.deploymentUrl) {
    violations.push("deployed-release-missing-identity");
  }
  if (deployed && !identity.exactSha && identity.evidenceState !== "DEPLOYED_INCOMPLETE") {
    violations.push("unbound-deployment-promoted");
  }
  return violations;
}
