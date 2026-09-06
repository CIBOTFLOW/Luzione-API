// Immutable compatibility input copied from the published A3 proof head
// 5cc727ac0cfb3f8f7fa75015246486bf7f7089f5. It is intentionally invalid:
// generic SEED_SOURCE lineage and URL/PDF semantic drift must remain detectable.

const tenantId = "tenant-luzione";
const createdAt = "2026-09-05T08:00:00.000Z";
const payloadHash = "a".repeat(64);
const releaseSha = "1".repeat(40);
const sourceRef = (id: string) => ({ objectId: `source:${id}`, objectType: "SEED_SOURCE", ownerProject: "LUZIONE_SEED_FIXTURE", tenantId, version: `source:${id}:v1` });

function seed(contractVersion: string, type: string, status: string, id: string, data: Record<string, unknown>) {
  const version = `${id}:v1`;
  return {
    authority: { actorId: "operator-fixture", actorType: "HUMAN", approvalRef: null, capability: `seed.${type.toLowerCase()}.write`, decision: "ALLOW", effectClass: "A0", policyVersion: "seed-authority:v1", serverDerivedIdentityRef: "request-fixture-1" },
    contractVersion,
    createdAt,
    data,
    mutation: { expectedVersion: `${id}:v0`, idempotencyKey: `seed:${id}:1`, payloadHash },
    receipt: { committedVersion: version, finality: "DOMAIN_COMMITTED", observedAt: null, observedVersion: null, providerAcknowledgementRef: null, receiptId: `receipt:${id}:v1`, sourceReadbackRef: null },
    resource: { archivedAt: null, id, status, type, version },
    sourceRefs: [sourceRef(id)],
    tenantId,
    updatedAt: createdAt,
  };
}

const evidenceArtifact = seed("EvidenceArtifact/v1", "EVIDENCE_ARTIFACT", "ACTIVE", "evidence-artifact-1", {
  capturedAt: createdAt,
  confidence: 0.95,
  contentDigest: payloadHash,
  kind: "EMAIL",
  mimeType: "message/rfc822",
  promptInjectionState: "CLEAR",
  provider: "GMAIL",
  sourceRecordRef: "gmail-message-1",
  storageRef: "private-object:gmail-message-1",
});
const productSource = seed("ProductSource/v1", "PRODUCT_SOURCE", "ACTIVE", "product-source-1", {
  contentDigest: payloadHash,
  kind: "PDF",
  locator: "private-object:supplier-catalog-1",
  observedAt: createdAt,
  sourceArtifactRef: "evidence-artifact-1",
  validUntil: "2026-12-31T00:00:00.000Z",
});
const productCandidate = seed("ProductCandidate/v1", "PRODUCT_CANDIDATE", "ELIGIBLE", "product-candidate-1", {
  attributes: { finish: "oak", width: "220cm" },
  confidence: { score: 0.92, sourceFreshAt: createdAt },
  lane: "APPROVED_VENDOR",
  leadTimeDays: 42,
  price: { amountMinor: 425000, currency: "USD" },
  productSourceId: "product-source-1",
  sku: "SOFA-220-OAK",
  title: "Oak Frame Sofa",
  vendorId: "supplier-1",
});

