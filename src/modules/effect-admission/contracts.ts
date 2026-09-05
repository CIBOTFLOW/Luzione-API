import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const LEGACY_EFFECT_ADMISSION_CONTRACT_VERSION = "luzione-effect-admission/v1" as const;
export const EFFECT_ADMISSION_CONTRACT_VERSION = "luzione-effect-admission/v2" as const;
export const EFFECT_EXECUTION_ENVELOPE_VERSION = "luzione-effect-execution-envelope/v1" as const;

export type EffectAdmissionCheckpoint =
  | "SULTAN_PREPARE"
  | "SULTAN_EXECUTE"
  | "PROVIDER_CLAIM"
  | "PROVIDER_CREDENTIAL_RELEASE"
  | "PROVIDER_PRE_EXECUTE"
  | "PROVIDER_RECONCILE";

export type EffectAdmissionSubject = {
  actor: { actorId: string; actorType: "service" | "system" | "user" | "agent" };
  authorityRef: string;
  checkpoint: EffectAdmissionCheckpoint;
  credentialBindingId: string;
  destination: string;
  effectClass: "EXTERNAL_EFFECT" | "NO_EFFECT" | "REVERSIBLE_INTERNAL";
  operationKey: string;
  originatingEnvelopeRef: string;
  preparedDispatchDigest: string;
  provider: string;
  sourcePayloadHash: string;
  tenantId: string;
};

export type EffectKillState = {
  activeKillRefs: readonly string[];
  killVersion: string;
  stateAvailable: boolean;
};

export type EffectAdmissionPolicy = {
  admittedBindings: ReadonlySet<string>;
  enabled: boolean;
};

export type EffectAdmissionDenial =
  | "ACTOR_NOT_AUTHORIZED"
  | "ACTIVE_KILL_SWITCH"
  | "ADMISSION_DISABLED"
  | "AUTHORITY_REQUIRED"
  | "BINDING_CHANGED"
  | "CREDENTIAL_BINDING_NOT_ADMITTED"
  | "KILL_STATE_UNAVAILABLE"
  | "PRIOR_DECISION_REQUIRED"
  | "SOURCE_PAYLOAD_HASH_INVALID"
  | "PREPARED_DISPATCH_DIGEST_INVALID";

export type EffectAdmissionDecision = {
  actor: EffectAdmissionSubject["actor"];
  admitted: boolean;
  authorityRef: string;
  bindingDigest: string;
  checkpoint: EffectAdmissionCheckpoint;
  contractVersion: typeof EFFECT_ADMISSION_CONTRACT_VERSION;
  credentialBindingId: string;
  credentialReleaseAuthorized: boolean;
  decisionRef: string;
  denialCode: EffectAdmissionDenial | null;
  destination: string;
  effectAuthority: "SANDBOX_ONLY";
  effectClass: EffectAdmissionSubject["effectClass"];
  executeAuthorized: boolean;
  executionIdentity: string;
  killVersion: string;
  operationKey: string;
  originatingEnvelopeRef: string;
  preparedDispatchDigest: string;
  provider: string;
  sourcePayloadHash: string;
  tenantId: string;
};

export type EffectExecutionEnvelope = {
  actor: EffectAdmissionSubject["actor"];
  admissionCheckpoint: "PROVIDER_PRE_EXECUTE" | "SULTAN_EXECUTE";
  authorityRef: string;
  contractVersion: typeof EFFECT_EXECUTION_ENVELOPE_VERSION;
  credentialBindingId: string;
  destination: string;
  effectAdmissionRef: string;
  effectAuthority: "SANDBOX_ONLY";
  effectClass: EffectAdmissionSubject["effectClass"];
  executionEnvelopeRef: string;
  executionIdentity: string;
  killVersion: string;
  operationKey: string;
  originatingEnvelopeRef: string;
  preparedDispatchDigest: string;
  provider: string;
  sourcePayloadHash: string;
  tenantId: string;
};

export class EffectAdmissionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EffectAdmissionError";
  }
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;
const DESTINATION = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CHECKPOINTS: readonly EffectAdmissionCheckpoint[] = [
  "SULTAN_PREPARE", "SULTAN_EXECUTE", "PROVIDER_CLAIM", "PROVIDER_CREDENTIAL_RELEASE", "PROVIDER_PRE_EXECUTE", "PROVIDER_RECONCILE",
];
const EFFECT_CLASSES: readonly EffectAdmissionSubject["effectClass"][] = ["EXTERNAL_EFFECT", "NO_EFFECT", "REVERSIBLE_INTERNAL"];

