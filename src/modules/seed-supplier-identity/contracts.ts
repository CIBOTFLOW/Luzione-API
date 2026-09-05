import type {
  SeedAuthorityBoundaryV1,
  SeedMutationBoundaryV1,
  SeedReceiptReadbackV1,
  SeedSourceRefV1,
} from "@/modules/luzione-core-contracts/seedProductContracts";

export const SUPPLIER_PROFILE_CONTRACT_VERSION = "SupplierProfile/v1";
export const SUPPLIER_PROFILE_COMMAND_VERSION = "SeedSupplierIdentityCommand/v1";
export const SUPPLIER_PROFILE_POLICY_VERSION = "2026-09-05.seed-supplier-identity.no-effect.v1";
export const SUPPLIER_PROFILE_OWNER = "LUZIONE_SUPPLIER_IDENTITY";

export const SUPPLIER_CAPABILITIES = [
  "CATALOG_SOURCE",
  "FULFILLMENT_UPDATE",
  "PO_ACKNOWLEDGEMENT",
  "QUOTE_SUBMISSION",
  "RFQ_RESPONSE",
] as const;

export type SupplierCapability = (typeof SUPPLIER_CAPABILITIES)[number];
export type SupplierProfileStatus = "ARCHIVED" | "ELIGIBLE" | "EXPIRED" | "PROPOSED" | "REVOKED" | "SUSPENDED";
export type SupplierProfileTransitionAction = "ACTIVATE" | "ARCHIVE" | "EXPIRE" | "REVOKE" | "SUSPEND";

export type SupplierProfileRefInput = {
  objectId: string;
  objectType: "CONTACT" | "EVIDENCE_ARTIFACT";
  ownerProject: string;
  version: string;
};

export type SupplierProfileFacts = {
  approvedCategories: readonly string[];
  approvedRegions: readonly string[];
  capabilities: readonly SupplierCapability[];
  contactRefs: readonly SupplierProfileRefInput[];
  evidenceRefs: readonly SupplierProfileRefInput[];
  identityReview: {
    conflictRefs: readonly string[];
    duplicateAccountRefs: readonly string[];
  };
  provenanceRefs: readonly string[];
  validFrom: string;
  validUntil: string;
};

type CommonCommand = {
  commandId: string;
  contractVersion: typeof SUPPLIER_PROFILE_COMMAND_VERSION;
  expectedVersion: string;
  idempotencyKey: string;
};

export type SupplierProfileProposeCommand = CommonCommand & {
  accountId: string;
  accountVersion: string;
  commandType: "supplier_profile.propose";
  expectedVersion: "ABSENT";
  profile: SupplierProfileFacts;
};

export type SupplierProfileReviseCommand = CommonCommand & {
  accountId: string;
  accountVersion: string;
  commandType: "supplier_profile.revise";
  profile: SupplierProfileFacts;
  supplierProfileId: string;
};

export type SupplierProfileTransitionCommand = CommonCommand & {
  action: SupplierProfileTransitionAction;
  commandType: "supplier_profile.transition";
  evidenceRefs: readonly SupplierProfileRefInput[];
  reason: string;
  supplierProfileId: string;
};

export type SeedSupplierIdentityCommand =
  | SupplierProfileProposeCommand
  | SupplierProfileReviseCommand
  | SupplierProfileTransitionCommand;

export type SupplierProfileV1 = {
  authority: SeedAuthorityBoundaryV1;
  contractVersion: typeof SUPPLIER_PROFILE_CONTRACT_VERSION;
  createdAt: string;
  data: {
    accountRef: { accountId: string; accountVersion: string };
    approvedCategories: readonly string[];
    approvedRegions: readonly string[];
    capabilities: readonly SupplierCapability[];
    contactRefs: readonly SeedSourceRefV1[];
    decision: {
      action: "PROPOSE" | "REVISE" | SupplierProfileTransitionAction;
      decidedAt: string;
      humanActorId: string | null;
      humanAuthenticationRef: string | null;
      reason: string | null;
    };
    evidenceRefs: readonly SeedSourceRefV1[];
    identityReview: {
      conflictRefs: readonly string[];
      duplicateAccountRefs: readonly string[];
    };
    provenanceRefs: readonly string[];
    validFrom: string;
    validUntil: string;
  };
  mutation: SeedMutationBoundaryV1;
  receipt: SeedReceiptReadbackV1;
  resource: {
    archivedAt: string | null;
    id: string;
    status: SupplierProfileStatus;
    type: "SUPPLIER_PROFILE";
    version: string;
  };
  sourceRefs: readonly SeedSourceRefV1[];
  tenantId: string;
  updatedAt: string;
};

