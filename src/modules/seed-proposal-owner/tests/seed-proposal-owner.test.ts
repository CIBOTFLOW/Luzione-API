import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createReleaseIdentity } from "@/modules/production-convergence/releaseIdentity";
import { proposalLineFixture, proposalTemplateFixture, proposalVersionFixture, specificationLineFixture } from "@/modules/luzione-core-contracts/seedProductFixtures";
import { SEED_PROPOSAL_COMMAND_VERSION, SeedProposalContractError, parseSeedProposalCommand } from "@/modules/seed-proposal-owner/contracts";
import { proposalTemplateCommandFixture, proposalVersionCommandFixture } from "@/modules/seed-proposal-owner/fixtures";
import { deriveProposalEconomics, proposalEconomicsDefects, templateValidationIssues } from "@/modules/seed-proposal-owner/model";
import { createSeedProposalReadModel, parseSeedProposalReadModel, SeedProposalReadModelError } from "@/modules/seed-proposal-owner/readModel";

test("A2P command parser rejects authority smuggling, stale create, noncanonical currency, and incomplete product lineage", () => {
  assert.equal(parseSeedProposalCommand(proposalTemplateCommandFixture).contractVersion, SEED_PROPOSAL_COMMAND_VERSION);
  assert.equal(parseSeedProposalCommand(proposalVersionCommandFixture).commandType, "proposal_version.create");
  assert.throws(() => parseSeedProposalCommand({ ...proposalVersionCommandFixture, tenantId: "forged" }), (error: unknown) => error instanceof SeedProposalContractError && error.code === "FIELD_SET_MISMATCH");
  assert.throws(() => parseSeedProposalCommand({ ...proposalVersionCommandFixture, expectedVersion: "proposal-version:old:v1" }), (error: unknown) => error instanceof SeedProposalContractError && error.code === "VERSION_CONFLICT");
  assert.throws(() => parseSeedProposalCommand({ ...proposalVersionCommandFixture, currency: "usd" }), (error: unknown) => error instanceof SeedProposalContractError && error.code === "INVALID_CURRENCY");
  const product = proposalVersionCommandFixture.lines[0];
  assert.throws(() => parseSeedProposalCommand({ ...proposalVersionCommandFixture, lines: [{ ...product, specificationLineRef: null }] }), (error: unknown) => error instanceof SeedProposalContractError && error.code === "REFERENCE_MISMATCH");
});

test("typed proposal economics reconcile independently and detect a one-cent defect", () => {
  assert.deepEqual(deriveProposalEconomics(proposalVersionCommandFixture.lines), proposalVersionCommandFixture.economics);
  assert.deepEqual(proposalEconomicsDefects(proposalVersionCommandFixture.lines, proposalVersionCommandFixture.economics), []);
  assert.ok(proposalEconomicsDefects(proposalVersionCommandFixture.lines, { ...proposalVersionCommandFixture.economics, totalMinor: proposalVersionCommandFixture.economics.totalMinor + 1 }).includes("PROPOSAL_TOTAL_MINOR_MISMATCH"));
  assert.ok(proposalEconomicsDefects([{ ...proposalVersionCommandFixture.lines[0], landedCostMinor: proposalVersionCommandFixture.lines[0].landedCostMinor + 1 }], deriveProposalEconomics([{ ...proposalVersionCommandFixture.lines[0], landedCostMinor: proposalVersionCommandFixture.lines[0].landedCostMinor + 1 }])).some((item) => item.startsWith("LINE_LANDED_COST_MISMATCH")));
});

test("template validation accepts declared merge tokens and returns deterministic unsupported-PDF evidence", () => {
  assert.deepEqual(templateValidationIssues(proposalTemplateCommandFixture.template), []);
  assert.deepEqual(templateValidationIssues({ format: "PDF_OVERLAY", mergeTokens: [], pdf: { acroFormFields: [], mode: "UNSUPPORTED", overlayMapDigest: null, overlayMapVersion: null } }), ["PDF_REQUIRES_ACROFORM_OR_VERSIONED_OVERLAY"]);
  assert.deepEqual(templateValidationIssues({ format: "HTML", mergeTokens: ["untrusted.token"], pdf: null }), ["UNSUPPORTED_MERGE_TOKEN:untrusted.token"]);
});

