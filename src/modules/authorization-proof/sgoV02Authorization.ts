import type { ApiActor } from "@/lib/api/actor";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const SGO_V02_AUTHORIZATION_CONTRACT_VERSION = "luzione-object-authorization/v0.1-draft" as const;
export const SGO_V02_AUTHORIZATION_SCOPE_VERSION = "luzione-object-authorization-scope/v0.1-draft" as const;
export const SGO_V02_CACHE_BINDING_VERSION = "luzione-object-cache-binding/v0.1-draft" as const;

export const sgoV02SurfaceKinds = ["CONTEXT", "ATTACHMENT", "ACTION", "THREAD", "EXPORT"] as const;
export type SgoV02SurfaceKind = (typeof sgoV02SurfaceKinds)[number];
export const sgoV02Operations = ["READ", "RESUME", "MUTATE", "RECEIVE_CACHED_RESULT"] as const;
export type SgoV02Operation = (typeof sgoV02Operations)[number];

type SgoV02Surface = {
  authorizationMode: "API_CONTRACT_PROOF" | "INTEGRATION_HOLD";
  evidencePinIds: readonly string[];
  limitation: string;
  owner: "CIBOTFLOW/Luzione-API" | "CIBOTFLOW/Luzione-UI" | "CIBOTFLOW/Luzione-UI+CIBOTFLOW/Sultan-OS";
  requiredCapabilities: Readonly<Partial<Record<SgoV02Operation, string>>>;
  runtimeState: "UNMOUNTED_DRAFT" | "EXISTING_RUNTIME_UNCHANGED" | "CROSS_REPOSITORY_READ_ONLY_EVIDENCE";
  surfaceId: string;
  surfaceKind: SgoV02SurfaceKind;
};

function surface(value: SgoV02Surface): SgoV02Surface {
  return Object.freeze({
    ...value,
    evidencePinIds: Object.freeze([...value.evidencePinIds]),
    requiredCapabilities: Object.freeze({ ...value.requiredCapabilities }),
  });
}

export const sgoV02AuthorizationMatrix: readonly SgoV02Surface[] = Object.freeze([
  surface({
    surfaceId: "api.context.linked-evidence.v0.1-draft",
    surfaceKind: "CONTEXT",
    owner: "CIBOTFLOW/Luzione-API",
    authorizationMode: "API_CONTRACT_PROOF",
    runtimeState: "UNMOUNTED_DRAFT",
    requiredCapabilities: {
      READ: "sultan.canonical.readback.read",
      RECEIVE_CACHED_RESULT: "sultan.canonical.readback.read",
    },
    evidencePinIds: ["api-actor-boundary", "api-http-cache-default", "api-linked-evidence-context"],
    limitation: "C03 source-port contract is unmounted; deployed actor/object integration is not proven.",
  }),
  surface({
    surfaceId: "api.context.stage5-canonical-readback.v1",
    surfaceKind: "CONTEXT",
    owner: "CIBOTFLOW/Luzione-API",
    authorizationMode: "API_CONTRACT_PROOF",
    runtimeState: "EXISTING_RUNTIME_UNCHANGED",
    requiredCapabilities: {
      READ: "sultan.canonical.readback.read",
      RECEIVE_CACHED_RESULT: "sultan.canonical.readback.read",
    },
    evidencePinIds: ["api-actor-boundary", "api-http-cache-default", "api-stage5-readback-route"],
    limitation: "Existing workload and tenant boundary is preserved; end-user object grants and V02 evaluator mounting are unproven.",
  }),
  surface({
    surfaceId: "api.action.sultan-reservation-effect.v1",
    surfaceKind: "ACTION",
    owner: "CIBOTFLOW/Luzione-API",
    authorizationMode: "API_CONTRACT_PROOF",
    runtimeState: "EXISTING_RUNTIME_UNCHANGED",
    requiredCapabilities: {
      READ: "sultan.effect.read",
      RESUME: "sultan.command.execute",
      MUTATE: "sultan.command.execute",
      RECEIVE_CACHED_RESULT: "sultan.effect.read",
    },
    evidencePinIds: [
      "api-actor-boundary",
      "api-http-cache-default",
      "api-sultan-command-execute-route",
      "api-sultan-effect-readback-route",
      "api-sultan-gateway-service",
      "api-sultan-gateway-store",
    ],
    limitation: "V02 executes no command and does not change existing approval, receipt or readback semantics.",
  }),
  surface({
    surfaceId: "ui.attachment.sultan-chat",
    surfaceKind: "ATTACHMENT",
    owner: "CIBOTFLOW/Luzione-UI",
    authorizationMode: "INTEGRATION_HOLD",
    runtimeState: "CROSS_REPOSITORY_READ_ONLY_EVIDENCE",
    requiredCapabilities: {},
    evidencePinIds: ["ui-sultan-chat-attachments"],
    limitation: "UI session ownership is observed but not independently integrated with this API draft.",
  }),
  surface({
    surfaceId: "ui-os.thread.sultan-chat",
    surfaceKind: "THREAD",
    owner: "CIBOTFLOW/Luzione-UI+CIBOTFLOW/Sultan-OS",
    authorizationMode: "INTEGRATION_HOLD",
    runtimeState: "CROSS_REPOSITORY_READ_ONLY_EVIDENCE",
    requiredCapabilities: {},
    evidencePinIds: ["ui-sultan-chat-route", "ui-sultan-chat-actions", "os-ui-workload-auth"],
    limitation: "Private-thread and resume authorization requires independent UI/OS consumer evidence.",
  }),
  surface({
    surfaceId: "ui.export.sultan-evidence",
    surfaceKind: "EXPORT",
    owner: "CIBOTFLOW/Luzione-UI",
    authorizationMode: "INTEGRATION_HOLD",
    runtimeState: "CROSS_REPOSITORY_READ_ONLY_EVIDENCE",
    requiredCapabilities: {},
    evidencePinIds: ["ui-sultan-evidence-export"],
    limitation: "API does not own export persistence, URLs, downloads or recipient delivery.",
  }),
]);

