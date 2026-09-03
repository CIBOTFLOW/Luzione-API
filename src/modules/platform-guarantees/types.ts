export const workflowStates = [
  "PLANNED",
  "RUNNING",
  "WAITING_FOR_FACT",
  "WAITING_FOR_HUMAN",
  "WAITING_FOR_PROVIDER",
  "RESUMING",
  "COMPENSATING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
  "QUARANTINED",
] as const;

export type WorkflowState = (typeof workflowStates)[number];

export const checkpointStates = [
  "PENDING",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "SUPERSEDED",
] as const;

export type CheckpointState = (typeof checkpointStates)[number];

export type AuthorityClass =
  | "BUSINESS_FACT"
  | "COMMAND_EVIDENCE"
  | "INTEGRATION_EVIDENCE"
  | "OBSERVATION"
  | "PROJECTION"
  | "RECOMMENDATION";

export type CanonicalObjectRef = {
  objectId: string;
  objectType: string;
  objectVersion: string;
  ownerProject: string;
  sourceRefs: string[];
};

export type EventActor = {
  actorId: string;
  actorType: "agent" | "service" | "system" | "user";
  roles: string[];
};

export type UniversalEventEnvelope = {
  actor: EventActor;
  authorityClass: AuthorityClass;
  causationId: string | null;
  commandId: string | null;
  contractVersion: "1.0";
  correctionOf: string | null;
  correlationId: string;
  eventId: string;
  eventType: string;
  eventVersion: number;
  evidenceRefs: string[];
  idempotencyKey: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  privacyClass: "INTERNAL" | "RESTRICTED" | "TENANT_VISIBLE";
  producerProject: string;
  recordedAt: string;
  retentionClass: "AUDIT" | "OPERATIONAL" | "TRANSIENT";
  stepId: string | null;
  subject: CanonicalObjectRef;
  supersedes: string | null;
  tenantId: string;
  workflowId: string | null;
};

export type FailureClass =
  | "AMBIGUOUS_AFTER_ACK"
  | "CONTRACT_VIOLATION"
  | "PERMANENT"
  | "POLICY_BLOCKED"
  | "RATE_LIMITED"
  | "TRANSIENT_BEFORE_ACK";

export type RetryPolicy = {
  backoffCoefficient: number;
  baseDelayMs: number;
  maxAttempts: number;
  maxDelayMs: number;
};

export type RetryDecision = {
  action: "BLOCK" | "DEAD_LETTER" | "RECONCILE" | "RETRY";
  attempt: number;
  delayMs: number | null;
  reason: string;
  retryAt: string | null;
};

export type FlowBlocker = {
  blockerId: string;
  evidenceNeeded: string;
  owner: string;
  reason: string;
  reviewBy: string | null;
};

export type WorkflowCheckpoint = {
  checkpointId: string;
  completedAt: string | null;
  evidenceRefs: string[];
  inputVersion: string;
  name: string;
  nextStepId: string | null;
  owner: string;
  state: CheckpointState;
  stepId: string;
};

export type DeliveryPosture = {
  acknowledgementAt: string | null;
  acknowledgementRef: string | null;
  attempt: number;
  failureClass: FailureClass | null;
  lastErrorCode: string | null;
  sourceConfirmedAt: string | null;
  sourceReadbackRef: string | null;
};

export type FlowSnapshot = {
  blockers: FlowBlocker[];
  checkpoints: WorkflowCheckpoint[];
  commandReceiptId: string | null;
  correlationId: string;
  currentStepId: string | null;
  definitionId: string;
  definitionVersion: number;
  delivery: DeliveryPosture | null;
  flowId: string;
  idempotencyKey: string;
  killSwitchActive: boolean;
  lastEventId: string | null;
  lastTransitionAt: string;
  objectRef: CanonicalObjectRef;
  outboxMessageId: string | null;
  retryPolicy: RetryPolicy;
  state: WorkflowState;
  stateVersion: number;
  tenantId: string;
};

