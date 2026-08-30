import assert from "node:assert/strict";
import test from "node:test";
import {
  certifyCrossSystemJourney,
  type JourneyCertificationInput,
  type JourneyEvidence,
  journeyCertificationViolations,
} from "../certification";

const CONTRACTS = ["luzione-request-identity/v1", "luzione-platform-failure/v1"];
const CASES = {
  POSITIVE: ["positive:test"],
  NEGATIVE: ["negative:test"],
  FAILURE: ["failure:test"],
  RECOVERY: ["recovery:test"],
  AUTHORITATIVE_READBACK: ["readback:test"],
} as const;

function evidence(repository: JourneyEvidence["repository"], digit: string): JourneyEvidence {
  return {
    artifactRefs: [`artifact:${repository}`],
    authoredByRepository: repository,
    candidateSha: digit.repeat(40),
    contractVersions: CONTRACTS,
    environment: "local",
    evidenceByCase: CASES,
    evidenceId: `evidence:${repository}`,
    evidenceTier: "LOCAL_PROVEN",
    observedAt: "2026-08-29T23:00:00.000Z",
    repository,
  };
}

function completeInput(): JourneyCertificationInput {
  return {
    evidence: [
      evidence("CIBOTFLOW/Luzione-API", "a"),
      evidence("CIBOTFLOW/Luzione-UI", "b"),
      evidence("CIBOTFLOW/Sultan-OS", "c"),
    ],
    journeyId: "tenant-command-to-authoritative-readback",
    requiredContractVersions: CONTRACTS,
    requiredRepositories: [
      "CIBOTFLOW/Luzione-API",
      "CIBOTFLOW/Luzione-UI",
      "CIBOTFLOW/Sultan-OS",
    ],
  };
}

test("certifies only exact-version evidence authored independently by every required repository", () => {
  const certificate = certifyCrossSystemJourney(completeInput());
  assert.equal(certificate.certificationStatus, "CERTIFIED");
  assert.equal(certificate.strongestEngineeringState, "INTEGRATED_PASS");
  assert.equal(certificate.releaseEvidence, "LOCAL_PROVEN");
  assert.deepEqual(certificate.violations, []);
});

test("producer-only evidence cannot prove consumer integration", () => {
  const input = completeInput();
  const certificate = certifyCrossSystemJourney({ ...input, evidence: input.evidence.slice(0, 1) });
  assert.equal(certificate.certificationStatus, "QUARANTINED");
  assert.ok(certificate.violations.includes("missing-repository-evidence:CIBOTFLOW/Luzione-UI"));
  assert.ok(certificate.violations.includes("missing-repository-evidence:CIBOTFLOW/Sultan-OS"));
});

test("API-authored consumer claims fail independence checks", () => {
  const input = completeInput();
  const impersonatedUi = {
    ...input.evidence[1],
    authoredByRepository: "CIBOTFLOW/Luzione-API" as const,
  };
  const violations = journeyCertificationViolations({
    ...input,
    evidence: [input.evidence[0], impersonatedUi, input.evidence[2]],
  });
  assert.ok(violations.includes("non-independent-evidence:CIBOTFLOW/Luzione-UI"));
});

test("missing negative, recovery, readback or exact contract evidence remains quarantined", () => {
  const input = completeInput();
  const incompleteSultan = {
    ...input.evidence[2],
    contractVersions: [CONTRACTS[0]],
    evidenceByCase: { POSITIVE: ["positive:test"], FAILURE: ["failure:test"] },
  };
  const certificate = certifyCrossSystemJourney({
    ...input,
    evidence: [input.evidence[0], input.evidence[1], incompleteSultan],
  });
  assert.equal(certificate.certificationStatus, "QUARANTINED");
  assert.ok(certificate.violations.some((item) => item.startsWith("missing-contract:CIBOTFLOW/Sultan-OS")));
  assert.ok(certificate.violations.includes("missing-case:CIBOTFLOW/Sultan-OS:NEGATIVE"));
  assert.ok(certificate.violations.includes("missing-case:CIBOTFLOW/Sultan-OS:RECOVERY"));
  assert.ok(certificate.violations.includes("missing-case:CIBOTFLOW/Sultan-OS:AUTHORITATIVE_READBACK"));
});