export function effectBindingKey(subject: Pick<EffectAdmissionSubject, "actor" | "credentialBindingId" | "destination" | "provider" | "tenantId">) {
  return [subject.tenantId, subject.actor.actorId, subject.provider, subject.destination, subject.credentialBindingId].join("|");
}

export function configuredEffectAdmissionPolicy(env: Record<string, string | undefined> = process.env): EffectAdmissionPolicy {
  const mutationGate = env.LUZIONE_API_MUTATIONS_ENABLED === "true"
    && Boolean(env.DATABASE_URL?.trim())
    && Boolean(env.LUZIONE_API_SERVICE_TOKEN?.trim());
  return {
    enabled: mutationGate && env.LUZIONE_API_EFFECT_ADMISSION_ENABLED === "true",
    admittedBindings: new Set((env.LUZIONE_API_EFFECT_ADMISSION_BINDINGS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)),
  };
}

export function killState(rows: readonly {
  active: boolean;
  activatedAt: string;
  deactivatedAt: string | null;
  scopeRef: string;
  scopeType: "DESTINATION" | "GLOBAL";
  switchId: string;
}[]): EffectKillState {
  const canonical = [...rows]
    .map((row) => ({ ...row, activatedAt: timestamp(row.activatedAt, "activatedAt"), deactivatedAt: row.deactivatedAt === null ? null : timestamp(row.deactivatedAt, "deactivatedAt") }))
    .sort((left, right) => `${left.scopeType}:${left.scopeRef}:${left.switchId}`.localeCompare(`${right.scopeType}:${right.scopeRef}:${right.switchId}`));
  return {
    activeKillRefs: canonical.filter((row) => row.active).map((row) => `${row.scopeType}:${row.scopeRef}:${row.switchId}`),
    killVersion: `kill:${sha256(canonical)}`,
    stateAvailable: true,
  };
}

export function unavailableKillState(): EffectKillState {
  return { activeKillRefs: [], killVersion: `kill:${"0".repeat(64)}`, stateAvailable: false };
}

function stableBinding(subject: EffectAdmissionSubject) {
  return {
    actor: subject.actor,
    authorityRef: subject.authorityRef,
    credentialBindingId: subject.credentialBindingId,
    destination: subject.destination,
    effectClass: subject.effectClass,
    operationKey: subject.operationKey,
    originatingEnvelopeRef: subject.originatingEnvelopeRef,
    preparedDispatchDigest: subject.preparedDispatchDigest,
    provider: subject.provider,
    sourcePayloadHash: subject.sourcePayloadHash,
    tenantId: subject.tenantId,
  };
}

export function effectExecutionIdentity(subject: EffectAdmissionSubject) {
  validateSubject(subject);
  return `effect-execution:${sha256(stableBinding(subject))}`;
}

export function decideEffectAdmission(
  subject: EffectAdmissionSubject,
  state: EffectKillState,
  policy: EffectAdmissionPolicy,
  prior: EffectAdmissionDecision | null = null,
): EffectAdmissionDecision {
  validateSubject(subject);
  const bindingDigest = sha256(stableBinding(subject));
  const executionIdentity = `effect-execution:${bindingDigest}`;
  let denialCode: EffectAdmissionDenial | null = null;
  if (!state.stateAvailable) denialCode = "KILL_STATE_UNAVAILABLE";
  else if (!policy.enabled) denialCode = "ADMISSION_DISABLED";
  else if (!subject.authorityRef.trim()) denialCode = "AUTHORITY_REQUIRED";
  else if (subject.actor.actorType === "agent") denialCode = "ACTOR_NOT_AUTHORIZED";
  else if (!policy.admittedBindings.has(effectBindingKey(subject))) denialCode = "CREDENTIAL_BINDING_NOT_ADMITTED";
  else if (prior && prior.executionIdentity !== executionIdentity) denialCode = "BINDING_CHANGED";
  else if (requiresPrior(subject.checkpoint) && (!prior || !prior.admitted || prior.checkpoint !== requiredPrior(subject.checkpoint))) denialCode = "PRIOR_DECISION_REQUIRED";
  else if (state.activeKillRefs.length > 0 && subject.checkpoint !== "PROVIDER_RECONCILE") denialCode = "ACTIVE_KILL_SWITCH";
  const admitted = denialCode === null;
  const unsigned = {
    actor: subject.actor,
    admitted,
    authorityRef: subject.authorityRef,
    bindingDigest,
    checkpoint: subject.checkpoint,
    contractVersion: EFFECT_ADMISSION_CONTRACT_VERSION,
    credentialBindingId: subject.credentialBindingId,
    credentialReleaseAuthorized: admitted && subject.checkpoint === "PROVIDER_CREDENTIAL_RELEASE",
    denialCode,
    destination: subject.destination,
    effectAuthority: "SANDBOX_ONLY" as const,
    effectClass: subject.effectClass,
    executeAuthorized: admitted && (subject.checkpoint === "PROVIDER_PRE_EXECUTE" || subject.checkpoint === "SULTAN_EXECUTE"),
    executionIdentity,
    killVersion: state.killVersion,
    operationKey: subject.operationKey,
    originatingEnvelopeRef: subject.originatingEnvelopeRef,
    preparedDispatchDigest: subject.preparedDispatchDigest,
    provider: subject.provider,
    sourcePayloadHash: subject.sourcePayloadHash,
    tenantId: subject.tenantId,
  };
  return Object.freeze({ ...unsigned, decisionRef: `effect-admission:${sha256(unsigned)}` });
}

