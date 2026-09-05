import crypto from "node:crypto";

import {
  CORE_CONTRACT_VERSIONS,
  type SetupMandateV1,
  type TenantBlueprintV1,
} from "@/modules/luzione-core-contracts/contracts";
import {
  parseSetupMandateV1,
  parseTenantBlueprintV1,
} from "@/modules/luzione-core-contracts/consumerSdk";
import { canonicalJson, sha256 } from "@/modules/platform-guarantees/eventContract";
import {
  TENANT_PACK_DRAFT_SCHEMA_DIGEST,
  assertTenantPackSourceBindingAdmitted,
  parseTenantPackSourceBinding,
  tenantPackSourceBindingDigest,
  type TenantPackSourceBindingV1,
} from "./sourceBinding";

export const LEGACY_ONBOARD_CORE_API_VERSION = "LuzioneOnboardCoreApi/v1";
export const ONBOARD_CORE_API_VERSION = "LuzioneOnboardCoreApi/v2";
export const TENANT_PACK_DRAFT_VERSION = "LuzioneTenantPackDraft/v1";
export const LEGACY_TENANT_BLUEPRINT_MAPPING_VERSION = "TenantBlueprintMap/v1";
export const TENANT_BLUEPRINT_MAPPING_VERSION = "TenantBlueprintMap/v2";
export const SETUP_MANDATE_REVOCATION_VERSION = "SetupMandateRevocation/v1";
export const ONBOARD_CORE_POLICY_VERSION = "ONBOARD-CORE-CORRECTION-01/policy-v2";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SECTION_KEYS = [
  "aiPolicies", "approvals", "connectors", "fields", "icp", "retention", "roles",
  "stages", "terminology", "workflows",
] as const;
const LIST_SECTION_KEYS = SECTION_KEYS.filter((key) => key !== "terminology");

export type TenantPackDraftV1 = {
  contractVersion: typeof TENANT_PACK_DRAFT_VERSION;
  sections: {
    aiPolicies: readonly string[];
    approvals: readonly string[];
    connectors: readonly string[];
    fields: readonly string[];
    icp: readonly string[];
    retention: readonly string[];
    roles: readonly string[];
    stages: readonly string[];
    terminology: Readonly<Record<string, string>>;
    workflows: readonly string[];
  };
  sourcePackId: string;
  sourcePackVersion: string;
  tenantSlug: string;
};

export type TenantBlueprintProposal = {
  contractVersion: typeof ONBOARD_CORE_API_VERSION;
  draft: TenantPackDraftV1;
  mappingVersion: typeof TENANT_BLUEPRINT_MAPPING_VERSION;
  sourceBinding: TenantPackSourceBindingV1;
  sourceDigest: string;
  sourceSchemaDigest: typeof TENANT_PACK_DRAFT_SCHEMA_DIGEST;
};

export type TenantBlueprintApprovalRequest = {
  blueprintId: string;
  contractVersion: typeof ONBOARD_CORE_API_VERSION;
  decision: "APPROVE" | "SUPERSEDE_AND_APPROVE";
  expectedObjectVersion: string;
  supersedesApprovalRef: string | null;
};

export type SetupMandateRequest = {
  blueprintId: string;
  blueprintVersion: string;
  contractVersion: typeof ONBOARD_CORE_API_VERSION;
  expectedBlueprintObjectVersion: string;
  profile: "NO_EFFECT_IMPORT_AND_CONNECTOR_VALIDATION";
};

export type SetupMandateRevocationRequest = {
  contractVersion: typeof ONBOARD_CORE_API_VERSION;
  expectedMandateObjectVersion: string;
  mandateId: string;
  reasonCode: "APPROVAL_WITHDRAWN" | "LIMIT_CHANGED" | "SECURITY_HOLD" | "SOURCE_WITHDRAWN";
  revocationVersion: typeof SETUP_MANDATE_REVOCATION_VERSION;
};

export class OnboardCoreContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "OnboardCoreContractError";
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(input: Record<string, unknown>, keys: readonly string[], field: string) {
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new OnboardCoreContractError("FIELD_SET_MISMATCH", `${field} must contain exactly: ${expected.join(", ")}.`);
  }
  return input;
}

function text(value: unknown, field: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function id(value: unknown, field: string) {
  const parsed = text(value, field, 200);
  if (!ID.test(parsed)) throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a stable identifier.`);
  return parsed;
}

function digest(value: unknown, field: string) {
  const parsed = text(value, field, 64);
  if (!DIGEST.test(parsed)) throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a lowercase SHA-256 digest.`);
  return parsed;
}

function uuid(value: unknown, field: string) {
  const parsed = text(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed)) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a UUID.`);
  }
  return parsed;
}

function inputList(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must be a non-empty bounded array.`);
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, 200));
  if (new Set(result).size !== result.length) {
    throw new OnboardCoreContractError("INVALID_REQUEST", `${field} must not contain duplicates.`);
  }
  return result;
}

