import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const EFFECT_ADMISSION_CONTRACT_VERSION = "luzione-effect-admission/v1" as const;

export type EffectAdmissionCheckpoint =
  | "SULTAN_PREPARE"
  | "SULTAN_EXECUTE"
  | "PROVIDER_CLAIM"
  | "PROVIDER_PRE_CREDENTIAL"
  | "PROVIDER_PRE_DISPATCH"
  | "PROVIDER_RECONCILE";

export type EffectAdmissionSubject = {
  actor: { actorId: string; actorType: "service" | "system" | "user" | "agent" };
  authorityRef: string;
  checkpoint: EffectAdmissionCheckpoint;
  credentialBindingId: string;
  destination: string;
  effectClass: "EXTERNAL_EFFECT" | "NO_EFFECT" | "REVERSIBLE_INTERNAL";
  operationKey: string;
  payloadHash: string;
  provider: string;
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
  | "PAYLOAD_HASH_INVALID";

export type EffectAdmissionDecision = {
  actor: EffectAdmissionSubject["actor"];
  admitted: boolean;
  authorityRef: string;
  bindingDigest: string;
  checkpoint: EffectAdmissionCheckpoint;
  contractVersion: typeof EFFECT_ADMISSION_CONTRACT_VERSION;
  credentialBindingId: string;
  credentialResolutionAuthorized: boolean;
  decisionRef: string;
  denialCode: EffectAdmissionDenial | null;
  destination: string;
  dispatchAuthorized: boolean;
  effectClass: EffectAdmissionSubject["effectClass"];
  killVersion: string;
  noEffectOnly: true;
  operationKey: string;
  payloadHash: string;
  provider: string;
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

export function decideEffectAdmission(
  subject: EffectAdmissionSubject,
  state: EffectKillState,
  policy: EffectAdmissionPolicy,
  prior: EffectAdmissionDecision | null = null,
): EffectAdmissionDecision {
  validateSubject(subject);
  const bindingDigest = sha256({
    actor: subject.actor,
    authorityRef: subject.authorityRef,
    credentialBindingId: subject.credentialBindingId,
    destination: subject.destination,
    effectClass: subject.effectClass,
    operationKey: subject.operationKey,
    payloadHash: subject.payloadHash,
    provider: subject.provider,
    tenantId: subject.tenantId,
  });
  let denialCode: EffectAdmissionDenial | null = null;
  if (!state.stateAvailable) denialCode = "KILL_STATE_UNAVAILABLE";
  else if (!policy.enabled) denialCode = "ADMISSION_DISABLED";
  else if (!subject.authorityRef.trim()) denialCode = "AUTHORITY_REQUIRED";
  else if (subject.actor.actorType === "agent") denialCode = "ACTOR_NOT_AUTHORIZED";
  else if (!policy.admittedBindings.has(effectBindingKey(subject))) denialCode = "CREDENTIAL_BINDING_NOT_ADMITTED";
  else if (prior && prior.bindingDigest !== bindingDigest) denialCode = "BINDING_CHANGED";
  else if (state.activeKillRefs.length > 0) denialCode = "ACTIVE_KILL_SWITCH";
  const admitted = denialCode === null;
  const unsigned = {
    actor: subject.actor,
    admitted,
    authorityRef: subject.authorityRef,
    bindingDigest,
    checkpoint: subject.checkpoint,
    contractVersion: EFFECT_ADMISSION_CONTRACT_VERSION,
    credentialBindingId: subject.credentialBindingId,
    credentialResolutionAuthorized: admitted,
    denialCode,
    destination: subject.destination,
    dispatchAuthorized: admitted && subject.checkpoint === "PROVIDER_PRE_DISPATCH",
    effectClass: subject.effectClass,
    killVersion: state.killVersion,
    noEffectOnly: true as const,
    operationKey: subject.operationKey,
    payloadHash: subject.payloadHash,
    provider: subject.provider,
    tenantId: subject.tenantId,
  };
  return Object.freeze({ ...unsigned, decisionRef: `effect-admission:${sha256(unsigned)}` });
}

const DECISION_KEYS = [
  "actor", "admitted", "authorityRef", "bindingDigest", "checkpoint", "contractVersion",
  "credentialBindingId", "credentialResolutionAuthorized", "decisionRef", "denialCode",
  "destination", "dispatchAuthorized", "effectClass", "killVersion", "noEffectOnly",
  "operationKey", "payloadHash", "provider", "tenantId",
] as const;

export function parseEffectAdmissionDecision(value: unknown): EffectAdmissionDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "decision must be an object.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join("|") !== [...DECISION_KEYS].sort().join("|")) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "decision fields must match the exact v1 contract.");
  }
  if (row.contractVersion !== EFFECT_ADMISSION_CONTRACT_VERSION) throw new EffectAdmissionError("EFFECT_ADMISSION_VERSION_UNSUPPORTED", "decision contractVersion is unsupported.");
  const actor = row.actor;
  if (!actor || typeof actor !== "object" || Array.isArray(actor)
    || Object.keys(actor).sort().join("|") !== "actorId|actorType") {
    throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "actor must match the exact v1 contract.");
  }
  const candidate = row as unknown as EffectAdmissionDecision;
  validateSubject({
    actor: candidate.actor,
    authorityRef: candidate.authorityRef,
    checkpoint: candidate.checkpoint,
    credentialBindingId: candidate.credentialBindingId,
    destination: candidate.destination,
    effectClass: candidate.effectClass,
    operationKey: candidate.operationKey,
    payloadHash: candidate.payloadHash,
    provider: candidate.provider,
    tenantId: candidate.tenantId,
  });
  const denialCodes: readonly (EffectAdmissionDenial | null)[] = [null, "ACTOR_NOT_AUTHORIZED", "ACTIVE_KILL_SWITCH", "ADMISSION_DISABLED", "AUTHORITY_REQUIRED", "BINDING_CHANGED", "CREDENTIAL_BINDING_NOT_ADMITTED", "KILL_STATE_UNAVAILABLE", "PAYLOAD_HASH_INVALID"];
  if (!denialCodes.includes(candidate.denialCode)
    || typeof candidate.admitted !== "boolean"
    || typeof candidate.credentialResolutionAuthorized !== "boolean"
    || typeof candidate.dispatchAuthorized !== "boolean"
    || !/^kill:[a-f0-9]{64}$/.test(candidate.killVersion)
    || !/^[a-f0-9]{64}$/.test(candidate.bindingDigest)
    || !/^effect-admission:[a-f0-9]{64}$/.test(candidate.decisionRef)
    || candidate.noEffectOnly !== true
    || candidate.admitted !== (candidate.denialCode === null)
    || candidate.credentialResolutionAuthorized !== candidate.admitted
    || candidate.dispatchAuthorized !== (candidate.admitted && candidate.checkpoint === "PROVIDER_PRE_DISPATCH")) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "decision invariants are invalid.");
  }
  const expectedBinding = sha256({ actor: candidate.actor, authorityRef: candidate.authorityRef, credentialBindingId: candidate.credentialBindingId, destination: candidate.destination, effectClass: candidate.effectClass, operationKey: candidate.operationKey, payloadHash: candidate.payloadHash, provider: candidate.provider, tenantId: candidate.tenantId });
  if (candidate.bindingDigest !== expectedBinding) throw new EffectAdmissionError("EFFECT_ADMISSION_BINDING_INVALID", "decision bindingDigest is invalid.");
  const { decisionRef, ...unsigned } = candidate;
  if (decisionRef !== `effect-admission:${sha256(unsigned)}`) throw new EffectAdmissionError("EFFECT_ADMISSION_DIGEST_INVALID", "decisionRef does not bind the exact decision.");
  return Object.freeze(candidate);
}

