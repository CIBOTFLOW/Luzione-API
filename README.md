# Luzione API

The deterministic business platform between `app.luzione.com`, `os.luzione.com`, canonical Luzione data and approved external providers.

## Authority boundary

- **Luzione UI** owns human records, queues, documents, actions, approvals and understandable analytics.
- **Luzione API** owns canonical object contracts, commands, events, durable workflows, permissions, integrations, data operations, reliability and audit.
- **Sultan OS** owns reasoning, agents, tools, models, prompts, memory, simulations, evaluations and AI governance.

Sultan never writes around the API. Every consequential action must resolve an actor and tenant, submit a typed command, receive a durable receipt and read the canonical result back from its owner.

## Current release

This first release is intentionally fail-closed:

- A restricted technical console is available at `/`.
- `GET /api/v1/healthz` reports configuration and aggregate database-security readiness without exposing secret values.
- `GET /api/v1/catalog` publishes the object and platform ownership contract.
- `GET /api/v1/platform-guarantees` reads the existing P110/P111 canonical tables when authenticated and configured.
- `GET /api/v1/security/rls-readiness` authenticates a service actor and verifies the sensitive server-only RLS boundary; `?activeProbes=true` adds live role-denial probes.
- `POST /api/v1/platform-guarantees` remains disabled until command-service extraction, database proof, actor authority and recovery verification are complete.
- No provider calls or external effects are authorized.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Configure `DATABASE_URL`, `LUZIONE_API_SERVICE_TOKEN` and `PLATFORM_CONTINUATION_SECRET`.
3. Keep `LUZIONE_API_MUTATIONS_ENABLED=false`.
4. Run `npm install`, `npm run typecheck`, `npm test`, and `npm run dev`.

## Vercel environment

Configure the following encrypted server-only values in Preview and Production:

- `DATABASE_URL`
- `LUZIONE_API_SERVICE_TOKEN`
- `PLATFORM_CONTINUATION_SECRET`
- `APP_ENV=production`
- `LUZIONE_API_MUTATIONS_ENABLED=false`
- `LUZIONE_CANONICAL_TENANT_CODE=LUZIONE_INTERNAL`
- `DATABASE_POOL_MAX=3`

Use the Supabase transaction pooler for serverless production traffic. Keep prepared statements disabled at the infrastructure connection layer, align Vercel compute with the database region, and configure `DATABASE_CA_CERT` as soon as the managed CA is available. `/api/v1/livez` is the no-dependency load-balancer probe; `/api/v1/readyz` checks database connectivity and safe runtime configuration; `/api/v1/healthz` performs the deeper RLS posture check.

Optional future Supabase administrative integration uses `SUPABASE_URL` and the new `SUPABASE_SECRET_KEY`. Never expose the secret key through `NEXT_PUBLIC_*`.

## Canonical database

This service must initially connect to the existing Luzione Postgres/Supabase project. Do not create duplicate Account, Commercial Case, Proposal, Order, event, receipt, workflow or checkpoint stores. P110/P111 migrations remain under their existing migration authority until a verified ownership transfer is performed.

See [Architecture](docs/ARCHITECTURE.md) and [Cutover plan](docs/CUTOVER.md).

## Production workflow and governance surface

`GET /api/v1/workflows` publishes the nine launch workflow packs: eight general CRM/growth/commercial/work/service packs and one isolated luxury-home pack. `POST /api/v1/governance/evaluate` intersects the immutable platform constitution with the active tenant `sultan.autonomy` policy. The UI and Sultan may request an evaluation, but neither can supply its own actor, tenant, role, authority grant, policy version or approval.

The tenant policy is intentionally liberal for explicit A0/A1 capabilities. Exact bounded A2 changes can be enabled by a canonical one-time policy grant. External or binding A3 effects remain approval-gated and require provider reconciliation. A4 capabilities—money movement, self-granted authority, audit deletion, kill-switch bypass and constitution mutation—remain prohibited.
