import type { ApiActor } from "@/lib/api/actor";
import type { HumanApprovalSubject } from "@/modules/onboard-core/humanApproval";
import { HUMAN_APPROVAL_SUBJECT_VERSION } from "@/modules/onboard-core/humanApproval";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { REQUEST_IDENTITY_CONTRACT_VERSION } from "@/modules/platform-contracts/requestIdentity";
import {
  SUPPLIER_PROFILE_COMMAND_VERSION,
  SUPPLIER_PROFILE_CONTRACT_VERSION,
  SUPPLIER_PROFILE_POLICY_VERSION,
  parseSeedSupplierIdentityCommand,
  parseSupplierProfileV1,
} from "@/modules/seed-supplier-identity/contracts";
import { accountVersionRef, supplierProfileIdFor, supplierProfileVersion } from "@/modules/seed-supplier-identity/model";
import { createSupplierProfileReadModel } from "@/modules/seed-supplier-identity/readModel";
import {
  PORTAL_ACCOUNT_ACCESS_BINDING_VERSION,
  PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION,
  parsePortalAccountAccessBindingCommand,
  parsePortalAccountAccessBindingV1,
  portalAccountAccessBindingId,
  portalAccountAccessBindingVersion,
} from "@/modules/seed-supplier-identity/portalAccessContracts";
import { API_HTTP_RESPONSE_VERSION } from "@/modules/seed-project-publication/readModel";
import { parseTimelineEventV1 } from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import { SEED_PRODUCT_CONTRACT_VERSIONS } from "@/modules/luzione-core-contracts/seedProductContracts";

export const supplierFixtureTenantId = "tenant-seed";
export const supplierFixtureAccountId = "supplier-account-1";
export const supplierFixtureAccountVersion = accountVersionRef(supplierFixtureAccountId, 1);
export const supplierFixtureProfileId = supplierProfileIdFor(supplierFixtureTenantId, supplierFixtureAccountId);

export const supplierEvidenceRefFixture = {
  objectId: "evidence-artifact-supplier-1",
  objectType: "EVIDENCE_ARTIFACT" as const,
  ownerProject: "LUZIONE_PROCUREMENT",
  version: "evidence-artifact:evidence-artifact-supplier-1:v1",
};

export const supplierProfileFactsFixture = {
  approvedCategories: ["casegoods", "seating"],
  approvedRegions: ["US-CA", "US-NY"],
  capabilities: ["CATALOG_SOURCE", "PO_ACKNOWLEDGEMENT", "QUOTE_SUBMISSION", "RFQ_RESPONSE"] as const,
  contactRefs: [],
  evidenceRefs: [supplierEvidenceRefFixture],
  identityReview: { conflictRefs: [], duplicateAccountRefs: [] },
  provenanceRefs: ["operator-review:supplier-onboarding-1"],
  validFrom: "2026-09-05T17:30:00.000Z",
  validUntil: "2027-09-05T17:30:00.000Z",
};

export const supplierProfileProposeCommandFixture = parseSeedSupplierIdentityCommand({
  accountId: supplierFixtureAccountId,
  accountVersion: supplierFixtureAccountVersion,
  commandId: "supplier-profile-propose-1",
  commandType: "supplier_profile.propose",
  contractVersion: SUPPLIER_PROFILE_COMMAND_VERSION,
  expectedVersion: "ABSENT",
  idempotencyKey: "supplier-profile-propose-idempotency-1",
  profile: supplierProfileFactsFixture,
});

export const supplierProfileActivateCommandFixture = parseSeedSupplierIdentityCommand({
  action: "ACTIVATE",
  commandId: "supplier-profile-activate-1",
  commandType: "supplier_profile.transition",
  contractVersion: SUPPLIER_PROFILE_COMMAND_VERSION,
  evidenceRefs: [supplierEvidenceRefFixture],
  expectedVersion: supplierProfileVersion(supplierFixtureProfileId, 1),
  idempotencyKey: "supplier-profile-activate-idempotency-1",
  reason: "Credential-bound human approved supplier eligibility.",
  supplierProfileId: supplierFixtureProfileId,
});

export const supplierProfileHumanFixture: HumanApprovalSubject = Object.freeze({
  actorId: "user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  actorType: "user",
  authenticationRef: "supabase-session:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  authenticatedAt: "2026-09-05T17:29:00.000Z",
  capabilities: Object.freeze(["supplier.profile.activate", "supplier.profile.archive", "supplier.profile.expire", "supplier.profile.propose", "supplier.profile.revise", "supplier.profile.revoke", "supplier.profile.suspend"]),
  contractVersion: HUMAN_APPROVAL_SUBJECT_VERSION,
  source: "supabase-user-jwt",
  tenantId: supplierFixtureTenantId,
});