export type SgoV02ObjectScope = {
  authorizationVersion: string;
  contractVersion: typeof SGO_V02_AUTHORIZATION_SCOPE_VERSION;
  objectId: string;
  objectVersion: string;
  ownerActorId: string;
  permittedActorIds: readonly string[];
  sourceRef: string;
  tenantId: string;
};

export type SgoV02CacheBinding = {
  actorId: string;
  authorizationSourceRef: string;
  authorizationVersion: string;
  bindingHash: string;
  contractVersion: typeof SGO_V02_CACHE_BINDING_VERSION;
  createdAt: string;
  expiresAt: string;
  objectId: string;
  objectVersion: string;
  payloadHash: string;
  surfaceId: string;
  tenantId: string;
};

export type SgoV02AuthorizationDecision = Readonly<{
  decision: "ALLOW" | "DENY" | "INTEGRATION_HOLD";
  effectAuthority: "NO_EFFECT";
  grantsAuthority: false;
  reasonCode:
    | "ACTOR_SCOPE_DENIED"
    | "ALLOW"
    | "CACHE_BINDING_EXPIRED"
    | "CACHE_BINDING_INVALID"
    | "CACHE_BINDING_MISMATCH"
    | "CACHE_BINDING_REQUIRED"
    | "CAPABILITY_DENIED"
    | "INTEGRATION_HOLD"
    | "INVALID_AUTHORIZATION_INPUT"
    | "OBJECT_SCOPE_DENIED"
    | "OPERATION_NOT_SUPPORTED"
    | "TENANT_SCOPE_DENIED"
    | "UNKNOWN_SURFACE";
  releaseAllowed: boolean;
}>;

export class SgoV02AuthorizationError extends Error {
  constructor(readonly code: "CACHE_BINDING_DENIED" | "INVALID_CACHE_INPUT" | "INVALID_CACHE_WINDOW") {
    super(`SGO-V02 authorization rejected: ${code}.`);
    this.name = "SgoV02AuthorizationError";
  }
}

type AuthorizationInput = {
  actor: ApiActor;
  cacheBinding?: unknown;
  cachedPayloadHash?: string;
  now: string;
  objectScope: unknown;
  operation: SgoV02Operation;
  requestedObjectId: string;
  surfaceId: string;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,511}$/;
const CAPABILITY = /^[a-z][a-z0-9._-]{1,255}$/;
const SOURCE_REF = /^(?:authorization|contract|postgres):[A-Za-z0-9][A-Za-z0-9._:@/+\-=]{1,2047}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const MAX_CACHE_AGE_MS = 5 * 60_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object.");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error("Unexpected fields.");
  }
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid timestamp.");
  }
  const normalized = new Date(value).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) throw new Error("Invalid calendar timestamp.");
  return normalized;
}