function parseDraft(value: unknown): TenantPackDraftV1 {
  const draft = exact(object(value, "draft"), [
    "contractVersion", "sections", "sourcePackId", "sourcePackVersion", "tenantSlug",
  ], "draft");
  if (draft.contractVersion !== TENANT_PACK_DRAFT_VERSION) {
    throw new OnboardCoreContractError("WRONG_VERSION", `draft.contractVersion must be ${TENANT_PACK_DRAFT_VERSION}.`);
  }
  const sections = exact(object(draft.sections, "draft.sections"), SECTION_KEYS, "draft.sections");
  const parsedLists = Object.fromEntries(LIST_SECTION_KEYS.map((key) => [key, inputList(sections[key], `draft.sections.${key}`)]));
  const terminologyInput = object(sections.terminology, "draft.sections.terminology");
  if (Object.keys(terminologyInput).length === 0 || Object.keys(terminologyInput).length > 100) {
    throw new OnboardCoreContractError("INVALID_REQUEST", "draft.sections.terminology must be a non-empty bounded object.");
  }
  const terminology = Object.fromEntries(Object.entries(terminologyInput).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [
    id(key, "draft.sections.terminology key"),
    text(item, `draft.sections.terminology.${key}`, 200),
  ]));
  return {
    contractVersion: TENANT_PACK_DRAFT_VERSION,
    sections: { ...parsedLists, terminology } as TenantPackDraftV1["sections"],
    sourcePackId: id(draft.sourcePackId, "draft.sourcePackId"),
    sourcePackVersion: id(draft.sourcePackVersion, "draft.sourcePackVersion"),
    tenantSlug: id(draft.tenantSlug, "draft.tenantSlug"),
  };
}

export function parseTenantBlueprintProposal(value: unknown): TenantBlueprintProposal {
  const input = exact(object(value, "proposal"), [
    "contractVersion", "draft", "mappingVersion", "sourceBinding", "sourceDigest", "sourceSchemaDigest",
  ], "proposal");
  if (input.contractVersion !== ONBOARD_CORE_API_VERSION) {
    throw new OnboardCoreContractError("WRONG_VERSION", `contractVersion must be ${ONBOARD_CORE_API_VERSION}.`);
  }
  if (input.mappingVersion !== TENANT_BLUEPRINT_MAPPING_VERSION) {
    throw new OnboardCoreContractError("WRONG_MAPPING_VERSION", `mappingVersion must be ${TENANT_BLUEPRINT_MAPPING_VERSION}.`, 409);
  }
  const draft = parseDraft(input.draft);
  const sourceBinding = parseTenantPackSourceBinding(input.sourceBinding);
  if (input.sourceSchemaDigest !== TENANT_PACK_DRAFT_SCHEMA_DIGEST
    || sourceBinding.sourceSchemaDigest !== input.sourceSchemaDigest) {
    throw new OnboardCoreContractError("SOURCE_SCHEMA_DIGEST_MISMATCH", "sourceSchemaDigest must match both the admitted exact Tenant Pack schema bytes and source binding.", 409);
  }
  const sourceDigest = digest(input.sourceDigest, "sourceDigest");
  const computed = sha256(draft);
  if (computed !== sourceDigest) {
    throw new OnboardCoreContractError("SOURCE_DIGEST_MISMATCH", "sourceDigest must match the canonical draft content.", 409);
  }
  return {
    contractVersion: ONBOARD_CORE_API_VERSION,
    draft,
    mappingVersion: TENANT_BLUEPRINT_MAPPING_VERSION,
    sourceBinding,
    sourceDigest,
    sourceSchemaDigest: TENANT_PACK_DRAFT_SCHEMA_DIGEST,
  };
}

export function parseTenantBlueprintApprovalRequest(value: unknown): TenantBlueprintApprovalRequest {
  const input = exact(object(value, "approval"), [
    "blueprintId", "contractVersion", "decision", "expectedObjectVersion", "supersedesApprovalRef",
  ], "approval");
  if (input.contractVersion !== ONBOARD_CORE_API_VERSION) {
    throw new OnboardCoreContractError("WRONG_VERSION", `contractVersion must be ${ONBOARD_CORE_API_VERSION}.`);
  }
  if (input.decision !== "APPROVE" && input.decision !== "SUPERSEDE_AND_APPROVE") {
    throw new OnboardCoreContractError("INVALID_REQUEST", "decision must be APPROVE or SUPERSEDE_AND_APPROVE.");
  }
  const supersedesApprovalRef = input.supersedesApprovalRef === null
    ? null
    : id(input.supersedesApprovalRef, "supersedesApprovalRef");
  if ((input.decision === "APPROVE") !== (supersedesApprovalRef === null)) {
    throw new OnboardCoreContractError("APPROVAL_LINEAGE_INVALID", "Only SUPERSEDE_AND_APPROVE may carry supersedesApprovalRef.", 409);
  }
  return {
    blueprintId: uuid(input.blueprintId, "blueprintId"),
    contractVersion: ONBOARD_CORE_API_VERSION,
    decision: input.decision,
    expectedObjectVersion: text(input.expectedObjectVersion, "expectedObjectVersion", 300),
    supersedesApprovalRef,
  };
}

