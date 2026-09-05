# CORE-02 Working Contract — API-Owned CRM Activation Cone

## Authority and outcome

- Project: `CORE-02`
- Controller: `CIBOTFLOW/Luzione-platform-program@7713b02201e5abb84a92bb0d2af91514d33c84d5`
- Repository/base: `CIBOTFLOW/Luzione-API@bb5eb395af0873f4483ba2dc10c76f9941051dde`
- Capability outcome: a repository-observed, machine-checked inventory of only the Luzione Core API dependencies reachable from GJ-1 tenant onboarding, GJ-2 lead to procurement, and GJ-3 support to resolution.
- Effect authority: `NO_EFFECT`.

## Entrypoint and expected end state

The entrypoint is an engineer or controller reading the frozen repository at the exact base and the CORE-02 artifacts. The expected end state is an exact list of reachable API routes, canonical contract objects, Postgres relations, read/write principals, opaque credential references, jobs, flags, monitoring, recovery, rollback, and kill switches. Every unresolved fact is routed through one minimal owner-return packet and no unknown is silently treated as approved.

## Authoritative truth, owner, and readback

- Repository source and migrations are authoritative only for tracked implementation intent and file ownership.
- `CIBOTFLOW/Luzione-API` owns the shared interface definitions and its tracked migration/route artifacts.
- Canonical Postgres owns committed business and control-plane data; actual production schema, grants, login memberships, jobs, and recovery posture are deliberately unqueried.
- Provider/release consoles own deployed job, credential-binding, monitoring, backup, and release facts; those remain unknown until a signed owner return supplies immutable evidence.
- Readback for this project is local manifest validation plus exact Git history. It is not application, provider, or production readback.

## Contracts consumed and published

CORE-02 consumes the frozen `LuzioneCoreContracts/v1` bundle and all exact identifiers from CORE-01 without modifying or republishing them. It publishes only `CORE-02/API-Activation-Cone-Inventory/v1`, `CORE-02/Unknown-Owner-Ledger/v1`, and `CORE-02/Owner-Return/v1` evidence formats.

## Dependencies and mutation cone

Inputs are the exact CORE-01 final, existing API routes, migrations, registries, runbooks, workflow worker, deployment configuration, and controller golden journeys. The mutation cone is limited to documentation, execution metadata, owner-return templates, and tests. No application route, runtime module, contract schema/SDK, migration, provider adapter, credential, deployment, or production surface is in the mutation cone.

## Reuse and convergence

- Reuse the existing topology inventory, source-of-truth registry, service catalog, operations registry, recovery registry, API-PC-013 ownership manifest, migration-ownership record, runtime flags, and CORE-01 activation-cone request.
- Narrow those broad artifacts to the three CRM journeys; do not copy parked FEP/Rewards/Portal/Planner concerns into the cone.
- Treat onboarding and support as contract-only where no dedicated API route/table/job exists.
- Treat GJ-2 dark-path domain records as transfer-pending where existing evidence does not establish completed canonical ownership.

## Invariants and explicit non-scope

- The entire `contracts/core` and `src/modules/luzione-core-contracts` trees remain byte-identical to the exact base.
- Company/product naming is `Luzione AI` / `Luzione CRM OS`; contract identifiers remain unchanged.
- No secret value is recorded. Credential bindings are opaque environment-variable or provider-reference names only.
- Unknown production truth stays `UNKNOWN`, never inferred from migration files, configuration presence, or provider acknowledgements.
- All effect flags remain disabled; CORE-02 adds no runtime binding or activation path.
- FEP and money movement are absent.
- No production query, migration, credential access/change, merge, default-branch action, deploy/promotion, provider effect, or rollback is performed.

## Acceptance proof

1. JSON artifacts parse and every inventory ID is unique.
2. Every route and source path exists and each recorded HTTP method is exported by that route.
3. Every migration-owned relation is mechanically evidenced by its named migration.
4. Every unknown appears exactly once in the ledger and exactly one owner-return packet.
5. Packets require a named human function, immutable evidence, observation time, explicit confirmation/correction, and signature metadata without secret material.
6. Runtime jobs, flags, monitors, recovery, rollback, and kill-switch claims are bound to tracked sources and do not claim deployment.
7. Frozen CORE-01 paths have the same Git tree IDs as the exact base.
8. Focused tests, compliance, typecheck, zero-warning lint, full tests, and build pass.
9. Reverse-applying CORE-02 commits restores the exact base tree.

## Irreversible effects

None are authorized or required. Every external, production, credential, migration, default-branch, provider, and rollback action remains outside this project.