function validateSubject(subject: EffectAdmissionSubject) {
  if (!(["SULTAN_PREPARE", "SULTAN_EXECUTE", "PROVIDER_CLAIM", "PROVIDER_PRE_CREDENTIAL", "PROVIDER_PRE_DISPATCH", "PROVIDER_RECONCILE"] as string[]).includes(subject.checkpoint)
    || !(["EXTERNAL_EFFECT", "NO_EFFECT", "REVERSIBLE_INTERNAL"] as string[]).includes(subject.effectClass)
    || !(["agent", "service", "system", "user"] as string[]).includes(subject.actor.actorType)) {
    throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "decision enum is invalid.");
  }
  for (const [field, value] of Object.entries({
    actorId: subject.actor.actorId,
    authorityRef: subject.authorityRef,
    credentialBindingId: subject.credentialBindingId,
    operationKey: subject.operationKey,
    provider: subject.provider,
    tenantId: subject.tenantId,
  })) {
    if (!TOKEN.test(value)) throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", `${field} is invalid.`);
  }
  if (!DESTINATION.test(subject.destination)) throw new EffectAdmissionError("EFFECT_ADMISSION_CONTRACT_INVALID", "destination is invalid.");
  if (!/^[a-f0-9]{64}$/.test(subject.payloadHash)) throw new EffectAdmissionError("PAYLOAD_HASH_INVALID", "payloadHash must be an exact lowercase SHA-256 digest.");
}

function timestamp(value: string, field: string) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new EffectAdmissionError("EFFECT_ADMISSION_KILL_STATE_INVALID", `${field} is invalid.`);
  return new Date(epoch).toISOString();
}
