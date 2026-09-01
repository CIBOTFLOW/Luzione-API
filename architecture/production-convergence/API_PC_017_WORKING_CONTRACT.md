# API-PC-017 Working Contract — Canonical License Store and Readback

Project: `API-PC-017` — add an append-versioned, tenant-scoped license and module-entitlement store plus authenticated readback while provisioning and billing effects remain disabled.

- Entrypoint: credential-bound `GET /api/v1/licensing/entitlements`; no public or caller-supplied entitlement path.
- Authoritative truth: API-owned append-versioned license records and version-bound module-entitlement rows in canonical Postgres; controlled supersession changes only the current-version pointer fields.
- Write owner: database owner only in this slice. A future billing/provisioning adapter must use a separately reviewed role, idempotent command and source readback.
- Readback: read-only transaction, `app.tenant_id` RLS context and an explicit tenant predicate produce a fresh canonical snapshot for deterministic evaluation.
- Invariants: forced RLS, no anon/authenticated/service-role grants, runtime role read-only, one current aggregate license version per tenant, exact module/access enums, content digest, no license-to-authority promotion and no production migration application in this project.
- Non-scope: pricing, checkout, invoicing, subscription collection, grace-period policy, customer activation, billing webhooks or production deployment.
- Acceptance proof: migration/security-source tests, tenant-scoped read service tests, route authentication contract, full repository gates and zero managed effects.
