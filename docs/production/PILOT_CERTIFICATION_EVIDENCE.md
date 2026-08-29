# Luzione Pilot Certification Evidence

Evidence time: `2026-08-29`  
Certification boundary: Luzione UI, Luzione API, Sultan OS, Postgres/Supabase,
OpenAI, Gmail, and private Google Docs/PDF.  
Current truth status: `TESTED_LOCAL` and exact-head preview evidence only.  
Certification decision: **not yet 100/100 certified**.

This register contains no tenant data, secret values, customer identifiers, or
provider payloads. Private receipts must be attached to the authorized release
record before certification.

## Exact candidate

| Component | Last code-bearing candidate commit | Review | Exact-head deployment/check |
| --- | --- | --- | --- |
| Luzione UI | `ca698cde0f3724d36502e07a518ee3b96006da31` | [PR #530](https://github.com/CIBOTFLOW/Luzione-UI/pull/530) | [Vercel preview](https://vercel.com/connor-spiegelmans-projects/luzione_ui/7GLDzgA2BnHN7GLm1yLEPAMKqUqt), successful |
| Luzione API | `87fb576b06f5eb1fd70a6ebc28ea48b18e2b9dd6` | [PR #31](https://github.com/CIBOTFLOW/Luzione-API/pull/31) | Exact-head deployment is refreshed by the PR after this evidence-only successor |
| Sultan OS | `0216135f5a59c48844a0b2a884d1345f44dfff51` | [PR #284](https://github.com/CIBOTFLOW/Sultan-OS/pull/284) | [Vercel attempt](https://vercel.com/connor-spiegelmans-projects/sultan-os/6gM8Np6LMkmQzXKTZPxEp7Jajvp6), blocked by account policy |

The API PR head includes this evidence-only document after the code-bearing
commit shown above. Its immutable final head is recorded by PR #31 and must be
bound by the signed platform release manifest; the document does not attempt
to embed the SHA of the commit that contains itself.

Rollback source commits are UI `2f3d6e42b244519dca79c0674cdfba5b85d45630`,
API `9f402ab6735f64c630c5ebe16dfe58557268ce6d`, and Sultan
`ccd81d514de8332a42e9d7d8f5c9081a588bc12a`. Database rollback remains the
backward-compatible upgraded schema plus the restored production backup; no
production migration has been applied by this candidate.

## Reproducible local evidence

- UI typecheck, zero-warning/zero-error lint, and production Webpack build pass.
- UI migration, runtime schema, RLS posture, integration, Shopify, governance,
  proposal, operations, platform-guarantee, Reality Lab, and changed-domain
  suites pass. The changed-domain set is `98/98`.
- API typecheck, lint, `140/140` tests, and production Webpack build pass. The
  runtime webhook registry now activates only explicitly allowlisted providers,
  resolves a single connected/pass-validated/non-kill-switched endpoint, reads
  only `env:` or tenant-bound `vault:` material, verifies HMAC, and otherwise
  fails closed. Final exact-head Release gate and CodeQL are recorded by PR #31.
- Sultan TypeScript, `7/7` platform tests, `294/294` operator tests, governance
  workflows, and production build pass.
- Production-only `npm audit` reports zero vulnerabilities for UI, API, and
  Sultan. CycloneDX 1.5 generation succeeds from each locked dependency graph.
  A tracked-file high-risk credential-pattern scan found no API matches and
  only identifier/name suffix false positives in UI/Sultan; no matched value
  was printed. Retained, signed SBOM artifacts and a dedicated CI secret scanner
  are still required for certification.
- The exact UI build's protected Connection Center route fails closed to
  `AUTH_CONFIGURATION_REQUIRED` when no authenticated runtime is configured.
  Its desktop and `390px` login boundary produced no console/network errors and
  no horizontal overflow. This is responsive/auth-boundary evidence only, not
  an authenticated Connection Center journey. The hosted preview is protected
  by Vercel login in the available test browser.
- Two independent empty-clone replays of the complete UI and API migration
  chains produced the same ledgers. UI: `148|136|af331d2f41016b1ee171e53a4bcd94ff`.
  API: `14|13|ac180e6b92936d23e2d43c9728ad7367`.
- Guarded rollback and reapplication of UI migrations 135 and 136 restored the
  hardened state. The release-manifest verifier rejects unsigned, dirty,
  checksum-mismatched, non-immutable, or non-`LIVE_EXTERNAL` candidates.
- The preserved dirty QuickBooks checkout was not reset, stashed, or modified.
  Candidate migration 134 exposes only an API-owned A0 projection; QuickBooks
  effects remain disabled.

## Certification gates

| Category | Current evidence | Missing 10/10 evidence |
| --- | --- | --- |
| Golden journey | Local governed components exist | One controlled production journey, deduplicated rerun, reply/proposal receipts, and crash-boundary validation |
| Tenancy | Canonical UUID model, membership enforcement, and local isolation tests | 24-hour zero-mismatch production shadow window and signed workload canary |
| Governance | Authority v2, exact approvals, A4 denial, compensation/readback contracts, and v1 preservation are tested | Production receipt chain for the controlled canary |
| Integrations | Connection contract and fail-closed legacy states are implemented | Real Gmail, private Google Docs/PDF, OpenAI, API/Postgres, and atomic Shopify readback receipts |
| Reliability | Durable commands, leases, retries, circuits, dead letters, reconciliation, and kill switches are implemented and tested | Production checkpoint/readback and controlled failure drill |
| AI cost control | Deterministic routing, effective-dated prices, metering, safe fallback, and budget controls are tested | Budgeted real OpenAI readback under the shared `$5` cap |
| Security | Local lint, test, build, CodeQL, grants/RLS, redaction, secret boundaries, and signed-manifest checks pass | Zero live Supabase advisor `WARN`/`ERROR`, classification of active-risk `INFO`, dependency/secret-scan closure, and exact-artifact SBOMs |
| Recovery | Deterministic empty-clone replay and guarded migration rollback pass | Fresh production-backup restore, data comparison, previous-binary proof, and retained production rollback artifacts |
| Observability | Audit/usage/queue/provider structures are implemented | Production dashboards, alerts, and alert-delivery proof |
| Operations | UI/API exact-head previews and GitHub checks pass | Sultan Vercel policy resolution, all exact-head checks, load/browser gates, signed immutable manifest, promotion and rollback drill |

No category receives 10/10 from design or local evidence alone. Any active hard
gate keeps the release below 100; no waiver changes this decision.

## Fail-closed blockers

1. Reconcile the production application ledger, Supabase management history,
   and signed release manifest by migration identity and SHA-256 checksum.
2. Restore the newest production backup into the isolated validation project,
   run both complete migration replays, previous-binary compatibility, data
   comparison, advisor scans, and rollback proof twice from scratch.
3. Remediate every live Supabase security/performance `WARN`/`ERROR` and classify
   every `INFO` that could represent active risk.
4. Resolve Sultan's Vercel collaboration policy with an authorized team/service
   identity and obtain an exact-head preview.
5. Generate exact-artifact SBOMs, close dependency and secret-scan findings,
   complete desktop/390px browser checks and the specified load test.
6. Supply the protected release signer, immutable artifact/deployment IDs, and
   verify the signed manifest in the authorized promotion environment.
7. Complete the 24-hour tenancy shadow window, signed-principal canary, and only
   then run the allowlisted internal Gmail/Google/OpenAI golden journey. Disable
   the Gmail pilot-send flag immediately after evidence capture.

Customer communication, payments, binding commitments, credential rotation,
deletion, Bravi effects, and non-pilot provider mutations remain prohibited.
