# Migration Ownership

The API/data authority lane owns new production-convergence DDL artifacts. This statement does not prove that any migration was applied to production.

| Artifact | Current repository state | Ownership/evidence boundary |
|---|---|---|
| `20260828210000_tenant_ai_governance_and_workflow_packs.sql` | Tracked additive artifact | API repository owns the file; application history and workflow-pack parity remain unproven |
| `20260828213000_workflow_pack_foreign_key_indexes.sql` | Tracked additive artifact | API repository owns the file; production application is unobserved |
| P110 command receipt/event/conflict/outbox baseline | `20260831022000_p110_command_ledger_baseline.sql` is tracked and locally proven | API repository owns the additive file; fresh and legacy-upgrade rehearsal passed in disposable Postgres; managed/production application remains unauthorized and unobserved |
| P111 workflow schema | Referenced by current reads, migration absent from main | API-PC-006 must reconcile production history and pending-change evidence before claiming migration ownership |
| API-PC-006 workflow/inbox/DLQ/reconciliation substrate | Not yet authored | API/data lane target; fresh/upgrade validation required before any application |

## API-PC-004 authority migration design

The future additive authority migration will converge existing identity/control-plane evidence into three API-owned relations: canonical actor identities, tenant memberships, and membership capability grants. Every grant must bind tenant, actor, capability, purpose/effect ceiling, validity window, issuer and revocation state. Browser roles receive no direct mutation grant; server reads must set tenant context and negative probes must cover anonymous, authenticated, cross-tenant, expired, revoked and missing-capability access. No authority DDL is authored in API-PC-004 because main does not yet contain the pending authority-v2 migration history. API-PC-005 reconciled only the existing P110 command-ledger shape and does not import or claim the draft authority-v2 migration.

No production DDL application, schema ownership transfer, destructive migration, credential change or table move is authorized by this document. Future migrations must be additive, versioned, reversible where practical, tenant/RLS tested, and bound to an exact release manifest.