export const supplierProfileActorFixture: ApiActor = Object.freeze({
  actorId: "service:luzione-ui",
  actorType: "service",
  capabilities: Object.freeze(["supplier.profile.command", "supplier.profile.read"]),
  source: "vercel-oidc",
  tenantId: supplierFixtureTenantId,
});

export const supplierProfileEligibleFixture = parseSupplierProfileV1({
  authority: {
    actorId: supplierProfileHumanFixture.actorId,
    actorType: "HUMAN",
    approvalRef: "approval:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    capability: "supplier_profile.transition",
    decision: "REQUIRE_HUMAN",
    effectClass: "A2",
    policyVersion: SUPPLIER_PROFILE_POLICY_VERSION,
    serverDerivedIdentityRef: "correlation:supplier-profile-proof-1",
  },
  contractVersion: SUPPLIER_PROFILE_CONTRACT_VERSION,
  createdAt: "2026-09-05T17:30:00.000Z",
  data: {
    accountRef: { accountId: supplierFixtureAccountId, accountVersion: supplierFixtureAccountVersion },
    approvedCategories: supplierProfileFactsFixture.approvedCategories,
    approvedRegions: supplierProfileFactsFixture.approvedRegions,
    capabilities: supplierProfileFactsFixture.capabilities,
    contactRefs: [],
    decision: { action: "ACTIVATE", decidedAt: "2026-09-05T17:31:00.000Z", humanActorId: supplierProfileHumanFixture.actorId, humanAuthenticationRef: supplierProfileHumanFixture.authenticationRef, reason: "Credential-bound human approved supplier eligibility." },
    evidenceRefs: [{ ...supplierEvidenceRefFixture, tenantId: supplierFixtureTenantId }],
    identityReview: supplierProfileFactsFixture.identityReview,
    provenanceRefs: supplierProfileFactsFixture.provenanceRefs,
    validFrom: supplierProfileFactsFixture.validFrom,
    validUntil: supplierProfileFactsFixture.validUntil,
  },
  mutation: { expectedVersion: supplierProfileVersion(supplierFixtureProfileId, 1), idempotencyKey: "supplier-profile-activate-idempotency-1", payloadHash: "d".repeat(64) },
  receipt: { committedVersion: supplierProfileVersion(supplierFixtureProfileId, 2), finality: "DOMAIN_COMMITTED", observedAt: null, observedVersion: null, providerAcknowledgementRef: null, receiptId: "receipt-supplier-profile-2", sourceReadbackRef: null },
  resource: { archivedAt: null, id: supplierFixtureProfileId, status: "ELIGIBLE", type: "SUPPLIER_PROFILE", version: supplierProfileVersion(supplierFixtureProfileId, 2) },
  sourceRefs: [
    { objectId: supplierFixtureAccountId, objectType: "ACCOUNT", ownerProject: "LUZIONE_CRM", tenantId: supplierFixtureTenantId, version: supplierFixtureAccountVersion },
    { ...supplierEvidenceRefFixture, tenantId: supplierFixtureTenantId },
  ],
  tenantId: supplierFixtureTenantId,
  updatedAt: "2026-09-05T17:31:00.000Z",
});

export const supplierProfileTimelineFixture = parseTimelineEventV1({
  authority: supplierProfileEligibleFixture.authority,
  contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent,
  createdAt: "2026-09-05T17:31:00.000Z",
  data: {
    actorId: supplierProfileHumanFixture.actorId,
    aggregateRefs: [{ objectId: supplierFixtureProfileId, objectType: "SUPPLIER_PROFILE", ownerProject: "LUZIONE_SUPPLIER_IDENTITY", tenantId: supplierFixtureTenantId, version: supplierProfileVersion(supplierFixtureProfileId, 2) }],
    eventType: "SUPPLIER_PROFILE_TRANSITION",
    evidenceRefs: [supplierEvidenceRefFixture.objectId],
    occurredAt: "2026-09-05T17:31:00.000Z",
    recordedAt: "2026-09-05T17:31:00.000Z",
    summary: "Accepted supplier eligibility activation with an exact durable owner receipt.",
    visibility: "INTERNAL",
  },
  mutation: supplierProfileEligibleFixture.mutation,
  receipt: { ...supplierProfileEligibleFixture.receipt },
  resource: { archivedAt: null, id: "supplier-profile-event-2", status: "ACTIVE", type: "TIMELINE_EVENT", version: supplierProfileVersion(supplierFixtureProfileId, 2) },
  sourceRefs: [{ objectId: supplierFixtureProfileId, objectType: "SUPPLIER_PROFILE", ownerProject: "LUZIONE_SUPPLIER_IDENTITY", tenantId: supplierFixtureTenantId, version: supplierProfileVersion(supplierFixtureProfileId, 2) }],
  tenantId: supplierFixtureTenantId,
  updatedAt: "2026-09-05T17:31:00.000Z",
});

