# SEED-PROCUREMENT-A3-CORRECTION-01 Working Contract

## Controller input and exact base

- Controller assignment: `SEED-PROCUREMENT-A3-CORRECTION-01` at controller head `c217cbe` or later.
- API base: A2S proof head `d3c4ea4156675c39e60f78a06ee12f37cf428b67`.
- Historical producers remain immutable and independently named:
  - seed product spine A1: `e14b405d58a293c002f5676984a95e55372b3bd2`
  - Project schedule A2: `265724e528502b44a1250efea551539d74cb0bbd`
  - procurement A3: `777e0d471d2ecf02294fffb7562761d6f8a36dbd`
  - supplier identity A2S: `6467b989db7422c45935dcec3ad334b4fe99ce5f`
- This correction will publish a separate A3C producer SHA and topology delta. It will not rewrite historical manifests.

## Scope and authority

- `CIBOTFLOW/Luzione-API` remains the sole canonical writer for Evidence Artifact, Product Source, Product Candidate, RFQ draft, normalized Supplier Quote, Bid Comparison, and immutable human Procurement Selection.
- All commands are tenant-bound, additive, default-off, internal `NO_EFFECT` writes through the existing P110 command/receipt/event/outbox kernel.
- RFQ send, supplier commitment, PO release, provider ingestion/fetching, managed migration, deployment, credentials, and all external effects remain prohibited.
- `purchase_order.create_draft` remains held until `SEED-PROPOSAL-OWNER-A2P` supplies exact canonical ProposalVersion readback. Purchase-order acknowledgement remains held behind an exact PO draft.
- The older assignment text says to preserve the A2S hold, but the newer controller dispatch and accepted A2S evidence explicitly authorize removing only that hold after exact `requireEligibleSupplier` checks. This package follows the newer direction.

## Contract correction

- Publish `SeedProcurementCommand/v2` and `SeedProcurementReadModel/v2`; do not mutate the published v1 compatibility promise in place.
- Each Product Source carries one exact direct Evidence Artifact reference and zero or more exact upstream Evidence Artifact references. A URL-resolved PDF therefore remains a PDF source backed by a PDF artifact and additionally names the URL artifact it derived from.
- Each Product Candidate carries the exact Product Source reference it derives from.
- Every reference binds tenant, canonical owner, object type, stable ID, and exact version. Project scope, digest, review state, time validity, and `DOMAIN_COMMITTED` finality must reconcile at write and readback.
- `CSV` maps to the existing `ProductSource/v1` XLSX spreadsheet lane. Manual, PDF, Room Planner, Shopify, URL, and XLSX match their source kind exactly.
- Canonical IDs must be unpadded. Canonical instants use RFC3339 UTC millisecond precision, are real calendar instants, and observations may not be in the future relative to the server-derived request/read time.
- Preserve the published bad v1 fixture as an immutable known-bad input with its recorded digest; publish a new positive v2 fixture and digests.

## Supplier-gated downstream owner writes

- Product Candidates with a claimed vendor require an exact current eligible `SupplierProfile/v1` with `CATALOG_SOURCE` capability.
- RFQ drafts require the RFQ supplier to be currently eligible for `RFQ_RESPONSE`.
- Supplier Quotes require the same supplier as their exact RFQ and current eligibility for `QUOTE_SUBMISSION`; their evidence, RFQ, lines, project, versions, and economics reconcile exactly.
- Bid Comparisons require exact RFQs and Supplier Quotes in one project/specification graph and current eligibility for every involved quote supplier. Recommendations remain non-authoritative.
- Procurement Selection requires an exact signed same-tenant human subject with `procurement.selection.record`, binds Bid Comparison v1 and one included quote, appends the immutable selection fact, and appends Bid Comparison v2 `APPROVED`. It does not release or send anything.

## Persistence and recovery

- Add one CLI-generated Supabase migration that removes the four obsolete dependency-hold triggers only after A2S exists, adds exact supplier-profile/version linkage and deferred P110 integrity, and grants only `SELECT, INSERT` for the four newly admitted owner relations to `luzione_api_runtime` with explicit tenant policies.
- Existing forced RLS and append-only triggers remain. PO and acknowledgement hold triggers/grants remain unchanged.
- The correction migration and rollback are idempotently rehearsed on disposable PostgreSQL. Rollback refuses after A3C-owned RFQ/quote/bid/selection rows or their P110 receipts exist; forward correction is required after admission.

## Required proof

- Focused parser/model/route/owner-store tests and known-bad controls.
- Replay, changed-payload conflict, stale version, concurrent duplicate, tenant/project isolation, supplier expiry/revocation/capability denial, human authority, exact readback, timeline causation, and atomic rollback.
- Ingestion/source-kind matrix including URL-to-PDF two-artifact lineage.
- Typecheck, zero-warning lint, full tests, build, artifact hash verification, pinned Supabase CLI checks, and disposable PostgreSQL apply/reapply/guarded rollback.

