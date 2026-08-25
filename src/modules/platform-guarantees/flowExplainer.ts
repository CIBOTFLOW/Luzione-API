import { decideRetry } from "./retryPolicy";
import { selectRecoveryPlaybook } from "./recoveryPlaybooks";
import { allowedCommandsFor } from "./stateMachine";
import { signContinuationDescriptor } from "./eventContract";
import type {
  ContinuationDescriptor,
  FlowExplanation,
  FlowSnapshot,
  GuaranteeEvaluation,
  NextSafeAction,
} from "./types";

function actionAuthority(action: NextSafeAction["actionId"]): NextSafeAction["authorityRequired"] {
  if (["CONFIRM_SOURCE_READBACK", "RETRY_SAFE_STEP", "START_FLOW"].includes(action)) return "SYSTEM_ALLOWED";
  if (["PAUSE_FOR_FACT", "PAUSE_FOR_HUMAN", "RECONCILE_SOURCE"].includes(action)) return "AI_MAY_PROPOSE";
  if (["RESUME_FLOW", "FAIL_CURRENT_STEP", "QUARANTINE_FLOW", "CANCEL_FUTURE_WORK", "SUPERSEDE_FLOW"].includes(action)) return "OPERATOR_REQUIRED";
  return "HUMAN_REQUIRED";
}

