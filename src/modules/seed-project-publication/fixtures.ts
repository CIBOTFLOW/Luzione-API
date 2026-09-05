import {
  projectFixture,
  projectPackageFixture,
  spaceFixture,
  specificationFixture,
  specificationLineFixture,
  timelineEventFixture,
} from "@/modules/luzione-core-contracts/seedProductFixtures";
import { REQUEST_IDENTITY_CONTRACT_VERSION } from "@/modules/platform-contracts/requestIdentity";
import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import {
  API_HTTP_RESPONSE_VERSION,
  createProjectSpecificationScheduleReadModel,
  parseProjectSpecificationScheduleReadModel,
} from "@/modules/seed-project-publication/readModel";

export const projectSpecificationSchedulePositiveFixture = createProjectSpecificationScheduleReadModel({
  activeSpecifications: [{ lines: [specificationLineFixture], specification: specificationFixture }],
  packages: [projectPackageFixture],
  pendingRevisions: [],
  project: projectFixture,
  projectContext: {
    briefRefs: ["brief-1"],
    decisionRefs: ["decision-1"],
    evidenceRefs: ["evidence-discovery-1"],
    spaceBriefs: [{ floor: "1", kind: "ROOM", name: "Living Room", sequence: 1 }],
    stakeholderRefs: ["contact-1"],
    taskRefs: ["task-1"],
  },
  spaces: [spaceFixture],
  timeline: [timelineEventFixture],
}, {
  observedAt: "2026-09-05T08:30:00.000Z",
  releaseIdentity: createReleaseIdentity({
    environment: {
      LUZIONE_BUILD_TIME: "2026-09-05T08:25:00.000Z",
      VERCEL_GIT_COMMIT_SHA: "1111111111111111111111111111111111111111",
    },
    mutationsEnabled: false,
  }),
  tenantId: projectFixture.tenantId,
});

const fixtureRequest = {
  correlationId: "correlation-seed-project-fixture",
  requestId: "request-seed-project-fixture",
  requestIdentityContractVersion: REQUEST_IDENTITY_CONTRACT_VERSION,
  responseContractVersion: API_HTTP_RESPONSE_VERSION,
  traceId: "1234567890abcdef1234567890abcdef",
} as const;

/** Exact successful GET /api/v1/projects body after the shared apiResponse envelope is applied. */
export const projectListHttpResponsePositiveFixture = {
  ...fixtureRequest,
  ok: true,
  result: { projects: [projectFixture] },
} as const;

/** Exact successful GET schedule (and GET project graph) body using apiResponse({ ok, result, ... }). */
export const projectScheduleHttpResponsePositiveFixture = {
  ...fixtureRequest,
  ok: true,
  result: projectSpecificationSchedulePositiveFixture,
} as const;

const proposedSpecification = structuredClone(specificationFixture);
proposedSpecification.resource.status = "REVISION_PROPOSED";
proposedSpecification.resource.version = "specification-1:proposed:revision-fixture";
proposedSpecification.data.revisionOfVersion = specificationFixture.resource.version;
proposedSpecification.mutation.expectedVersion = specificationFixture.resource.version;
proposedSpecification.receipt.committedVersion = proposedSpecification.resource.version;
const proposedLine = structuredClone(specificationLineFixture);
proposedLine.data.description = "Revised three-seat sofa";
proposedLine.resource.version = "specification-line-1:proposed:revision-fixture";
proposedLine.receipt.committedVersion = proposedLine.resource.version;

export const projectSpecificationScheduleWithRevisionPositiveFixture = parseProjectSpecificationScheduleReadModel({
  ...structuredClone(projectSpecificationSchedulePositiveFixture),
  pendingRevisions: [{
    diff: [{ after: "Revised three-seat sofa", before: "Three-seat sofa", fieldPath: "lines" }],
    lines: [proposedLine],
    revisionId: "specification-revision-fixture",
    specification: proposedSpecification,
    status: "PENDING",
  }],
});

/** Exact successful POST /api/v1/projects/:projectId/specification-revisions body. */
export const specificationRevisionHttpResponsePositiveFixture = {
  ...fixtureRequest,
  ok: true,
  result: {
    canonicalIds: {
      packageId: "project-package-revision-fixture",
      revisionId: "specification-revision-fixture",
      spaceIds: [spaceFixture.resource.id],
      specificationIds: [specificationFixture.resource.id],
      specificationLineIds: [specificationLineFixture.resource.id],
    },
    readback: projectSpecificationScheduleWithRevisionPositiveFixture.pendingRevisions[0],
    readbackMatchesReceipt: true,
    receipt: {
      commandId: "command-revision-fixture",
      correlationId: fixtureRequest.correlationId,
      eventId: "event-revision-fixture",
      idempotentReplay: false,
      idempotencyKey: "idempotency-revision-fixture",
      objectVersion: proposedSpecification.resource.version,
      outboxMessageId: "outbox-revision-fixture",
      payloadHash: "a".repeat(64),
      receiptId: "receipt-revision-fixture",
      state: "DISPATCH_PENDING",
      tenantId: projectFixture.tenantId,
    },
  },
} as const;