function parseActor(value: unknown): ApiActor {
  const input = record(value);
  exactKeys(input, ["actorId", "actorType", "capabilities", "source", "tenantId"]);
  if (typeof input.actorId !== "string" || !ID.test(input.actorId)
    || typeof input.tenantId !== "string" || !ID.test(input.tenantId)
    || !["agent", "service", "user"].includes(String(input.actorType))
    || !["service-token", "vercel-oidc"].includes(String(input.source))
    || !Array.isArray(input.capabilities) || input.capabilities.length > 64
    || input.capabilities.some((item) => typeof item !== "string" || !CAPABILITY.test(item))
    || new Set(input.capabilities).size !== input.capabilities.length) throw new Error("Invalid actor.");
  return input as ApiActor;
}

function parseObjectScope(value: unknown): SgoV02ObjectScope {
  const input = record(value);
  exactKeys(input, [
    "authorizationVersion", "contractVersion", "objectId", "objectVersion", "ownerActorId",
    "permittedActorIds", "sourceRef", "tenantId",
  ]);
  if (input.contractVersion !== SGO_V02_AUTHORIZATION_SCOPE_VERSION
    || typeof input.authorizationVersion !== "string" || !ID.test(input.authorizationVersion)
    || typeof input.objectId !== "string" || !ID.test(input.objectId)
    || typeof input.objectVersion !== "string" || !ID.test(input.objectVersion)
    || typeof input.ownerActorId !== "string" || !ID.test(input.ownerActorId)
    || typeof input.tenantId !== "string" || !ID.test(input.tenantId)
    || typeof input.sourceRef !== "string" || !SOURCE_REF.test(input.sourceRef)
    || !Array.isArray(input.permittedActorIds) || input.permittedActorIds.length > 32
    || input.permittedActorIds.some((item) => typeof item !== "string" || !ID.test(item))
    || new Set(input.permittedActorIds).size !== input.permittedActorIds.length
    || input.permittedActorIds.includes(input.ownerActorId as string)) throw new Error("Invalid object scope.");
  return Object.freeze({
    authorizationVersion: input.authorizationVersion,
    contractVersion: SGO_V02_AUTHORIZATION_SCOPE_VERSION,
    objectId: input.objectId,
    objectVersion: input.objectVersion,
    ownerActorId: input.ownerActorId,
    permittedActorIds: Object.freeze([...input.permittedActorIds].sort()),
    sourceRef: input.sourceRef,
    tenantId: input.tenantId,
  }) as SgoV02ObjectScope;
}

function cacheMaterial(binding: Omit<SgoV02CacheBinding, "bindingHash">) {
  return {
    actorId: binding.actorId,
    authorizationSourceRef: binding.authorizationSourceRef,
    authorizationVersion: binding.authorizationVersion,
    contractVersion: binding.contractVersion,
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt,
    objectId: binding.objectId,
    objectVersion: binding.objectVersion,
    payloadHash: binding.payloadHash,
    surfaceId: binding.surfaceId,
    tenantId: binding.tenantId,
  };
}

function parseCacheBinding(value: unknown): SgoV02CacheBinding {
  const input = record(value);
  exactKeys(input, [
    "actorId", "authorizationSourceRef", "authorizationVersion", "bindingHash", "contractVersion", "createdAt", "expiresAt",
    "objectId", "objectVersion", "payloadHash", "surfaceId", "tenantId",
  ]);
  for (const key of ["actorId", "authorizationVersion", "objectId", "objectVersion", "surfaceId", "tenantId"] as const) {
    if (typeof input[key] !== "string" || !ID.test(input[key])) throw new Error("Invalid cache identity.");
  }
  if (input.contractVersion !== SGO_V02_CACHE_BINDING_VERSION
    || typeof input.authorizationSourceRef !== "string" || !SOURCE_REF.test(input.authorizationSourceRef)
    || typeof input.payloadHash !== "string" || !SHA256.test(input.payloadHash)
    || typeof input.bindingHash !== "string" || !SHA256.test(input.bindingHash)) throw new Error("Invalid cache binding.");
  const createdAt = timestamp(input.createdAt);
  const expiresAt = timestamp(input.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(createdAt)
    || Date.parse(expiresAt) - Date.parse(createdAt) > MAX_CACHE_AGE_MS) throw new Error("Invalid cache lifetime.");
  const binding = {
    actorId: input.actorId,
    authorizationSourceRef: input.authorizationSourceRef,
    authorizationVersion: input.authorizationVersion,
    bindingHash: input.bindingHash,
    contractVersion: SGO_V02_CACHE_BINDING_VERSION,
    createdAt,
    expiresAt,
    objectId: input.objectId,
    objectVersion: input.objectVersion,
    payloadHash: input.payloadHash,
    surfaceId: input.surfaceId,
    tenantId: input.tenantId,
  } as SgoV02CacheBinding;
  if (sha256(cacheMaterial(binding)) !== binding.bindingHash) throw new Error("Invalid cache hash.");
  return Object.freeze(binding);
}

