# P113 Catalog Projection Recovery

Owner: Luzione catalog projection owner. Scope: authenticated Shopify observation ingest and Postgres projection.

## Containment

Stop accepting new projection writes when mapping evidence, counts, cursor continuity or idempotency is uncertain. Shopify remains authoritative; the projection is rebuildable.

## Diagnosis and recovery

Inspect the bounded ingest receipt, source cursor/version, source and accepted counts, mapping contract, idempotency key and latest sync ledger. Reconcile ambiguous acknowledgement before retry. Rebuild from provider-authoritative observations only through the authenticated P113 boundary.

## Verification

Require exact independent counts, current mapping evidence, cursor continuity, quote eligibility tests and canonical Postgres readback. Configuration or a completed HTTP call alone is not proof.

## Escalation

Escalate provider/source conflicts to the Shopify source owner and mapping/schema conflicts to the API catalog owner. External Shopify writes are outside this runbook and remain unauthorized.
