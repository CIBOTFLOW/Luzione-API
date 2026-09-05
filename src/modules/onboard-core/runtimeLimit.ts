import { OnboardCoreContractError } from "./contracts";

export type JobRuntimeEvidence = {
  deadlineAt: string;
  elapsedMs: number;
  maxRuntimeMinutes: number;
  measuredBy: "server-monotonic-clock";
};

export function runtimeDeadline(startedAt: string, maxRuntimeMinutes: number) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || !Number.isSafeInteger(maxRuntimeMinutes) || maxRuntimeMinutes < 1 || maxRuntimeMinutes > 1_440) {
    throw new OnboardCoreContractError("MANDATE_RUNTIME_INVALID", "Setup Mandate runtime authority is invalid.", 403);
  }
  return new Date(start + maxRuntimeMinutes * 60_000).toISOString();
}

export function assertRuntimeWithinMandate(input: {
  elapsedMs: number;
  maxRuntimeMinutes: number;
  startedAt: string;
}): JobRuntimeEvidence {
  const allowedMs = input.maxRuntimeMinutes * 60_000;
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < 0 || input.elapsedMs >= allowedMs) {
    throw new OnboardCoreContractError("MANDATE_RUNTIME_EXCEEDED", "The API-owned job exceeded the Setup Mandate runtime limit and was rolled back atomically.", 409);
  }
  return {
    deadlineAt: runtimeDeadline(input.startedAt, input.maxRuntimeMinutes),
    elapsedMs: Math.ceil(input.elapsedMs),
    maxRuntimeMinutes: input.maxRuntimeMinutes,
    measuredBy: "server-monotonic-clock",
  };
}