function requiresPrior(checkpoint: EffectAdmissionCheckpoint) {
  return checkpoint === "PROVIDER_CREDENTIAL_RELEASE" || checkpoint === "PROVIDER_PRE_EXECUTE";
}

function requiredPrior(checkpoint: EffectAdmissionCheckpoint): EffectAdmissionCheckpoint | null {
  if (checkpoint === "PROVIDER_CREDENTIAL_RELEASE") return "PROVIDER_CLAIM";
  if (checkpoint === "PROVIDER_PRE_EXECUTE") return "PROVIDER_CREDENTIAL_RELEASE";
  return null;
}

const DECISION_KEYS = [
  "actor", "admitted", "authorityRef", "bindingDigest", "checkpoint", "contractVersion",
  "credentialBindingId", "credentialReleaseAuthorized", "decisionRef", "denialCode",
  "destination", "effectAuthority", "effectClass", "executeAuthorized", "executionIdentity",
  "killVersion", "operationKey", "originatingEnvelopeRef", "preparedDispatchDigest", "provider",
  "sourcePayloadHash", "tenantId",
] as const;

export function parseEffectAdmissionDecision(value: unknown): EffectAdmissionDecision {
  const row = exactObject(value, DECISION_KEYS, "decision");
  if (row.contractVersion !== EFFECT_ADMISSION_CONTRACT_VERSION) throw new EffectAdmissionError("EFFECT_ADMISSION_VERSION_UNSUPPORTED", "decision contractVersion is unsupported.");
  const candidate = row as unknown as EffectAdmissionDecision;
  const subject = subjectFromDecision(candidate);
  validateSubject(subject);
  const denialCodes: readonly (EffectAdmissionDenial | null)[] = [null, "ACTOR_NOT_AUTHORIZED", "ACTIVE_KILL_SWITCH", "ADMISSION_DISABLED", "AUTHORITY_REQUIRED", "BINDING_CHANGED", "CREDENTIAL_BINDING_NOT_ADMITTED", "KILL_STATE_UNAVAILABLE", "PRIOR_DECISION_REQUIRED", "SOURCE_PAYLOAD_HASH_INVALID", "PREPARED_DISPATCH_DIGEST_INVALID"];
  if (!denialCodes.includes(candidate.denialCode)
    || typeof candidate.admitted !== "boolean"
    || typeof candidate.credentialReleaseAuthorized !== "boolean"
    || typeof candidate.executeAuthorized !== "boolean"
    || candidate.effectAuthority !== "SANDBOX_ONLY"
    || !/^kill:[a-f0-9]{64}$/.test(candidate.killVersion)
    || !DIGEST.test(candidate.bindingDigest)
    || !/^effect-execution:[a-f0-9]{64}$/.test(candidate.executionIdentity)
    || !/^effect-admission:[a-f0-9]{64}$/.test(candidate.decisionRef)
    || candidate.admitted !== (candidate.denialCode === null)
    || candidate.credentialReleaseAuthorized !== (candidate.admitted && candidate.checkpoint === "PROVIDER_CREDENTIAL_RELEASE")
    || candidate.executeAuthorized !== (candidate.admitted && (candidate.checkpoint === "PROVIDER_PRE_EXECUTE" || candidate.checkpoint === "SULTAN_EXECUTE"))) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "decision invariants are invalid.");
  }
  const expectedBinding = sha256(stableBinding(subject));
  if (candidate.bindingDigest !== expectedBinding || candidate.executionIdentity !== `effect-execution:${expectedBinding}`) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_BINDING_INVALID", "decision execution identity is invalid.");
  }
  const { decisionRef, ...unsigned } = candidate;
  if (decisionRef !== `effect-admission:${sha256(unsigned)}`) throw new EffectAdmissionError("EFFECT_ADMISSION_DIGEST_INVALID", "decisionRef does not bind the exact decision.");
  return Object.freeze(candidate);
}

