import crypto from "node:crypto";
import type { FailureClass, RetryDecision, RetryPolicy } from "./types";

export const defaultRetryPolicy: RetryPolicy = {
  backoffCoefficient: 2,
  baseDelayMs: 1_000,
  maxAttempts: 5,
  maxDelayMs: 15 * 60_000,
};

function deterministicJitter(key: string, attempt: number) {
  const byte = crypto.createHash("sha256").update(`${key}:${attempt}`).digest()[0];
  return 0.5 + byte / 510;
}

export function decideRetry(input: {
  attempt: number;
  failureClass: FailureClass;
  idempotencyKey: string;
  killSwitchActive: boolean;
  now: string;
  policy?: RetryPolicy;
  retryAfterMs?: number | null;
}): RetryDecision {
  const policy = input.policy ?? defaultRetryPolicy;
  if (!Number.isInteger(input.attempt) || input.attempt < 1) throw new Error("attempt must be a positive integer.");
  if (input.killSwitchActive) {
    return { action: "BLOCK", attempt: input.attempt, delayMs: null, reason: "Kill switch is active; no new delivery may start.", retryAt: null };
  }
  if (input.failureClass === "AMBIGUOUS_AFTER_ACK") {
    return { action: "RECONCILE", attempt: input.attempt, delayMs: null, reason: "Provider may have accepted the request; source readback must run before any retry.", retryAt: null };
  }
  if (["CONTRACT_VIOLATION", "PERMANENT", "POLICY_BLOCKED"].includes(input.failureClass)) {
    return { action: "DEAD_LETTER", attempt: input.attempt, delayMs: null, reason: "Failure is not safe to retry automatically.", retryAt: null };
  }
  if (input.attempt >= policy.maxAttempts) {
    return { action: "DEAD_LETTER", attempt: input.attempt, delayMs: null, reason: `Retry budget of ${policy.maxAttempts} attempts is exhausted.`, retryAt: null };
  }

  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * policy.backoffCoefficient ** Math.max(0, input.attempt - 1),
  );
  const serverDelay = input.failureClass === "RATE_LIMITED" ? Math.max(0, input.retryAfterMs ?? 0) : 0;
  const delayMs = Math.min(policy.maxDelayMs, Math.max(serverDelay, Math.round(exponential * deterministicJitter(input.idempotencyKey, input.attempt))));
  const retryAt = new Date(new Date(input.now).getTime() + delayMs).toISOString();
  return {
    action: "RETRY",
    attempt: input.attempt,
    delayMs,
    reason: input.failureClass === "RATE_LIMITED" ? "Provider rate limit is retryable after the bounded delay." : "Failure occurred before acknowledgement and is safe to retry with the same idempotency key.",
    retryAt,
  };
}
