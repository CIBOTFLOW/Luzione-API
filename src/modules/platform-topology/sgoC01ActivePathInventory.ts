export const SGO_C01_INVENTORY_ID = "sgo-c01-active-sultan-runtime-producers/v1";
export const SGO_C01_BUILD_PROGRAM = "SGO-20260911-01";
export const SGO_C01_TASK_ID = "SGO-C01";
export const SGO_C01_CONTROLLER_SHA = "76d5e05078a71790b5babdfc5020c63ae8513f14";

const SHA40 = /^[a-f0-9]{40}$/;
const REQUIRED_EVIDENCE_ROLES = [
  "VISIBLE_ENTRYPOINT",
  "RUNTIME_INVOCATION",
  "CANONICAL_SOURCE_READBACK",
] as const;

export const SGO_C01_REPOSITORY_PINS = Object.freeze({
  "CIBOTFLOW/Luzione-API": "7ee5a0a53a3434c3e00969dc626a4daad33f9dc0",
  "CIBOTFLOW/Luzione-UI": "84f0dcecbe5aff2d29176433967a6ae0223d9214",
  "CIBOTFLOW/Sultan-OS": "ea50caa66f09b14b1ac2bcfdfb74cdf9f4c067f0",
});

type EvidencePinExpectation = {
  blobSha: string;
  path: string;
  repository: keyof typeof SGO_C01_REPOSITORY_PINS;
};

