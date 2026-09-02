# Work-Package Handoff

## Identity

- Work package: `A01` / `FW-API-001` — Restore API readiness without weakening security
- Prompt: `02`
- Repository: `CIBOTFLOW/Luzione-API`
- Branch: `codex/a01-api-readiness-restoration`
- Pull request: `#57` (draft)
- Starting SHA: `6f7191f0f5e59153541271ea291f3727015f5741`
- Ending SHA: `00d345eb29ecff3a8b031276a58d24b2a73972f1` (verified implementation boundary; this handoff follows in a repository-only evidence commit)
- Deployment environment: exact-SHA protected preview; production remains on the starting SHA
- Immutable release identifier: preview `E63DinBh2roTbkwWttTGxTw3Xfsp`; current production `dpl_3TCkqyjzYwebcrDpjAdaw69Hc7SZ`

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

## Changed paths

- `package.json`, `package-lock.json`, `next-env.d.ts`
- `src/modules/security-posture/rlsPosture.ts`
- `src/modules/security-posture/tests/rls-posture.test.ts`
- `scripts/validation/a01-readiness-preflight.ts`
- `scripts/validation/a01-observed-security-baseline.sql`
- `scripts/validation/run-a01-readiness-rehearsal.sh`
- `architecture/production-convergence/A01_WORKING_CONTRACT.md`
- `engineering/execution/readiness/A01_READINESS_EVIDENCE_20260902.json`
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
| `npm run verify` | PASS; typecheck, lint, 224/224 tests, production build | GitHub Release gate `33597984639` |
| CodeQL | PASS | GitHub run `33597984671` |
| `npm run proof:a01-readiness` preflight | PASS; exact 39/40 and 61 violations | `engineering/execution/readiness/A01_READINESS_EVIDENCE_20260902.json` |
| candidate migration/readback | PASS; 40/40, zero violations, four active probes | same evidence artifact |
| API-PC-013 negative journey | PASS; 90 client-role denials, cross-tenant and worker denial | same evidence artifact |
| dump/restore rollback | PASS; exact 39/40 failure signature restored | same evidence artifact |
| exact-SHA Vercel preview build | READY, access protected | `E63DinBh2roTbkwWttTGxTw3Xfsp` |
| preview HTTP canary | NOT EXERCISED; Vercel authorization unavailable | preview URL in evidence artifact |
| production `livez` | 200 LIVE at starting SHA | request `496e02aa-bdb2-4f52-b42e-4dcfcbafe84a` |
| production `readyz` | 200 READY; database ready, pooler detected | request `2de47f32-fe10-4a95-8cb8-3c425d7f1ef2` |
| production `healthz` | 503, intentionally fail closed at 39/40 and 61 violations | request `7884a0ba-538e-486d-be7d-51117e555762` |

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
`6f7191f0f5e59153541271ea291f3727015f5741`: liveness and dependency readiness
are healthy, while the deeper security gate correctly returns 503.

## Not completed

- Managed migrations `20260831070000` and `20260831090000` are not applied.
- The deployed database login principal has not been reviewed or bound to the least-privilege runtime group.
- Preview health/readiness could not be fetched through Vercel deployment protection.
- The candidate is not promoted; production 40/40 and `healthz=200` at its exact SHA are therefore not proven.
- Controller acceptance has not occurred; A02 remains blocked by A01 and D01.

## Risks

The role/grant migration intentionally removes legacy `service_role` access from
30 convergence relations. Applying it before confirming the Vercel database
principal and managed recovery point could interrupt reads or require a managed
restore. The migration and restore are proven locally, but managed PITR and the
deployed credential transition remain unexercised. No score increase or
production-final claim is requested.

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
`00d345eb29ecff3a8b031276a58d24b2a73972f1`, and accept only if the same SHA
returns 40/40 with `livez=200`, `readyz=200`, `healthz=200`, four denied active
probes, mutations disabled and external effects unauthorized.
