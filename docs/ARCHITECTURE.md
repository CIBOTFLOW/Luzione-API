# Architecture

```text
app.luzione.com ─┐
client portal ───┼──> api.luzione.com ───> canonical Postgres and approved providers
os.luzione.com ──┘          │
       ▲                    └──> durable events, receipts, checkpoints and readback
       └──────── permitted evidence and context; never shadow authority
```

## Extracted foundation

The pure P110/P111 contract modules in `src/modules/platform-guarantees` are retained from the completed Luzione guarantee foundation:

- universal event envelopes and stable payload hashing;
- client-authority rejection;
- atomic command kernel and idempotency conflict contract;
- bounded retry decisions and reconciliation after possible acknowledgement;
- workflow transition invariants and checkpoints;
- signed, expiring, exact-version continuations;
- self-explaining flows and recovery playbooks.

The canonical Postgres records remain the existing P110/P111 tables. This repository does not contain a copied migration because migration authority must move only after the current schema, RLS, constraints and production history are reconciled.

## Security posture

- Server-side Postgres only; `DATABASE_URL` is never public.
- Mutations fail closed by default.
- Service authentication uses a high-entropy bearer token plus explicit tenant and actor headers for the initial server-to-server boundary.
- A later slice will verify Supabase user JWTs through current signing keys and map authorization from non-user-editable app metadata.
- Client payloads cannot grant actor, tenant, roles, permissions, source confirmation or external-effect authority.
- Provider acknowledgement is transport evidence, not business completion.
- API responses use request IDs and `no-store`.

## Supabase posture

The service connects directly to Postgres for canonical P110/P111 records. If Supabase Data API endpoints are later added, use a dedicated exposed API schema, explicit grants and RLS. New secret keys (`sb_secret_*`) are server-only; legacy `service_role` keys are not introduced into new code.


## Database security readiness

`GET /api/v1/security/rls-readiness` is a service-authenticated, read-only contract over the canonical Postgres catalog. It verifies the first server-only control-plane boundary and the API-PC-013 production-convergence surface: ten credential, authentication, connector, service-client and migration relations plus thirty admitted P110/P111 and commercial/order relations must exist and have the required RLS posture. The admitted convergence relations must force RLS, remove direct `anon`, `authenticated` and legacy `service_role` table authority, keep the non-login API runtime and provider-worker roles from owning or bypassing relations, and constrain the worker to its six delivery/reconciliation relations. Unsafe default grants for future tables also fail readiness.

The public health endpoint reports only aggregate pass/fail posture and returns 503 unless configuration and this RLS gate pass. Authorized callers may add `?activeProbes=true` to prove that `anon` and `authenticated` reads against both server-only and convergence relations fail with PostgreSQL `42501 permission_denied`. No row values, credentials or connection details are returned. Production migration application and deployed credential membership remain separate release-authorized operations.

## Autonomy boundary

The autonomy constitution in `src/modules/autonomy` assigns every registered capability an effect class. A model or client may describe an intent, but it cannot choose a lower class, submit tenant or actor identity, assert approval, or mint authority.

- **A0** is read-only analysis or no-effect simulation.
- **A1** is a reversible internal effect under a pre-granted, scoped policy.
- **A2** is a consequential but reversible effect requiring exact action-version human approval.
- **A3** is an external or binding effect requiring one-time human approval, idempotency, reconciliation, rollback and source readback.
- **A4** is prohibited through the agent action path, including direct payments and changes to authority, the constitution, kill switches, audit history or budget guardrails.

`POST /api/v1/autonomy/evaluate` performs only authenticated deterministic evaluation. It deliberately has no authority-store adapter and therefore cannot allow A1–A3 in production yet. The pure evaluator accepts a `VerifiedAuthorityGrant` only as an internal server-side dependency so a later canonical-store adapter can be tested without weakening this boundary.
