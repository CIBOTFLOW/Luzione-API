# SGO-C02 — bounded record context producer

Controller release: `2f0d9818029cc79f1ca1058f735699fa33982b9b`; activation/lease: `SGO-20260911-01` / `SGO-20260911-01-L1`.

Base: `7ee5a0a53a3434c3e00969dc626a4daad33f9dc0`; branch: `codex/sgo-c02-record-context-20260911`.

## Outcome and entrypoint

An executable G0 source adapter prepares bounded Lead and Commercial Case facts for an exact authenticated Stage 5 consumer workload. Callers supply the existing `LeadCommercialCaseStore` through its read-only methods. This slice is intentionally not mounted on an HTTP route and does not create a receipt. Draft output is unpersisted and cannot be used for admission or outcome observation.

## Ownership and contracts

- Shared context/readback contract owner: Luzione API.
- Existing source owner: `LeadCommercialCaseStore.readLead` / `readCommercialCase`, `luzione-lead-commercial-case/v0.1`, tenant-scoped `crm_leads` / `commercial_cases`.
- Current domain writer remains Luzione UI; the API command transfer is dark. No transfer is asserted here.
- Reuse existing Stage 5 workload check, release pin meanings, `CanonicalClaim` type, deterministic hash and source object versions.
- Publish `luzione-sultan-record-context/v1-draft.1`; preserve all existing v1 receipt/admission schemas and routes and frozen A02 pins.
- Task, Product, Supplier and Account research remain explicit unsupported-source outcomes, pending source-owner reconciliation. Generic accounts and rich CRM research are not treated as interchangeable.

## Mutation cone and dependencies

Only new Stage 5 draft adapter/manifest, focused existing Stage 5 test suite, and repository-local handoff/proof accounting. No production data, SQL/migration, credential, provider, default branch, deployment or existing PR changes.

## Acceptance established before implementation

Prove exact workload and tenant checks before source reads; caller authority rejection; exact consumer/API SHA binding; invalid/stale/future request denial; unsupported kinds perform zero source calls; owner/contract/object-ID/version/type mismatches return no claims; missing records, schema absence and dependency failures are distinct; deterministic minimized immutable output; no receipt/admission authority; old Stage 5 request contract unchanged. Exercise both source kinds with representative fixtures and bad cases. Document local source export/runtime limits separately from CI and authenticated real database readback.

## Rollback

The adapter is unmounted and read-only. Reverting only this additive candidate restores the source tree; no data or external state restoration is required. Prove inverse patch/content restoration locally before publication.

## Successor slice — source-owner and receipt-compatible integration

- Capability outcome: expose the existing authorized draft producer through the Stage 5 service and bind its exact draft hash, source version, consumer release, tenant and idempotency identity into deterministic receipt material.
- Actor/system entrypoint and end state: an in-process, unmounted `SultanStage5Service` method accepts the existing draft request plus a bounded idempotency key and the existing `LeadCommercialCaseStore` read port; it returns immutable receipt preparation, never a persisted receipt.
- Authoritative truth/write owner/readback: the same tenant-scoped `crm_leads` / `commercial_cases` reads remain authoritative; Luzione UI remains current writer; no mutation or alternate source is added.
- Consumed/published contracts: consume `luzione-sultan-record-context/v1-draft.1`, `luzione-lead-commercial-case/v0.1` and Stage 5 v1 receipt semantics; publish an additive `luzione-sultan-record-context-receipt-preparation/v1-draft.1` in source and the existing manifest only.
- Compatibility boundary: `luzione-canonical-business-readback/v1` and its database constraint do not admit `LEAD` or `COMMERCIAL_CASE`. The preparation must state that exact incompatibility and the need for a separately versioned receipt/storage change. It must not alter v1 types, parser, schema, persistence or admission.
- Mutation cone: `src/modules/sultan-stage5`, its focused tests, and SGO-C02 repository-local handoff/proof accounting only. No route, contract registry, SQL/migration, source table, provider, deployment or current-client changes.
- Invariants: source authorization precedes reads; only verified draft hashes can be prepared; receipt material exists only for statuses representable by canonical receipt semantics; unavailable or incompatible status carries no claims; the request hash is stable for exact replay; changed source evidence cannot redefine an existing idempotency identity and recovery requires a new key; `readbackReceiptId` remains absent and `admissionEligible=false`.
- Acceptance proof: exact Lead and Commercial Case material; identity/release/freshness denial before reads; corrupt draft rejection; unsupported/version-mismatch/source-invalid fail closed; deterministic replay material; changed-source recovery requires a new idempotency identity; Stage 5 v1 source/schema/parser bytes remain unchanged.
- Irreversible effects: none. Rollback is source-only removal of the additive service method/preparation module and tests.
