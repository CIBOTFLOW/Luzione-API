# A02 G0 Candidate Handoff

## Identity

- Work package: `A02` — Shared identity, tenant, command, receipt and readback contract drafts
- Controller release: `CIBOTFLOW/Luzione-platform-program@19cf3a752f761a632349ab2581efc2730a557964`
- Repository: `CIBOTFLOW/Luzione-API`
- Branch: `codex/a02-shared-contract-drafts-g0`
- Base: A01 PR #57 head `9b5366266918ed4222acf54ce685bab15f6f104d`
- Exact implementation SHA: `f2d643a0913b888809c217adfd9bdcef0385b05a`
- Engineering state: `BOUNDED_PASS`
- Release evidence: `PREVIEW_PROVEN` for build only
- Effect authority: `NO_EFFECT`
- Finality: `BOUNDED_CLAIM`
- Immutable preview: GitHub deployment `6232238860`, status `17702151898`, `https://luzione-9lis0ykgh-connor-spiegelmans-projects.vercel.app`

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
| exact-SHA GitHub Actions | NOT RUN; branch push did not match a workflow trigger |
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
- Canonical GitHub CI did not run for the pushed branch.
- Neither consumer has returned independent exact-SHA evidence yet.
- No managed migration, credential change, command activation, public promotion,
  production readback or production rollback is included.

## One next action

Collect independent exact-SHA G0 adapter evidence from Sultan OS and Luzione UI
against all five pins while keeping execution `NO_EFFECT`; do not begin A02
integration until the controller records both A01 and D01 at G1.