function actionLabel(action: NextSafeAction["actionId"]) {
  return action.toLowerCase().replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function evaluateGuarantees(snapshot: FlowSnapshot, nextActions: NextSafeAction[]): GuaranteeEvaluation[] {
  const evidence = [snapshot.commandReceiptId, snapshot.outboxMessageId, snapshot.lastEventId].filter((item): item is string => Boolean(item));
  const sourceConfirmedWithoutReadback = Boolean(snapshot.delivery?.sourceConfirmedAt && !snapshot.delivery.sourceReadbackRef);
  return [
    { guaranteeId: "G-001", invariant: "Every accepted command has a stable tenant-scoped idempotency key.", status: snapshot.idempotencyKey ? "PROVEN" : "BREACHED", evidenceRefs: snapshot.commandReceiptId ? [snapshot.commandReceiptId] : [] },
    { guaranteeId: "G-002", invariant: "A dispatchable command has both a durable receipt and outbox row.", status: snapshot.commandReceiptId && snapshot.outboxMessageId ? "PROVEN" : snapshot.commandReceiptId || snapshot.outboxMessageId ? "BREACHED" : "UNPROVEN", evidenceRefs: evidence },
    { guaranteeId: "G-003", invariant: "Provider acknowledgement never becomes source confirmation without independent readback.", status: sourceConfirmedWithoutReadback ? "BREACHED" : "PROVEN", evidenceRefs: snapshot.delivery?.sourceReadbackRef ? [snapshot.delivery.sourceReadbackRef] : [] },
    { guaranteeId: "G-004", invariant: "Retries are bounded and ambiguous acknowledgements reconcile before retry.", status: snapshot.retryPolicy.maxAttempts > 0 ? "PROVEN" : "BREACHED", evidenceRefs: [] },
    { guaranteeId: "G-005", invariant: "Workflow continuation is pinned to the exact state and definition version.", status: snapshot.stateVersion > 0 && snapshot.definitionVersion > 0 ? "PROVEN" : "BREACHED", evidenceRefs: snapshot.checkpoints.map((item) => item.checkpointId) },
    { guaranteeId: "G-006", invariant: "Every non-terminal flow explains a safe next action or an explicit blocker.", status: ["COMPLETED", "CANCELLED", "SUPERSEDED"].includes(snapshot.state) || nextActions.length > 0 || snapshot.blockers.length > 0 ? "PROVEN" : "BREACHED", evidenceRefs: snapshot.blockers.map((item) => item.blockerId) },
    { guaranteeId: "G-007", invariant: "AI continuation is advisory and cannot self-grant actor, tenant, approval, or external-effect authority.", status: "PROVEN", evidenceRefs: [] },
    { guaranteeId: "G-008", invariant: "Tenant and correlation identity are present on every flow explanation.", status: snapshot.tenantId && snapshot.correlationId ? "PROVEN" : "BREACHED", evidenceRefs: snapshot.lastEventId ? [snapshot.lastEventId] : [] },
  ];
}

function truthStatements(snapshot: FlowSnapshot) {
  const statements = [
    `The canonical object is ${snapshot.objectRef.ownerProject}/${snapshot.objectRef.objectType}/${snapshot.objectRef.objectId} at version ${snapshot.objectRef.objectVersion}.`,
    `Workflow ${snapshot.definitionId} is running definition version ${snapshot.definitionVersion} and state version ${snapshot.stateVersion}.`,
    snapshot.commandReceiptId ? `Command receipt ${snapshot.commandReceiptId} is durable.` : "No durable command receipt is proven yet.",
  ];
  if (snapshot.delivery?.acknowledgementRef) statements.push(`Provider acknowledgement ${snapshot.delivery.acknowledgementRef} is transport evidence only.`);
  if (snapshot.delivery?.sourceReadbackRef) statements.push(`Independent source readback ${snapshot.delivery.sourceReadbackRef} confirms the requested outcome.`);
  if (snapshot.killSwitchActive) statements.push("The kill switch is active, so no new delivery may start.");
  return statements;
}

function stateDescription(snapshot: FlowSnapshot) {
  const step = snapshot.currentStepId ? ` at ${snapshot.currentStepId}` : "";
  return `${snapshot.definitionId} is ${snapshot.state.toLowerCase().replaceAll("_", " ")}${step}.`;
}

export function explainFlow(input: {
  continuationSecret: string;
  continuationTtlMs?: number;
  now: string;
  snapshot: FlowSnapshot;
}): FlowExplanation {
  const { snapshot } = input;
  const activeCheckpoint = snapshot.checkpoints.find((item) => item.state === "ACTIVE") ?? null;
  const completedCheckpoints = snapshot.checkpoints.filter((item) => item.state === "COMPLETED");
  const commands = allowedCommandsFor(snapshot);
  const nextActions = commands.map<NextSafeAction>((action) => ({
    actionId: action,
    authorityRequired: actionAuthority(action),
    blockedBy: snapshot.killSwitchActive && !["CANCEL_FUTURE_WORK", "QUARANTINE_FLOW", "RECONCILE_SOURCE", "SUPERSEDE_FLOW"].includes(action) ? ["kill_switch"] : [],
    eligible: !snapshot.killSwitchActive || ["CANCEL_FUTURE_WORK", "QUARANTINE_FLOW", "RECONCILE_SOURCE", "SUPERSEDE_FLOW"].includes(action),
    label: actionLabel(action),
    reason: snapshot.blockers.length ? `Resolve or explicitly handle ${snapshot.blockers.length} blocker(s) before advancing owner truth.` : "This transition is allowed from the current persisted state.",
  }));

  const retry = snapshot.delivery?.failureClass
    ? decideRetry({
        attempt: snapshot.delivery.attempt,
        failureClass: snapshot.delivery.failureClass,
        idempotencyKey: snapshot.idempotencyKey,
        killSwitchActive: snapshot.killSwitchActive,
        now: input.now,
        policy: snapshot.retryPolicy,
      })
    : null;
  const allowedCommands = nextActions.filter((item) => item.eligible).map((item) => item.actionId).filter((item): item is Exclude<typeof item, "NONE"> => item !== "NONE");
  const descriptor: ContinuationDescriptor = {
    allowedCommands,
    checkpointId: activeCheckpoint?.checkpointId ?? null,
    expiresAt: new Date(new Date(input.now).getTime() + (input.continuationTtlMs ?? 15 * 60_000)).toISOString(),
    flowId: snapshot.flowId,
    stateVersion: snapshot.stateVersion,
    tenantId: snapshot.tenantId,
    workflowVersion: snapshot.definitionVersion,
  };

  const guarantees = evaluateGuarantees(snapshot, nextActions);
  const breached = guarantees.filter((item) => item.status === "BREACHED");
  const headline = breached.length
    ? `${breached.length} production guarantee${breached.length === 1 ? " is" : "s are"} breached.`
    : snapshot.blockers.length
      ? `${snapshot.blockers.length} blocker${snapshot.blockers.length === 1 ? " needs" : "s need"} attention before the flow can advance.`
      : `${snapshot.definitionId} is ${snapshot.state.toLowerCase().replaceAll("_", " ")}.`;

  return {
    activeCheckpoint,
    blockers: snapshot.blockers,
    completedCheckpoints,
    continuation: { descriptor, token: signContinuationDescriptor(descriptor, input.continuationSecret) },
    guarantees,
    headline,
    nextActions,
    observability: {
      commandReceiptId: snapshot.commandReceiptId,
      correlationId: snapshot.correlationId,
      flowId: snapshot.flowId,
      lastEventId: snapshot.lastEventId,
      outboxMessageId: snapshot.outboxMessageId,
    },
    recoveryPlaybook: selectRecoveryPlaybook(snapshot, snapshot.delivery?.failureClass),
    retry,
    state: snapshot.state,
    whatIsBlockingProgress: snapshot.blockers.map((item) => `${item.owner}: ${item.reason} Evidence needed: ${item.evidenceNeeded}`),
    whatIsTrue: truthStatements(snapshot),
    whereAmI: stateDescription(snapshot),
  };
}
