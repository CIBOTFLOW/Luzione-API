# Cross-System Topology and Ownership Inventory V1

Project: `API_SE_001`  
Machine-readable inventory: `engineering/execution/LUZIONE_API_TOPOLOGY_INVENTORY_V1.json`  
Observed main SHA: `be8cd38fe6af24a5d686ff414b02caf449980386`  
Evidence boundary: local repository inspection plus GitHub metadata for open API pull requests; no production or provider effect.

## Working contract

- Capability outcome: inventory the real API deployables, routes, stores, provider boundaries, dependencies, health/evidence sources and semantic owners before adding platform machinery.
- Entrypoints: the tracked Next.js application, Vercel configuration, Postgres migrations, CI workflows and published API architecture.
- Expected end state: one machine-readable inventory, one human reconciliation, explicit UI/Sultan handoffs and tests that detect omitted routes or malformed ownership records.
- Authoritative truth: tracked `main` is current repository truth. Canonical Postgres or an explicitly named provider owns business state. Open PRs are pending evidence only.
- Mutation cone: documentation, execution metadata and verification tests. No runtime, database, provider, deployment or consumer-repository mutation.
- Invariants: no draft PR is promoted to current truth; no configuration is described as observed health; no provider acknowledgement is described as business finality; no secret or private production identifier is recorded.
- Acceptance proof: parse the inventory and handoffs, cover every tracked API route file, keep IDs unique, constrain owner/evidence vocabulary, require all visible runtime environment dependencies and prove at least one open convergence finding.
- Irreversible effects: none.

## Current topology

One Vercel/Next.js deployable serves the API and restricted engineering console. It connects server-side to canonical Postgres and can verify one exact Luzione UI Vercel workload through OIDC JWKS. The repository also publishes additive Postgres migrations, but `main` has no migration runner or production migration receipt.

The current HTTP surface contains 16 method/path contracts across 14 route files:

- public process/configuration evidence: `livez`, `readyz`, `healthz`;
- authenticated security and platform readback: RLS readiness and P110/P111 aggregates;
- public aggregate Sultan runtime status;
- authenticated, effect-free autonomy and governance evaluation;
- public static platform/workflow catalogs;
- authenticated P113 catalog reads and bounded internal projection writes;
- one fail-closed, unauthenticated mutation placeholder that never executes a command.

The API directly calls only Postgres and Vercel's OIDC JWKS endpoint on `main`. Shopify observations are supplied by an authenticated caller and reconciled into Postgres; the API does not call Shopify. Gmail, Google Drive and Airtable appear only through a Postgres aggregate function. AI and other vendors are documented policy boundaries, not active adapters.

## Ownership model retained

- Luzione API owns shared deterministic platform contracts and server-side enforcement/readback adapters.
- Luzione UI owns human-facing workflows, interaction and presentation.
- Sultan OS owns reasoning, model/tool runtime, memory, simulation and AI-quality evaluation.
- Canonical Postgres or an explicitly named provider owns business truth.

This inventory does not transfer any business object, table or provider mutation path. Object-by-object truth and consistency mapping belongs to `API_SE_003`.

## Material convergence findings

1. The public platform catalog currently implies that the API owns canonical business objects and “deterministic truth.” The systems program assigns business truth to Postgres/providers, and draft PR #31 preserves existing UI object ownership until an explicit transfer. This is an unresolved semantic conflict, not a stylistic wording issue.
2. P110/P111 are read as canonical, but their migrations and transfer evidence are intentionally absent from `main`. PR #31 proposes an ownership registry; until merged and reconciled with migration history, it is pending only.
3. Workflow packs are independently defined in TypeScript and SQL. Current tests do not prove the two copies are identical.
4. `readyz` can report `READY` from `select 1` plus configuration while `healthz` requires an RLS pass. They are two meanings sharing readiness language.
5. Gmail, Google Drive and Airtable are called `CONNECTED` from stored row counts without current reachability or provider readback.
6. Service-token callers supply tenant/actor headers. The current architecture documents this as an initial boundary; canonical membership resolution remains pending in PR #31 and future `API_SE_004` work.
7. The fail-closed `POST /api/v1/platform-guarantees` placeholder overlaps the governed `/commands` path proposed by PR #31 and needs explicit retirement or compatibility mapping.
8. The public catalog labels OpenAPI/developer concepts as `foundation`, but `main` has no OpenAPI route or shared compatibility registry.
9. The canonical object list does not yet cover the program's required Supplier, Quote, Product, Task, Approval, Decision, Workflow, Memory and AI Generation entries.

## Pending work is not current truth

PR #31 at `b08e472eee11d6c9db6e332836bad8c1a98e53ed` integrates PRs #26–#30 and adds a substantial control plane, migration runner, durable execution, connection and webhook contracts, and release/load evidence. It diverged from `main` before the systems-engineering queue commit. Subsequent projects should rebase and converge it; they must not copy its tables, routes or ownership claims as if already deployed.

## Cross-repository boundary

The UI and Sultan handoffs request independent consumer inventories. They do not ask either repository to adopt draft API routes. Consumer integration is not proven until those repositories return exact versioned evidence.

## Recorded dependency failure

The locked `main` dependency graph reports three high-severity and one low-severity audit entries. The high entries resolve through the available Next.js `16.3.3` non-major update; this project does not silently widen its documentation/discovery mutation cone into a framework upgrade. The release-readiness claim for the current dependency graph is quarantined in `SYSTEMS_ENGINEERING_FAILURE_LEDGER.json` as `API_SE_001_DEPENDENCY_AUDIT_20260829` until the update passes the exact release gate and audit.

## Strongest supportable claim

`BOUNDED_PASS | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`

The tracked main-branch API topology, route surface, direct store/provider boundaries, health/evidence sources, pending API change sets and visible semantic conflicts are inventoried and coverage-checked for `API_SE_001`. Live production/provider state and the internal reality of UI and Sultan OS remain unverified.
