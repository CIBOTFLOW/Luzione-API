# Source-of-Truth and Consistency Registry V1

Project: `API_SE_003`  
Canonical source: `src/modules/platform-contracts/truthRegistry.ts`  
Public read surface: `GET /api/v1/catalog`  
Registry version: `luzione-source-of-truth-registry/v1`

## Working contract

- Capability outcome: map every required initial entity to semantic owner, canonical store/provider, mutation owner, read models, consistency, reconciliation, conflict, version, retention and rebuild posture—using explicit unresolved values where evidence is missing.
- Actor/entrypoint/end state: engineers and consumers read the public catalog and can see both confirmed and missing ownership without interpreting UI labels or draft PRs as truth.
- Authoritative owner: Luzione API owns the registry contract. Canonical Postgres or an explicitly named provider owns the record; UI and Sultan retain their published semantic scopes.
- Consumed contracts: architecture, API topology inventory, P113 runtime, P110/P111 library/readback and draft change metadata.
- Mutation cone: typed metadata, existing read-only catalog route, tests, docs and handoffs. No domain write path changes.
- Invariants: one mutation-owner field per entity; unresolved ownership remains `null`; a projection never becomes source truth; draft transfer is never current ownership.
- Non-scope: deciding cross-repository ownership without consumer evidence, transferring tables, adding dual writes, or applying migrations.
- Acceptance proof: all 17 required entities present, unique domain/entity identity, confirmed entries complete, unresolved entries evidence-linked, Shopify/Product projection semantics exact and known-bad duplicates/incomplete confirmed entries rejected.
- Irreversible effects: none.

## Current registry result

| Entity | Canonical store/provider | Mutation owner | Consistency/state |
| --- | --- | --- | --- |
| Account, Contact, Lead, Opportunity | canonical Postgres | unresolved | unresolved |
| Commercial Case, Proposal, Quote, Order | canonical Postgres | unresolved | unresolved |
| Product | Shopify | unresolved | provider-authoritative; P113 projection confirmed and rebuildable |
| Supplier, Shipment, Task | canonical Postgres | unresolved | unresolved |
| Approval, Decision | unresolved on current main | unresolved | deterministic evaluation exists; durable PR #31 stores are pending |
| Workflow | canonical Postgres/P111 | transfer pending | transactional state/version contract; current mutation owner unresolved |
| Memory, AI Generation | store unresolved | Sultan OS semantic/mutation owner | aggregate readback only; persistence/version evidence required |
| Campaign, Customer Issue | canonical Postgres | unresolved | unresolved |

The unresolved rows are deliberate. Repository evidence is not sufficient to select a canonical mutation owner for those objects, and selecting one here would create a false ownership transfer.

## Duplicate and collision findings

- `API_SE_003_M001`: workflow-pack definitions exist independently in TypeScript and SQL.
- `API_SE_003_M002`: the main platform catalog's API-centric business-object wording conflicts with the pending preservation of existing UI object ownership.
- `API_SE_003_M003`: the current fail-closed platform-guarantees POST placeholder collides conceptually with PR #31's pending governed command route.

These findings do not prove two live production writers. They identify definitions or paths that must be converged before a new current owner is declared.

## Product projection boundary

Product is the only initial entity with a bounded provider-authoritative mapping proven by current API code. Shopify remains source truth. P113 tables are read models. The projection becomes `CURRENT` only after authoritative product/variant counts, cursor evidence and current P107 mapping evidence agree; otherwise it remains reconciliation-required or blocked.

## Strongest supportable claim

`CONTRACT_STABLE | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`

The required initial entities now have one machine-readable truth/consistency record and explicit duplicate-path findings. Most business mutation owners remain unresolved pending UI/Sultan and production-schema evidence; no ownership transfer or production observation is claimed.