export class SeedSupplierIdentityContractError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "SeedSupplierIdentityContractError";
  }
}

type JsonObject = Record<string, unknown>;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RFC3339_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fail(code: string, message: string, status = 400): never {
  throw new SeedSupplierIdentityContractError(code, message, status);
}
function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_DOCUMENT", `${path} must be an object.`);
  return value as JsonObject;
}
function exact(value: unknown, keys: readonly string[], path: string) {
  const parsed = object(value, path);
  const expected = [...keys].sort();
  const actual = Object.keys(parsed).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("FIELD_SET_MISMATCH", `${path} fields must be exactly ${expected.join(", ")}; received ${actual.join(", ")}.`);
  }
  return parsed;
}
function text(value: unknown, path: string, max = 1_000) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail("INVALID_DOCUMENT", `${path} must be bounded text.`);
  return value.trim();
}
function nullableText(value: unknown, path: string, max = 1_000) {
  return value === null ? null : text(value, path, max);
}
function id(value: unknown, path: string) {
  if (typeof value !== "string" || value !== value.trim()) fail("INVALID_DOCUMENT", `${path} must not contain surrounding whitespace.`);
  const parsed = text(value, path, 512);
  if (!ID.test(parsed)) fail("INVALID_DOCUMENT", `${path} must be a stable canonical identifier.`);
  return parsed;
}
function nullableId(value: unknown, path: string) {
  return value === null ? null : id(value, path);
}
function digest(value: unknown, path: string) {
  if (typeof value !== "string" || !SHA256.test(value)) fail("INVALID_DOCUMENT", `${path} must be a lowercase SHA-256 digest.`);
  return value;
}
function timestamp(value: unknown, path: string) {
  if (typeof value !== "string" || !RFC3339_UTC_MILLISECONDS.test(value)) fail("INVALID_DOCUMENT", `${path} must be canonical RFC3339 UTC with millisecond precision.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail("INVALID_DOCUMENT", `${path} must be a real canonical calendar timestamp.`);
  return value;
}
function timestampOrNull(value: unknown, path: string) {
  return value === null ? null : timestamp(value, path);
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail("INVALID_DOCUMENT", `${path} is not allowed.`);
  return value as T;
}
function strings(value: unknown, path: string, requireOne = false) {
  if (!Array.isArray(value) || (requireOne && value.length === 0) || value.length > 100) fail("INVALID_DOCUMENT", `${path} must be ${requireOne ? "a non-empty" : "an"} bounded array.`);
  const parsed = value.map((item, index) => id(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail("INVALID_DOCUMENT", `${path} must not contain duplicates.`);
  return parsed.sort();
}
function reference(value: unknown, path: string, expectedType?: SupplierProfileRefInput["objectType"]): SupplierProfileRefInput {
  const parsed = exact(value, ["objectId", "objectType", "ownerProject", "version"], path);
  const objectType = enumValue(parsed.objectType, ["CONTACT", "EVIDENCE_ARTIFACT"], `${path}.objectType`);
  if (expectedType && objectType !== expectedType) fail("INVALID_DOCUMENT", `${path}.objectType must be ${expectedType}.`);
  return { objectId: id(parsed.objectId, `${path}.objectId`), objectType, ownerProject: id(parsed.ownerProject, `${path}.ownerProject`), version: id(parsed.version, `${path}.version`) };
}
function refs(value: unknown, path: string, expectedType: SupplierProfileRefInput["objectType"], requireOne = false) {
  if (!Array.isArray(value) || (requireOne && value.length === 0) || value.length > 100) fail("INVALID_DOCUMENT", `${path} must be ${requireOne ? "a non-empty" : "an"} bounded array.`);
  const parsed = value.map((item, index) => reference(item, `${path}[${index}]`, expectedType));
  const identities = parsed.map((item) => `${item.ownerProject}:${item.objectType}:${item.objectId}@${item.version}`);
  if (new Set(identities).size !== identities.length) fail("INVALID_DOCUMENT", `${path} must not contain duplicates.`);
  return parsed.sort((left, right) => left.objectId.localeCompare(right.objectId));
}
function profileFacts(value: unknown): SupplierProfileFacts {
  const parsed = exact(value, ["approvedCategories", "approvedRegions", "capabilities", "contactRefs", "evidenceRefs", "identityReview", "provenanceRefs", "validFrom", "validUntil"], "command.profile");
  const review = exact(parsed.identityReview, ["conflictRefs", "duplicateAccountRefs"], "command.profile.identityReview");
  const validFrom = timestamp(parsed.validFrom, "command.profile.validFrom");
  const validUntil = timestamp(parsed.validUntil, "command.profile.validUntil");
  if (Date.parse(validUntil) <= Date.parse(validFrom)) fail("INVALID_VALIDITY_WINDOW", "Supplier profile validUntil must be after validFrom.");
  const capabilities = strings(parsed.capabilities, "command.profile.capabilities", true).map((value) => enumValue(value, SUPPLIER_CAPABILITIES, "command.profile.capabilities"));
  return {
    approvedCategories: strings(parsed.approvedCategories, "command.profile.approvedCategories", true),
    approvedRegions: strings(parsed.approvedRegions, "command.profile.approvedRegions", true),
    capabilities,
    contactRefs: refs(parsed.contactRefs, "command.profile.contactRefs", "CONTACT"),
    evidenceRefs: refs(parsed.evidenceRefs, "command.profile.evidenceRefs", "EVIDENCE_ARTIFACT", true),
    identityReview: { conflictRefs: strings(review.conflictRefs, "command.profile.identityReview.conflictRefs"), duplicateAccountRefs: strings(review.duplicateAccountRefs, "command.profile.identityReview.duplicateAccountRefs") },
    provenanceRefs: strings(parsed.provenanceRefs, "command.profile.provenanceRefs", true),
    validFrom,
    validUntil,
  };
}
function common(input: JsonObject) {
  if (input.contractVersion !== SUPPLIER_PROFILE_COMMAND_VERSION) fail("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${SUPPLIER_PROFILE_COMMAND_VERSION}.`);
  return { commandId: id(input.commandId, "command.commandId"), contractVersion: SUPPLIER_PROFILE_COMMAND_VERSION, expectedVersion: id(input.expectedVersion, "command.expectedVersion"), idempotencyKey: id(input.idempotencyKey, "command.idempotencyKey") } as const;
}

