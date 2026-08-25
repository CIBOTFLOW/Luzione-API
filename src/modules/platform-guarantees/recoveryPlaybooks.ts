import type { FailureClass, FlowSnapshot, RecoveryPlaybook } from "./types";

export const recoveryPlaybooks: Record<string, RecoveryPlaybook> = {
  "p110.timeout-after-ack": {
    description: "Prevent duplicate external work when transport failed after possible provider acceptance.",
    playbookId: "p110.timeout-after-ack",
    title: "Reconcile an ambiguous provider acknowledgement",
    steps: [
      { instruction: "Freeze dispatch for this command and preserve the original idempotency key.", kind: "CONTAIN", owner: "integration spine", safeCommand: null },
      { instruction: "Read the provider/source by external reference or idempotency key.", kind: "DIAGNOSE", owner: "provider adapter", safeCommand: "RECONCILE_SOURCE" },
      { instruction: "Link the accepted provider object or prove absence before retrying.", kind: "VERIFY", owner: "source owner", safeCommand: "CONFIRM_SOURCE_READBACK" },
      { instruction: "Resume only from the persisted checkpoint after readback.", kind: "RECOVER", owner: "workflow owner", safeCommand: "RESUME_FLOW" },
    ],
  },
  "p110.outbox-stuck": {
    description: "Recover dispatchable work that is committed but older than its delivery objective.",
    playbookId: "p110.outbox-stuck",
    title: "Recover a stuck outbox message",
    steps: [
      { instruction: "Confirm the command receipt and outbox row committed atomically.", kind: "DETECT", owner: "integration spine", safeCommand: null },
      { instruction: "Check the kill switch, lease expiry, adapter health, and retry budget.", kind: "DIAGNOSE", owner: "platform operator", safeCommand: null },
      { instruction: "Retry the same message and idempotency key only when acknowledgement is absent.", kind: "RECOVER", owner: "integration spine", safeCommand: "RETRY_SAFE_STEP" },
      { instruction: "Verify one delivery receipt and an unchanged domain version.", kind: "VERIFY", owner: "source owner", safeCommand: null },
    ],
  },
  "p110.poison-message": {
    description: "Contain contract-invalid work without blocking healthy neighbors.",
    playbookId: "p110.poison-message",
    title: "Repair or quarantine a poison message",
    steps: [
      { instruction: "Move the message to a tenant-scoped dead letter and release its worker lease.", kind: "CONTAIN", owner: "integration spine", safeCommand: null },
      { instruction: "Compare the payload hash and schema version with the accepted contract.", kind: "DIAGNOSE", owner: "contract owner", safeCommand: null },
      { instruction: "Append a corrected command; never edit the rejected payload in place.", kind: "RECOVER", owner: "domain operator", safeCommand: "SUPERSEDE_FLOW" },
      { instruction: "Prove unrelated tenant and workflow work continued.", kind: "VERIFY", owner: "platform operator", safeCommand: null },
    ],
  },
  "p111.stale-checkpoint": {
    description: "Reject stale callbacks and resume only against current owner versions.",
    playbookId: "p111.stale-checkpoint",
    title: "Supersede a stale workflow checkpoint",
    steps: [
      { instruction: "Record the stale signal without advancing the current workflow.", kind: "CONTAIN", owner: "workflow owner", safeCommand: null },
      { instruction: "Read current source versions and identify the superseding checkpoint.", kind: "DIAGNOSE", owner: "domain owner", safeCommand: "RECONCILE_SOURCE" },
      { instruction: "Start or resume the current workflow version with exact source references.", kind: "RECOVER", owner: "workflow owner", safeCommand: "RESUME_FLOW" },
      { instruction: "Verify the stale callback produced no domain or provider effect.", kind: "VERIFY", owner: "platform operator", safeCommand: null },
    ],
  },
  "p111.operator-repair": {
    description: "Make an unexplained failed flow safe, visible, and recoverable.",
    playbookId: "p111.operator-repair",
    title: "Repair a failed workflow",
    steps: [
      { instruction: "Stop new effects for the flow while preserving history and neighbor progress.", kind: "CONTAIN", owner: "platform operator", safeCommand: "QUARANTINE_FLOW" },
      { instruction: "Inspect the last durable checkpoint, attempt, correlated event, and source readback posture.", kind: "DIAGNOSE", owner: "workflow owner", safeCommand: null },
      { instruction: "Choose safe retry, reconciliation, compensation intent, or supersession.", kind: "RECOVER", owner: "platform operator", safeCommand: "RESUME_FLOW" },
      { instruction: "Verify the source owner, event lineage, and flow explanation agree.", kind: "VERIFY", owner: "platform operator", safeCommand: null },
    ],
  },
};

export function selectRecoveryPlaybook(snapshot: FlowSnapshot, failureClass?: FailureClass | null) {
  if (failureClass === "AMBIGUOUS_AFTER_ACK") return recoveryPlaybooks["p110.timeout-after-ack"];
  if (["CONTRACT_VIOLATION", "PERMANENT", "POLICY_BLOCKED"].includes(failureClass ?? "")) return recoveryPlaybooks["p110.poison-message"];
  if (["RATE_LIMITED", "TRANSIENT_BEFORE_ACK"].includes(failureClass ?? "")) return recoveryPlaybooks["p110.outbox-stuck"];
  if (snapshot.state === "SUPERSEDED") return recoveryPlaybooks["p111.stale-checkpoint"];
  if (snapshot.state === "FAILED" || snapshot.state === "QUARANTINED") return recoveryPlaybooks["p111.operator-repair"];
  if (snapshot.state === "WAITING_FOR_PROVIDER" && snapshot.outboxMessageId) return recoveryPlaybooks["p110.outbox-stuck"];
  return null;
}
