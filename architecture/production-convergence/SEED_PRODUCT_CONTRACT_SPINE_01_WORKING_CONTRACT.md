# SEED-PRODUCT-CONTRACT-SPINE-01 Working Contract

## Outcome

Publish an additive, strict, versioned API-owned contract spine for the seed-product journey:

`Project → Space → Specification → Product → Proposal → RFQ → Supplier Quote → PO → Shipment → Installation → Service evidence`

This slice is a library-only G0 contract deliverable. It does not add a route, table, worker, provider adapter, deployment, migration, or live effect.

## Boundary

- **Entrypoint:** TypeScript consumer SDK and machine-readable JSON Schema within the existing `luzione-core-contracts` bundle.
- **Authoritative owner:** Luzione API owns the shared contract definitions. Canonical Postgres remains the future business-row owner; Room Planner remains the mutable owner of pre-publication drafts.
- **Consumers:** Luzione UI, Sultan OS, Room Planner, and Supplier/Designer/Client Portal.
- **End state:** Consumers can pin exact `/v1` contracts and reject local forks, stale versions, cross-tenant references, invalid authority, replay conflicts, or false finality before runtime activation.

## Reuse and convergence

- Extend `LuzioneCoreContracts/v1`, `CORE_CONTRACT_VERSIONS`, the strict consumer SDK, manifest, and compatibility-test conventions.
- Reuse the existing A02 identity/command/receipt/readback pins and Core effect vocabulary; do not introduce another command or receipt framework.
- Model every seed resource with stable tenant-scoped identity, version, archival posture, source references, expected-version/idempotency metadata, server-bound authority evidence, and receipt/readback state.

## Invariants

- Contract evolution is additive and exact-versioned.
- A2/A3 authority requires immutable human approval evidence; A4 is always denied.
- A provider acknowledgement is not business-final source readback.
- A committed receipt version must equal the resource version; source-confirmed readback must name the observed version, timestamp, and source reference.
- Cross-resource relationships must remain within one tenant and pin stable IDs/versions where applicable.
- Project packages are immutable publication records; activated specifications accept later Planner work only as proposed revisions.
- Proposal decisions bind an exact proposal version and target.
- Supplier quotes retain source evidence and bind exact RFQ lines; PO release remains approval-gated.

## Non-scope

- Persistence, migrations, mutation routes, provider calls, document rendering, extraction, ranking, email parsing, external authentication, UI surfaces, and release activation.
- Any claim beyond local contract compatibility.

## Acceptance proof

- All 26 P0 contracts have unique exact versions, strict TypeScript parsers, positive fixtures, and schema/manifest entries.
- Every boundary rejects surplus/missing/wrong-version fields.
- Focused negative tests cover tenant mismatch, stale expected version, replay conflict, invalid graph linkage, unauthorized A2/A3/A4 action, proposal-version drift, supplier-quote/RFQ mismatch, and provider-acknowledgement false finality.
- Typecheck, lint, focused contract tests, full test suite, and production build pass on the exact candidate SHA.

## Effect authority

`NO_EFFECT`. All runtime activation remains dark and requires a later controller gate.
