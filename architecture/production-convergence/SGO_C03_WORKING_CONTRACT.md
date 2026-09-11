# SGO-C03 working contract — bounded linked record evidence

## Outcome

Publish the smallest additive, machine-readable API contract and unmounted producer for linked `TASK`, `COMMERCIAL_CASE`, `QUOTE`, `PRODUCT`, and `SUPPLIER` evidence. Every requested record has one explicit result state. An available result cites the exact source record and version; missing, denied, stale, unavailable, and invalid source outcomes stay distinguishable and fail closed.

## Entrypoint and end state

- Actor/system entrypoint: a server-only caller invokes `buildLinkedEvidenceContext` with an authenticated API actor, exact consumer/API release pins, a bounded request, and a server-injected source reader.
- Expected end state: one deterministic, hashed `UNPERSISTED_DRAFT` context contains 1–5 unique requested records, each with exactly one status and provenance shape.
- No HTTP route, runtime registration, Stage 5 admission path, database write, migration, provider call, deployment, or user-facing surface is added.

## Truth, ownership, and readback

| Subject | Observed read/source path | Current source/write owner evidence | Exact identity/version rule |
|---|---|---|---|
| Task | `public.team_coordination_tasks`; UI `getTeamCoordinationTaskRecordForActor` | UI current writer; API semantic-owner registry remains unresolved | `task:<taskId>:v<positive integer>` |
| Commercial Case | API `LeadCommercialCaseStore.readCommercialCase` over `public.commercial_cases` | API read contract; UI legacy writer remains transfer-pending | `commercial-case:<caseId>:v<positive integer>` |
| Quote | API `ProposalQuoteApprovalStore.readQuote` over Quote/economics rows | API read contract; UI legacy writer remains transfer-pending | `quote:<quoteId>:e<positive integer>:s<bounded status>` |
| Product | API P113 projection over `public.p113_catalog_search_projections`; Shopify source truth | Shopify canonical provider; API owns the rebuildable projection contract | exact P113 `selectionKey` plus 64-hex `sourceVersion` |
| Supplier | `public.suppliers`; UI `SupplierDirectoryService` | UI current writer; API semantic-owner registry remains unresolved | `supplier:<supplierId>@<exact UTC source timestamp>` |

The G0 producer consumes a `LinkedEvidenceSource` port. The port is server-injected and may wrap only the observed paths above. Fixtures exercise the minimum interface; this package does not claim an authenticated deployed readback or consumer adoption.

## Consumed and published contracts

- Consumes existing `ApiActor`, `CanonicalClaim`, release SHA, tenant, and source-version semantics without changing them.
- Preserves `luzione-lead-commercial-case/v0.1`, `luzione-proposal-quote-approval/v0.1`, P113 catalog projection, Stage 5 v1 parser/schema/routes, and the accepted SGO-C01 inventory byte-for-byte.
- Publishes `luzione-linked-evidence-context/v0.1-draft` plus a source-profile manifest. Draft output is not a Stage 5 receipt and is not admission-eligible.

## Dependencies and mutation cone

- Program dependency: controller-accepted SGO-C01 exact head `b46f35b9b21f59ec19c3537b7568a86fa7ec24aa`.
- Mutation cone: this working contract, one new linked-evidence module, its focused tests, the canonical test taxonomy, one machine source-profile manifest, and repository-local proof/handoff records.
- CIBOTFLOW/Luzione-UI and CIBOTFLOW/Sultan-OS remain read-only evidence sources.

## Invariants

1. The actor, tenant, deployment pins, source observations, actual record versions, source references, and claims cannot come from caller-provided request facts. A non-null caller expected-version precondition must match the subject-specific identity/version grammar before any source read.
2. Only the exact UI or Sultan workload identity already admitted for `sultan.canonical.readback.read` may receive available source data. A denied workload yields explicit `DENIED` entries without source existence or fact disclosure.
3. Requests contain 1–5 unique canonical record references; unknown fields, duplicate references, invalid IDs, invalid timestamps, and unpinned releases are rejected.
4. `AVAILABLE` requires an exact record ID, valid subject-specific record version, valid observation timestamp, at least one allowlisted exact source reference, and bounded unique canonical claims.
5. Expected-version mismatch or a source-declared stale observation yields `STALE`, retains the actual record/version citation, and exposes no claims.
6. `MISSING`, `DENIED`, and `SOURCE_UNAVAILABLE` expose no source version or claims. `SOURCE_INVALID` exposes no claims and cannot be promoted to available.
7. Source profiles keep current-writer, projection, provider, and unresolved semantic ownership distinct. Names or table presence do not promote ownership.
8. Output is deterministic for the same normalized request, server observation, actor, pins, and clock; its hash covers every field except itself.
9. `persistence=UNPERSISTED_DRAFT`, `admissionEligible=false`, `grantsAuthority=false`, `businessStateMutated=false`, and `effectAuthority=NO_EFFECT` are immutable.

## Explicit non-scope

- No legacy `A02` execution or status change.
- No UI/OS write, route mounting, runtime/tool registration, Stage 5 contract evolution, durable receipt/replay, migration application, database/provider call in tests, deployment, production action, or G1/G2 claim.
- No resolution of the still-unresolved Task or Supplier semantic owner.
- No automatic link discovery; the caller selects bounded record references and the trusted source port supplies facts.

## Acceptance proof

- Exact source-profile identities and repository pins validate.
- All five subject types produce an available result with exact record/version citations from trusted fixtures.
- Missing, denied, expected-version stale, source-declared stale, unavailable, structurally invalid-source, malformed subject-version grammar, forged-owner/ref, duplicate-reference, unknown-field, stale-request, release-pin mismatch, oversized-claim, and tamper cases fail closed.
- Denied/missing/unavailable/stale results do not leak claims; denied/missing/unavailable do not leak actual versions.
- Deterministic replay and hash verification pass; isolated reverse/reapply restores exact base/candidate trees.
- Focused tests, full repository tests, TypeScript, lint, compliance, build, exact-head CI, and CodeQL pass before handoff.

## Evidence maturity ceiling

`CONTRACT_STABLE / LOCAL_PROVEN / NO_EFFECT / BOUNDED_CLAIM`. G1 remains held for authenticated deployed source readback, persisted cross-system receipt/replay, consumer integration, and exact preview exercise. G2 remains held.
