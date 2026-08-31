# ADR-001: Postgres-Backed Durable Workflow Authority

Status: accepted for implementation, not production-proven.

The initial production-convergence workflow authority will use transactional Postgres state for commands, events, outbox/inbox, workflow instances/steps, leases, retries, dead letters and reconciliation. Workers remain stateless and restart-safe. Temporal code may remain for local proof but is non-authoritative until a real namespace, worker fleet, versioning policy, SLO and on-call owner are evidenced.

This decision creates no table and authorizes no production migration. API-PC-005 and API-PC-006 must provide additive DDL, ownership, fresh/upgrade validation, tenant/RLS tests, crash/retry/reorder proof and rollback planning.