export function parseSeedSupplierIdentityCommand(value: unknown): SeedSupplierIdentityCommand {
  const input = object(value, "command");
  const commandType = enumValue(input.commandType, ["supplier_profile.propose", "supplier_profile.revise", "supplier_profile.transition"], "command.commandType");
  if (commandType === "supplier_profile.propose") {
    exact(input, ["accountId", "accountVersion", "commandId", "commandType", "contractVersion", "expectedVersion", "idempotencyKey", "profile"], "command");
    if (input.expectedVersion !== "ABSENT") fail("VERSION_CONFLICT", "Supplier profile proposal must expect ABSENT.", 409);
    return { ...common(input), accountId: id(input.accountId, "command.accountId"), accountVersion: id(input.accountVersion, "command.accountVersion"), commandType, expectedVersion: "ABSENT", profile: profileFacts(input.profile) };
  }
  if (commandType === "supplier_profile.revise") {
    exact(input, ["accountId", "accountVersion", "commandId", "commandType", "contractVersion", "expectedVersion", "idempotencyKey", "profile", "supplierProfileId"], "command");
    if (input.expectedVersion === "ABSENT") fail("VERSION_CONFLICT", "Supplier profile revision must bind the current version.", 409);
    return { ...common(input), accountId: id(input.accountId, "command.accountId"), accountVersion: id(input.accountVersion, "command.accountVersion"), commandType, profile: profileFacts(input.profile), supplierProfileId: id(input.supplierProfileId, "command.supplierProfileId") };
  }
  exact(input, ["action", "commandId", "commandType", "contractVersion", "evidenceRefs", "expectedVersion", "idempotencyKey", "reason", "supplierProfileId"], "command");
  if (input.expectedVersion === "ABSENT") fail("VERSION_CONFLICT", "Supplier profile transition must bind the current version.", 409);
  return {
    ...common(input),
    action: enumValue(input.action, ["ACTIVATE", "ARCHIVE", "EXPIRE", "REVOKE", "SUSPEND"], "command.action"),
    commandType,
    evidenceRefs: refs(input.evidenceRefs, "command.evidenceRefs", "EVIDENCE_ARTIFACT", true),
    reason: text(input.reason, "command.reason", 2_000),
    supplierProfileId: id(input.supplierProfileId, "command.supplierProfileId"),
  };
}

