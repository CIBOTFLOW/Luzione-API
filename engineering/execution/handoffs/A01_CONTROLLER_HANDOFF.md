# Work-Package Handoff

## Identity

- Work package: `A01` / `FW-API-001` — Restore API readiness without weakening security
- Prompt: `02`
- Repository: `CIBOTFLOW/Luzione-API`
- Branch: `codex/a01-api-readiness-restoration`
- Pull request: `#57` (draft)
- Starting SHA: `6f7191f0f5e59153541271ea291f3727015f5741`
- Ending SHA: `0d4fa2587b85f6cd50db7f713bf919d6bc7f8f6a` (verified implementation boundary; this handoff follows in a repository-only evidence commit)
- Deployment environment: exact-SHA protected preview; production remains on the starting SHA
- Immutable release identifier: preview `7GjEgvN54RoN8JbrSnVS7TFrU7G2`; current production `dpl_3TCkqyjzYwebcrDpjAdaw69Hc7SZ`

## Completed

The dependency graph now uses patched Next.js 16.3.4, eslint-config-next
16.3.4 and tsx 4.23.13 and reports zero vulnerabilities. The production build
uses Next.js's supported explicit webpack path after the local Turbopack worker
socket was unavailable. A deterministic, non-secret A01 readiness signature
identifies the exact production drift instead of treating aggregate health as
sufficient.

An isolated PostgreSQL 16 rehearsal builds the observed production shape,
proves the exact 39/40 and 61-violation failure, applies the existing API-PC-010
and API-PC-013 migrations twice, proves 40/40 with zero violations and negative
tenant/role cases, then restores the pre-migration dump and proves the original
fail-closed signature. No managed database, credential, production deployment,
command mutation or external effect was changed.

The managed preflight subsequently exposed an additional production defect:
`readyz` reused a named prepared statement through Supavisor's transaction
pooler. PostgreSQL recorded `prepared statement "readiness-v1" already exists`
at both observed 503s. Candidate `0d4fa2587b85f6cd50db7f713bf919d6bc7f8f6a`
uses an unnamed probe and adds a regression test. It also identifies the
deployed login as `luzione_api_readiness` and records its non-superuser,
`NOINHERIT`, zero-public-table-privilege posture without changing it.

## Changed paths

- `package.json`, `package-lock.json`, `next-env.d.ts`
- `src/modules/security-posture/rlsPosture.ts`
- `src/modules/security-posture/tests/rls-posture.test.ts`
- `scripts/validation/a01-readiness-preflight.ts`
- `scripts/validation/a01-observed-security-baseline.sql`
- `scripts/validation/run-a01-readiness-rehearsal.sh`
- `architecture/production-convergence/A01_WORKING_CONTRACT.md`
- `engineering/execution/readiness/A01_READINESS_EVIDENCE_20260902.json`
- `engineering/execution/readiness/A01_PRODUCTION_PREFLIGHT_20260902.json`
- `docs/runbooks/A01_PRODUCTION_READINESS_GATE.md`
- `engineering/execution/CURRENT_HANDOFF.json`
- `engineering/execution/SYSTEMS_ENGINEERING_PROOF_LEDGER.json`
- `engineering/execution/SYSTEMS_ENGINEERING_FAILURE_LEDGER.json`

## Contracts

- Consumed versions: `luzione-readiness-evidence/v1`, `luzione-reconciliation-state/v1`, `luzione-platform-failure/v1`, `luzione-request-identity/v1`, `luzione-api-contract/v0.1`
- Changed versions: none
- Compatibility: additive diagnostic/proof projection only; public and authenticated HTTP contracts are unchanged
- Migration required: yes, existing checksummed migrations `20260831070000` then `20260831090000`; managed application is not authorized or performed

## Verification

