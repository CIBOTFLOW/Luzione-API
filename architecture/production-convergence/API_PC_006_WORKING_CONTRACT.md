# API-PC-006 Working Contract

Capability outcome: converge the existing P110 delivery/inbox/dead-letter/reconciliation and P111 workflow records into an API-owned additive baseline plus a restart-safe, tenant-bound Postgres worker store.

- System entrypoints: `PostgresWorkflowDeliveryStore` claim, heartbeat, outcome, inbox and reconciliation methods; no public HTTP route is introduced.
- Expected end state: a crashed worker loses only its lease, not durable workflow/delivery intent; due work can be reclaimed once, bounded failures retry or dead-letter, ambiguous acknowledgement requires reconciliation, and source confirmation requires authoritative readback evidence.
- Authoritative truth: existing `public.p110_inbox_messages`, `public.p110_delivery_attempts`, `public.p110_dead_letters`, `public.p110_reconciliation_checkpoints`, `public.p110_outbox_messages` and P111 workflow/checkpoint/attempt/timer/human-task/compensation/recovery relations in canonical Postgres.
- Write owner: CIBOTFLOW/Luzione-API through tenant-bound transactions. Provider adapters remain later API-PC-010 work and may not bypass this store.
- Readback: locked outbox/workflow rows, delivery attempts, reconciliation checkpoints, dead letters and the existing tenant-scoped platform-guarantee summary.
- Consumed contracts: `luzione-command-ledger/v0.1`, lifecycle workflow/retry/event semantics v1, API-PC-004 authenticated tenant authority.
- Published contract: `luzione-workflow-delivery/v0.1`.
- Dependencies: API-PC-005; the current P110/P111 read service and pure retry/state-machine contracts; the observed local legacy schema.
- Mutation cone: one additive fresh/upgrade migration, one Postgres worker store, deterministic delivery decisions, disposable database proof, registries and consumer handoffs.
- Reuse/convergence: preserve every observed P110/P111 relation name and compatibility shape. The draft durable-execution change is evidence for leases and `SKIP LOCKED`, but its authority-v2/provider/effect-receipt tables are outside this cell.
- Invariants: claims use `FOR UPDATE SKIP LOCKED`; a lease has owner/start/heartbeat/expiry and can be reclaimed only after expiry; attempts never exceed the row budget; ambiguous-after-ack is never blindly retried; source confirmation requires readback; inbox producer IDs deduplicate; replay is operator/reconciliation gated; all tables force tenant RLS and browser roles receive no grants.
- Non-scope: provider HTTP calls, circuit breakers, live workers, business HTTP commands, authority-v2, production migration application, operator UI and external effects.
- Acceptance proof: fresh and observed-legacy upgrade; crash/expired-lease reclaim; competing-claim exclusion; bounded retry exhaustion to DLQ; ambiguous acknowledgement to reconciliation; source-confirmed readback; inbox duplicate; cross-tenant denial.
- Irreversible effects: production migration or worker activation is explicitly excluded and requires a separate release decision.
