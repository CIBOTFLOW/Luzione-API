# Disposable Postgres Restore Drill

Owner: Luzione database and security owner. Scope: isolated local/disposable restore rehearsal only.

## Containment

Use a local Docker Postgres container and a new target named `luzione_api_se014_restore_<suffix>`. The harness refuses an existing target, refuses `postgres` as the source, never changes the source database, and cleans up the dump and drill database. Production endpoints and credentials are prohibited.

## Procedure

Run `scripts/run-disposable-postgres-restore-drill.sh <local-source-db> <unique-drill-db> [container] [post-restore-migration] [post-restore-sql]`. It captures a source fingerprint, creates a custom-format logical dump without ownership/grants, restores into `template0`, optionally reapplies an exact reviewed migration and executes a fail-fast bounded readback SQL file, captures the restored fingerprint, compares exact table/row/function/index/policy aggregates, and reports elapsed recovery time, migration/readback state and dump checksum/size without printing row contents. API-PC-014 uses `scripts/validation/run-api-pc-014-disposable-restore.sh` to build the admitted migration chain, reapply the exact role/grant/RLS migration omitted by the portable dump, and verify restored forced-RLS, role, grant and canonical-row evidence before cleanup.

## Verification

A passing local drill requires `pg_dump` and `pg_restore` success, exact source/restored catalog fingerprints, a bounded artifact checksum/size, measured elapsed time, and verified cleanup. This proves local logical portability only. It does not prove managed backup configuration, PITR, production scale, production RPO/RTO, RLS active-denial probes, provider reconciliation, or application traffic cutover.

## Escalation

Fingerprint mismatch, extension/role incompatibility, restore timeout, or cleanup uncertainty blocks the drill claim. Production restore requires separate authorization, provider snapshot identity, isolated destination, reviewed cutover/rollback plan, and an already-exercised restoration path.