function decision(
  value: SgoV02AuthorizationDecision["decision"],
  reasonCode: SgoV02AuthorizationDecision["reasonCode"],
): SgoV02AuthorizationDecision {
  return Object.freeze({
    decision: value,
    effectAuthority: "NO_EFFECT" as const,
    grantsAuthority: false as const,
    reasonCode,
    releaseAllowed: value === "ALLOW",
  });
}

export function evaluateSgoV02Authorization(input: AuthorizationInput): SgoV02AuthorizationDecision {
  try {
    if (typeof input.surfaceId !== "string" || !ID.test(input.surfaceId)) {
      return decision("DENY", "INVALID_AUTHORIZATION_INPUT");
    }
    const selected = sgoV02AuthorizationMatrix.find((item) => item.surfaceId === input.surfaceId);
    if (!selected) return decision("DENY", "UNKNOWN_SURFACE");
    if (selected.authorizationMode === "INTEGRATION_HOLD") {
      return decision("INTEGRATION_HOLD", "INTEGRATION_HOLD");
    }
    if (!sgoV02Operations.includes(input.operation)) return decision("DENY", "INVALID_AUTHORIZATION_INPUT");
    if (typeof input.requestedObjectId !== "string" || !ID.test(input.requestedObjectId)) {
      return decision("DENY", "INVALID_AUTHORIZATION_INPUT");
    }
    const now = timestamp(input.now);
    const actor = parseActor(input.actor);
    const scope = parseObjectScope(input.objectScope);
    if (scope.tenantId !== actor.tenantId) return decision("DENY", "TENANT_SCOPE_DENIED");
    if (scope.objectId !== input.requestedObjectId) return decision("DENY", "OBJECT_SCOPE_DENIED");
    if (scope.ownerActorId !== actor.actorId && !scope.permittedActorIds.includes(actor.actorId)) {
      return decision("DENY", "ACTOR_SCOPE_DENIED");
    }
    const capability = selected.requiredCapabilities[input.operation];
    if (!capability) return decision("DENY", "OPERATION_NOT_SUPPORTED");
    if (!actor.capabilities.includes(capability)) return decision("DENY", "CAPABILITY_DENIED");
    if (input.operation !== "RECEIVE_CACHED_RESULT") return decision("ALLOW", "ALLOW");
    if (input.cacheBinding === undefined || input.cachedPayloadHash === undefined) {
      return decision("DENY", "CACHE_BINDING_REQUIRED");
    }
    let binding: SgoV02CacheBinding;
    try {
      binding = parseCacheBinding(input.cacheBinding);
    } catch {
      return decision("DENY", "CACHE_BINDING_INVALID");
    }
    if (binding.actorId !== actor.actorId
      || binding.tenantId !== actor.tenantId
      || binding.surfaceId !== selected.surfaceId
      || binding.objectId !== scope.objectId
      || binding.objectVersion !== scope.objectVersion
      || binding.authorizationSourceRef !== scope.sourceRef
      || binding.authorizationVersion !== scope.authorizationVersion
      || binding.payloadHash !== input.cachedPayloadHash) {
      return decision("DENY", "CACHE_BINDING_MISMATCH");
    }
    if (Date.parse(binding.createdAt) > Date.parse(now) + 30_000
      || Date.parse(binding.expiresAt) <= Date.parse(now)) {
      return decision("DENY", "CACHE_BINDING_EXPIRED");
    }
    return decision("ALLOW", "ALLOW");
  } catch {
    return decision("DENY", "INVALID_AUTHORIZATION_INPUT");
  }
}

