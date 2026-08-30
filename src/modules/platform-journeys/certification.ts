export const CROSS_SYSTEM_JOURNEY_CERTIFICATION_VERSION = "luzione-cross-system-journey-certification/v1";

export const journeyEvidenceCases = [
  "POSITIVE",
  "NEGATIVE",
  "FAILURE",
  "RECOVERY",
  "AUTHORITATIVE_READBACK",
] as const;

export type JourneyEvidenceCase = (typeof journeyEvidenceCases)[number];
export type JourneyRepository =
  | "CIBOTFLOW/Luzione-API"
  | "CIBOTFLOW/Luzione-UI"
  | "CIBOTFLOW/Sultan-OS";
export type JourneyEvidenceTier = "LOCAL_PROVEN" | "PREVIEW_PROVEN" | "PRODUCTION_OBSERVED";

export type JourneyEvidence = {
  artifactRefs: readonly string[];
  authoredByRepository: JourneyRepository;
  candidateSha: string;
  contractVersions: readonly string[];
  environment: "local" | "preview" | "production";
  evidenceByCase: Readonly<Partial<Record<JourneyEvidenceCase, readonly string[]>>>;
  evidenceId: string;
  evidenceTier: JourneyEvidenceTier;
  observedAt: string;
  repository: JourneyRepository;
};

export type JourneyCertificationInput = {
  evidence: readonly JourneyEvidence[];
  journeyId: string;
  requiredContractVersions: readonly string[];
  requiredRepositories: readonly JourneyRepository[];
};

const EVIDENCE_TIER_ORDER: Record<JourneyEvidenceTier, number> = {
  LOCAL_PROVEN: 0,
  PREVIEW_PROVEN: 1,
  PRODUCTION_OBSERVED: 2,
};

const SHA_PATTERN = /^[a-f0-9]{40}$/;

export const crossSystemJourneyCertificationLaw = Object.freeze({
  apiProducerEvidenceProvesConsumerIntegration: false,
  contractVersion: CROSS_SYSTEM_JOURNEY_CERTIFICATION_VERSION,
  evidenceCases: journeyEvidenceCases,
  exactCandidateShaRequired: true,
  independentRepositoriesRequired: [
    "CIBOTFLOW/Luzione-API",
    "CIBOTFLOW/Luzione-UI",
    "CIBOTFLOW/Sultan-OS",
  ] as const,
  providerAcknowledgementIsAuthoritativeReadback: false,
  unsupportedFinality: "QUARANTINED" as const,
});

export function journeyCertificationViolations(input: JourneyCertificationInput) {
  const violations: string[] = [];
  if (!input.journeyId.trim()) violations.push("missing-journey-id");
  if (new Set(input.requiredRepositories).size !== input.requiredRepositories.length) {
    violations.push("duplicate-required-repository");
  }
  if (new Set(input.requiredContractVersions).size !== input.requiredContractVersions.length) {
    violations.push("duplicate-required-contract-version");
  }

  const evidenceIds = new Set<string>();
  const evidenceRepositories = new Set<JourneyRepository>();
  for (const item of input.evidence) {
    if (evidenceIds.has(item.evidenceId)) violations.push(`duplicate-evidence:${item.evidenceId}`);
    evidenceIds.add(item.evidenceId);
    if (evidenceRepositories.has(item.repository)) violations.push(`duplicate-repository-evidence:${item.repository}`);
    evidenceRepositories.add(item.repository);
    if (item.authoredByRepository !== item.repository) {
      violations.push(`non-independent-evidence:${item.repository}`);
    }
    if (!SHA_PATTERN.test(item.candidateSha)) violations.push(`invalid-candidate-sha:${item.repository}`);
    if (!Number.isFinite(new Date(item.observedAt).getTime())) violations.push(`invalid-observed-at:${item.repository}`);
    if (item.artifactRefs.length === 0 || item.artifactRefs.some((ref) => !ref.trim())) {
      violations.push(`missing-artifact-ref:${item.repository}`);
    }
    if (item.evidenceTier === "PREVIEW_PROVEN" && item.environment !== "preview") {
      violations.push(`preview-environment-mismatch:${item.repository}`);
    }
    if (item.evidenceTier === "PRODUCTION_OBSERVED" && item.environment !== "production") {
      violations.push(`production-environment-mismatch:${item.repository}`);
    }
    for (const contractVersion of input.requiredContractVersions) {
      if (!item.contractVersions.includes(contractVersion)) {
        violations.push(`missing-contract:${item.repository}:${contractVersion}`);
      }
    }
    for (const evidenceCase of journeyEvidenceCases) {
      const refs = item.evidenceByCase[evidenceCase];
      if (!refs?.length || refs.some((ref) => !ref.trim())) {
        violations.push(`missing-case:${item.repository}:${evidenceCase}`);
      }
    }
  }

  for (const repository of input.requiredRepositories) {
    if (!evidenceRepositories.has(repository)) violations.push(`missing-repository-evidence:${repository}`);
  }
  return violations;
}

export function certifyCrossSystemJourney(input: JourneyCertificationInput) {
  const violations = journeyCertificationViolations(input);
  const weakestEvidenceTier = input.evidence.length === 0
    ? null
    : input.evidence.reduce(
      (weakest, item) => EVIDENCE_TIER_ORDER[item.evidenceTier] < EVIDENCE_TIER_ORDER[weakest]
        ? item.evidenceTier
        : weakest,
      input.evidence[0].evidenceTier,
    );
  return {
    candidateVersions: input.evidence.map((item) => ({
      exactSha: item.candidateSha,
      repository: item.repository,
    })),
    certificationStatus: violations.length === 0 ? "CERTIFIED" as const : "QUARANTINED" as const,
    contractVersion: CROSS_SYSTEM_JOURNEY_CERTIFICATION_VERSION,
    journeyId: input.journeyId,
    releaseEvidence: violations.length === 0 ? weakestEvidenceTier : null,
    strongestEngineeringState: violations.length === 0 ? "INTEGRATED_PASS" as const : "CONTRACT_STABLE" as const,
    violations,
  };
}