function sourceReference(value: unknown, path: string): SeedSourceRefV1 {
  const parsed = exact(value, ["objectId", "objectType", "ownerProject", "tenantId", "version"], path);
  return { objectId: id(parsed.objectId, `${path}.objectId`), objectType: id(parsed.objectType, `${path}.objectType`), ownerProject: id(parsed.ownerProject, `${path}.ownerProject`), tenantId: id(parsed.tenantId, `${path}.tenantId`), version: id(parsed.version, `${path}.version`) };
}
function sourceReferences(value: unknown, path: string, requireOne = false) {
  if (!Array.isArray(value) || (requireOne && value.length === 0) || value.length > 300) fail("INVALID_DOCUMENT", `${path} must be ${requireOne ? "a non-empty" : "an"} bounded array.`);
  const parsed = value.map((item, index) => sourceReference(item, `${path}[${index}]`));
  const identities = parsed.map((item) => `${item.ownerProject}:${item.objectType}:${item.objectId}@${item.version}`);
  if (new Set(identities).size !== identities.length) fail("INVALID_DOCUMENT", `${path} must not contain duplicates.`);
  return parsed;
}

function sourceRefIdentity(ref: SeedSourceRefV1) {
  return `${ref.ownerProject}:${ref.objectType}:${ref.objectId}@${ref.version}`;
}

function sameReferenceSet(left: readonly SeedSourceRefV1[], right: readonly SeedSourceRefV1[]) {
  const leftSet = [...left].map(sourceRefIdentity).sort();
  const rightSet = [...right].map(sourceRefIdentity).sort();
  return leftSet.length === rightSet.length && leftSet.every((identity, index) => identity === rightSet[index]);
}

