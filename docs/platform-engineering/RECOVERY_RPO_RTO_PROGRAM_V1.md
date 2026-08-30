# Recovery, RPO and RTO Program V1

Project: `API_SE_014`  
Canonical source: `src/modules/platform-recovery/registry.ts`  
Contract version: `luzione-recovery-registry/v1`

## Working contract

The initial paid-pilot targets remain RPO 24 hours and RTO 8 hours for canonical Postgres. These are policy targets, not measured production promises. Managed backup/PITR configuration lives outside this repository and remains `DECLARED_UNVERIFIED` until provider evidence and an isolated production-scale restore exist.

Shopify remains authoritative for product/catalog source truth. P113 is a rebuildable projection with a 48-hour freshness boundary; recovery discards/rebuilds the projection from authenticated source observations and never writes projection state back to Shopify.

The guarded local harness accepts only a new `luzione_api_se014_restore_*` Docker database, refuses overwrite/source-target aliasing, performs a custom logical dump/restore, compares exact bounded table/row/function/index/policy fingerprints, and cleans up the target/artifact.

## Exercised evidence

The 2026-08-29 disposable drill restored a 7,425,352-byte dump in 10 seconds. Source and restored fingerprints matched across 545 tables, 50,032 rows, 36 functions, 1,068 indexes and 103 policies; the drill database and dump were removed. The first attempt failed before target creation because an autocommit-dropped temporary table was unavailable; the retained session-scoped table repaired it.

This proves local logical portability only. It does not prove managed backups/PITR, production data size, production RPO/RTO, active RLS denial after cutover, traffic rollback or provider reconciliation. Production restore remains a separately authorized effect requiring an already-tested recovery path.

Strongest claim: `BOUNDED_PASS | LOCAL_PROVEN | SANDBOX_ONLY | BOUNDED_CLAIM`.
