import crypto from "node:crypto";

import type { FailureClass } from "@/modules/platform-guarantees/types";

export const EXECUTION_LEASE_MS = 60_000;
export const EXECUTION_HEARTBEAT_MS = 20_000;
export const EXECUTION_RETRY_DELAYS_MS = [2_000, 10_000, 30_000, 120_000, 600_000] as const;
export const EXECUTION_JITTER_RATIO = 0.2;
export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_FAILURE_WINDOW_MS = 60_000;
export const CIRCUIT_HALF_OPEN_MS = 5 * 60_000;

export type DurableRetryDecision =
  | { action: "DEAD_LETTER"; delayMs: null; retryAt: null }
  | { action: "RECONCILE"; delayMs: null; retryAt: null }
  | { action: "RETRY"; delayMs: number; retryAt: string };

function deterministicJitter(key: string, attempt: number) {
  const sample = crypto.createHash("sha256").update(`${key}:${attempt}`).digest().readUInt16BE(0) / 65_535;
  return 1 - EXECUTION_JITTER_RATIO + sample * EXECUTION_JITTER_RATIO * 2;
}

export function durableRetryDecision(input: {
  attempt: number;
  failureClass: FailureClass;
  idempotencyKey: string;
  now: string;
  retryAfterMs?: number | null;
}): DurableRetryDecision {
  if (!Number.isInteger(input.attempt) || input.attempt < 1) throw new Error("attempt must be a positive integer.");
  if (input.failureClass === "AMBIGUOUS_AFTER_ACK") {
    return { action: "RECONCILE", delayMs: null, retryAt: null };
  }
  if (["CONTRACT_VIOLATION", "PERMANENT", "POLICY_BLOCKED"].includes(input.failureClass)) {
    return { action: "DEAD_LETTER", delayMs: null, retryAt: null };
  }
  const baseDelay = EXECUTION_RETRY_DELAYS_MS[input.attempt - 1];
  if (baseDelay === undefined) return { action: "DEAD_LETTER", delayMs: null, retryAt: null };
  const providerDelay = input.failureClass === "RATE_LIMITED" ? Math.max(0, input.retryAfterMs ?? 0) : 0;
  const jitteredDelay = Math.round(baseDelay * deterministicJitter(input.idempotencyKey, input.attempt));
  const delayMs = Math.max(providerDelay, jitteredDelay);
  return {
    action: "RETRY",
    delayMs,
    retryAt: new Date(new Date(input.now).getTime() + delayMs).toISOString(),
  };
}

export function classifyProviderHttpFailure(status: number): FailureClass {
  if (!Number.isInteger(status) || status < 100 || status > 599) return "CONTRACT_VIOLATION";
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return status === 429 ? "RATE_LIMITED" : "TRANSIENT_BEFORE_ACK";
  }
  if (status >= 400) return "PERMANENT";
  return "CONTRACT_VIOLATION";
}

export type CircuitSnapshot = {
  failureWindowStartedAt: string | null;
  halfOpenAt: string | null;
  state: "CLOSED" | "HALF_OPEN" | "OPEN";
  transientFailureCount: number;
};

export function recordTransientCircuitFailure(snapshot: CircuitSnapshot, now: string): CircuitSnapshot {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid timestamp.");
  const windowStartMs = snapshot.failureWindowStartedAt
    ? new Date(snapshot.failureWindowStartedAt).getTime()
    : Number.NaN;
  const withinWindow = Number.isFinite(windowStartMs) && nowMs - windowStartMs <= CIRCUIT_FAILURE_WINDOW_MS;
  const failureWindowStartedAt = withinWindow ? snapshot.failureWindowStartedAt : now;
  const transientFailureCount = Math.min(
    CIRCUIT_FAILURE_THRESHOLD,
    withinWindow ? snapshot.transientFailureCount + 1 : 1,
  );
  if (transientFailureCount < CIRCUIT_FAILURE_THRESHOLD) {
    return { failureWindowStartedAt, halfOpenAt: null, state: "CLOSED", transientFailureCount };
  }
  return {
    failureWindowStartedAt,
    halfOpenAt: new Date(nowMs + CIRCUIT_HALF_OPEN_MS).toISOString(),
    state: "OPEN",
    transientFailureCount,
  };
}

export function circuitAdmission(snapshot: CircuitSnapshot, now: string) {
  if (snapshot.state === "CLOSED") return { allowed: true, nextState: "CLOSED" as const };
  const halfOpenAt = snapshot.halfOpenAt ? new Date(snapshot.halfOpenAt).getTime() : Number.POSITIVE_INFINITY;
  if (new Date(now).getTime() >= halfOpenAt) return { allowed: true, nextState: "HALF_OPEN" as const };
  return { allowed: false, nextState: "OPEN" as const };
}