const EVIDENCE_PIN_EXPECTATIONS: Readonly<Record<string, EvidencePinExpectation>> = Object.freeze({
  "api-p113-route": { repository: "CIBOTFLOW/Luzione-API", path: "src/app/api/v1/catalog/shopify/projections/route.ts", blobSha: "88fc94db55d4f85a5755a52e91306153e3f1f5ac" },
  "api-p113-runtime": { repository: "CIBOTFLOW/Luzione-API", path: "src/modules/catalog-projection/runtime.ts", blobSha: "911f9318de18d7e22a4481c066c7e10ff7dfa581" },
  "api-sultan-command-execute": { repository: "CIBOTFLOW/Luzione-API", path: "src/app/api/v1/sultan/commands/execute/route.ts", blobSha: "5053758a960aa7ef77cb1f9d5f49ec638cc11975" },
  "api-sultan-command-prepare": { repository: "CIBOTFLOW/Luzione-API", path: "src/app/api/v1/sultan/commands/prepare/route.ts", blobSha: "681e739c563f7c9ff3b30c7fddb80ae79d12f713" },
  "api-sultan-effect-readback": { repository: "CIBOTFLOW/Luzione-API", path: "src/app/api/v1/sultan/effects/[receiptId]/readback/route.ts", blobSha: "b231a4ca6dfd94e816ab6c02b31ff40d690ba38c" },
  "api-sultan-tools": { repository: "CIBOTFLOW/Luzione-API", path: "src/app/api/v1/sultan/tools/route.ts", blobSha: "c75cbf0a61004176186fd7a7a99fe9a80b821fa2" },
  "os-agent-case-persistence": { repository: "CIBOTFLOW/Sultan-OS", path: "src/lib/agentCasePersistence.ts", blobSha: "ba388a248f2826bfe1b8f6d7fe5c7b57491080f1" },
  "os-agent-case-route": { repository: "CIBOTFLOW/Sultan-OS", path: "src/app/api/system/agent-case-run/route.ts", blobSha: "a404e16f3931c118b5930b7af7ca5dc4cedd82d6" },
  "os-agent-case-runtime": { repository: "CIBOTFLOW/Sultan-OS", path: "src/lib/agentCaseRuntime.ts", blobSha: "4a12d9fb2126dfb6d4023097354210164b9f6940" },
  "os-api-tool-client": { repository: "CIBOTFLOW/Sultan-OS", path: "src/lib/luzioneAgentToolClientV1.ts", blobSha: "59cc78a8a564b93906dd2cb2c58c83c2afd46b7f" },
  "os-chat-route": { repository: "CIBOTFLOW/Sultan-OS", path: "src/app/api/system/developmental-participation/chat/route.ts", blobSha: "5825dea27b416ad22fe7b8c89bbdcd8edddd1d60" },
  "os-doctrine-chat": { repository: "CIBOTFLOW/Sultan-OS", path: "src/lib/doctrineChat.ts", blobSha: "df259b0c28cfb1c34a42a8b0a185cc7f2a9d3061" },
  "os-private-memory": { repository: "CIBOTFLOW/Sultan-OS", path: "src/lib/sultanInternalMemory.ts", blobSha: "306e4b1c454eafef5acfe464ba4576ef9d7b2e1b" },
  "os-runtime-v2": { repository: "CIBOTFLOW/Sultan-OS", path: "src/lib/agentRuntimeV2.ts", blobSha: "c6d44ec008d79f98e5d05e42f2c1122da09dbc5b" },
  "os-runtime-v2-persistence": { repository: "CIBOTFLOW/Sultan-OS", path: "src/lib/agentRuntimeV2Persistence.ts", blobSha: "910bf447c5f7a1dca6b7d37ff2e82b266030028c" },
  "ui-agent-runtime-repository": { repository: "CIBOTFLOW/Luzione-UI", path: "src/modules/agent-runtime/repositories/AgentRuntimeRepository.ts", blobSha: "21cee212ded64c8eaaca28a7759142e40b088095" },
  "ui-agent-runtime-service": { repository: "CIBOTFLOW/Luzione-UI", path: "src/modules/agent-runtime/services/AgentRuntimeService.ts", blobSha: "f98574ec00d8b3a4f99dbcfe4cc31e6b385b443b" },
  "ui-approval-service": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/approvals/approvalService.ts", blobSha: "b800e261425241d813112584bdc114ac74b72627" },
  "ui-chat-actions-route": { repository: "CIBOTFLOW/Luzione-UI", path: "src/app/api/sultan/chat/actions/route.ts", blobSha: "6e0f98855c8b8bf66798b43723f8e698500718cc" },
  "ui-chat-route": { repository: "CIBOTFLOW/Luzione-UI", path: "src/app/api/sultan/chat/route.ts", blobSha: "c981a1eb7c864d7e86cbcb6d7d675a8d90caf53b" },
  "ui-chat-store": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/server/sultanChatStore.ts", blobSha: "027b3b059d57d1d4fbcaa013bc6b3c134ff95540" },
  "ui-chat-workspace": { repository: "CIBOTFLOW/Luzione-UI", path: "src/components/sultan/SultanChatWorkspace.tsx", blobSha: "fb750100544bf1520feb2adbf1dbf55eed87ddf1" },
  "ui-command-intent": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/sultan/commandIntent.ts", blobSha: "fd400dc0096f4200ee7da192ef53a041e409a2cd" },
  "ui-content-plan": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/marketing/sultanPlanService.ts", blobSha: "13be34b5c9ec41ac3f83cf8442b5f9a943b7a6ac" },
  "ui-execution-plan": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/sultan/sultanExecutionPlanService.ts", blobSha: "644483bd906097c525e5c068fad17577592c8f04" },
  "ui-executor-registry": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/governance/actionIntentExecutorRegistry.ts", blobSha: "9056e87d350b6eed009b488abc67874279318ffa" },
  "ui-governance-kernel": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/server/governanceKernel.ts", blobSha: "1dd8660c650ef32555fc1361f5886f86d4e4a11d" },
  "ui-governed-memory": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/memory/memoryPromotionService.ts", blobSha: "c0bfe37636dcc792345b0a6d2d9197f7f2698fd6" },
  "ui-marketing-store": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/server/marketingWorkspaceStore.ts", blobSha: "778db8ca7ec4efe05ce24d4161652467090dbb32" },
  "ui-model-router": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/ai/ModelRouter.ts", blobSha: "04650858b7765bcb73d7a7c97d0cfb8652191fa1" },
  "ui-object-memory": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/memory/objectMemoryContextService.ts", blobSha: "6dd420b6882a83e071d11eadd67c203f9906ecea" },
  "ui-proposal-document": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/commercial-case/proposalDocumentPreflightService.ts", blobSha: "dc470a689d2e6147f3fbc0b5555a33a449c45020" },
  "ui-quote-card": { repository: "CIBOTFLOW/Luzione-UI", path: "src/components/operations/SultanQuoteReviewCard.tsx", blobSha: "f67fcd741281e95433d212f46b5b0dc64377d7e5" },
  "ui-quote-review-route": { repository: "CIBOTFLOW/Luzione-UI", path: "src/app/api/quotes/[quoteId]/sultan-review/route.ts", blobSha: "3652777d41c2b8f3fb21d63ed4d18f974f1efd0f" },
  "ui-quote-review-service": { repository: "CIBOTFLOW/Luzione-UI", path: "src/modules/agent-runtime/services/QuoteReviewAgentService.ts", blobSha: "598272b6ba546e41d958bc2079161e539f93c736" },
  "ui-quotes": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/server/quotes.ts", blobSha: "f589318b424c0b7ed3f4d614f02b275cdf7693e6" },
  "ui-shopify-store": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/server/shopifyReadModelStore.ts", blobSha: "02170c3f62cd4cdfada01ace4900dbe705f3649b" },
  "ui-simulation-lab": { repository: "CIBOTFLOW/Luzione-UI", path: "src/components/sultan/SultanSimulationLab.tsx", blobSha: "7db209b30cad877407af001209d23d79be7361ab" },
  "ui-simulation-route": { repository: "CIBOTFLOW/Luzione-UI", path: "src/app/api/sultan/agent-simulations/[scenarioId]/runs/route.ts", blobSha: "c891d7f89380a0abd39b2d44c7557313a3e37c34" },
  "ui-sultan-gateway": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/server/sultanAgentSimulationGateway.ts", blobSha: "a5a7259b7200c2b5f4a445998f0277d258e438c0" },
  "ui-task-assist-builder": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/tasks/sultanTaskAssistance.ts", blobSha: "5a3f3384ea1e7047d055be0d91bb76de0e2ca86d" },
  "ui-task-assist-route": { repository: "CIBOTFLOW/Luzione-UI", path: "src/app/api/team-coordination/[taskId]/sultan-assist/route.ts", blobSha: "58c2c72b4cc903e4ab19435a6971a3fd3344171d" },
  "ui-task-page": { repository: "CIBOTFLOW/Luzione-UI", path: "src/components/tasks/TaskDetailPage.tsx", blobSha: "a846d403388eeed7f10c32d12f02f3fe80a2c358" },
  "ui-team-task-store": { repository: "CIBOTFLOW/Luzione-UI", path: "src/lib/server/teamCoordinationStore.ts", blobSha: "0152a947479e7665a8e09b3727cfc1cfff7e0b6e" },
});