export function assertEffectAdmissionDecisionForSubject(
  value: unknown,
  subject: EffectAdmissionSubject,
  priorValue: EffectAdmissionDecision | null = null,
) {
  validateSubject(subject);
  const decision = parseEffectAdmissionDecision(value);
  const prior = priorValue === null ? null : parseEffectAdmissionDecision(priorValue);
  const subjectMatches = decision.actor.actorId === subject.actor.actorId
    && decision.actor.actorType === subject.actor.actorType
    && decision.authorityRef === subject.authorityRef
    && decision.checkpoint === subject.checkpoint
    && decision.credentialBindingId === subject.credentialBindingId
    && decision.destination === subject.destination
    && decision.effectClass === subject.effectClass
    && decision.operationKey === subject.operationKey
    && decision.originatingEnvelopeRef === subject.originatingEnvelopeRef
    && decision.preparedDispatchDigest === subject.preparedDispatchDigest
    && decision.provider === subject.provider
    && decision.sourcePayloadHash === subject.sourcePayloadHash
    && decision.tenantId === subject.tenantId
    && decision.executionIdentity === effectExecutionIdentity(subject);
  if (!subjectMatches) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_SUBJECT_MISMATCH", "The decision does not bind the exact requested effect subject.");
  }
  const required = requiredPrior(subject.checkpoint);
  if (required !== null && (!prior || !prior.admitted || prior.checkpoint !== required || prior.executionIdentity !== decision.executionIdentity)) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_PRIOR_MISMATCH", "The decision does not continue the exact required prior admission.");
  }
  if (required === null && prior !== null && prior.executionIdentity !== decision.executionIdentity) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_PRIOR_MISMATCH", "The supplied prior decision has a foreign execution identity.");
  }
  return decision;
}

export function buildEffectExecutionEnvelope(subject: EffectAdmissionSubject, decision: EffectAdmissionDecision): EffectExecutionEnvelope {
  const parsed = parseEffectAdmissionDecision(decision);
  const expectedIdentity = effectExecutionIdentity(subject);
  if (!parsed.admitted || !parsed.executeAuthorized
    || (parsed.checkpoint !== "PROVIDER_PRE_EXECUTE" && parsed.checkpoint !== "SULTAN_EXECUTE")
    || parsed.executionIdentity !== expectedIdentity
    || parsed.checkpoint !== subject.checkpoint) {
    throw new EffectAdmissionError("EFFECT_EXECUTION_NOT_AUTHORIZED", "The final admission does not authorize this exact execution identity.");
  }
  const unsigned = {
    actor: subject.actor,
    admissionCheckpoint: parsed.checkpoint,
    authorityRef: subject.authorityRef,
    contractVersion: EFFECT_EXECUTION_ENVELOPE_VERSION,
    credentialBindingId: subject.credentialBindingId,
    destination: subject.destination,
    effectAdmissionRef: parsed.decisionRef,
    effectAuthority: "SANDBOX_ONLY" as const,
    effectClass: subject.effectClass,
    executionIdentity: parsed.executionIdentity,
    killVersion: parsed.killVersion,
    operationKey: subject.operationKey,
    originatingEnvelopeRef: subject.originatingEnvelopeRef,
    preparedDispatchDigest: subject.preparedDispatchDigest,
    provider: subject.provider,
    sourcePayloadHash: subject.sourcePayloadHash,
    tenantId: subject.tenantId,
  };
  return Object.freeze({ ...unsigned, executionEnvelopeRef: `effect-envelope:${sha256(unsigned)}` });
}

const ENVELOPE_KEYS = [
  "actor", "admissionCheckpoint", "authorityRef", "contractVersion", "credentialBindingId", "destination",
  "effectAdmissionRef", "effectAuthority", "effectClass", "executionEnvelopeRef", "executionIdentity", "killVersion",
  "operationKey", "originatingEnvelopeRef", "preparedDispatchDigest", "provider", "sourcePayloadHash", "tenantId",
] as const;

