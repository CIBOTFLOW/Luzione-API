# Production Convergence Release Gates

A bounded API increment may merge only after typecheck, lint, complete test taxonomy, optimized build, affected negative tests, compatibility checks and exact-SHA proof pass.

Promotion evidence is separate:

1. `LOCAL_PROVEN`: exact repository SHA plus local checks.
2. `STAGING_PROVEN`: exact deployment identity, contract/schema versions, health/readiness, negative tests and rollback target.
3. `CANARY_PROVEN`: named tenant/cohort, before/after invariants, causal receipts, authoritative readback and rollback rehearsal.
4. `PRODUCTION_PROVEN`: fresh exact-production observation, open-defect review, SLO/security/recovery evidence and retained journey package.

Configuration, deployment acknowledgement, provider acknowledgement, HTTP 200, mock evidence and UI rendering never independently prove business completion. Mutations remain disabled unless an explicit runtime policy, authority kernel, durable ledger, rollback plan and release gate all permit them.
