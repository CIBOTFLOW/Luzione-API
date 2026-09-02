# A02 G0 Candidate Handoff

## Identity

- Work package: `A02` — Shared identity, tenant, command, receipt and readback contract drafts
- Controller review: `CIBOTFLOW/Luzione-platform-program@bc04797a16ff0a7949c677cc7fa4c3aafc039c7b`
- Repository: `CIBOTFLOW/Luzione-API`
- Branch: `codex/a02-shared-contract-drafts-g0`
- Draft pull request: `#58`, stacked on the A01 branch
- Base: A01 PR #57 head `9b5366266918ed4222acf54ce685bab15f6f104d`
- Exact implementation SHA: `f2d643a0913b888809c217adfd9bdcef0385b05a`
- Exact automated-CI evidence head: `3cd4cd6a1ed358a549fff9e29fac1daa28e78437`
- Engineering state: `BOUNDED_PASS`
- Release evidence: `PREVIEW_PROVEN` for build only
- Effect authority: `NO_EFFECT`
- Finality: `BOUNDED_CLAIM`
- Immutable preview: GitHub deployment `6232238860`, status `17702151898`, `https://luzione-9lis0ykgh-connor-spiegelmans-projects.vercel.app`
- Automated-CI-head preview: GitHub deployment `6232422081`, status `17702648058`, `https://luzione-31hr9jwy9-connor-spiegelmans-projects.vercel.app`

This is a G0 draft candidate. It is not integrated or production-ready.

## Contract versions

- `luzione-shared-contracts/v0.2-draft.1`
- `luzione-identity-tenant/v0.2-draft.1`
- `luzione-command-envelope/v0.2-draft.1`
- `luzione-receipt-envelope/v0.2-draft.1`
- `luzione-readback-envelope/v0.2-draft.1`

Consumers must pin all five versions together at the exact producer SHA and use
repository-local adapters. Luzione API remains the only writer of the shared
field meanings.

## Changed paths

- `architecture/production-convergence/A02_G0_WORKING_CONTRACT.md`
- `contracts/drafts/*.json`
- `docs/platform-engineering/A02_SHARED_CONTRACT_DRAFTS_V0.2.md`
- `src/modules/shared-contract-drafts/contracts.ts`
- `src/modules/shared-contract-drafts/adapters.ts`
- `src/modules/shared-contract-drafts/tests/shared-contract-drafts.test.ts`
- `src/modules/platform-contracts/registry.ts`
- `src/modules/platform-testing/taxonomy.ts`
- `scripts/validation/a02-contract-draft-rehearsal.sql`
- `scripts/validation/a02-contract-draft-rehearsal.ts`
- `scripts/validation/run-a02-contract-draft-rehearsal.sh`
- `package.json`

## Exact verification

| Boundary | Result |
|---|---|
| `npm run compliance:verify` | PASS, 7 control documents |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS, 230/230 |
| focused A02 suite | PASS, 5/5 |
| `npm run build` | PASS, Next.js 16.3.4 webpack build |
| `npm run proof:a02-contracts` fresh shape | PASS |
| `npm run proof:a02-contracts` observed-upgrade shape | PASS |
| exact-SHA Vercel preview build | SUCCESS |
| Release gate at `3cd4cd6a1ed358a549fff9e29fac1daa28e78437` | PASS, run `33691790213` |
| CodeQL at `3cd4cd6a1ed358a549fff9e29fac1daa28e78437` | PASS, run `33691790139` |
| preview release/livez/readyz/healthz | 302 to Vercel SSO; canary not exercised |

## Negative paths and readback

Credential/request actor drift, tenant drift, missing credential capability,
command actor/correlation/payload-hash drift, receipt tenant/hash drift,
readback tenant/receipt/command drift, stale and unknown pins all fail closed.
Provider acknowledgement stays non-final. Fresh source confirmation alone may
be business-final; stale source confirmation returns `RECONCILING`.

The disposable Postgres proof exercises tenant-bound P110 receipt/event/outbox
readback, exact version metadata, a same-key/different-payload conflict, zero
cross-tenant rows and legacy-row preservation. No draft route or runtime
activation exists, so deployed contract readback is not applicable.

## Rollback proof

An intentionally raised transaction error leaves no partial receipt. Both the
fresh and observed-upgrade proof databases are dropped and the temporary
Postgres container is removed. The draft adds no migration or truth store; code
rollback is removal of this isolated branch candidate. No production rollback
was run or authorized.

## Risks and deferred boundaries

- A02 depends on A01 and D01 reaching G1 before any integration claim.
- The preview is access-protected, so only its build status is proven.
- The implementation SHA itself retains zero GitHub Actions runs; draft PR #58
  passed both canonical workflows at the exact evidence head containing that
  unchanged implementation.
- Sultan OS has returned bounded A03 G0 evidence; independent Luzione UI
  evidence remains outstanding.
- No managed migration, credential change, command activation, public promotion,
  production readback or production rollback is included.

## One next action

Collect independent exact-SHA G0 adapter, negative and zero-write evidence from
Luzione UI against all five pins while keeping execution `NO_EFFECT`; preserve
draft PR #58 without integration or promotion until the controller records both
A01 and D01 at G1.
