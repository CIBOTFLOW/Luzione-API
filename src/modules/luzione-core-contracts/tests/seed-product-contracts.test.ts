import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LuzioneCoreCompatibilityError,
  SEED_PRODUCT_CONTRACT_VERSIONS,
  approvalDecisionFixture,
  authorityPolicyFixture,
  bidComparisonFixture,
  evidenceArtifactFixture,
  fieldChangeProposalFixture,
  installationRecordFixture,
  outcomeReceiptFixture,
  packageFixture,
  parseApprovalDecisionV1,
  parseAuthorityPolicyV1,
  parseBidComparisonV1,
  parseEvidenceArtifactV1,
  parseFieldChangeProposalV1,
  parseInstallationRecordV1,
  parseLuzioneCoreContractDocument,
  parseLuzioneSeedProductContractDocument,
  parseOutcomeReceiptV1,
  parsePackageV1,
  parseProductCandidateV1,
  parseProductSourceV1,
  parseProjectPackageV1,
  parseProjectV1,
  parseProposalLineV1,
  parseProposalTemplateV1,
  parseProposalVersionV1,
  parsePurchaseOrderAcknowledgementV1,
  parsePurchaseOrderV1,
  parseReceivingRecordV1,
  parseRFQV1,
  parseShipmentV1,
  parseSpaceV1,
  parseSpecificationLineV1,
  parseSpecificationV1,
  parseSultanReviewItemV1,
  parseSupplierQuoteV1,
  parseTimelineEventV1,
  productCandidateFixture,
  productSourceFixture,
  projectFixture,
  projectPackageFixture,
  proposalLineFixture,
  proposalTemplateFixture,
  proposalVersionFixture,
  purchaseOrderAcknowledgementFixture,
  purchaseOrderFixture,
  receivingRecordFixture,
  rfqFixture,
  seedProductPositiveFixtures,
  shipmentFixture,
  spaceFixture,
  specificationFixture,
  specificationLineFixture,
  supplierQuoteFixture,
  sultanReviewItemFixture,
  timelineEventFixture,
  type LuzioneCoreCompatibilityErrorCode,
} from "..";

const schemaPath = "contracts/core/v1/luzione-seed-product-contracts-v1.schema.json";
const manifestPath = "contracts/core/luzione-core-v1.manifest.json";

test("SEED-PRODUCT-01 parses the complete tenant-bound flagship graph", () => {
  const project = parseProjectV1(projectFixture);
  const space = parseSpaceV1(spaceFixture, project);
  const projectPackage = parseProjectPackageV1(projectPackageFixture);
  const specification = parseSpecificationV1(specificationFixture, project, [space]);
  const productSource = parseProductSourceV1(productSourceFixture);
  const candidate = parseProductCandidateV1(productCandidateFixture, productSource);
  const specificationLine = parseSpecificationLineV1(specificationLineFixture, specification, space, [candidate]);
  const template = parseProposalTemplateV1(proposalTemplateFixture);
  const proposal = parseProposalVersionV1(proposalVersionFixture, project, template);
  parseProposalLineV1(proposalLineFixture, proposal);
  parseApprovalDecisionV1(approvalDecisionFixture, proposal);
  const rfq = parseRFQV1(rfqFixture, project, specification, [specificationLine]);
  const evidence = parseEvidenceArtifactV1(evidenceArtifactFixture);
  const quote = parseSupplierQuoteV1(supplierQuoteFixture, rfq, evidence);
  const bid = parseBidComparisonV1(bidComparisonFixture, [rfq], [quote]);
  const order = parsePurchaseOrderV1(purchaseOrderFixture, bid, quote, proposal);
  parsePurchaseOrderAcknowledgementV1(purchaseOrderAcknowledgementFixture, order);
  const shipment = parseShipmentV1(shipmentFixture, [order]);
  const packageRecord = parsePackageV1(packageFixture, shipment);
  parseReceivingRecordV1(receivingRecordFixture, shipment, [packageRecord]);
  parseInstallationRecordV1(installationRecordFixture, project, [space]);
  parseTimelineEventV1(timelineEventFixture);
  parseFieldChangeProposalV1(fieldChangeProposalFixture, [evidence]);
  const policy = parseAuthorityPolicyV1(authorityPolicyFixture);
  const outcome = parseOutcomeReceiptV1(outcomeReceiptFixture);
  parseSultanReviewItemV1(sultanReviewItemFixture, policy, outcome);

  assert.equal(projectPackage.data.canonicalProjectId, project.resource.id);
  assert.equal(order.data.supplierQuoteId, quote.resource.id);
  assert.equal(outcome.receipt.finality, "SOURCE_CONFIRMED");
});

