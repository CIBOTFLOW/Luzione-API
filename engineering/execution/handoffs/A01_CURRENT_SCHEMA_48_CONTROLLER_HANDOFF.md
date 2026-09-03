# A01 current-schema 48-relation G0 handoff

Status: `done | BOUNDED_PASS | LOCAL_PROVEN | NO_EFFECT | BOUNDED_CLAIM`.

This candidate is not integrated or production-ready.

## Immutable candidate

- Repository: `CIBOTFLOW/Luzione-API`
- Branch: `codex/a01-current-schema-48-rehearsal-g0`
- Base: `main@7ee5a0a53a3434c3e00969dc626a4daad33f9dc0`
- Implementation SHA: `48dee5d107309e749d77ad7d99607bc2bac45efd`
- Draft PR: `#61`
- Release gate: `33712446489` success
  - exact-SHA A01 job `100514622780` success
  - repository verify job `100514622911` success
- CodeQL: `33712446424` success
- Immutable A01 artifact: `9877379010`, `a01-current-schema-48dee5d107309e749d77ad7d99607bc2bac45efd`
- Artifact digest: `sha256:b45605e8e0824c73a1a4ec9eff49b83fe7a259dd91372097b7dd7a4c8717577f`
- Evidence record: `engineering/execution/readiness/A01_CURRENT_SCHEMA_48_G0_EVIDENCE_20260903.json`

## Current public production observation

Controller-supplied canonical readback remains:

- `/api/v1/release`: 200
- `/api/v1/livez`: 200
- `/api/v1/readyz`: 200, database `READY`
- `/api/v1/healthz`: 503, 39/48 relations and 69 violations
- Non-v1 404 routes are expected; no alias was added.

This lane did not access or change production data, schema, principals, credentials, secrets, DNS, aliases, deployments, protection, default branch, or rollback state.

## Isolated candidate proof

Disposable PostgreSQL 16 reproduced the exact 39/48 and 69-violation baseline, applied only the six existing ordered migrations, and returned 48/48 with zero violations. The candidate proved:

- five active permission-denied probes;
- 96 `anon`/`authenticated` relation denials;
- 38 legacy `service_role` tenant-relation denials;
- ten runtime sensitive-relation denials;
- 42 provider-worker out-of-scope denials;
- two representative cross-tenant insert denials spanning legacy and Stage-5 relations;
- zero missing-tenant representative rows, zero runtime-owned relations, and zero public tenant policies.

Exact-SHA synthetic HTTP readback returned release/livez/readyz/healthz/authenticated-RLS 200, with `READY_READ_ONLY`, 48/48, mutations and internal projections disabled, and no external-effect authority. Negative paths returned unauthenticated RLS 401 and invalid probe parameter 400.

Dump/restore then reproduced the exact original catalog evidence byte-for-byte. Rollback readback returned readyz 200 independently, healthz 503 and authenticated RLS 503 at exactly 39/48 and 69 violations, with effects still disabled. This is isolated rollback proof, not managed backup/PITR or production rollback proof.

Local verification passed seven compliance controls, typecheck, zero-warning lint, 26/26 focused security tests, 257/257 repository tests, the Next.js webpack production build, and the exact-SHA HTTP/rollback rehearsal.

## Preserved A02 draft

PR #58 and implementation `f2d643a0913b888809c217adfd9bdcef0385b05a` were not modified. Its exact draft pins remain:

- `luzione-shared-contracts/v0.2-draft.1`
- `luzione-identity-tenant/v0.2-draft.1`
- `luzione-command-envelope/v0.2-draft.1`
- `luzione-receipt-envelope/v0.2-draft.1`
- `luzione-readback-envelope/v0.2-draft.1`

## Failures, risks, and stops

- The superseded preflight ran active probes against missing Stage-5 relations and failed before it could assert the current baseline. The repaired proof separates no-probe public drift readback from active candidate denial probes and is exact-signature sensitive.
- A separate pre-existing Stage-5 disposable business rehearsal is quarantined outside this A01 mutation cone; it currently exposes fixture/runtime-locking drift and does not weaken the A01 catalog, RLS, cross-tenant, HTTP, or rollback evidence.
- Managed backup/PITR remains unproven and is a human/external G1 prerequisite.
- No production migration, principal membership change, exact candidate deployment/readback, promotion, or production rollback occurred.
- A01 is not controller-accepted at G1 and D01 remains below G1. A02 integration remains stopped.

Writer lock: released after the evidence-only branch head is pushed; no further repository mutation is planned by this lane.

## One next action

A named human database owner records one accessible project-specific managed backup/PITR restore receipt before any production migration window is considered.
