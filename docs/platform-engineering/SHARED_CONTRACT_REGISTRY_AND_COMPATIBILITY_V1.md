# Shared Contract Registry and Compatibility Law V1

Project: `API_SE_002`  
Canonical source: `src/modules/platform-contracts/registry.ts`  
Public read surface: `GET /api/v1/catalog`  
Registry version: `luzione-platform-contract-registry/v1`

## Working contract

- Capability outcome: publish one API-owned index of shared contracts, versions, source paths, consumers, compatibility posture and actual maturity.
- Actor/entrypoint/end state: UI, Sultan or an engineer reads the existing public catalog and can distinguish current runtime, library-only, specified-only and pending contracts.
- Authoritative owner: `CIBOTFLOW/Luzione-API` owns the registry and shared platform meanings. Referenced domain/provider stores remain authoritative for their records.
- Consumed contracts: current main modules plus published systems-engineering law; open PR #31 is pending evidence only.
- Published contracts: registry metadata and compatibility law added to the existing catalog response without changing its `1.0` contract version or removing fields.
- Mutation cone: typed metadata, existing read-only catalog route, tests, docs and consumer handoffs.
- Invariants: no draft is current runtime; no breaking field-meaning change inside one major; unknown authority/effect/failure/state values fail closed; producer evidence never proves consumer integration.
- Non-scope: duplicating PR #31 OpenAPI code, activating commands, changing persistence, or claiming consumer adoption.
- Acceptance proof: unique `contractId@version`, API ownership, real current source paths, no pending/current overlap, catalog exposure and known-bad duplicate/promoted-draft sensitivity.
- Irreversible effects: none.

## Convergence decision

The existing `/api/v1/catalog` is the natural read surface, so this project extends it additively. It does not add another service, table or endpoint. PR #31 already proposes an OpenAPI implementation; copying it onto this divergent branch would create two candidate definitions, so OpenAPI remains a named pending change set until rebase and semantic convergence.

## Maturity is part of the contract

The registry separates:

- `IMPLEMENTED`: callable on current `main`;
- `IMPLEMENTED_TRANSITIONAL`: callable but intentionally not the target identity/authority model;
- `LIBRARY_ONLY`: deterministic code exists, but the production route/store path is not active;
- `SPECIFIED_ONLY`: the shared meaning is published but has no runtime implementation;
- `PENDING_CHANGESET`: code exists only in an open draft and is not current truth.

This prevents the prior broad `foundation` label from implying that OpenAPI, universal failure semantics, desired/observed state, or release evidence are already implemented.

## Compatibility law

Additive evolution is the default. A breaking change requires a new major version, consumer inventory, migration/cutover plan, compatibility evidence and retirement criteria for the old path. Unknown optional fields may be ignored, while unknown authority, effect, failure, state or retry enum values fail closed.

Current `1.0` catalog consumers remain compatible because `contractRegistry` and `sourceOfTruthRegistry` are added fields. No existing field is removed or reinterpreted.

The legacy `authority`, `canonicalObjects[].owner` and `platformAreas[].status` fields remain for compatibility but now carry explicit notices. They are descriptive/functional labels, not canonical mutation ownership or precise contract maturity. New consumers use the versioned registries.

## Current limitations

- The HTTP response and actor envelopes are not yet the universal request/correlation envelope required by `API_SE_004`.
- The existing retry failure classes predate the universal failure taxonomy and are registered as legacy/library-only, not as the completed `platform-failure/v1` contract.
- Lifecycle command, receipt, workflow and continuation code is library-only until canonical runtime ownership and persistence are activated.
- Authority v2 and OpenAPI remain draft PR #31 candidates.
- UI and Sultan must independently prove consumption of any stable registry version.

## Strongest supportable claim

`CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`

The API now has one typed, public, compatibility-aware registry of current and pending shared contracts. It does not prove consumer integration, runtime activation of library-only contracts, preview deployment or production observation.