test("strict A2P read model reconciles line economics and refuses provider false finality", () => {
  const tenantId = proposalVersionFixture.tenantId; const projectId = proposalVersionFixture.data.projectId;
  const acceptedProposal = { ...proposalVersionFixture, data: { ...proposalVersionFixture.data, decisionState: "PENDING" as const }, sourceRefs: proposalVersionFixture.sourceRefs };
  const line = { ...proposalLineFixture, sourceRefs: [...proposalLineFixture.sourceRefs, { objectId: specificationLineFixture.resource.id, objectType: "SPECIFICATION_LINE", ownerProject: "LUZIONE_PROJECT", tenantId, version: specificationLineFixture.resource.version }] };
  const data = { projectVersion: `project:${projectId}:v1`, proposals: [{ decisions: [], economics: { clientPriceBeforeTaxMinor: 575000, discountTotalMinor: 0, dutyTotalMinor: 0, freightTotalMinor: 50000, grossMarginMinor: 225000, landedCostTotalMinor: 350000, reserveTotalMinor: 0, supplierCostTotalMinor: 300000, taxTotalMinor: 0, totalMinor: 575000 }, identityMap: { caseId: "case-fixture", proposalContextVersionId: "context-fixture", proposalDocumentVersionId: "document-fixture", quoteEconomicsVersionId: "economics-fixture", quoteId: "quote-fixture" }, lines: [{ economics: { dutyMinor: 0, freightMinor: 50000, reserveMinor: 0, sectionId: "section-fixture", supplierCostTotalMinor: 300000 }, resource: line, specificationLineRef: line.sourceRefs[1] }], proposal: acceptedProposal, renderPreparations: [], template: proposalTemplateFixture }] };
  const readModel = createSeedProposalReadModel(data, { observedAt: "2026-09-06T01:00:00.000Z", projectId, releaseIdentity: createReleaseIdentity({ mutationsEnabled: false }), tenantId });
  assert.equal(parseSeedProposalReadModel(readModel).proposals[0].proposal.data.totalMinor, 575000);
  const bad = structuredClone(readModel) as unknown as { proposals: Array<{ renderPreparations: unknown[] }> }; bad.proposals[0].renderPreparations.push({ artifactRef: "provider-artifact", createdAt: "2026-09-06T01:00:00.000Z", evidenceRefs: ["evidence-render"], externalEffectAuthorized: false, objectVersion: "render-prep-v1", preparationId: "render-prep", proposalId: acceptedProposal.resource.id, proposalVersion: acceptedProposal.resource.version, providerAcknowledgementRef: null, renderInputHash: "a".repeat(64), requestedArtifact: "PDF", sourceReadbackRef: null, status: "PREPARED", templateId: proposalTemplateFixture.resource.id, templateVersion: proposalTemplateFixture.resource.version });
  assert.throws(() => parseSeedProposalReadModel(bad), (error: unknown) => error instanceof SeedProposalReadModelError && error.code === "FALSE_FINALITY");
});

test("A2P migration and routes adapt predecessor truth, force RLS, preserve zero effects, and keep Portal grants server-derived", () => {
  const migration = readFileSync("supabase/migrations/20260906032814_seed_proposal_owner_a2p.sql", "utf8");
  assert.match(migration, /commercial_case_proposal_document_versions/); assert.match(migration, /commercial_case_proposal_review_versions/); assert.match(migration, /quote_economics_versions/); assert.match(migration, /commercial_case_proposal_v1_identity_map/); assert.match(migration, /force row level security/i); assert.match(migration, /revoke all on function public\.seed_proposal_a2p_/i); assert.match(migration, /rows are immutable|facts are immutable/i);
  assert.match(migration, /malware_scan_evidence_ref jsonb/); assert.match(migration, /exact active tenant-global malware scan evidence/);
  assert.match(migration, /drop trigger seed_purchase_order_dependency_hold/); assert.doesNotMatch(migration, /drop trigger seed_purchase_order_ack_dependency_hold/);
  assert.match(migration, /create constraint trigger seed_purchase_order_a2p_integrity[\s\S]*deferrable initially deferred/);
  assert.match(migration, /grant select,insert on table public\.seed_purchase_order_drafts/);
  assert.match(migration, /external_effect_authorized=false/); assert.match(migration, /release_approval_ref is null/);
  assert.doesNotMatch(migration, /create table public\.seed_proposals|create table public\.seed_proposal_versions/i);
  const route = readFileSync("src/app/api/v1/proposals/commands/route.ts", "utf8"); assert.match(route, /requireServiceActor\(request\.headers, "proposal\.command"\)/); assert.match(route, /CLIENT_OBJECT_GRANT_ADAPTER_UNAVAILABLE/); assert.doesNotMatch(route, /clientGrant\s*:\s*(body|command)/);
  for (const forbidden of ["sendMail", "shopify", "stripe", "fetch(", "providerAdapter"]) assert.doesNotMatch(route, new RegExp(forbidden.replace("(", "\\("), "i"));
});