export const seedProcurementA3V1KnownBadFixture = {
  correlationId: "correlation-seed-procurement-fixture",
  ok: true,
  requestId: "request-seed-procurement-fixture",
  requestIdentityContractVersion: "luzione-request-identity/v1",
  responseContractVersion: "api-http-response/1.0",
  result: {
    acknowledgements: [],
    bidComparisons: [],
    blockedDependencies: [
      { affectedCapabilities: ["rfq.create_draft", "supplier_quote.normalize"], code: "SUPPLIER_ELIGIBILITY_UNVERIFIED", requiredContract: "SupplierProfile/v1", summary: "Tenant Account identity does not attest supplier eligibility." },
      { affectedCapabilities: ["purchase_order.create_draft", "purchase_order_acknowledgement.record"], code: "PROPOSAL_CANONICAL_READER_UNAVAILABLE", requiredContract: "ProposalVersion/v1 canonical API readback", summary: "A canonical tenant and project-bound ProposalVersion reader is not admitted." },
    ],
    contractVersion: "SeedProcurementReadModel/v1",
    evidenceArtifacts: [{ projectId: "project-1", resource: evidenceArtifact }],
    metadata: {
      apiResponseContractVersion: "api-http-response/1.0",
      observedAt: "2026-09-05T09:30:00.000Z",
      procurementContractProducerSha: "777e0d471d2ecf02294fffb7562761d6f8a36dbd",
      producerRepository: "CIBOTFLOW/Luzione-API",
      projectId: "project-1",
      releaseIdentity: {
        buildTime: "2026-09-05T09:29:00.000Z",
        contractComponents: [
          "api-http-response/1.0", "ProjectSpecificationScheduleReadModel/v1", "SeedProjectPublicationCommand/v1",
          "SeedProcurementCommand/v1", "SeedProcurementReadModel/v1", "ProcurementSelectionDecision/v1",
          "luzione-request-identity/v1", "luzione-table-object-registry/v1", "luzione-platform-failure/v1",
          "luzione-readiness-evidence/v1", "luzione-release-identity/v0.1", "luzione-receipt-reference/v0.1",
          "luzione-sultan-tool-manifest/v1", "luzione-sultan-tool-call/v1", "luzione-sultan-tool-result/v1",
          "luzione-sultan-effect-receipt/v1", "luzione-sultan-readback/v1", "luzione-sultan-command-preparation/v1",
          "luzione-sultan-command-execution/v1", "luzione-sultan-api-admission/v1", "luzione-canonical-business-readback/v1",
          "luzione-sultan-outcome-observation/v1", "sultan.stage5-developmental-participation.v2",
        ],
        contractVersion: "luzione-release-identity/v0.1",
        deploymentId: null,
        deploymentUrl: null,
        environment: "local",
        evidenceState: "EXACT_RELEASE_BOUND",
        exactSha: releaseSha,
        mutations: "DISABLED_FAIL_CLOSED",
        releaseContractVersion: "luzione-api-contract/v0.1",
        repository: "CIBOTFLOW/Luzione-API",
        schemaVersions: [
          "20260828210000_tenant_ai_governance_and_workflow_packs", "20260828213000_workflow_pack_foreign_key_indexes",
          "20260901123000_sultan_agent_policy_envelopes", "20260901130000_sultan_agent_internal_actions",
          "20260902010000_sultan_stage5_authority_outcomes", "20260902010100_sultan_stage5_post_inference_receipt_constraints",
          "20260905083212_seed_project_publication_a2", "20260905091246_seed_procurement_a3",
        ],
        service: "luzione-api",
      },
      scheduleContractProducerSha: "265724e528502b44a1250efea551539d74cb0bbd",
      seedProductContractProducerSha: "e14b405d58a293c002f5676984a95e55372b3bd2",
      tenantId,
    },
    productCandidates: [{ conflictRefs: [], duplicateOfCandidateId: null, extractionProvenance: ["fixture-parser:row-1"], fit: { inputs: { leadTime: 0.7, margin: 0.8, price: 0.9, sourceFreshness: 1, specificationMatch: 0.95, supplierReliability: 0.75 }, score: 0.865, weights: { leadTime: 0.15, margin: 0.15, price: 0.2, sourceFreshness: 0.1, specificationMatch: 0.3, supplierReliability: 0.1 } }, projectId: "project-1", resource: productCandidate }],
    productSources: [{ conflictRefs: [], duplicateOfSourceId: null, extractionProvenance: ["fixture-parser:v1"], ingestionFormat: "URL", projectId: "project-1", resource: productSource }],
    purchaseOrders: [],
    rfqs: [],
    selectionDecisions: [],
    supplierQuotes: [],
    timeline: [],
  },
  traceId: "1234567890abcdef1234567890abcdef",
} as const;

export const SEED_PROCUREMENT_A3_V1_KNOWN_BAD_DIGEST_SHA256 = "d10d9c6032d7c6bcb904f5c3f43be2cafb4a3d9135ea9419279e32d8f6559300";