test("all 26 seed boundaries reject surplus, missing and wrong-version fields", async (context) => {
  const fixtures = Object.entries(seedProductPositiveFixtures);
  assert.equal(fixtures.length, 26);
  assert.equal(Object.keys(SEED_PRODUCT_CONTRACT_VERSIONS).length, 26);
  for (const [name, fixture] of fixtures) {
    await context.test(`${name}:positive`, () => {
      assert.equal(parseLuzioneSeedProductContractDocument(fixture).tenantId, "tenant-luzione");
      assert.equal(parseLuzioneCoreContractDocument(fixture).contractVersion, fixture.contractVersion);
    });
    await context.test(`${name}:surplus`, () => {
      assertCoreError(() => parseLuzioneSeedProductContractDocument({ ...structuredClone(fixture), surplus: true }), "CORE_FIELD_SET_MISMATCH");
    });
    await context.test(`${name}:missing`, () => {
      const missing = structuredClone(fixture) as Record<string, unknown>;
      delete missing.updatedAt;
      assertCoreError(() => parseLuzioneSeedProductContractDocument(missing), "CORE_FIELD_SET_MISMATCH");
    });
    await context.test(`${name}:wrong-version`, () => {
      assertCoreError(() => parseLuzioneSeedProductContractDocument({ ...structuredClone(fixture), contractVersion: "consumer-local/v1" }), "CORE_WRONG_VERSION");
    });
  }
});

test("source provenance and cross-resource references fail closed across tenants", () => {
  const wrongSourceTenant = structuredClone(projectFixture);
  wrongSourceTenant.sourceRefs[0].tenantId = "tenant-other";
  assertCoreError(() => parseProjectV1(wrongSourceTenant), "CORE_TENANT_MISMATCH");

  const wrongProjectTenant = structuredClone(projectFixture);
  wrongProjectTenant.tenantId = "tenant-other";
  assertCoreError(() => parseSpaceV1(spaceFixture, wrongProjectTenant), "CORE_TENANT_MISMATCH");

  const wrongPackageTenant = structuredClone(projectPackageFixture);
  wrongPackageTenant.data.plannerProjectRef.tenantId = "tenant-other";
  assertCoreError(() => parseProjectPackageV1(wrongPackageTenant), "CORE_TENANT_MISMATCH");
});

test("new mutations require exact prior version while exact replay retains payload identity", () => {
  assert.equal(parseProjectV1(structuredClone(projectFixture), projectFixture).resource.id, projectFixture.resource.id);

  const changedReplay = structuredClone(projectFixture);
  changedReplay.mutation.payloadHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assertCoreError(() => parseProjectV1(changedReplay, projectFixture), "CORE_REPLAY_CONFLICT");

  const staleMutation = structuredClone(projectFixture);
  staleMutation.mutation.idempotencyKey = "seed:project-1:2";
  staleMutation.mutation.expectedVersion = "project-1:stale";
  assertCoreError(() => parseProjectV1(staleMutation, projectFixture), "CORE_EXPIRED");
});

