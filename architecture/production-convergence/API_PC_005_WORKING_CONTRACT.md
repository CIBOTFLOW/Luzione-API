# API-PC-005 Working Contract

Capability outcome: converge the existing P110 command, idempotency-conflict, event and outbox contracts into an API-owned additive migration and a real Postgres implementation of the already-proven atomic command kernel.

- System entrypoint: `LifecycleCommandKernel.execute`; future HTTP domain commands must call this service after API-PC-004 authentication and domain-specific parsing.
- Expected end state: one transaction contains the owner mutation, accepted receipt, event and outbox record; exact retries return the prior receipt and hash drift records a conflict without a second owner effect.
- Authoritative truth: `public.p110_command_receipts`, `public.p110_event_envelopes`, `public.p110_outbox_messages` and `public.p110_idempotency_conflicts` in canonical Postgres.
- Write owner: CIBOTFLOW/Luzione-API through the Postgres atomic store. Domain owner callbacks remain responsible for their own canonical object mutation and version readback.
- Readback: tenant-scoped receipt lookup by idempotency key and the existing platform-guarantee summary.
- Consumed contracts: `luzione-authority-subject/v0.1`, lifecycle command/event/receipt v1 and canonical owner mutation callback.
- Published contracts: `luzione-command-ledger/v0.1` over existing lifecycle command/event/receipt v1 semantics.
- Dependencies: API-PC-004; local schema evidence; the existing command kernel and P110 read service.
- Mutation cone: one additive migration, one Postgres store, command-kernel tests, migration proof and catalog/registry metadata.
- Reuse/convergence: preserve the established P110 relation names and shapes. Draft #31 is evidence for later authority-v2 columns but is not imported because it assumes the base P110 tables and includes unrelated provider/control-plane work.
- Invariants: unique tenant/idempotency receipt; same hash replays; different hash conflicts; owner mutation/event/receipt/outbox share one transaction; tenant RLS; browser roles have no table grants; external effects remain undispatched.
- Non-scope: business-domain HTTP commands, authority-v2 migration import, provider workers, production migration application and live effects.
- Acceptance proof: fresh migration, upgrade over the observed legacy shape, atomic rollback, replay, conflict, tenant denial and exact-schema readback.
- Irreversible effects: production migration application is explicitly excluded and requires a separate release decision.
