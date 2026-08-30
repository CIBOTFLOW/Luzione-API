# Disposable Postgres Restore Drill

Owner: Luzione database and security owner. Scope: isolated local/disposable restore rehearsal only.

## Containment

Use a local Docker Postgres container and a new target named `luzione_api_se014_restore_<suffix>`. The harness refuses an existing target, refuses `postgres` as the source, never changes the source database, and cleans up the dump and drill database. Production endpoints and credentials are prohibited.

## Procedure

Run `scripts/run-disposable-postgres-restore-drill.sh <local-source-db> <unique-drill-db> [container]`. It captures a source fingerprint, creates a custom-format logical dump without ownership/grants, restores into `template0`, captures the restored fingerprint, compares exact table/row/function/index/policy aggregates, and reports elapsed recovery time and dump checksum/size without printing row contents.

## Verification

A passing local drill requires `pg_dump` and `pg_restore` success, exact source/restored catalog fingerprints, a bounded artifact checksum/size, measured elapsed time, and verified cleanup. This proves local logical portability only. It does not prove managed backup configuration, PITR, production scale, production RPO/RTO, RLS active-denial probes, provider reconciliation, or application traffic cutover.

## Escalation

Fingerprint mismatch, extension/role incompatibility, restore timeout, or cleanup uncertainty blocks the drill claim. Production restore requires separate authorization, provider snapshot identity, isolated destination, reviewed cutover/rollback plan, and an already-exercised restoration path.
