# Data Flow and Trust Boundaries

## Principal and tenant

The API verifies a user or workload principal, resolves a global identity, then
loads an active tenant membership. A supplied tenant hint must match the
resolved tenant or the request is rejected before policy evaluation.

## Command and outcome

```text
request -> EffectEnvelope -> policy -> exact approval when required
        -> durable command/idempotency receipt -> leased workflow step
        -> provider request -> provider readback/reconciliation
        -> canonical outcome/audit/usage -> UI/Sultan projection
```

HTTP success, model text, local state and provider acknowledgement are not
business outcomes. Source-owner readback is the outcome.

## Secrets

Connection records contain opaque `vault:`, `legacy:` or environment secret
references only. Secret values are server-only and excluded from API responses,
audit payloads, errors and logs. Unavailable secure storage blocks new secret
writes rather than falling back to plaintext.

## Models

Sultan may select an allowed model by task, quality, privacy, latency and budget.
Model choice cannot create authority, change tenant identity, bypass budgets,
call a provider around the API, promote learning, or mutate operational truth.