const REQUIRED_SURFACE_IDS = Object.freeze([
  "chat.main_drawer",
  "quote_review.quote_detail",
  "task_assist.task_detail",
  "simulation.agent_case_lab",
  "memory.main_chat_private",
  "memory.quote_review_object",
  "command.create_content_work",
  "command.draft_internal_email",
  "command.send_external_email",
  "command.create_task",
  "command.create_google_doc",
  "command.sync_shopify_catalog",
  "command.decision_draft",
  "command.request_approval",
  "command.committee_question",
]);

const ACTIVE_BINDING_EXPECTATIONS: Readonly<Record<string, {
  kind: string;
  ownerPin: string;
  producerPin: string;
  reachability: "REACHABLE_ACTIVE" | "REACHABLE_CONDITIONAL";
}>> = Object.freeze({
  "chat.main_drawer": { kind: "chat", producerPin: "os-doctrine-chat", ownerPin: "ui-chat-store", reachability: "REACHABLE_ACTIVE" },
  "quote_review.quote_detail": { kind: "quote-review", producerPin: "ui-model-router", ownerPin: "ui-quotes", reachability: "REACHABLE_CONDITIONAL" },
  "task_assist.task_detail": { kind: "task-assist", producerPin: "ui-task-assist-builder", ownerPin: "ui-team-task-store", reachability: "REACHABLE_ACTIVE" },
  "simulation.agent_case_lab": { kind: "simulation", producerPin: "os-agent-case-runtime", ownerPin: "os-agent-case-persistence", reachability: "REACHABLE_ACTIVE" },
  "memory.main_chat_private": { kind: "memory", producerPin: "os-private-memory", ownerPin: "os-private-memory", reachability: "REACHABLE_ACTIVE" },
  "memory.quote_review_object": { kind: "memory", producerPin: "ui-object-memory", ownerPin: "ui-governed-memory", reachability: "REACHABLE_CONDITIONAL" },
  "command.create_content_work": { kind: "command", producerPin: "ui-content-plan", ownerPin: "ui-marketing-store", reachability: "REACHABLE_ACTIVE" },
  "command.draft_internal_email": { kind: "command", producerPin: "ui-execution-plan", ownerPin: "ui-execution-plan", reachability: "REACHABLE_ACTIVE" },
  "command.send_external_email": { kind: "command", producerPin: "ui-execution-plan", ownerPin: "ui-execution-plan", reachability: "REACHABLE_CONDITIONAL" },
  "command.create_task": { kind: "command", producerPin: "ui-executor-registry", ownerPin: "ui-team-task-store", reachability: "REACHABLE_ACTIVE" },
  "command.create_google_doc": { kind: "command", producerPin: "ui-executor-registry", ownerPin: "ui-proposal-document", reachability: "REACHABLE_CONDITIONAL" },
  "command.sync_shopify_catalog": { kind: "command", producerPin: "ui-executor-registry", ownerPin: "api-p113-runtime", reachability: "REACHABLE_CONDITIONAL" },
  "command.decision_draft": { kind: "command", producerPin: "ui-executor-registry", ownerPin: "ui-governance-kernel", reachability: "REACHABLE_ACTIVE" },
  "command.request_approval": { kind: "command", producerPin: "ui-executor-registry", ownerPin: "ui-approval-service", reachability: "REACHABLE_ACTIVE" },
  "command.committee_question": { kind: "command", producerPin: "ui-executor-registry", ownerPin: "ui-governance-kernel", reachability: "REACHABLE_ACTIVE" },
});

