import { releaseIdentityViolations, type ReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA } from "@/modules/seed-procurement/readModel";
import { API_HTTP_RESPONSE_VERSION, PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA, SEED_PRODUCT_CONTRACT_PRODUCER_SHA } from "@/modules/seed-project-publication/readModel";
import { parseSupplierProfileV1, type SupplierProfileV1 } from "@/modules/seed-supplier-identity/contracts";
import { parseTimelineEventV1 } from "@/modules/luzione-core-contracts/seedProductConsumerSdk";
import type { TimelineEventV1 } from "@/modules/luzione-core-contracts/seedProductContracts";
import { sha256 } from "@/modules/platform-guarantees/eventContract";

export const SUPPLIER_PROFILE_READ_MODEL_VERSION = "SupplierProfileReadModel/v1";
export const SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA = "5cc727ac0cfb3f8f7fa75015246486bf7f7089f5";

export const SEED_SUPPLIER_IDENTITY_HTTP_ROUTES = Object.freeze({
  accountProfile: "/api/v1/accounts/:accountId/supplier-profile",
  commandCollection: "/api/v1/supplier-profiles/commands",
  portalBindingCommandCollection: "/api/v1/supplier-portal-account-bindings/commands",
  portalBindingRead: "/api/v1/supplier-portal-account-bindings/:bindingId",
  profileRead: "/api/v1/supplier-profiles/:supplierProfileId",
});

export type SupplierProfileReadModelV1 = {
  contractVersion: typeof SUPPLIER_PROFILE_READ_MODEL_VERSION;
  metadata: {
    apiResponseContractVersion: typeof API_HTTP_RESPONSE_VERSION;
    observedAt: string;
    procurementContractProducerSha: typeof SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA;
    producerRepository: "CIBOTFLOW/Luzione-API";
    releaseIdentity: ReleaseIdentity;
    scheduleContractProducerSha: typeof PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA;
    seedProductContractProducerSha: typeof SEED_PRODUCT_CONTRACT_PRODUCER_SHA;
    supplierIdentityContractProducerSha: typeof SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA;
    tenantId: string;
  };
  supplierProfile: SupplierProfileV1;
  timelineEvent: TimelineEventV1;
};

type JsonObject = Record<string, unknown>;

export class SupplierProfileReadModelError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SupplierProfileReadModelError";
  }
}

function fail(code: string, message: string): never { throw new SupplierProfileReadModelError(code, message); }
function object(value: unknown, path: string): JsonObject { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_VALUE", `${path} must be an object.`); return value as JsonObject; }
function exact(value: unknown, keys: readonly string[], path: string) { const parsed = object(value, path); const expected = [...keys].sort(); const actual = Object.keys(parsed).sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail("FIELD_SET_MISMATCH", `${path} fields must be exactly ${expected.join(", ")}.`); return parsed; }
function bounded(value: unknown, path: string) { if (typeof value !== "string" || value !== value.trim() || value.length < 2 || value.length > 512) fail("INVALID_VALUE", `${path} must be unpadded bounded text.`); return value; }
function timestamp(value: unknown, path: string) { const parsed = bounded(value, path); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed) || !Number.isFinite(Date.parse(parsed)) || new Date(Date.parse(parsed)).toISOString() !== parsed) fail("INVALID_VALUE", `${path} must be canonical RFC3339 UTC.`); return parsed; }

function parseReleaseIdentity(value: unknown) {
  const parsed = exact(value, ["buildTime", "contractComponents", "contractVersion", "deploymentId", "deploymentUrl", "environment", "evidenceState", "exactSha", "mutations", "releaseContractVersion", "repository", "schemaVersions", "service"], "supplierProfile.metadata.releaseIdentity") as unknown as ReleaseIdentity;
  const violations = releaseIdentityViolations(parsed);
  if (violations.length) fail("DEPLOYMENT_IDENTITY_INVALID", violations.join(", "));
  return parsed;
}

