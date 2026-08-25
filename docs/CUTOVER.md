# Cutover plan

## Gate 1: visible safe foundation

- Deploy console, health and catalog.
- Configure Vercel server secrets.
- Keep mutations and external effects disabled.

## Gate 2: canonical readback

- Connect the existing Luzione database.
- Prove tenant-scoped reads of P110/P111 tables.
- Verify unavailable sources are reported as unavailable, never zero or success.

## Gate 3: command extraction

- Move the existing guarded P110 command service without changing its contract.
- Prove same-key/same-payload replay and same-key/different-payload conflict.
- Prove receipt, owner mutation, event and outbox atomicity.
- Preserve no-effect destinations.

## Gate 4: app and Sultan adoption

- Route one Luzione UI workflow through `/api/v1`.
- Route the equivalent Sultan action through the same command.
- Prove Sultan cannot supply tenant, actor, approval or source-confirmation authority.

## Gate 5: provider sandboxes

- Add provider adapters one at a time.
- Exercise timeouts before and after acknowledgement, rate limits, retries, reconciliation, dead letters, kill switches and recovery.
- Require provider readback before business finality.

## Gate 6: production cutover

- Cut over one bounded workflow at a time.
- Preserve object IDs, event lineage, idempotency keys and redirects.
- Retire the old in-app endpoint only after equivalent readback, recovery and rollback are proven.