const REQUIRED_COMMAND_ACTIONS = Object.freeze([
  "committee_question",
  "create_content_work",
  "create_google_doc",
  "create_task",
  "decision_draft",
  "draft_internal_email",
  "request_approval",
  "send_external_email",
  "sync_shopify_catalog",
]);

const REQUIRED_UNCREDITED_PATHS = Object.freeze({
  "ambiguous.sultan_memory_label": "AMBIGUOUS",
  "shadow.api_sultan_tool_gateway_from_visible_drawer": "SHADOW_NOT_REACHED",
  "shadow.sultan_runtime_v2_from_visible_surfaces": "SHADOW_NOT_REACHED",
  "unavailable.quote_review_registry_disabled": "UNAVAILABLE",
});

export class SgoC01InventoryValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SgoC01InventoryValidationError";
  }
}

function fail(code: string, message: string): never {
  throw new SgoC01InventoryValidationError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("SGO_C01_INVALID_RECORD", `${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail("SGO_C01_INVALID_ARRAY", `${label} must be an array.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail("SGO_C01_INVALID_TEXT", `${label} must be a non-empty string.`);
  }
  return value.trim();
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail("SGO_C01_INVALID_BOOLEAN", `${label} must be boolean.`);
  return value;
}

function exactSet(actual: readonly string[], expected: readonly string[], label: string) {
  const uniqueActual = [...new Set(actual)].sort();
  const uniqueExpected = [...new Set(expected)].sort();
  if (actual.length !== uniqueActual.length || JSON.stringify(uniqueActual) !== JSON.stringify(uniqueExpected)) {
    fail("SGO_C01_COVERAGE_MISMATCH", `${label} must match the exact admitted set.`);
  }
}

