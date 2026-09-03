import {
  SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION,
  type Stage5Pins,
} from "./contracts";

const GIT_SHA = /^[a-f0-9]{40}$/;

export function stage5Pins(environment: Readonly<Record<string, string | undefined>> = process.env): Stage5Pins {
  return Object.freeze({
    apiDeploymentSha: exactSha(environment.VERCEL_GIT_COMMIT_SHA, "VERCEL_GIT_COMMIT_SHA"),
    maximumEvidenceAgeMs: boundedPositiveInteger(environment.SULTAN_STAGE5_MAX_EVIDENCE_AGE_MS, 5 * 60_000, 1_000, 60 * 60_000),
    participationContractSha: exactSha(environment.SULTAN_STAGE5_PARTICIPATION_CONTRACT_SHA, "SULTAN_STAGE5_PARTICIPATION_CONTRACT_SHA"),
    participationContractVersion: SULTAN_STAGE5_PARTICIPATION_CONTRACT_VERSION,
    sultanDeploymentSha: exactSha(environment.SULTAN_STAGE5_DEPLOYMENT_SHA, "SULTAN_STAGE5_DEPLOYMENT_SHA"),
    uiDeploymentSha: exactSha(environment.LUZIONE_UI_DEPLOYMENT_SHA, "LUZIONE_UI_DEPLOYMENT_SHA"),
  });
}

function exactSha(value: string | undefined, field: string) {
  const normalized = value?.trim() ?? "";
  if (!GIT_SHA.test(normalized)) throw new Error(`${field} must contain an exact 40-character Git SHA.`);
  return normalized;
}

function boundedPositiveInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("SULTAN_STAGE5_MAX_EVIDENCE_AGE_MS is outside the safe bounded range.");
  }
  return parsed;
}