export function parseSupplierProfileV1(value: unknown): SupplierProfileV1 {
  const input = exact(value, ["authority", "contractVersion", "createdAt", "data", "mutation", "receipt", "resource", "sourceRefs", "tenantId", "updatedAt"], "supplierProfile");
  if (input.contractVersion !== SUPPLIER_PROFILE_CONTRACT_VERSION) fail("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${SUPPLIER_PROFILE_CONTRACT_VERSION}.`);
  const tenantId = id(input.tenantId, "supplierProfile.tenantId");
  const authority = exact(input.authority, ["actorId", "actorType", "approvalRef", "capability", "decision", "effectClass", "policyVersion", "serverDerivedIdentityRef"], "supplierProfile.authority");
  const mutation = exact(input.mutation, ["expectedVersion", "idempotencyKey", "payloadHash"], "supplierProfile.mutation");
  const receipt = exact(input.receipt, ["committedVersion", "finality", "observedAt", "observedVersion", "providerAcknowledgementRef", "receiptId", "sourceReadbackRef"], "supplierProfile.receipt");
  const resource = exact(input.resource, ["archivedAt", "id", "status", "type", "version"], "supplierProfile.resource");
  const data = exact(input.data, ["accountRef", "approvedCategories", "approvedRegions", "capabilities", "contactRefs", "decision", "evidenceRefs", "identityReview", "provenanceRefs", "validFrom", "validUntil"], "supplierProfile.data");
  const accountRef = exact(data.accountRef, ["accountId", "accountVersion"], "supplierProfile.data.accountRef");
  const decision = exact(data.decision, ["action", "decidedAt", "humanActorId", "humanAuthenticationRef", "reason"], "supplierProfile.data.decision");
  const identityReview = exact(data.identityReview, ["conflictRefs", "duplicateAccountRefs"], "supplierProfile.data.identityReview");
  const status = enumValue(resource.status, ["ARCHIVED", "ELIGIBLE", "EXPIRED", "PROPOSED", "REVOKED", "SUSPENDED"], "supplierProfile.resource.status");
  const action = enumValue(decision.action, ["ACTIVATE", "ARCHIVE", "EXPIRE", "PROPOSE", "REVISE", "REVOKE", "SUSPEND"], "supplierProfile.data.decision.action");
  const actorType = enumValue(authority.actorType, ["HUMAN", "SERVICE", "SULTAN_AGENT"], "supplierProfile.authority.actorType");
  const approvalRef = nullableId(authority.approvalRef, "supplierProfile.authority.approvalRef");
  const humanActorId = nullableId(decision.humanActorId, "supplierProfile.data.decision.humanActorId");
  const humanAuthenticationRef = nullableId(decision.humanAuthenticationRef, "supplierProfile.data.decision.humanAuthenticationRef");
  const authorityDecision = enumValue(authority.decision, ["ALLOW", "DENY", "REQUIRE_HUMAN"], "supplierProfile.authority.decision");
  const effectClass = enumValue(authority.effectClass, ["A0", "A1", "A2", "A3", "A4"], "supplierProfile.authority.effectClass");
  const isProposal = action === "PROPOSE" || action === "REVISE";
  const authorityActorId = id(authority.actorId, "supplierProfile.authority.actorId");
  const authorityCapability = id(authority.capability, "supplierProfile.authority.capability");
  const policyVersion = id(authority.policyVersion, "supplierProfile.authority.policyVersion");
  if (policyVersion !== SUPPLIER_PROFILE_POLICY_VERSION) fail("FALSE_AUTHORITY", "Supplier Profile policy version is not admitted.", 409);
  const expectedCapability = isProposal ? `supplier_profile.${action.toLowerCase()}` : "supplier_profile.transition";
  if (authorityCapability !== expectedCapability) fail("FALSE_AUTHORITY", "Supplier Profile authority capability does not match its decision action.", 409);
  const serverDerivedIdentityRef = id(authority.serverDerivedIdentityRef, "supplierProfile.authority.serverDerivedIdentityRef");
  if (!/^correlation:[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/.test(serverDerivedIdentityRef)) fail("FALSE_AUTHORITY", "Supplier Profile identity must bind a server-derived correlation reference.", 409);
  if (isProposal) {
    if (effectClass !== "A1" || authorityDecision !== "ALLOW" || actorType !== "HUMAN" || approvalRef || humanActorId || humanAuthenticationRef) {
      fail("FALSE_AUTHORITY", "Supplier proposal and revision facts require A1 + ALLOW without approval evidence.", 409);
    }
  } else if (effectClass !== "A2" || authorityDecision !== "REQUIRE_HUMAN" || actorType !== "HUMAN" || !approvalRef || !humanActorId || !humanAuthenticationRef) {
    fail("HUMAN_APPROVAL_REQUIRED", "Supplier eligibility decisions require A2 + REQUIRE_HUMAN and an exact credential-bound human.", 403);
  }
  if (approvalRef && !/^approval:[a-f0-9]{64}$/.test(approvalRef)) fail("FALSE_AUTHORITY", "Supplier Profile approval reference is malformed.", 409);
  if (receipt.finality !== "DOMAIN_COMMITTED" || receipt.providerAcknowledgementRef !== null || receipt.sourceReadbackRef !== null
    || receipt.observedAt !== null || receipt.observedVersion !== null) {
    fail("FALSE_FINALITY", "SupplierProfile/v1 is an internal domain commit without provider or source observation.", 409);
  }
  const parsedContacts = sourceReferences(data.contactRefs, "supplierProfile.data.contactRefs");
  const parsedEvidence = sourceReferences(data.evidenceRefs, "supplierProfile.data.evidenceRefs", true);
  const parsedSources = sourceReferences(input.sourceRefs, "supplierProfile.sourceRefs", true);
  if ([...parsedContacts, ...parsedEvidence, ...parsedSources].some((ref) => ref.tenantId !== tenantId)) fail("TENANT_MISMATCH", "Supplier Profile references must remain in one tenant.", 403);
  if (parsedContacts.some((ref) => ref.objectType !== "CONTACT" || ref.ownerProject !== "LUZIONE_CRM")) fail("SOURCE_LINEAGE_MISMATCH", "Supplier contact lineage must use LUZIONE_CRM CONTACT references.", 409);
  if (parsedEvidence.some((ref) => ref.objectType !== "EVIDENCE_ARTIFACT" || ref.ownerProject !== "LUZIONE_PROCUREMENT")) fail("SOURCE_LINEAGE_MISMATCH", "Supplier evidence lineage must use LUZIONE_PROCUREMENT EVIDENCE_ARTIFACT references.", 409);
  if (resource.type !== "SUPPLIER_PROFILE") fail("INVALID_DOCUMENT", "resource.type must be SUPPLIER_PROFILE.");
  const version = id(resource.version, "supplierProfile.resource.version");
  if (receipt.committedVersion !== version) fail("READBACK_VERSION_MISMATCH", "Receipt and Supplier Profile versions must match.", 409);
  const accountId = id(accountRef.accountId, "supplierProfile.data.accountRef.accountId");
  const accountVersion = id(accountRef.accountVersion, "supplierProfile.data.accountRef.accountVersion");
  if (!accountVersion.startsWith(`account:${accountId}:v`)) fail("SOURCE_LINEAGE_MISMATCH", "Supplier Profile Account version must bind its exact Account ID.", 409);
  const expectedSources: SeedSourceRefV1[] = [
    { objectId: accountId, objectType: "ACCOUNT", ownerProject: "LUZIONE_CRM", tenantId, version: accountVersion },
    ...parsedContacts,
    ...parsedEvidence,
  ];
  if (!sameReferenceSet(parsedSources, expectedSources)) fail("SOURCE_LINEAGE_MISMATCH", "Supplier Profile sourceRefs must exactly cover its Account, Contact, and Evidence lineage.", 409);
  const validFrom = timestamp(data.validFrom, "supplierProfile.data.validFrom");
  const validUntil = timestamp(data.validUntil, "supplierProfile.data.validUntil");
  if (Date.parse(validUntil) <= Date.parse(validFrom)) fail("INVALID_VALIDITY_WINDOW", "Supplier Profile validity is inverted.");
  const createdAt = timestamp(input.createdAt, "supplierProfile.createdAt");
  const updatedAt = timestamp(input.updatedAt, "supplierProfile.updatedAt");
  const decidedAt = timestamp(decision.decidedAt, "supplierProfile.data.decision.decidedAt");
  const reason = nullableText(decision.reason, "supplierProfile.data.decision.reason", 2_000);
  if (isProposal ? reason !== null : reason === null) fail("INVALID_DOCUMENT", "Supplier Profile decision reason is inconsistent with its action.");
  if (Date.parse(updatedAt) < Date.parse(createdAt) || Date.parse(decidedAt) !== Date.parse(updatedAt)) fail("INVALID_DOCUMENT", "Supplier Profile timestamps are not monotonic or decision-aligned.");
  const archivedAt = timestampOrNull(resource.archivedAt, "supplierProfile.resource.archivedAt");
  if ((status === "ARCHIVED") !== Boolean(archivedAt) || (archivedAt && archivedAt !== updatedAt)) fail("INVALID_DOCUMENT", "Supplier Profile archivedAt must exactly match an ARCHIVED disposition.");
  const expectedStatus: Partial<Record<typeof action, SupplierProfileStatus | readonly SupplierProfileStatus[]>> = {
    ACTIVATE: "ELIGIBLE", ARCHIVE: "ARCHIVED", EXPIRE: "EXPIRED", PROPOSE: "PROPOSED", REVISE: "PROPOSED", REVOKE: "REVOKED", SUSPEND: "SUSPENDED",
  };
  const allowedStatus = expectedStatus[action];
  if (Array.isArray(allowedStatus) ? !allowedStatus.includes(status) : allowedStatus !== status) fail("INVALID_DOCUMENT", "Supplier Profile action and status are inconsistent.");
  const resourceId = id(resource.id, "supplierProfile.resource.id");
  const versionMatch = /^supplier-profile:(.+):v([1-9][0-9]*)$/.exec(version);
  if (!versionMatch || versionMatch[1] !== resourceId) fail("INVALID_DOCUMENT", "Supplier Profile resource version must bind its stable ID and positive integer version.");
  const versionNumber = Number(versionMatch[2]);
  if (!Number.isSafeInteger(versionNumber)) fail("INVALID_DOCUMENT", "Supplier Profile resource version is outside the supported range.");
  const expectedMutationVersion = mutation.expectedVersion === null ? null : id(mutation.expectedVersion, "supplierProfile.mutation.expectedVersion");
  if (expectedMutationVersion === null) fail("VERSION_CONFLICT", "Supplier Profile facts require an exact expectedVersion.", 409);
  if ((action === "PROPOSE") !== (expectedMutationVersion === "ABSENT")) fail("VERSION_CONFLICT", "Supplier Profile mutation expectedVersion is inconsistent with its action.", 409);
  if (action === "PROPOSE" && versionNumber !== 1) fail("VERSION_CONFLICT", "An initial Supplier Profile proposal must commit version 1.", 409);
  if (action !== "PROPOSE" && expectedMutationVersion !== `supplier-profile:${resourceId}:v${versionNumber - 1}`) fail("VERSION_CONFLICT", "Supplier Profile mutation must bind the immediately prior exact version.", 409);
  if (!isProposal && humanActorId !== authorityActorId) fail("FALSE_AUTHORITY", "Supplier Profile approving actor must match decision humanActorId.", 409);
  return {
    authority: {
      actorId: authorityActorId, actorType, approvalRef,
      capability: authorityCapability, decision: authorityDecision,
      effectClass, policyVersion, serverDerivedIdentityRef,
    },
    contractVersion: SUPPLIER_PROFILE_CONTRACT_VERSION,
    createdAt,
    data: {
      accountRef: { accountId, accountVersion },
      approvedCategories: strings(data.approvedCategories, "supplierProfile.data.approvedCategories", true), approvedRegions: strings(data.approvedRegions, "supplierProfile.data.approvedRegions", true),
      capabilities: strings(data.capabilities, "supplierProfile.data.capabilities", true).map((capability) => enumValue(capability, SUPPLIER_CAPABILITIES, "supplierProfile.data.capabilities")),
      contactRefs: parsedContacts,
      decision: { action, decidedAt, humanActorId, humanAuthenticationRef, reason },
      evidenceRefs: parsedEvidence,
      identityReview: { conflictRefs: strings(identityReview.conflictRefs, "supplierProfile.data.identityReview.conflictRefs"), duplicateAccountRefs: strings(identityReview.duplicateAccountRefs, "supplierProfile.data.identityReview.duplicateAccountRefs") },
      provenanceRefs: strings(data.provenanceRefs, "supplierProfile.data.provenanceRefs", true), validFrom, validUntil,
    },
    mutation: { expectedVersion: expectedMutationVersion, idempotencyKey: id(mutation.idempotencyKey, "supplierProfile.mutation.idempotencyKey"), payloadHash: digest(mutation.payloadHash, "supplierProfile.mutation.payloadHash") },
    receipt: { committedVersion: version, finality: "DOMAIN_COMMITTED", observedAt: null, observedVersion: null, providerAcknowledgementRef: null, receiptId: id(receipt.receiptId, "supplierProfile.receipt.receiptId"), sourceReadbackRef: null },
    resource: { archivedAt, id: resourceId, status, type: "SUPPLIER_PROFILE", version },
    sourceRefs: parsedSources,
    tenantId,
    updatedAt,
  };
}