export function parseSetupMandateRequest(value: unknown): SetupMandateRequest {
  const input = exact(object(value, "mandate"), [
    "blueprintId", "blueprintVersion", "contractVersion", "expectedBlueprintObjectVersion", "profile",
  ], "mandate");
  if (input.contractVersion !== ONBOARD_CORE_API_VERSION) {
    throw new OnboardCoreContractError("WRONG_VERSION", `contractVersion must be ${ONBOARD_CORE_API_VERSION}.`);
  }
  if (input.profile !== "NO_EFFECT_IMPORT_AND_CONNECTOR_VALIDATION") {
    throw new OnboardCoreContractError("AUTHORITY_DENIED", "Only the no-effect onboarding profile is admitted.", 403);
  }
  return {
    blueprintId: uuid(input.blueprintId, "blueprintId"),
    blueprintVersion: id(input.blueprintVersion, "blueprintVersion"),
    contractVersion: ONBOARD_CORE_API_VERSION,
    expectedBlueprintObjectVersion: text(input.expectedBlueprintObjectVersion, "expectedBlueprintObjectVersion", 300),
    profile: "NO_EFFECT_IMPORT_AND_CONNECTOR_VALIDATION",
  };
}

export function parseSetupMandateRevocationRequest(value: unknown): SetupMandateRevocationRequest {
  const input = exact(object(value, "revocation"), [
    "contractVersion", "expectedMandateObjectVersion", "mandateId", "reasonCode", "revocationVersion",
  ], "revocation");
  if (input.contractVersion !== ONBOARD_CORE_API_VERSION) {
    throw new OnboardCoreContractError("WRONG_VERSION", `contractVersion must be ${ONBOARD_CORE_API_VERSION}.`);
  }
  if (input.revocationVersion !== SETUP_MANDATE_REVOCATION_VERSION) {
    throw new OnboardCoreContractError("WRONG_REVOCATION_VERSION", `revocationVersion must be ${SETUP_MANDATE_REVOCATION_VERSION}.`, 409);
  }
  if (!(new Set(["APPROVAL_WITHDRAWN", "LIMIT_CHANGED", "SECURITY_HOLD", "SOURCE_WITHDRAWN"])).has(String(input.reasonCode))) {
    throw new OnboardCoreContractError("INVALID_REQUEST", "reasonCode is unsupported.");
  }
  return {
    contractVersion: ONBOARD_CORE_API_VERSION,
    expectedMandateObjectVersion: text(input.expectedMandateObjectVersion, "expectedMandateObjectVersion", 300),
    mandateId: uuid(input.mandateId, "mandateId"),
    reasonCode: input.reasonCode as SetupMandateRevocationRequest["reasonCode"],
    revocationVersion: SETUP_MANDATE_REVOCATION_VERSION,
  };
}

function slug(value: string) {
  const normalized = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
  if (!normalized) throw new OnboardCoreContractError("INVALID_REQUEST", "Draft content cannot map to an empty canonical reference.");
  return normalized;
}

function namespaceList(kind: string, values: readonly string[]) {
  return [...new Set(values.map((value) => `${kind}:${slug(value)}`))].sort();
}