function validateRepositoryPins(value: unknown) {
  const entries = array(value, "source_repositories");
  const observed = new Map<string, string>();
  for (const [index, raw] of entries.entries()) {
    const item = record(raw, `source_repositories[${index}]`);
    const repository = text(item.repository, `source_repositories[${index}].repository`);
    const commitSha = text(item.commit_sha, `source_repositories[${index}].commit_sha`);
    const access = text(item.access, `source_repositories[${index}].access`);
    if (!SHA40.test(commitSha)) fail("SGO_C01_INVALID_SHA", `${repository} commit must be a Git SHA.`);
    if (observed.has(repository)) fail("SGO_C01_DUPLICATE_REPOSITORY", `${repository} is duplicated.`);
    observed.set(repository, commitSha);
    const expectedAccess = repository === "CIBOTFLOW/Luzione-API"
      ? "WRITER_FOR_THIS_EVIDENCE_ONLY_BRANCH"
      : "READ_ONLY_EVIDENCE";
    if (access !== expectedAccess) {
      fail("SGO_C01_REPOSITORY_ACCESS_MISMATCH", `${repository} access must remain ${expectedAccess}.`);
    }
  }
  exactSet([...observed.keys()], Object.keys(SGO_C01_REPOSITORY_PINS), "source repositories");
  for (const [repository, expectedSha] of Object.entries(SGO_C01_REPOSITORY_PINS)) {
    if (observed.get(repository) !== expectedSha) {
      fail("SGO_C01_REPOSITORY_PIN_MISMATCH", `${repository} does not match the reconciled commit.`);
    }
  }
}

function validateEvidencePins(value: unknown) {
  const pins = array(value, "evidence_pins");
  const observed = new Map<string, Record<string, unknown>>();
  for (const [index, raw] of pins.entries()) {
    const pin = record(raw, `evidence_pins[${index}]`);
    const pinId = text(pin.pin_id, `evidence_pins[${index}].pin_id`);
    if (observed.has(pinId)) fail("SGO_C01_DUPLICATE_PIN", `${pinId} is duplicated.`);
    observed.set(pinId, pin);
  }
  exactSet([...observed.keys()], Object.keys(EVIDENCE_PIN_EXPECTATIONS), "evidence pins");
  for (const [pinId, expected] of Object.entries(EVIDENCE_PIN_EXPECTATIONS)) {
    const pin = observed.get(pinId);
    if (!pin) fail("SGO_C01_MISSING_PIN", `${pinId} is missing.`);
    const repository = text(pin.repository, `${pinId}.repository`);
    const commitSha = text(pin.commit_sha, `${pinId}.commit_sha`);
    const path = text(pin.path, `${pinId}.path`);
    const blobSha = text(pin.blob_sha, `${pinId}.blob_sha`);
    if (repository !== expected.repository || path !== expected.path || blobSha !== expected.blobSha) {
      fail("SGO_C01_EVIDENCE_PIN_MISMATCH", `${pinId} path/blob identity changed.`);
    }
    if (commitSha !== SGO_C01_REPOSITORY_PINS[expected.repository]) {
      fail("SGO_C01_EVIDENCE_COMMIT_MISMATCH", `${pinId} is not bound to its repository commit.`);
    }
    if (!SHA40.test(blobSha)) fail("SGO_C01_INVALID_SHA", `${pinId} blob must be a Git SHA.`);
  }
  return observed;
}