export function parseSupplierProfileReadModel(value: unknown): SupplierProfileReadModelV1 {
  const input = exact(value, ["contractVersion", "metadata", "supplierProfile", "timelineEvent"], "supplierProfileReadModel");
  if (input.contractVersion !== SUPPLIER_PROFILE_READ_MODEL_VERSION) fail("UNSUPPORTED_CONTRACT_VERSION", `contractVersion must be ${SUPPLIER_PROFILE_READ_MODEL_VERSION}.`);
  const metadata = exact(input.metadata, ["apiResponseContractVersion", "observedAt", "procurementContractProducerSha", "producerRepository", "releaseIdentity", "scheduleContractProducerSha", "seedProductContractProducerSha", "supplierIdentityContractProducerSha", "tenantId"], "supplierProfileReadModel.metadata");
  if (metadata.apiResponseContractVersion !== API_HTTP_RESPONSE_VERSION || metadata.producerRepository !== "CIBOTFLOW/Luzione-API") fail("PRODUCER_MISMATCH", "Unexpected Supplier Profile producer or response envelope.");
  if (metadata.seedProductContractProducerSha !== SEED_PRODUCT_CONTRACT_PRODUCER_SHA
    || metadata.scheduleContractProducerSha !== PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA
    || metadata.procurementContractProducerSha !== SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA
    || metadata.supplierIdentityContractProducerSha !== SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA) {
    fail("PRODUCER_MISMATCH", "Supplier Profile read model has an unadmitted producer SHA.");
  }
  const tenantId = bounded(metadata.tenantId, "supplierProfileReadModel.metadata.tenantId");
  const supplierProfile = parseSupplierProfileV1(input.supplierProfile);
  const timelineEvent = parseTimelineEventV1(input.timelineEvent);
  if (supplierProfile.tenantId !== tenantId) fail("TENANT_MISMATCH", "Supplier Profile crosses the authenticated tenant.");
  if (timelineEvent.tenantId !== tenantId || !timelineEvent.data.aggregateRefs.some((ref) => ref.objectType === "SUPPLIER_PROFILE" && ref.objectId === supplierProfile.resource.id && ref.version === supplierProfile.resource.version)) fail("TIMELINE_MISMATCH", "Supplier Profile TimelineEvent must bind the exact tenant and profile version.");
  const expectedProfileRef = { objectId: supplierProfile.resource.id, objectType: "SUPPLIER_PROFILE", ownerProject: "LUZIONE_SUPPLIER_IDENTITY", tenantId, version: supplierProfile.resource.version };
  if (timelineEvent.data.aggregateRefs.length !== 1 || timelineEvent.sourceRefs.length !== 1
    || sha256(timelineEvent.data.aggregateRefs[0]) !== sha256(expectedProfileRef)
    || sha256(timelineEvent.sourceRefs[0]) !== sha256(expectedProfileRef)
    || timelineEvent.data.actorId !== timelineEvent.authority.actorId
    || timelineEvent.receipt.receiptId !== supplierProfile.receipt.receiptId
    || timelineEvent.mutation.payloadHash !== supplierProfile.mutation.payloadHash
    || timelineEvent.receipt.finality !== "DOMAIN_COMMITTED"
    || timelineEvent.receipt.observedAt !== null || timelineEvent.receipt.observedVersion !== null
    || timelineEvent.receipt.providerAcknowledgementRef !== null || timelineEvent.receipt.sourceReadbackRef !== null) {
    fail("TIMELINE_MISMATCH", "Supplier Profile TimelineEvent must exactly project the P110 causation, actor, receipt, mutation, and profile reference.");
  }
  timestamp(timelineEvent.createdAt, "supplierProfileReadModel.timelineEvent.createdAt");
  timestamp(timelineEvent.updatedAt, "supplierProfileReadModel.timelineEvent.updatedAt");
  timestamp(timelineEvent.data.occurredAt, "supplierProfileReadModel.timelineEvent.data.occurredAt");
  timestamp(timelineEvent.data.recordedAt, "supplierProfileReadModel.timelineEvent.data.recordedAt");
  return {
    contractVersion: SUPPLIER_PROFILE_READ_MODEL_VERSION,
    metadata: {
      apiResponseContractVersion: API_HTTP_RESPONSE_VERSION,
      observedAt: timestamp(metadata.observedAt, "supplierProfileReadModel.metadata.observedAt"),
      procurementContractProducerSha: SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA,
      producerRepository: "CIBOTFLOW/Luzione-API",
      releaseIdentity: parseReleaseIdentity(metadata.releaseIdentity),
      scheduleContractProducerSha: PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA,
      seedProductContractProducerSha: SEED_PRODUCT_CONTRACT_PRODUCER_SHA,
      supplierIdentityContractProducerSha: SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA,
      tenantId,
    },
    supplierProfile,
    timelineEvent,
  };
}

export function createSupplierProfileReadModel(supplierProfile: SupplierProfileV1, timelineEvent: TimelineEventV1, input: { observedAt: string; releaseIdentity: ReleaseIdentity; tenantId: string }) {
  return parseSupplierProfileReadModel({
    contractVersion: SUPPLIER_PROFILE_READ_MODEL_VERSION,
    metadata: {
      apiResponseContractVersion: API_HTTP_RESPONSE_VERSION,
      observedAt: input.observedAt,
      procurementContractProducerSha: SEED_PROCUREMENT_CONTRACT_PRODUCER_SHA,
      producerRepository: "CIBOTFLOW/Luzione-API",
      releaseIdentity: input.releaseIdentity,
      scheduleContractProducerSha: PROJECT_SPECIFICATION_SCHEDULE_CONTRACT_PRODUCER_SHA,
      seedProductContractProducerSha: SEED_PRODUCT_CONTRACT_PRODUCER_SHA,
      supplierIdentityContractProducerSha: SEED_SUPPLIER_IDENTITY_CONTRACT_PRODUCER_SHA,
      tenantId: input.tenantId,
    },
    supplierProfile,
    timelineEvent,
  });
}