export function createSgoV02CacheBinding(input: {
  actor: ApiActor;
  createdAt: string;
  expiresAt: string;
  objectScope: unknown;
  payload: unknown;
  surfaceId: string;
}): SgoV02CacheBinding {
  let scope: SgoV02ObjectScope;
  let createdAt: string;
  let expiresAt: string;
  try {
    scope = parseObjectScope(input.objectScope);
    createdAt = timestamp(input.createdAt);
    expiresAt = timestamp(input.expiresAt);
  } catch {
    throw new SgoV02AuthorizationError("INVALID_CACHE_INPUT");
  }
  if (Date.parse(expiresAt) <= Date.parse(createdAt)
    || Date.parse(expiresAt) - Date.parse(createdAt) > MAX_CACHE_AGE_MS) {
    throw new SgoV02AuthorizationError("INVALID_CACHE_WINDOW");
  }
  const read = evaluateSgoV02Authorization({
    actor: input.actor,
    now: createdAt,
    objectScope: scope,
    operation: "READ",
    requestedObjectId: scope.objectId,
    surfaceId: input.surfaceId,
  });
  if (read.decision !== "ALLOW") throw new SgoV02AuthorizationError("CACHE_BINDING_DENIED");
  const actor = parseActor(input.actor);
  let payloadHash: string;
  try {
    payloadHash = sha256(input.payload);
  } catch {
    throw new SgoV02AuthorizationError("INVALID_CACHE_INPUT");
  }
  const material = Object.freeze({
    actorId: actor.actorId,
    authorizationSourceRef: scope.sourceRef,
    authorizationVersion: scope.authorizationVersion,
    contractVersion: SGO_V02_CACHE_BINDING_VERSION,
    createdAt,
    expiresAt,
    objectId: scope.objectId,
    objectVersion: scope.objectVersion,
    payloadHash,
    surfaceId: input.surfaceId,
    tenantId: actor.tenantId,
  });
  return Object.freeze({ ...material, bindingHash: sha256(material) });
}

export function releaseSgoV02CachedResult<T>(input: {
  actor: ApiActor;
  cacheBinding: unknown;
  cachedResult: T;
  now: string;
  objectScope: unknown;
  requestedObjectId: string;
  surfaceId: string;
}): Readonly<{ decision: SgoV02AuthorizationDecision; result: T | null }> {
  let cachedPayloadHash: string;
  try {
    cachedPayloadHash = sha256(input.cachedResult);
  } catch {
    return Object.freeze({
      decision: decision("DENY", "INVALID_AUTHORIZATION_INPUT"),
      result: null,
    });
  }
  const authorization = evaluateSgoV02Authorization({
    actor: input.actor,
    cacheBinding: input.cacheBinding,
    cachedPayloadHash,
    now: input.now,
    objectScope: input.objectScope,
    operation: "RECEIVE_CACHED_RESULT",
    requestedObjectId: input.requestedObjectId,
    surfaceId: input.surfaceId,
  });
  return Object.freeze({ decision: authorization, result: authorization.releaseAllowed ? input.cachedResult : null });
}