function validateProducerOrOwner(
  value: unknown,
  label: string,
  pins: ReadonlyMap<string, Record<string, unknown>>,
  kind: "producer" | "owner",
) {
  const item = record(value, label);
  const repository = text(item.repository, `${label}.repository`);
  const evidencePinId = text(item.evidence_pin_id, `${label}.evidence_pin_id`);
  const pin = pins.get(evidencePinId);
  if (!pin) fail("SGO_C01_UNKNOWN_PIN", `${label} references unknown pin ${evidencePinId}.`);
  if (text(pin.repository, `${evidencePinId}.repository`) !== repository) {
    fail("SGO_C01_OWNER_PIN_MISMATCH", `${label} repository does not own its evidence pin.`);
  }
  if (kind === "producer") {
    text(item.component, `${label}.component`);
    text(item.entry_symbol, `${label}.entry_symbol`);
  } else {
    text(item.source_scope, `${label}.source_scope`);
    text(item.readback, `${label}.readback`);
  }
  return { evidencePinId, repository };
}

function validateActiveSurfaces(
  value: unknown,
  pins: ReadonlyMap<string, Record<string, unknown>>,
) {
  const surfaces = array(value, "active_surfaces");
  const surfaceIds: string[] = [];
  const commandActions: string[] = [];
  const kinds = new Set<string>();

  for (const [index, raw] of surfaces.entries()) {
    const surface = record(raw, `active_surfaces[${index}]`);
    const id = text(surface.surface_id, `active_surfaces[${index}].surface_id`);
    const kind = text(surface.surface_kind, `${id}.surface_kind`);
    const reachability = text(surface.reachability, `${id}.reachability`);
    if (!["REACHABLE_ACTIVE", "REACHABLE_CONDITIONAL"].includes(reachability)) {
      fail("SGO_C01_UNCREDITABLE_REACHABILITY", `${id} cannot be credited with ${reachability}.`);
    }
    if (!boolean(surface.capability_credited, `${id}.capability_credited`)) {
      fail("SGO_C01_ACTIVE_NOT_CREDITED", `${id} must be an explicitly credited active row.`);
    }
    text(surface.runtime_condition, `${id}.runtime_condition`);
    const producer = validateProducerOrOwner(surface.runtime_producer, `${id}.runtime_producer`, pins, "producer");
    const owner = validateProducerOrOwner(surface.canonical_source_owner, `${id}.canonical_source_owner`, pins, "owner");
    if (["os-runtime-v2", "os-runtime-v2-persistence", "os-api-tool-client"].includes(producer.evidencePinId)) {
      fail("SGO_C01_SHADOW_PROMOTED", `${id} promotes a shadow Runtime v2/tool-client producer.`);
    }
    const expectedBinding = ACTIVE_BINDING_EXPECTATIONS[id];
    if (!expectedBinding
      || expectedBinding.kind !== kind
      || expectedBinding.reachability !== reachability
      || expectedBinding.producerPin !== producer.evidencePinId
      || expectedBinding.ownerPin !== owner.evidencePinId) {
      fail("SGO_C01_ACTIVE_BINDING_MISMATCH", `${id} changed its observed producer or canonical owner binding.`);
    }
    const actions = array(surface.action_types, `${id}.action_types`).map((item, actionIndex) =>
      text(item, `${id}.action_types[${actionIndex}]`));
    if (kind === "command") {
      if (actions.length !== 1) fail("SGO_C01_COMMAND_PRODUCER_AMBIGUOUS", `${id} must map one command action.`);
      commandActions.push(actions[0]);
    } else if (actions.length !== 0) {
      fail("SGO_C01_UNEXPECTED_ACTION", `${id} is not a command surface.`);
    }

    const chain = array(surface.evidence_chain, `${id}.evidence_chain`);
    if (chain.length < 4) fail("SGO_C01_NAME_ONLY_CLAIM", `${id} lacks a reachable evidence chain.`);
    const roles = new Set<string>();
    const chainPins = new Set<string>();
    for (const [chainIndex, rawHop] of chain.entries()) {
      const hop = record(rawHop, `${id}.evidence_chain[${chainIndex}]`);
      if (hop.ordinal !== chainIndex + 1) {
        fail("SGO_C01_EVIDENCE_ORDER_INVALID", `${id} evidence ordinals must be contiguous.`);
      }
      const role = text(hop.role, `${id}.evidence_chain[${chainIndex}].role`);
      roles.add(role);
      const pinId = text(hop.pin_id, `${id}.evidence_chain[${chainIndex}].pin_id`);
      if (!pins.has(pinId)) fail("SGO_C01_UNKNOWN_PIN", `${id} references unknown evidence pin ${pinId}.`);
      chainPins.add(pinId);
      if (text(hop.observation, `${id}.evidence_chain[${chainIndex}].observation`).length < 24) {
        fail("SGO_C01_NAME_ONLY_CLAIM", `${id} has a names-only evidence observation.`);
      }
    }
    for (const role of REQUIRED_EVIDENCE_ROLES) {
      if (!roles.has(role)) fail("SGO_C01_NAME_ONLY_CLAIM", `${id} lacks ${role} evidence.`);
    }
    if (!chainPins.has(producer.evidencePinId) || !chainPins.has(owner.evidencePinId)) {
      fail("SGO_C01_NAME_ONLY_CLAIM", `${id} does not bind its producer and owner pins into the reachable chain.`);
    }
    const authority = record(surface.authority, `${id}.authority`);
    if (boolean(authority.authorized_by_inventory, `${id}.authority.authorized_by_inventory`)) {
      fail("SGO_C01_AUTHORITY_EXPANSION", `${id} cannot receive authority from an inventory.`);
    }
    text(authority.observed_runtime_effect, `${id}.authority.observed_runtime_effect`);
    if (array(surface.limitations, `${id}.limitations`).length === 0) {
      fail("SGO_C01_LIMITS_MISSING", `${id} must retain an explicit limit.`);
    }
    surfaceIds.push(id);
    kinds.add(kind);
  }

  exactSet(surfaceIds, REQUIRED_SURFACE_IDS, "active surface IDs");
  exactSet(commandActions, REQUIRED_COMMAND_ACTIONS, "drawer command actions");
  exactSet([...kinds], ["chat", "quote-review", "task-assist", "simulation", "memory", "command"], "surface kinds");
  return { commandCount: commandActions.length, surfaceCount: surfaces.length };
}