export function deterministicUuid(namespace: string, value: unknown) {
  const bytes = crypto.createHash("sha256").update(`${namespace}:${canonicalJson(value)}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function blueprintTuple(tenantId: string, proposal: TenantBlueprintProposal) {
  return {
    sourceBindingDigest: tenantPackSourceBindingDigest(proposal.sourceBinding),
    mappingVersion: proposal.mappingVersion,
    sourceDigest: proposal.sourceDigest,
    sourceSchemaDigest: proposal.sourceSchemaDigest,
    sourcePackId: proposal.draft.sourcePackId,
    sourcePackVersion: proposal.draft.sourcePackVersion,
    tenantId,
  };
}

export function blueprintIdempotencyKey(tenantId: string, proposal: TenantBlueprintProposal) {
  return `onboard-blueprint:${sha256(blueprintTuple(tenantId, proposal))}`;
}

export function issueDraftBlueprint(tenantId: string, proposal: TenantBlueprintProposal): TenantBlueprintV1 {
  if (proposal.draft.tenantSlug !== tenantId) {
    throw new OnboardCoreContractError("TENANT_MISMATCH", "draft.tenantSlug must match the authenticated tenant.", 403);
  }
  const terms = Object.fromEntries(Object.entries(proposal.draft.sections.terminology).map(([key, value]) => [
    `term:${slug(key)}`,
    `label:${slug(value)}`,
  ]));
  return parseTenantBlueprintV1({
    approval: { approvedAt: null, approvalRef: null, state: "DRAFT" },
    blueprintId: deterministicUuid("tenant-blueprint", blueprintTuple(tenantId, proposal)),
    contractVersion: CORE_CONTRACT_VERSIONS.tenantBlueprint,
    sections: {
      aiPolicies: namespaceList("ai-policy", proposal.draft.sections.aiPolicies),
      approvals: namespaceList("approval-policy", proposal.draft.sections.approvals),
      connectors: namespaceList("connector", proposal.draft.sections.connectors),
      fields: namespaceList("field", proposal.draft.sections.fields),
      icp: namespaceList("icp", proposal.draft.sections.icp),
      retention: namespaceList("retention-policy", proposal.draft.sections.retention),
      roles: namespaceList("role", proposal.draft.sections.roles),
      stages: namespaceList("stage", proposal.draft.sections.stages),
      terminology: terms,
      workflows: namespaceList("workflow", proposal.draft.sections.workflows),
    },
    tenantId,
    version: proposal.draft.sourcePackVersion,
  });
}

export function admitProposalSourceBinding(tenantId: string, proposal: TenantBlueprintProposal) {
  return assertTenantPackSourceBindingAdmitted({
    binding: proposal.sourceBinding,
    sourcePackId: proposal.draft.sourcePackId,
    sourcePackVersion: proposal.draft.sourcePackVersion,
    tenantId,
  });
}

export function issueApprovedBlueprint(draft: TenantBlueprintV1, input: { approvalRef: string; approvedAt: string; state?: "APPROVED" | "SUPERSEDED" }) {
  return parseTenantBlueprintV1({
    ...draft,
    approval: {
      approvedAt: input.approvedAt,
      approvalRef: input.approvalRef,
      state: input.state ?? "APPROVED",
    },
  });
}

export function issueSetupMandate(input: {
  approvalRef: string;
  approvedBlueprint: TenantBlueprintV1;
  mandateId?: string;
  requestedAt: string;
}): SetupMandateV1 {
  const requestedAt = new Date(input.requestedAt);
  if (!Number.isFinite(requestedAt.getTime())) throw new OnboardCoreContractError("INVALID_REQUEST", "requestedAt must be an ISO timestamp.");
  const expiresAt = new Date(requestedAt.getTime() + 24 * 60 * 60 * 1_000).toISOString();
  return parseSetupMandateV1({
    active: true,
    allowedActions: ["DRY_RUN_IMPORT", "RECONCILE_IMPORT", "VALIDATE_CONNECTOR_READBACK"],
    approvalRef: input.approvalRef,
    blueprintRef: { blueprintId: input.approvedBlueprint.blueprintId, version: input.approvedBlueprint.version },
    contractVersion: CORE_CONTRACT_VERSIONS.setupMandate,
    effectCeiling: "NO_EFFECT",
    expiresAt,
    limits: { maxImportRecords: 1_000, maxRuntimeMinutes: 30 },
    mandateId: input.mandateId ?? deterministicUuid("setup-mandate", {
      approvalRef: input.approvalRef,
      blueprintId: input.approvedBlueprint.blueprintId,
      tenantId: input.approvedBlueprint.tenantId,
      version: input.approvedBlueprint.version,
    }),
    prohibitedActions: [
      "CHANGE_SHARED_CODE_OR_SCHEMA",
      "COMPLETE_OAUTH",
      "CREATE_OR_READ_CREDENTIAL",
      "CROSS_TENANT",
      "DESTRUCTIVE_DATA_CLEANUP",
      "EXPAND_AUTHORITY",
      "SEND_EXTERNAL_COMMUNICATION",
    ],
    rollbackPlanRef: `blueprint-rollback:${input.approvedBlueprint.blueprintId}:${input.approvedBlueprint.version}`,
    tenantId: input.approvedBlueprint.tenantId,
  }, input.approvedBlueprint);
}

export function blueprintDraftObjectVersion(blueprint: TenantBlueprintV1, sourceDigest: string) {
  return `tenant-blueprint:${blueprint.blueprintId}:draft@${sourceDigest}`;
}

export function blueprintApprovalObjectVersion(blueprint: TenantBlueprintV1, approvalRef: string) {
  return `tenant-blueprint:${blueprint.blueprintId}:approved@${sha256({ approvalRef, version: blueprint.version })}`;
}

export function setupMandateObjectVersion(mandate: SetupMandateV1) {
  return `setup-mandate:${mandate.mandateId}@${sha256(mandate)}`;
}