export const supplierProfileReadModelFixture = createSupplierProfileReadModel(supplierProfileEligibleFixture, supplierProfileTimelineFixture, {
  observedAt: "2026-09-05T17:31:00.000Z",
  releaseIdentity: createReleaseIdentity({ environment: {}, mutationsEnabled: false }),
  tenantId: supplierFixtureTenantId,
});

export const portalOrganizationFixtureId = "portal-organization-supplier-1";
export const portalSupplierBindingFixtureId = portalAccountAccessBindingId(supplierFixtureTenantId, portalOrganizationFixtureId, supplierFixtureAccountId);
export const portalSupplierMembershipRefFixture = { id: "portal-membership-supplier-1", status: "ACTIVE" as const, version: "membership:portal-membership-supplier-1:v1" };
export const portalSupplierObjectGrantRefFixture = { id: "portal-object-grant-supplier-1", status: "ACTIVE" as const, version: "object-grant:portal-object-grant-supplier-1:v1" };

export const portalSupplierBindingRecordCommandFixture = parsePortalAccountAccessBindingCommand({
  accountId: supplierFixtureAccountId,
  accountVersion: supplierFixtureAccountVersion,
  bindingId: portalSupplierBindingFixtureId,
  commandId: "portal-supplier-binding-record-1",
  commandType: "portal_account_access_binding.record",
  contractVersion: PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION,
  evidenceRefs: [supplierEvidenceRefFixture],
  expectedVersion: "ABSENT",
  idempotencyKey: "portal-supplier-binding-record-idempotency-1",
  membershipRef: portalSupplierMembershipRefFixture,
  objectGrantRef: portalSupplierObjectGrantRefFixture,
  organizationId: portalOrganizationFixtureId,
});

export const portalSupplierBindingActiveFixture = parsePortalAccountAccessBindingV1({
  accountRef: { accountId: supplierFixtureAccountId, accountVersion: supplierFixtureAccountVersion },
  authority: {
    decision: "REQUIRE_HUMAN",
    effectClass: "A2",
    humanActorId: supplierProfileHumanFixture.actorId,
    humanAuthenticationRef: supplierProfileHumanFixture.authenticationRef,
    workloadActorId: "service:luzione-supplier-portal",
  },
  bindingId: portalSupplierBindingFixtureId,
  contractVersion: PORTAL_ACCOUNT_ACCESS_BINDING_VERSION,
  createdAt: "2026-09-05T17:32:00.000Z",
  evidenceRefs: [supplierEvidenceRefFixture],
  membershipRef: portalSupplierMembershipRefFixture,
  objectGrantRef: portalSupplierObjectGrantRefFixture,
  organizationId: portalOrganizationFixtureId,
  receipt: {
    committedVersion: portalAccountAccessBindingVersion(portalSupplierBindingFixtureId, 1),
    finality: "DOMAIN_COMMITTED",
    payloadHash: "e".repeat(64),
    receiptId: "receipt-portal-supplier-binding-1",
  },
  revocationRef: null,
  status: "ACTIVE",
  tenantId: supplierFixtureTenantId,
  version: portalAccountAccessBindingVersion(portalSupplierBindingFixtureId, 1),
});

const portalSupplierBindingRef = {
  objectId: portalSupplierBindingFixtureId,
  objectType: "PORTAL_ACCOUNT_ACCESS_BINDING",
  ownerProject: "LUZIONE_SUPPLIER_IDENTITY",
  tenantId: supplierFixtureTenantId,
  version: portalSupplierBindingActiveFixture.version,
};