function validateUncreditedPaths(
  value: unknown,
  pins: ReadonlyMap<string, Record<string, unknown>>,
) {
  const paths = array(value, "uncredited_paths");
  const observed = new Map<string, string>();
  for (const [index, raw] of paths.entries()) {
    const path = record(raw, `uncredited_paths[${index}]`);
    const id = text(path.path_id, `uncredited_paths[${index}].path_id`);
    const status = text(path.status, `${id}.status`);
    if (observed.has(id)) fail("SGO_C01_DUPLICATE_UNCREDITED_PATH", `${id} is duplicated.`);
    observed.set(id, status);
    if (boolean(path.capability_credited, `${id}.capability_credited`)) {
      fail("SGO_C01_UNCREDITED_PROMOTED", `${id} must remain uncredited.`);
    }
    if (Object.hasOwn(path, "runtime_producer")) {
      fail("SGO_C01_UNCREDITED_PROMOTED", `${id} cannot declare an active runtime producer.`);
    }
    const candidates = array(path.candidate_producers, `${id}.candidate_producers`);
    if (status === "AMBIGUOUS" ? candidates.length < 2 : candidates.length < 1) {
      fail("SGO_C01_UNCREDITED_EVIDENCE_MISSING", `${id} has no explicit candidate evidence.`);
    }
    for (const [candidateIndex, candidate] of candidates.entries()) {
      validateProducerOrOwner(candidate, `${id}.candidate_producers[${candidateIndex}]`, pins, "producer");
    }
    for (const [pinIndex, pin] of array(path.evidence_pin_ids, `${id}.evidence_pin_ids`).entries()) {
      const pinId = text(pin, `${id}.evidence_pin_ids[${pinIndex}]`);
      if (!pins.has(pinId)) fail("SGO_C01_UNKNOWN_PIN", `${id} references unknown pin ${pinId}.`);
    }
    if (text(path.reason, `${id}.reason`).length < 40 || text(path.negative_check, `${id}.negative_check`).length < 24) {
      fail("SGO_C01_UNCREDITED_REASON_MISSING", `${id} must explain its denial.`);
    }
  }
  exactSet([...observed.keys()], Object.keys(REQUIRED_UNCREDITED_PATHS), "uncredited path IDs");
  for (const [id, expectedStatus] of Object.entries(REQUIRED_UNCREDITED_PATHS)) {
    if (observed.get(id) !== expectedStatus) {
      fail("SGO_C01_UNCREDITED_STATUS_MISMATCH", `${id} must remain ${expectedStatus}.`);
    }
  }
  return paths.length;
}

