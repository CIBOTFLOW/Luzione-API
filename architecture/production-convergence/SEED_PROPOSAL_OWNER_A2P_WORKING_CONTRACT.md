# SEED-PROPOSAL-OWNER-A2P Working Contract

## Controller input and exact base

- Controller assignment: `SEED-PROPOSAL-OWNER-A2P` at controller head `09ff6c156a294b2179ce9bdf35e08fd2caaac15b` or later.
- API base: controller-admitted A3C proof head `f77d68daca1ce897d498e9661bceeee9554a579c`.
- Historical producers remain immutable and independently named:
  - seed product spine A1: `e14b405d58a293c002f5676984a95e55372b3bd2`
  - Project schedule A2: `265724e528502b44a1250efea551539d74cb0bbd`
  - supplier identity A2S: `6467b989db7422c45935dcec3ad334b4fe99ce5f`
  - historical procurement A3: `777e0d471d2ecf02294fffb7562761d6f8a36dbd`
  - procurement correction A3C: `a98d70e75baac9c25c3aa8af96615fbf3eba4575`
- A2P publishes a separate proposal producer and an A2P-compatible procurement producer because its same atomic API slice lifts only the PO-draft dependency hold. It does not rewrite prior handoffs.

## Canonical ownership and predecessor reconciliation

- `CIBOTFLOW/Luzione-API` is the sole target writer for canonical proposal templates, proposal versions, typed proposal lines, exact-version client decisions, render preparations, and purchase-order drafts.
- A2P reuses API-PC-009 business truth. `commercial_case_proposal_document_versions` remains Proposal Version lineage and is bound to an exact `quote_economics_versions` snapshot; `quotes`, `quote_lines`, `commercial_case_proposal_context_versions`, and `commercial_case_proposal_review_versions` remain the predecessor canonical rows.
- `commercial_case_proposal_v1_identity_map` is an immutable stable-ID bridge. It does not contain an independent proposal body or economics and is not a second proposal truth.
- A2P-owned predecessor rows are append-only and protected from update/delete. Existing unrelated API-PC-009 rows retain their prior semantics.
- UI/API-PC-009 legacy mutation paths may remain reachable only while A2P commands are default-off. G1 requires shadow equality, a tenant cutover, and one active writer, as declared in the writer-retirement manifest.

## CPQ, templates, revisions, and decisions

- `SeedProposalCommand/v1` supports immutable template versions, proposal create/revise, scoped client decisions, and render preparation.
- Proposal lines cover product, design fee, service fee, procurement fee, freight, delivery/installation, discount, and tax. All money uses safe integer minor units; supplier cost, freight, duty, reserve, landed cost, before-tax client price, discount, tax, total, and gross margin are independently reconciled in application and deferred database constraints.
- Each Proposal Version binds one exact Project version, one or more exact Specification versions, every product line to an exact Product Candidate and Specification Line version, and one exact active Template version.
- Revisions append immutable document/economics/line snapshots under an advisory lock. Decisions never carry forward; old-version decisions read back as superseded once a later revision exists.
- Client decisions bind the exact Proposal Version and exactly one item, option group, section, or whole proposal. They require a distinct signed same-tenant human plus an exact active, unexpired, same-actor Portal object grant. The command body cannot supply that grant.
- No Portal grant adapter is admitted at G0, so the HTTP client-decision branch deliberately returns `CLIENT_OBJECT_GRANT_ADAPTER_UNAVAILABLE`. Store-level behavior is exercised only with an injected server-derived grant reader in isolated proof.

## Template and rendering boundary

- Template persistence accepts immutable private-object metadata only after an exact active clean `EvidenceArtifact/v1` readback, content digest, tenant match, and source version check.
- DOCX and HTML templates validate declared merge tokens. PDF templates require declared AcroForm fields or a versioned overlay-map digest; unsupported PDFs produce deterministic validation issues and remain invalid.
- `proposal_render.prepare` records only a deterministic preparation. Provider acknowledgement, artifact reference, authoritative source readback, external authorization, customer send, Shopify publishing, and payment remain absent/null.
- Object upload, malware scanning, DOCX/PDF rendering, and delivery adapters are dependencies, not capabilities implied by this slice.

## Purchase-order draft admission

- A2P lifts only `purchase_order.create_draft` after exact same-tenant validation of the current approved Bid Comparison v2, its immutable human selection, the selected Supplier Quote, current Supplier Profile capability, the latest accepted Proposal Version, and the shared canonical Specification Line set.
- The draft currency and supplier total are derived from the selected Supplier Quote. `releaseApprovalRef` is null and `externalEffectAuthorized` is false.
- PO release/send, supplier commitment, acknowledgement ingestion, provider finality, payment, and shipment effects remain held. The acknowledgement dependency trigger remains.

## Persistence, security, and recovery

- The additive migration was generated with Supabase CLI 2.116.0 and is applied only to a uniquely named disposable local PostgreSQL database during proof.
- Five owner relations have forced RLS, one explicit tenant policy each, and `SELECT, INSERT` only for `luzione_api_runtime`; browser-facing and public grants are absent. Six predecessor tables gain conditional A2P-row immutability and seven deferred integrity triggers bind owner rows to exact receipts and upstream state.
- Command admission is global-switch plus feature-switch plus tenant allowlist, all default-off. Reads require a server-derived actor and `proposal.read` capability.
- Schema-level destructive rollback over shared API-PC-009 columns is not authored: after any admitted rows, dropping those columns would be unsafe. Release recovery is feature disable plus forward correction; transaction-level injected-fault rollback and disposable-database drop prove atomic/local recovery. This is not managed backup/PITR evidence.
- API-PC-013 currently revokes prerequisite `accounts` and `opportunities` runtime reads without restoring the bounded API `SELECT` used by A2/A2S. The A2P proof adds SELECT-only permissions to disposable fixture relations and records the integration gap; it makes no managed-runtime claim.

## Required proof and release limits

- Strict command/read-model parsers, consumer fixtures, source/version/tenant denials, changed replay, stale write, concurrent revision winner, exact decision target, non-inheritance, one-cent corruption, template scan/hash/token/PDF validation, false finality, PO dependency tampering, and atomic rollback.
- Exhaustive test taxonomy and additive topology delta, typecheck, zero-warning lint, all repository tests, compliance checks, production build, disposable migration apply/reapply, forced-RLS/grant inspection, and zero non-`NO_EFFECT` outboxes.
- Producer SHA, proof head, consumer proof SHA, deployment SHA, managed migration state, and external effect authority are separate fields. G0 leaves deployment SHA null, managed migration not run, and all external effects unauthorized.