const SGO_V02_EVIDENCE_PINS = Object.freeze([
  { pin_id: "api-actor-boundary", repository: "CIBOTFLOW/Luzione-API", commit_sha: "c6c4fa1f95649edfac120a0e796df641a9cdbbad", path: "src/lib/api/actor.ts", blob_sha: "d1e18aba31f21dfb3463136a8abd738d15a9fe7e" },
  { pin_id: "api-http-cache-default", repository: "CIBOTFLOW/Luzione-API", commit_sha: "c6c4fa1f95649edfac120a0e796df641a9cdbbad", path: "src/lib/api/http.ts", blob_sha: "94538ec4833afe7937351731e1bd2a702740e120" },
  { pin_id: "api-linked-evidence-context", repository: "CIBOTFLOW/Luzione-API", commit_sha: "c6c4fa1f95649edfac120a0e796df641a9cdbbad", path: "src/modules/linked-evidence-context/producer.ts", blob_sha: "447c313a48eebd3e435057d560b91eb5bb8ccc58" },
  { pin_id: "api-stage5-readback-route", repository: "CIBOTFLOW/Luzione-API", commit_sha: "c6c4fa1f95649edfac120a0e796df641a9cdbbad", path: "src/app/api/v1/sultan/canonical-readbacks/route.ts", blob_sha: "11107f37819a702604ea0c292a48f6bd124549ef" },
  { pin_id: "api-sultan-command-execute-route", repository: "CIBOTFLOW/Luzione-API", commit_sha: "c6c4fa1f95649edfac120a0e796df641a9cdbbad", path: "src/app/api/v1/sultan/commands/execute/route.ts", blob_sha: "5053758a960aa7ef77cb1f9d5f49ec638cc11975" },
  { pin_id: "api-sultan-effect-readback-route", repository: "CIBOTFLOW/Luzione-API", commit_sha: "c6c4fa1f95649edfac120a0e796df641a9cdbbad", path: "src/app/api/v1/sultan/effects/[receiptId]/readback/route.ts", blob_sha: "b231a4ca6dfd94e816ab6c02b31ff40d690ba38c" },
  { pin_id: "api-sultan-gateway-service", repository: "CIBOTFLOW/Luzione-API", commit_sha: "c6c4fa1f95649edfac120a0e796df641a9cdbbad", path: "src/modules/sultan-agent-gateway/service.ts", blob_sha: "d4429f02d102d0ed8277acad81a13230e3f1cfdc" },
  { pin_id: "api-sultan-gateway-store", repository: "CIBOTFLOW/Luzione-API", commit_sha: "c6c4fa1f95649edfac120a0e796df641a9cdbbad", path: "src/modules/sultan-agent-gateway/postgresStore.ts", blob_sha: "e8c1b52cc264ff8d73e13cfdcbb132f9d007660a" },
  { pin_id: "ui-sultan-chat-attachments", repository: "CIBOTFLOW/Luzione-UI", commit_sha: "84f0dcecbe5aff2d29176433967a6ae0223d9214", path: "src/app/api/sultan/chat/attachments/route.ts", blob_sha: "d37cdbdc3b2cebe6983fca689a68bab4b96fb210" },
  { pin_id: "ui-sultan-chat-actions", repository: "CIBOTFLOW/Luzione-UI", commit_sha: "84f0dcecbe5aff2d29176433967a6ae0223d9214", path: "src/app/api/sultan/chat/actions/route.ts", blob_sha: "6e0f98855c8b8bf66798b43723f8e698500718cc" },
  { pin_id: "ui-sultan-chat-route", repository: "CIBOTFLOW/Luzione-UI", commit_sha: "84f0dcecbe5aff2d29176433967a6ae0223d9214", path: "src/app/api/sultan/chat/route.ts", blob_sha: "c981a1eb7c864d7e86cbcb6d7d675a8d90caf53b" },
  { pin_id: "ui-sultan-evidence-export", repository: "CIBOTFLOW/Luzione-UI", commit_sha: "84f0dcecbe5aff2d29176433967a6ae0223d9214", path: "src/app/api/sultan-evidence-export/route.ts", blob_sha: "581cae2202f2baa490e4b49586a8a02d73fbfcf1" },
  { pin_id: "os-ui-workload-auth", repository: "CIBOTFLOW/Sultan-OS", commit_sha: "ea50caa66f09b14b1ac2bcfdfb74cdf9f4c067f0", path: "src/lib/luzioneUiWorkloadAuth.ts", blob_sha: "4f6fbdea7b44afe4359b7d13b3da608c64404de4" },
]);

export const sgoV02CacheLaw = Object.freeze({
  runtime_cache_created: false,
  binding_origin: "SERVER_INTERNAL_ONLY",
  api_object_responses_observed_default: "no-store",
  binding_dimensions: Object.freeze([
    "actorId", "tenantId", "surfaceId", "objectId", "objectVersion", "authorizationSourceRef",
    "authorizationVersion", "payloadHash", "createdAt", "expiresAt",
  ]),
  maximum_binding_age_ms: MAX_CACHE_AGE_MS,
  denial_payload: null,
});

export const sgoV02IntegrationHolds = Object.freeze([
  "UI attachment session/object authorization",
  "UI/OS private thread ownership and resume authorization",
  "UI export object, URL, recipient and download authorization",
  "authenticated deployed consumer exercise",
  "exact preview exercise",
]);

