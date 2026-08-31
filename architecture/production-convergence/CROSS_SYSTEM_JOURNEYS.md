# Cross-System Journey Registry

The first target journey is `Lead → Commercial Case → Proposal/Quote → Order → Fulfillment Intent`.

Current state: `SPECIFIED_NOT_EXECUTED`.

Required evidence for certification:

- exact API, UI and Sultan candidate SHAs and shared contract versions;
- authenticated actor, tenant, purpose and capability context;
- command, idempotency, event, workflow and receipt lineage;
- projection and canonical/provider readback;
- denied second tenant, validation, stale-version and conflicting-idempotency cases;
- failure, bounded retry/reconciliation and recovery case;
- UI pending/degraded/rollback behavior;
- Sultan source/version/freshness citations and abstention behavior;
- before/after invariants, canary identity and rollback result.

No current repository evidence certifies this journey. API producer artifacts cannot substitute for independent UI or Sultan evidence.