| Command or journey | Result | Evidence path / ID |
|---|---|---|
| `npm ci` | PASS; 391 packages, zero vulnerabilities | local output; lockfile at implementation SHA |
| `npm run compliance:verify` | PASS; 7 controls | local output |
| `npm run verify` | PASS; typecheck, lint, 225/225 tests, production build | GitHub Release gate `33603316756` |
| CodeQL | PASS | GitHub run `33603316773` |
| `npm run proof:a01-readiness` preflight | PASS; exact 39/40 and 61 violations | `engineering/execution/readiness/A01_READINESS_EVIDENCE_20260902.json` |
| candidate migration/readback | PASS; 40/40, zero violations, four active probes | same evidence artifact |
| API-PC-013 negative journey | PASS; 90 client-role denials, cross-tenant and worker denial | same evidence artifact |
| dump/restore rollback | PASS; exact 39/40 failure signature restored | same evidence artifact |
| exact-SHA Vercel preview build | READY, access protected | `7GjEgvN54RoN8JbrSnVS7TFrU7G2` |
| preview HTTP canary | NOT EXERCISED; Vercel authorization unavailable | preview URL in evidence artifact |
| production `livez` | 200 LIVE at starting SHA | request `78f3df20-25b6-45c0-a5e0-ce4c75ab67e9` |
| production `readyz` | 503 on the old SHA; exact pooler prepared-statement collision found | request `3b391fb8-69be-4ba2-a3c4-54f5fdca8211`; managed PostgreSQL logs |
| production `healthz` | 503, intentionally fail closed at 39/40 and 61 violations | request `4c68dd92-a716-4a91-9f18-e403586d916c` |
| deployed principal review | PASS BOUNDED; `luzione_api_readiness`, NOINHERIT, no unsafe attributes, ownership or public-table privilege | `engineering/execution/readiness/A01_PRODUCTION_PREFLIGHT_20260902.json` |

## Effect evidence

- Correlation ID: production read-only health request `7884a0ba-538e-486d-be7d-51117e555762`
- Command/event ID: not applicable; no command was admitted
- Approval: no production DDL, credential or promotion approval was present
- Execution receipt: local test/process exit success only; no business-effect receipt claimed
- Provider/ledger result: GitHub Release gate, CodeQL and Vercel preview build succeeded
- Canonical readback: read-only Postgres catalogs establish production drift; isolated candidate establishes 40/40 only in disposable Postgres

## Negative and recovery tests

- Unauthorized: `anon`, `authenticated` and legacy `service_role` denied across 30 convergence relations; public policies remain absent
- Cross-tenant: runtime cross-tenant insert denied; tenant A sees only tenant A rows
- Duplicate/replay: both migrations reapply successfully and no duplicate roles/policies are created
- Stale/out-of-order: the production SHA remains explicitly distinct from the candidate and cannot satisfy candidate readiness
- Partial failure: migrations are transactional; the gate forbids promotion when catalog or health readback fails
- Rollback/restore: a pre-migration dump is restored into a fresh database and the exact fail-closed 39/40 signature is recovered

## Deployment status

The exact candidate is `PREVIEW_BUILD_READY_ACCESS_PROTECTED`, not canary-proven
and not production-deployed. Production remains `DEPLOYED_NOT_READY` at
`6f7191f0f5e59153541271ea291f3727015f5741`: liveness is healthy, dependency
readiness intermittently fails on the repaired prepared-statement defect, and
the deeper security gate correctly returns 503.

## Not completed

- Managed migrations `20260831070000` and `20260831090000` are not applied.
- The deployed database login principal is reviewed but intentionally unchanged;
  enabling inheritance would also activate its existing memberships.
- Preview health/readiness could not be fetched through Vercel deployment protection.
- No project-specific managed backup receipt or PITR window is visible through
  the connected Supabase authority, so the restore prerequisite is unverified.
- The candidate is not promoted; production 40/40 and `healthz=200` at its exact SHA are therefore not proven.
- Controller acceptance has not occurred; A02 remains blocked by A01 and D01.

## Risks