export function parseEffectExecutionEnvelope(value: unknown): EffectExecutionEnvelope {
  const candidate = exactObject(value, ENVELOPE_KEYS, "executionEnvelope") as unknown as EffectExecutionEnvelope;
  if (candidate.contractVersion !== EFFECT_EXECUTION_ENVELOPE_VERSION
    || (candidate.admissionCheckpoint !== "PROVIDER_PRE_EXECUTE" && candidate.admissionCheckpoint !== "SULTAN_EXECUTE")
    || candidate.effectAuthority !== "SANDBOX_ONLY"
    || !/^effect-admission:[a-f0-9]{64}$/.test(candidate.effectAdmissionRef)
    || !/^effect-execution:[a-f0-9]{64}$/.test(candidate.executionIdentity)
    || !/^effect-envelope:[a-f0-9]{64}$/.test(candidate.executionEnvelopeRef)
    || !/^kill:[a-f0-9]{64}$/.test(candidate.killVersion)) {
    throw new EffectAdmissionError("EFFECT_EXECUTION_ENVELOPE_INVALID", "executionEnvelope invariants are invalid.");
  }
  const subject: EffectAdmissionSubject = { ...subjectFromEnvelope(candidate), checkpoint: candidate.admissionCheckpoint };
  validateSubject(subject);
  if (effectExecutionIdentity(subject) !== candidate.executionIdentity) throw new EffectAdmissionError("EFFECT_EXECUTION_IDENTITY_INVALID", "executionIdentity does not bind the exact envelope tuple.");
  const { executionEnvelopeRef, ...unsigned } = candidate;
  if (executionEnvelopeRef !== `effect-envelope:${sha256(unsigned)}`) throw new EffectAdmissionError("EFFECT_EXECUTION_ENVELOPE_DIGEST_INVALID", "executionEnvelopeRef does not bind the exact envelope.");
  return Object.freeze(candidate);
}

export function subjectFromEnvelope(envelope: EffectExecutionEnvelope): Omit<EffectAdmissionSubject, "checkpoint"> {
  return {
    actor: envelope.actor,
    authorityRef: envelope.authorityRef,
    credentialBindingId: envelope.credentialBindingId,
    destination: envelope.destination,
    effectClass: envelope.effectClass,
    operationKey: envelope.operationKey,
    originatingEnvelopeRef: envelope.originatingEnvelopeRef,
    preparedDispatchDigest: envelope.preparedDispatchDigest,
    provider: envelope.provider,
    sourcePayloadHash: envelope.sourcePayloadHash,
    tenantId: envelope.tenantId,
  };
}

function subjectFromDecision(decision: EffectAdmissionDecision): EffectAdmissionSubject {
  return {
    actor: decision.actor,
    authorityRef: decision.authorityRef,
    checkpoint: decision.checkpoint,
    credentialBindingId: decision.credentialBindingId,
    destination: decision.destination,
    effectClass: decision.effectClass,
    operationKey: decision.operationKey,
    originatingEnvelopeRef: decision.originatingEnvelopeRef,
    preparedDispatchDigest: decision.preparedDispatchDigest,
    provider: decision.provider,
    sourcePayloadHash: decision.sourcePayloadHash,
    tenantId: decision.tenantId,
  };
}

function exactObject(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", `${field} must be an object.`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join("|") !== [...keys].sort().join("|")) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", `${field} fields must match the exact contract.`);
  }
  return row;
}

function validateSubject(subject: EffectAdmissionSubject) {
  if (!CHECKPOINTS.includes(subject.checkpoint)
    || !EFFECT_CLASSES.includes(subject.effectClass)
    || !(subject.actor && typeof subject.actor === "object" && !Array.isArray(subject.actor))
    || Object.keys(subject.actor).sort().join("|") !== "actorId|actorType"
    || !(["agent", "service", "system", "user"] as string[]).includes(subject.actor.actorType)) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "execution identity enum or actor is invalid.");
  }
  for (const [field, value] of Object.entries({
    actorId: subject.actor.actorId,
    authorityRef: subject.authorityRef,
    credentialBindingId: subject.credentialBindingId,
    operationKey: subject.operationKey,
    originatingEnvelopeRef: subject.originatingEnvelopeRef,
    provider: subject.provider,
    tenantId: subject.tenantId,
  })) {
    if (!TOKEN.test(value)) throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", `${field} is invalid.`);
  }
  if (subject.destination.length > 190 || !DESTINATION.test(subject.destination)) throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "destination is invalid.");
  if (!DIGEST.test(subject.sourcePayloadHash)) throw new EffectAdmissionError("SOURCE_PAYLOAD_HASH_INVALID", "sourcePayloadHash must be an exact lowercase SHA-256 digest.");
  if (!DIGEST.test(subject.preparedDispatchDigest)) throw new EffectAdmissionError("PREPARED_DISPATCH_DIGEST_INVALID", "preparedDispatchDigest must be an exact lowercase SHA-256 digest.");
}

function timestamp(value: string, field: string) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new EffectAdmissionError("EFFECT_ADMISSION_KILL_STATE_INVALID", `${field} is invalid.`);
  return new Date(epoch).toISOString();
}
