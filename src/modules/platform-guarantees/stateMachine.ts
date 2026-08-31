import type { FlowCommandType, FlowSnapshot, WorkflowState } from "./types";

const transitions: Record<WorkflowState, Partial<Record<FlowCommandType, WorkflowState>>> = {
  PLANNED: { START_FLOW: "RUNNING", CANCEL_FUTURE_WORK: "CANCELLED", SUPERSEDE_FLOW: "SUPERSEDED" },
  RUNNING: {
    PAUSE_FOR_FACT: "WAITING_FOR_FACT",
    PAUSE_FOR_HUMAN: "WAITING_FOR_HUMAN",
    ACKNOWLEDGE_PROVIDER: "WAITING_FOR_PROVIDER",
    CONFIRM_SOURCE_READBACK: "COMPLETED",
    FAIL_CURRENT_STEP: "FAILED",
    CANCEL_FUTURE_WORK: "CANCELLED",
    SUPERSEDE_FLOW: "SUPERSEDED",
  },
  WAITING_FOR_FACT: { RESUME_FLOW: "RESUMING", CANCEL_FUTURE_WORK: "CANCELLED", SUPERSEDE_FLOW: "SUPERSEDED" },
  WAITING_FOR_HUMAN: { RESUME_FLOW: "RESUMING", CANCEL_FUTURE_WORK: "CANCELLED", SUPERSEDE_FLOW: "SUPERSEDED" },
  WAITING_FOR_PROVIDER: {
    CONFIRM_SOURCE_READBACK: "COMPLETED",
    RECONCILE_SOURCE: "RESUMING",
    FAIL_CURRENT_STEP: "FAILED",
    CANCEL_FUTURE_WORK: "CANCELLED",
    SUPERSEDE_FLOW: "SUPERSEDED",
  },
  RESUMING: { RETRY_SAFE_STEP: "RUNNING", RECONCILE_SOURCE: "RUNNING", FAIL_CURRENT_STEP: "FAILED", CANCEL_FUTURE_WORK: "CANCELLED" },
  COMPENSATING: { CONFIRM_SOURCE_READBACK: "COMPLETED", FAIL_CURRENT_STEP: "FAILED", QUARANTINE_FLOW: "QUARANTINED" },
  COMPLETED: { SUPERSEDE_FLOW: "SUPERSEDED" },
  FAILED: { RETRY_SAFE_STEP: "RESUMING", RECONCILE_SOURCE: "RESUMING", QUARANTINE_FLOW: "QUARANTINED", SUPERSEDE_FLOW: "SUPERSEDED" },
  CANCELLED: { RECONCILE_SOURCE: "RESUMING", SUPERSEDE_FLOW: "SUPERSEDED" },
  SUPERSEDED: {},
  QUARANTINED: { RECONCILE_SOURCE: "RESUMING", RESUME_FLOW: "RESUMING", SUPERSEDE_FLOW: "SUPERSEDED" },
};

export function allowedCommandsFor(snapshot: FlowSnapshot) {
  return Object.keys(transitions[snapshot.state]) as FlowCommandType[];
}

export function nextWorkflowState(input: {
  commandType: FlowCommandType;
  currentState: WorkflowState;
  killSwitchActive: boolean;
}) {
  if (input.killSwitchActive && !["CANCEL_FUTURE_WORK", "QUARANTINE_FLOW", "RECONCILE_SOURCE", "SUPERSEDE_FLOW"].includes(input.commandType)) {
    throw new Error("Kill switch blocks this workflow command.");
  }
  const nextState = transitions[input.currentState][input.commandType];
  if (!nextState) throw new Error(`${input.commandType} is not allowed from ${input.currentState}.`);
  return nextState;
}

export function transitionFlow(input: {
  commandType: FlowCommandType;
  expectedStateVersion: number;
  now: string;
  snapshot: FlowSnapshot;
}): FlowSnapshot {
  if (input.expectedStateVersion !== input.snapshot.stateVersion) {
    throw new Error(`Stale flow version: expected ${input.snapshot.stateVersion}, received ${input.expectedStateVersion}.`);
  }
  const nextState = nextWorkflowState({
    commandType: input.commandType,
    currentState: input.snapshot.state,
    killSwitchActive: input.snapshot.killSwitchActive,
  });
  return {
    ...input.snapshot,
    lastTransitionAt: new Date(input.now).toISOString(),
    state: nextState,
    stateVersion: input.snapshot.stateVersion + 1,
  };
}
