# A01 Working Contract — API Readiness Restoration

## Capability outcome

- Controller project: `A01` / Prompt 02.
- Starting repository SHA: `6f7191f0f5e59153541271ea291f3727015f5741`.
- Outcome: restore reproducible release readiness and the exact 40-relation production security gate without weakening RLS, client denial, fail-closed health semantics, or disabled mutation/effect flags.

## Entrypoint and expected end state

- Public entrypoints: `GET /api/v1/livez`, `GET /api/v1/readyz`, and `GET /api/v1/healthz`.
- Authenticated diagnostic entrypoint: `GET /api/v1/security/rls-readiness` with capability `security.rls.read`.
- Expected end state: the same exact deployed SHA reports `livez=200`, `readyz=200`, and `healthz=200`; the authenticated catalog readback reports all 40 expected relations, zero RLS/grant/role violations, and permission-denied active probes.

## Authoritative truth, write owner, and readback

- Canonical truth: the managed Luzione Postgres catalog and role/grant/RLS state.
- Write owner: reviewed API-owned migrations in `supabase/migrations`; managed or production application is a separate release action.
- Readback: `src/lib/security-posture/readService.ts` over `pg_class`, `pg_roles`, `pg_default_acl`, `has_table_privilege`, and active `SET LOCAL ROLE` denial probes.
- Current production observation at the starting SHA: connectivity is healthy, but `order_fulfillment_intents` is absent, both `luzione_api_runtime` and `luzione_provider_worker` are absent, and the 29 present convergence relations are not forced-RLS and retain legacy `service_role` SELECT. This exactly explains 39/40 relations and 61 violations.

## Consumed and published contracts

- Consumes unchanged `luzione-readiness-evidence/v1`, `luzione-reconciliation-state/v1`, `luzione-platform-failure/v1`, `luzione-request-identity/v1`, and the existing API-PC-010/API-PC-013 migration contracts.
- Publishes no new shared identity, command, receipt, readback, economic, or HTTP contract version.
- The 40-relation set remains the canonical `EXPECTED_RLS_TABLES` definition; the project repairs implementation and release evidence only.

## Dependencies and mutation cone

- Controller dependencies: none.
- Reused implementation: `20260831070000_order_fulfillment_intent_dark_path.sql`, `20260831090000_api_pc_013_least_privilege_roles_rls.sql`, the API-PC-013 disposable proof, health/readiness routes, and release/compliance gates.
- Mutation cone: dependency lockfile, readiness release preflight/proof artifacts, migration rehearsal/rollback evidence, proof/failure ledgers, and repository-local handoff.
- Open PR #55 overlaps dependency and readiness files but adds separate productization contracts and a new migration; A01 does not merge, duplicate, or expand that work.

## Invariants and non-scope

- Never remove a relation from the expected set, suppress a violation, make health fail open, relax active probes, or restore direct `anon`, `authenticated`, or legacy `service_role` authority to obtain a 200.
- Keep all production command mutations and external effects disabled.
- Do not change shared contract versions, tenant/actor meaning, economic semantics, DNS, credentials, or another repository.
- Do not apply a production migration, role membership, credential change, or production promotion without the separate production gate.

## Acceptance proof defined before coding

1. Clean install plus compliance, typecheck, lint, full tests, production build, and zero unaccepted high/critical dependency findings.
2. Test-sensitive preflight that identifies the exact missing relation, missing roles, non-forced RLS, and legacy grant drift instead of returning only aggregate counts.
3. Disposable observed-shape migration proof for ordered API-PC-010 then API-PC-013 application, idempotent reapplication, 40/40 catalog posture, client/cross-tenant/worker denials, and authoritative readback.
4. Rollback rehearsal restoring the pre-migration schema/role/grant posture and proving the service remains fail closed; no data or effect path is activated.
5. Exact-SHA preview/staging deployment evidence where the environment is already authorized and can use an isolated migration target.
6. Production `livez`, `readyz`, `healthz`, authenticated active probes, deployment ID, and rollback observation only after the named production gate.

## Irreversible or external effects

- Local code, disposable databases, tests, and preview deployment are reversible and effect-free.
- Managed/production DDL, role/grant changes, credential membership, environment-secret changes, and production promotion are gated external state changes. The session stops before them unless separately authorized.