test("authority requires exact approval for A2/A3 and always denies A4", () => {
  const unapprovedA2 = structuredClone(purchaseOrderFixture);
  unapprovedA2.authority.effectClass = "A2";
  assertCoreError(() => parsePurchaseOrderV1(unapprovedA2), "CORE_AUTHORITY_DENIED");

  const approvedA3 = structuredClone(purchaseOrderFixture);
  approvedA3.authority.effectClass = "A3";
  approvedA3.authority.decision = "REQUIRE_HUMAN";
  approvedA3.authority.approvalRef = "approval:po-release-1";
  assert.equal(parsePurchaseOrderV1(approvedA3).authority.approvalRef, "approval:po-release-1");

  const allowedA4 = structuredClone(projectFixture);
  allowedA4.authority.effectClass = "A4";
  assertCoreError(() => parseProjectV1(allowedA4), "CORE_AUTHORITY_DENIED");
});

test("proposal decisions and procurement objects pin exact upstream versions", () => {
  const staleDecision = structuredClone(approvalDecisionFixture);
  staleDecision.data.proposalVersion = "proposal-version-1:v0";
  assertCoreError(() => parseApprovalDecisionV1(staleDecision, proposalVersionFixture), "CORE_EXPIRED");

  const foreignLine = structuredClone(supplierQuoteFixture);
  foreignLine.data.lines[0].rfqLineId = "specification-line-other";
  assertCoreError(() => parseSupplierQuoteV1(foreignLine, rfqFixture), "CORE_REFERENCE_MISMATCH");

  const staleAcknowledgement = structuredClone(purchaseOrderAcknowledgementFixture);
  staleAcknowledgement.data.acknowledgedPurchaseOrderVersion = "purchase-order-1:v0";
  assertCoreError(() => parsePurchaseOrderAcknowledgementV1(staleAcknowledgement, purchaseOrderFixture), "CORE_EXPIRED");
});

test("provider acknowledgement never masquerades as authoritative source readback", () => {
  assert.equal(parsePurchaseOrderAcknowledgementV1(purchaseOrderAcknowledgementFixture).receipt.finality, "PROVIDER_ACKNOWLEDGED");

  const falseFinality = structuredClone(purchaseOrderAcknowledgementFixture);
  falseFinality.receipt.finality = "SOURCE_CONFIRMED";
  assertCoreError(() => parsePurchaseOrderAcknowledgementV1(falseFinality), "CORE_FINALITY_INVALID");

  const providerWithReadback = structuredClone(purchaseOrderAcknowledgementFixture);
  providerWithReadback.receipt.sourceReadbackRef = "provider:claimed-readback";
  assertCoreError(() => parsePurchaseOrderAcknowledgementV1(providerWithReadback), "CORE_FINALITY_INVALID");
});

test("receiving discrepancies and Sultan applied state require durable evidence", () => {
  const badCounts = structuredClone(receivingRecordFixture);
  badCounts.data.counts.received = 0;
  assertCoreError(() => parseReceivingRecordV1(badCounts), "CORE_VALUE_INVALID");

  const missingOutcome = structuredClone(sultanReviewItemFixture);
  missingOutcome.data.outcomeReceiptId = null;
  assertCoreError(() => parseSultanReviewItemV1(missingOutcome), "CORE_FINALITY_INVALID");

  const unsafeEvidence = structuredClone(evidenceArtifactFixture);
  unsafeEvidence.data.promptInjectionState = "DETECTED";
  assertCoreError(() => parseEvidenceArtifactV1(unsafeEvidence), "CORE_AUTHORITY_DENIED");
});

test("schema and core manifest publish every exact seed product contract", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { $defs: Record<string, unknown>; oneOf: unknown[] };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { contracts: Record<string, string>; artifacts: Record<string, string> };
  assert.equal(schema.oneOf.length, 26);
  for (const version of Object.values(SEED_PRODUCT_CONTRACT_VERSIONS)) assert.ok(version in manifest.contracts, version);
  assert.equal(manifest.artifacts.seedProductSchemaBundle, schemaPath);
});

function assertCoreError(run: () => unknown, code: LuzioneCoreCompatibilityErrorCode) {
  assert.throws(run, (error) => error instanceof LuzioneCoreCompatibilityError && error.code === code);
}