export const portalSupplierBindingTimelineFixture = parseTimelineEventV1({
  authority: {
    actorId: supplierProfileHumanFixture.actorId,
    actorType: "HUMAN",
    approvalRef: "approval:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    capability: "portal_account_access_binding.record",
    decision: "REQUIRE_HUMAN",
    effectClass: "A2",
    policyVersion: SUPPLIER_PROFILE_POLICY_VERSION,
    serverDerivedIdentityRef: "correlation:portal-supplier-binding-fixture",
  },
  contractVersion: SEED_PRODUCT_CONTRACT_VERSIONS.timelineEvent,
  createdAt: portalSupplierBindingActiveFixture.createdAt,
  data: {
    actorId: supplierProfileHumanFixture.actorId,
    aggregateRefs: [portalSupplierBindingRef],
    eventType: "PORTAL_ACCOUNT_ACCESS_BINDING_RECORD",
    evidenceRefs: [supplierEvidenceRefFixture.objectId],
    occurredAt: portalSupplierBindingActiveFixture.createdAt,
    recordedAt: portalSupplierBindingActiveFixture.createdAt,
    summary: "Accepted Portal organization-to-Account access binding with exact human approval and workload attribution.",
    visibility: "INTERNAL",
  },
  mutation: { expectedVersion: "ABSENT", idempotencyKey: portalSupplierBindingRecordCommandFixture.idempotencyKey, payloadHash: portalSupplierBindingActiveFixture.receipt.payloadHash },
  receipt: { committedVersion: portalSupplierBindingActiveFixture.version, finality: "DOMAIN_COMMITTED", observedAt: null, observedVersion: null, providerAcknowledgementRef: null, receiptId: portalSupplierBindingActiveFixture.receipt.receiptId, sourceReadbackRef: null },
  resource: { archivedAt: null, id: "portal-supplier-binding-event-1", status: "ACTIVE", type: "TIMELINE_EVENT", version: portalSupplierBindingActiveFixture.version },
  sourceRefs: [portalSupplierBindingRef],
  tenantId: supplierFixtureTenantId,
  updatedAt: portalSupplierBindingActiveFixture.createdAt,
});

const fixtureRequest = {
  correlationId: "correlation-seed-supplier-identity-fixture",
  requestId: "request-seed-supplier-identity-fixture",
  requestIdentityContractVersion: REQUEST_IDENTITY_CONTRACT_VERSION,
  responseContractVersion: API_HTTP_RESPONSE_VERSION,
  traceId: "1234567890abcdef1234567890abcdef",
} as const;

export const supplierProfileReadHttpResponsePositiveFixture = {
  ...fixtureRequest,
  ok: true,
  result: supplierProfileReadModelFixture,
} as const;

export const supplierProfileCommandHttpResponsePositiveFixture = {
  ...fixtureRequest,
  ok: true,
  result: {
    readback: { supplierProfile: supplierProfileEligibleFixture, timelineEvent: supplierProfileTimelineFixture },
    readbackMatchesReceipt: true,
    receipt: {
      commandId: supplierProfileActivateCommandFixture.commandId,
      correlationId: fixtureRequest.correlationId,
      eventId: "event-supplier-profile-activate-1",
      idempotentReplay: false,
      idempotencyKey: supplierProfileActivateCommandFixture.idempotencyKey,
      objectVersion: supplierProfileEligibleFixture.resource.version,
      outboxMessageId: "outbox-supplier-profile-activate-1",
      payloadHash: supplierProfileEligibleFixture.mutation.payloadHash,
      receiptId: supplierProfileEligibleFixture.receipt.receiptId,
      state: "DOMAIN_COMMITTED",
      tenantId: supplierFixtureTenantId,
    },
  },
} as const;

export const portalSupplierBindingReadHttpResponsePositiveFixture = {
  ...fixtureRequest,
  ok: true,
  result: portalSupplierBindingActiveFixture,
} as const;

export const portalSupplierBindingCommandHttpResponsePositiveFixture = {
  ...fixtureRequest,
  ok: true,
  result: {
    readback: portalSupplierBindingActiveFixture,
    readbackMatchesReceipt: true,
    receipt: {
      commandId: portalSupplierBindingRecordCommandFixture.commandId,
      correlationId: fixtureRequest.correlationId,
      eventId: "event-portal-supplier-binding-1",
      idempotentReplay: false,
      idempotencyKey: portalSupplierBindingRecordCommandFixture.idempotencyKey,
      objectVersion: portalSupplierBindingActiveFixture.version,
      outboxMessageId: "outbox-portal-supplier-binding-1",
      payloadHash: portalSupplierBindingActiveFixture.receipt.payloadHash,
      receiptId: portalSupplierBindingActiveFixture.receipt.receiptId,
      state: "DOMAIN_COMMITTED",
      tenantId: supplierFixtureTenantId,
    },
    timelineEvent: portalSupplierBindingTimelineFixture,
  },
} as const;
