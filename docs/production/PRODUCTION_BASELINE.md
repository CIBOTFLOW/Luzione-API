# Production Baseline Contract

This public document defines how production truth is recorded without
publishing private project identifiers, deployment IDs, tenant data, security
findings, or provider receipts. Exact evidence lives in the private Luzione
release register and is linked from the corresponding change record.

Every claim uses one of these evidence labels: `DESIGNED`, `TESTED_LOCAL`,
`SHADOW_OBSERVED`, `LIVE_INTERNAL`, `LIVE_EXTERNAL`, `DEGRADED`, or `BLOCKED`.

A release record must contain the exact repository SHA, immutable deployment,
database migration IDs and checksums, observed health, rollback point, evidence
time, owner, and unresolved boundaries. A green build or HTTP response is not
an operational outcome without canonical database or provider readback.

Production database promotion is blocked whenever the repository migration
manifest and application ledger differ. Reconciliation keys are `(owner
repository, migration id, checksum)` because a numeric sequence is not globally
unique across historical repositories and rehearsals.

UI, API and Sultan releases remain separately rollbackable. External effects
stay fail-closed unless a versioned policy and exact approval authorize the
specific effect.