export const sgoV02StrongestClaim = Object.freeze({
  engineering_state: "CONTRACT_STABLE",
  release_evidence: "LOCAL_PROVEN",
  effect_authority: "NO_EFFECT",
  finality: "BOUNDED_CLAIM",
});

export function validateSgoV02AuthorizationManifest(value: unknown) {
  const input = record(value);
  exactKeys(input, [
    "base_sha", "build_program", "business_state_mutated", "cache_law", "contract_version",
    "controller_allowlist_count", "controller_sha", "effect_authority", "evidence_pins", "grants_authority",
    "integration_holds", "matrix", "matrix_id", "operations", "persistence", "provider_calls", "repository",
    "runtime_mounting", "schema_version", "state", "strongest_claim", "surface_kinds", "task_id",
  ]);
  if (input.schema_version !== 1
    || input.matrix_id !== "sgo-v02-object-authorization-matrix/v1"
    || input.build_program !== "SGO-20260911-01"
    || input.task_id !== "SGO-V02"
    || input.controller_sha !== "065c41b59887c25b96617db429f447cc8221c372"
    || input.controller_allowlist_count !== 68
    || input.repository !== "CIBOTFLOW/Luzione-API"
    || input.base_sha !== "c6c4fa1f95649edfac120a0e796df641a9cdbbad"
    || input.contract_version !== SGO_V02_AUTHORIZATION_CONTRACT_VERSION
    || input.state !== "G0_UNMOUNTED_PROVIDER_FREE_AUTHORIZATION_PROOF"
    || input.runtime_mounting !== false
    || input.persistence !== "NONE"
    || input.provider_calls !== false
    || input.business_state_mutated !== false
    || input.grants_authority !== false
    || input.effect_authority !== "NO_EFFECT"
    || sha256(input.surface_kinds) !== sha256(sgoV02SurfaceKinds)
    || sha256(input.operations) !== sha256(sgoV02Operations)
    || sha256(input.matrix) !== sha256(sgoV02AuthorizationMatrix)
    || sha256(input.cache_law) !== sha256(sgoV02CacheLaw)
    || sha256(input.integration_holds) !== sha256(sgoV02IntegrationHolds)
    || sha256(input.strongest_claim) !== sha256(sgoV02StrongestClaim)) {
    throw new Error("Invalid SGO-V02 authorization manifest.");
  }
  const pins = input.evidence_pins;
  if (!Array.isArray(pins) || sha256(pins) !== sha256(SGO_V02_EVIDENCE_PINS)) {
    throw new Error("Invalid SGO-V02 evidence pins.");
  }
  const pinIds = new Set<string>();
  for (const value of pins) {
    const pin = record(value);
    exactKeys(pin, ["blob_sha", "commit_sha", "path", "pin_id", "repository"]);
    if (typeof pin.pin_id !== "string" || !ID.test(pin.pin_id)
      || typeof pin.repository !== "string" || !/^CIBOTFLOW\/[A-Za-z0-9._-]+$/.test(pin.repository)
      || typeof pin.commit_sha !== "string" || !/^[a-f0-9]{40}$/.test(pin.commit_sha)
      || typeof pin.path !== "string" || !/^[A-Za-z0-9_@.\/[\]-]+$/.test(pin.path)
      || typeof pin.blob_sha !== "string" || !/^[a-f0-9]{40}$/.test(pin.blob_sha)
      || pinIds.has(pin.pin_id)) throw new Error("Invalid SGO-V02 evidence pin.");
    pinIds.add(pin.pin_id);
  }
  const referencedPins = new Set(sgoV02AuthorizationMatrix.flatMap((item) => item.evidencePinIds));
  if (referencedPins.size !== pinIds.size || [...referencedPins].some((pinId) => !pinIds.has(pinId))) {
    throw new Error("SGO-V02 evidence pin coverage is incomplete.");
  }
  const heldKinds = new Set(sgoV02AuthorizationMatrix
    .filter((item) => item.authorizationMode === "INTEGRATION_HOLD")
    .map((item) => item.surfaceKind));
  if (!heldKinds.has("ATTACHMENT") || !heldKinds.has("THREAD") || !heldKinds.has("EXPORT")) {
    throw new Error("Cross-repository integration holds are incomplete.");
  }
  return Object.freeze({ apiProofRows: 3, evidencePins: pins.length, integrationHolds: 3, surfaceKinds: 5 });
}