The role/grant migration intentionally removes legacy `service_role` access from
30 convergence relations. Applying it without an exact managed recovery point
could interrupt reads or require a managed restore. The deployed principal is
now identified and safely left unchanged, and the migration and restore are
proven locally, but managed PITR/backup restore and Vercel promotion remain
unexercised. No score increase or production-final claim is requested.

## Score effect

Dependency security, release reproducibility, negative security evidence and
local recovery evidence are materially stronger. The live-operation score and
overall cap must not increase because production `healthz` remains 503 and the
preview canary is access-protected. The controller awards any score change.

## Next action

The named Supabase and Vercel owners execute
`docs/runbooks/A01_PRODUCTION_READINESS_GATE.md`: record a verified managed
restore point, apply the two checksummed migrations in order, review the
`DATABASE_URL` principal's least-privilege membership, promote exact candidate
`0d4fa2587b85f6cd50db7f713bf919d6bc7f8f6a`, and accept only if the same SHA
returns 40/40 with `livez=200`, `readyz=200`, `healthz=200`, four denied active
probes, mutations disabled and external effects unauthorized.

## L1 regression-recovery addendum — 2026-09-03T01:04:42Z

Production remains on `6f7191f0f5e59153541271ea291f3727015f5741` and
immutable deployment `dpl_3TCkqyjzYwebcrDpjAdaw69Hc7SZ`. Supabase project
`cfwkqhenhnvnnwpxdjns` is `ACTIVE_HEALTHY`, but its PostgreSQL logs independently
record five additional `prepared statement "readiness-v1" already exists`
errors from `2026-09-02T23:54:32.129Z` through `23:54:55.070Z`. Eight later
production samples returned `readyz=200`; those are bounded availability
observations, not retirement of the intermittent defect on the old release.
Production `healthz` remains deliberately fail closed at 39/40 and 61
violations with mutations disabled and external effects unauthorized.

Draft stacked PR #59 adds evidence automation only. Exact evidence candidate
`fd1698e80ea9873564c615ab5d2c5163e1c10812` leaves runtime implementation
`0d4fa2587b85f6cd50db7f713bf919d6bc7f8f6a` unchanged. Release gate
`33702096449` and CodeQL `33702096468` passed. Job `100483366543` explicitly
checked out the exact branch head, built it, reproduced 39/40, reached 40/40,
proved four active denial probes, 90 client-role denials and cross-tenant
denial, served exact-SHA `release`, `livez`, `readyz` and `healthz` over HTTP,
then restored the baseline and proved `readyz=200` plus fail-closed
`healthz=503` at 39/40 and 61 violations. Immutable artifact `9873897168`,
`a01-readiness-fd1698e80ea9873564c615ab5d2c5163e1c10812`, has digest
`sha256:7a068f41e3aebb45155d17919e5abda4005018a983bc7c6e9e28659f0891b0d5`.
This is synthetic disposable CI evidence, not a managed preview or production
claim.

The same SHA built Vercel preview `BxyW3w9ezAf2tm46NN3uNycEViMa`, GitHub
deployment `6234868473` / status `17709031739`, at
`https://luzione-dzwaelsks-connor-spiegelmans-projects.vercel.app`. Direct
`release`, `livez`, `readyz` and `healthz` requests all return 302 to Vercel
SSO; both authenticated fetch and scoped share-link creation fail because the
connected identity cannot access project `prj_hEQQeozR9ZfauHr1QWvxZiZ3A9pQ`.
No deployment protection, secret, alias, production release or database state
was changed.

A02 remains frozen: PR #58 terminal head
`5bd078db71fda5186cebd8c471988d4da298f649`, implementation
`f2d643a0913b888809c217adfd9bdcef0385b05a`, and all five
`v0.2-draft.1` versions are unchanged. A02 integration remains blocked until
A01 and D01 meet G1.

### Exact next action

The Vercel project owner creates one expiring share link scoped to deployment
`BxyW3w9ezAf2tm46NN3uNycEViMa`; L1 then records exact-SHA `release`, `livez`,
`readyz` and `healthz` HTTP readback without disabling or changing deployment
protection.
