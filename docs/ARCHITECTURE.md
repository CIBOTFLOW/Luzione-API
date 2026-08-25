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
