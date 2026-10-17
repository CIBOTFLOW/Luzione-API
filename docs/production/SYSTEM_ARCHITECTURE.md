# System Architecture

```text
Human operator
  -> Luzione UI: work, review, approval and understandable readback
  -> Luzione API: identity, policy, command, workflow and provider authority
  -> Postgres or the explicit provider source of truth

Sultan OS
  -> plan, evaluate and propose
  -> submit typed commands to Luzione API
  -> never write operational tables or providers directly
```

Luzione API owns canonical tenant UUIDs, memberships, connections,
capabilities, commands, effects, approvals, workflows, provider execution,
reconciliation, audit, usage, budgets and kill switches. Existing UI-owned
objects remain owned by UI until an object-level transfer is explicitly proven.

Identity is global and authorization is an active tenant membership. Tenant
context is resolved from an authenticated principal and membership, never from
an unverified browser or model payload.

Postgres is the durable command/checkpoint/outbox truth. Workers lease due steps
with `FOR UPDATE SKIP LOCKED`; provider request and provider readback are
separate resumable steps. Temporal may execute the same step contract but is not
canonical workflow state.