export type RecoveryStep = {
  instruction: string;
  kind: "CONTAIN" | "DETECT" | "DIAGNOSE" | "ESCALATE" | "RECOVER" | "VERIFY";
  owner: string;
  safeCommand: FlowCommandType | null;
};

export type RecoveryPlaybook = {
  description: string;
  playbookId: string;
  steps: RecoveryStep[];
  title: string;
};

export type FlowCommandType =
  | "ACKNOWLEDGE_PROVIDER"
  | "CANCEL_FUTURE_WORK"
  | "CONFIRM_SOURCE_READBACK"
  | "FAIL_CURRENT_STEP"
  | "PAUSE_FOR_FACT"
  | "PAUSE_FOR_HUMAN"
  | "QUARANTINE_FLOW"
  | "RECONCILE_SOURCE"
  | "RESUME_FLOW"
  | "RETRY_SAFE_STEP"
  | "START_FLOW"
  | "SUPERSEDE_FLOW";

export type FlowCommand = {
  commandId: string;
  commandType: FlowCommandType;
  expectedStateVersion: number;
  idempotencyKey: string;
  payloadHash: string;
};

export type LifecycleCommandRequest = {
  actor: EventActor;
  causationId: string | null;
  commandId: string;
  commandType: string;
  contractVersion: "1.0";
  correlationId: string;
  expectedObjectVersion: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  policyVersion: string;
  requestedAt: string;
  target: CanonicalObjectRef;
  tenantId: string;
  workflowId: string | null;
  stepId: string | null;
  delivery?: {
    authorizationRef: string | null;
    destination: string;
    effectClass: "EXTERNAL_EFFECT" | "NO_EFFECT" | "REVERSIBLE_INTERNAL";
    maxAttempts: number;
    payload: Record<string, unknown>;
  };
};

export type LifecycleCommandReceipt = {
  commandId: string;
  correlationId: string;
  eventId: string;
  idempotentReplay: boolean;
  idempotencyKey: string;
  objectVersion: string;
  outboxMessageId: string;
  payloadHash: string;
  receiptId: string;
  state: "DOMAIN_COMMITTED" | "DISPATCH_PENDING";
  tenantId: string;
};

export type IdempotencyConflict = {
  commandId: string;
  conflictId: string;
  correlationId: string;
  existingPayloadHash: string;
  idempotencyKey: string;
  receivedPayloadHash: string;
  tenantId: string;
};

export type NextSafeAction = {
  actionId: FlowCommandType | "NONE";
  authorityRequired: "AI_MAY_PROPOSE" | "HUMAN_REQUIRED" | "OPERATOR_REQUIRED" | "SYSTEM_ALLOWED";
  blockedBy: string[];
  eligible: boolean;
  label: string;
  reason: string;
};

export type ContinuationDescriptor = {
  allowedCommands: FlowCommandType[];
  checkpointId: string | null;
  expiresAt: string;
  flowId: string;
  stateVersion: number;
  tenantId: string;
  workflowVersion: number;
};

export type GuaranteeEvaluation = {
  evidenceRefs: string[];
  guaranteeId: string;
  invariant: string;
  status: "BREACHED" | "NOT_APPLICABLE" | "PROVEN" | "UNPROVEN";
};

export type FlowExplanation = {
  activeCheckpoint: WorkflowCheckpoint | null;
  blockers: FlowBlocker[];
  completedCheckpoints: WorkflowCheckpoint[];
  continuation: {
    descriptor: ContinuationDescriptor;
    token: string;
  };
  guarantees: GuaranteeEvaluation[];
  headline: string;
  nextActions: NextSafeAction[];
  observability: {
    commandReceiptId: string | null;
    correlationId: string;
    flowId: string;
    lastEventId: string | null;
    outboxMessageId: string | null;
  };
  recoveryPlaybook: RecoveryPlaybook | null;
  retry: RetryDecision | null;
  state: WorkflowState;
  whatIsBlockingProgress: string[];
  whatIsTrue: string[];
  whereAmI: string;
};