export type SgoC01InventoryValidationSummary = {
  commandCount: number;
  evidencePinCount: number;
  surfaceCount: number;
  uncreditedPathCount: number;
};

export function validateSgoC01ActivePathInventory(value: unknown): SgoC01InventoryValidationSummary {
  const inventory = record(value, "inventory");
  if (inventory.schema_version !== 1 || inventory.inventory_id !== SGO_C01_INVENTORY_ID) {
    fail("SGO_C01_UNSUPPORTED_VERSION", "The SGO-C01 inventory identity is unsupported.");
  }
  if (inventory.build_program !== SGO_C01_BUILD_PROGRAM || inventory.task_id !== SGO_C01_TASK_ID) {
    fail("SGO_C01_EXECUTION_FILTER_MISMATCH", "The active build-program/task marker changed.");
  }
  if (inventory.controller_sha !== SGO_C01_CONTROLLER_SHA || inventory.controller_allowlist_count !== 68) {
    fail("SGO_C01_CONTROLLER_PIN_MISMATCH", "The controller decision or exact 68-ID admission changed.");
  }
  if (inventory.inventory_effect_authority !== "NO_EFFECT") {
    fail("SGO_C01_AUTHORITY_EXPANSION", "The inventory must remain NO_EFFECT.");
  }
  for (const field of ["runtime_activation", "route_activation", "deployment_performed", "production_effect_performed"] as const) {
    if (boolean(inventory[field], field)) fail("SGO_C01_AUTHORITY_EXPANSION", `${field} must remain false.`);
  }

  validateRepositoryPins(inventory.source_repositories);
  const pins = validateEvidencePins(inventory.evidence_pins);
  const active = validateActiveSurfaces(inventory.active_surfaces, pins);
  const uncreditedPathCount = validateUncreditedPaths(inventory.uncredited_paths, pins);
  const strongestClaim = record(inventory.strongest_claim, "strongest_claim");
  if (strongestClaim.engineering_state !== "CONTRACT_STABLE"
    || strongestClaim.release_evidence !== "LOCAL_PROVEN"
    || strongestClaim.effect_authority !== "NO_EFFECT"
    || strongestClaim.finality !== "BOUNDED_CLAIM") {
    fail("SGO_C01_FALSE_FINALITY", "The strongest claim exceeds bounded local contract evidence.");
  }
  if (array(inventory.remaining_uncertainty, "remaining_uncertainty").length < 4) {
    fail("SGO_C01_UNCERTAINTY_MISSING", "Material deployment and integration uncertainty must remain explicit.");
  }

  return {
    commandCount: active.commandCount,
    evidencePinCount: pins.size,
    surfaceCount: active.surfaceCount,
    uncreditedPathCount,
  };
}
